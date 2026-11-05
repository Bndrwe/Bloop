// Security review v2, check 3: the Brightspace login window policy, the host and navigation rules,
// same-origin API requests (including paging `Next` links) and "no cookies or tokens in logs".
// brightspace.ts is pure; brightspaceApp.ts imports electron, so its wiring is checked statically.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { describe, expect, it, vi } from 'vitest'
import {
  BRIGHTSPACE_PARTITION,
  BrightspaceClient,
  BrightspaceError,
  isLoginSuccessUrl,
  LOGIN_ALLOWED_PERMISSIONS,
  navigationDecision,
  normalizeBrightspaceHost,
  type FetchLike
} from '../src/main/brightspace'
import type { TrustedOrigins } from '../src/main/ai/guard'

const ROOT = process.cwd()
const read = (rel: string): string => readFileSync(join(ROOT, rel), 'utf8')
const ORIGIN = 'https://school.brightspace.example'

const rendererOrigins: TrustedOrigins = {
  rendererIndex: '/opt/bloop/out/renderer/index.html',
  packaged: true,
  platform: 'linux'
}

describe('login navigation policy (check 3)', () => {
  it.each([
    'http://sso.example.edu/login',
    'http://school.brightspace.example/d2l/login',
    'file:///etc/passwd',
    'file:///home/user/.ssh/id_rsa',
    'javascript:alert(document.cookie)',
    'data:text/html,<script>alert(1)</script>',
    'blob:https://school.brightspace.example/abc',
    'bloop://internal/x',
    'chrome://settings',
    'ftp://files.example.edu/x',
    'https://user:pw@sso.example.edu/',
    'https://someone@sso.example.edu/'
  ])('denies %s', (url) => {
    expect(navigationDecision(url, 'brightspace-login')).toBe('deny')
  })

  it('denies over-long URLs and non-string input', () => {
    expect(navigationDecision('https://sso.example.edu/' + 'a'.repeat(9000), 'brightspace-login')).toBe('deny')
    expect(navigationDecision(undefined as unknown as string, 'brightspace-login')).toBe('deny')
    expect(navigationDecision(null as unknown as string, 'brightspace-login')).toBe('deny')
  })

  it.each(['https://login.microsoftonline.com/common/oauth2', 'https://sso.example.edu/idp/profile/SAML2', ORIGIN + '/d2l/login', 'about:blank'])(
    'allows %s (SSO and Brightspace pages)',
    (url) => {
      expect(navigationDecision(url, 'brightspace-login')).toBe('allow')
    }
  )

  it('Bloop windows only allow our own renderer, never https', () => {
    const renderer = pathToFileURL(rendererOrigins.rendererIndex).href
    expect(navigationDecision(renderer, 'bloop', { origins: rendererOrigins })).toBe('allow')
    expect(navigationDecision(ORIGIN + '/d2l/home', 'bloop', { origins: rendererOrigins })).toBe('deny')
    expect(navigationDecision('file:///etc/passwd', 'bloop', { origins: rendererOrigins })).toBe('deny')
    expect(navigationDecision(renderer, 'bloop')).toBe('deny') // no origins given: nothing is trusted
  })

  it('login only counts as done on the school origin home / course pages', () => {
    expect(isLoginSuccessUrl(ORIGIN + '/d2l/home', ORIGIN)).toBe(true)
    expect(isLoginSuccessUrl(ORIGIN + '/d2l/le/123/content', ORIGIN)).toBe(true)
    expect(isLoginSuccessUrl('https://evil.example/d2l/home', ORIGIN)).toBe(false)
    expect(isLoginSuccessUrl('http://school.brightspace.example/d2l/home', ORIGIN)).toBe(false)
  })

  it('login permissions are the two storage ones only (camera, mic, location, notifications denied)', () => {
    expect([...LOGIN_ALLOWED_PERMISSIONS].sort()).toEqual(['clipboard-sanitized-write', 'storage-access', 'top-level-storage-access'])
    for (const p of ['media', 'geolocation', 'notifications', 'midi', 'hid', 'serial', 'usb']) expect(LOGIN_ALLOWED_PERMISSIONS.has(p)).toBe(false)
  })
})

describe('school address: https only, no credentials, no IPs unless the test flag is set', () => {
  it.each(['http://purdue.brightspace.com', 'ftp://purdue.brightspace.com', 'https://user:pw@purdue.brightspace.com', 'https://10.0.0.5', 'https://localhost', 'https://intranet', 'x'.repeat(301), 42, null])(
    'rejects %j',
    (raw) => {
      expect(normalizeBrightspaceHost(raw).ok).toBe(false)
    }
  )

  it('accepts a bare school host and returns the https origin', () => {
    expect(normalizeBrightspaceHost('purdue.brightspace.com/d2l/home')).toEqual({ ok: true, origin: 'https://purdue.brightspace.com', host: 'purdue.brightspace.com' })
  })

  it('local hosts are only allowed with the explicit test flag', () => {
    expect(normalizeBrightspaceHost('https://localhost:8443', { allowLocal: false }).ok).toBe(false)
    expect(normalizeBrightspaceHost('https://localhost:8443', { allowLocal: true }).ok).toBe(true)
  })
})

describe('API requests only go to the configured https origin (check 3)', () => {
  function client(fetchFn: FetchLike): BrightspaceClient {
    return new BrightspaceClient(ORIGIN, fetchFn)
  }
  const json = (body: unknown, status = 200): Response => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

  it('refuses absolute and protocol-relative URLs to other sites without sending anything', async () => {
    const fetchFn = vi.fn(async () => json({}))
    const c = client(fetchFn)
    await expect(c.get('https://evil.example/steal')).rejects.toBeInstanceOf(BrightspaceError)
    await expect(c.get('//evil.example/steal')).rejects.toBeInstanceOf(BrightspaceError)
    await expect(c.get('http://school.brightspace.example/x')).rejects.toBeInstanceOf(BrightspaceError)
    expect(fetchFn).not.toHaveBeenCalled()
  })

  it('same-origin paths are requested with manual redirects and the session cookies', async () => {
    const fetchFn = vi.fn(async () => json([{ ProductCode: 'lp', LatestVersion: '1.0' }]))
    await client(fetchFn).get('/d2l/api/versions/')
    expect(fetchFn).toHaveBeenCalledWith(ORIGIN + '/d2l/api/versions/', expect.objectContaining({ redirect: 'manual', credentials: 'include', method: 'GET' }))
  })

  it('a paging Next link pointing at another site is refused and never requested', async () => {
    const fetchFn = vi.fn(async () => json({ Objects: [{ id: 1 }], Next: 'https://evil.example/collect?cookie=1' }))
    const c = client(fetchFn) as unknown as { objectList(path: string): Promise<unknown[]> }
    await expect(c.objectList('/d2l/api/lp/1/enrollments/')).rejects.toBeInstanceOf(BrightspaceError)
    const urls = fetchFn.mock.calls.map((a) => String((a as unknown[])[0]))
    expect(urls.every((u) => u.startsWith(ORIGIN + '/'))).toBe(true)
    expect(urls.some((u) => u.includes('evil.example'))).toBe(false)
  })

  it('a same-origin Next link is followed (paging still works)', async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce(json({ Objects: [{ id: 1 }], Next: '/d2l/api/lp/1/enrollments/?page=2' }))
      .mockResolvedValueOnce(json({ Objects: [{ id: 2 }], Next: null }))
    const c = client(fetchFn as unknown as FetchLike) as unknown as { objectList(path: string): Promise<unknown[]> }
    await expect(c.objectList('/d2l/api/lp/1/enrollments/')).resolves.toEqual([{ id: 1 }, { id: 2 }])
    expect(String(fetchFn.mock.calls[1]![0])).toBe(ORIGIN + '/d2l/api/lp/1/enrollments/?page=2')
  })

  it('a redirect to the login page counts as an expired session, not as data', async () => {
    const redirect = new Response(null, { status: 302, headers: { location: 'https://sso.example.edu/login' } })
    await expect(client(vi.fn(async () => redirect)).get('/d2l/api/versions/')).rejects.toMatchObject({ kind: 'expired' })
  })
})

describe('login wiring and logging (check 3, static)', () => {
  const app = read('src/main/brightspaceApp.ts')
  const prefs = app.slice(app.indexOf('function loginWebPreferences'), app.indexOf('\n}\n', app.indexOf('function loginWebPreferences')))

  it('the login window uses its own partition, sandbox, no node and no preload', () => {
    expect(prefs).toContain('partition: BRIGHTSPACE_PARTITION')
    expect(prefs).toContain('sandbox: true')
    expect(prefs).toContain('nodeIntegration: false')
    expect(prefs).toContain('contextIsolation: true')
    expect(prefs).toContain('webviewTag: false')
    expect(prefs).not.toMatch(/preload/i)
    expect(BRIGHTSPACE_PARTITION).toBe('persist:brightspace')
  })

  it('the login BrowserWindow takes these preferences and no preload', () => {
    const win = app.slice(app.indexOf('const win = new BrowserWindow('), app.indexOf('loginWin = win'))
    expect(win).toContain('webPreferences: loginWebPreferences()')
    expect(win).not.toMatch(/preload/i)
  })

  it('brightspace contents go to the login policy, everything else to the strict Bloop guard', () => {
    const index = read('src/main/index.ts')
    const ai = read('src/main/ai/ipc.ts')
    expect(index).toContain('hardenSpecial: hardenBrightspaceContents')
    expect(ai).toMatch(/if \(deps\.hardenSpecial\?\.\(contents\)\) return\s*\n\s*hardenWebContents\(contents, origins, openExternalSafe\)/)
  })

  it('the Brightspace partition is only handed to the login policy, never to Bloop windows', () => {
    const win = read('src/main/windows.ts')
    expect(win).not.toContain('persist:brightspace')
    expect(win).not.toContain('brightspace')
  })

  it('no cookie, token, header or password value is logged by the Brightspace code', () => {
    const sensitive = /cookie|token|authorization|set-cookie|password|headers|res\.url|\bbody\b/i
    for (const f of ['src/main/brightspace.ts', 'src/main/brightspaceApp.ts']) {
      const lines = read(f)
        .split('\n')
        .filter((l) => /\b(log|console\.\w+)\(/.test(l) && !/^\s*\/\//.test(l))
      expect(lines.filter((l) => sensitive.test(l)), f).toEqual([])
    }
  })

  it('the API client never writes responses to the log', () => {
    const src = read('src/main/brightspace.ts')
    expect(src).not.toMatch(/console\.(log|info|warn|error)\(/)
  })
})

// Known gap, found in review (not a test failure): the login policy listens for `will-navigate` and
// `will-redirect` on the top frame only. A subframe (an SSO iframe) navigating to an http: or other
// non-https URL is not checked. Electron emits `will-frame-navigate` for that; the fix belongs in
// brightspaceApp.ts hardenBrightspaceContents and needs Electron to exercise, so it is noted in the
// report rather than tested here.
