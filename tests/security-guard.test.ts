// Electron hardening helpers (src/main/ai/guard.ts): trusted senders, navigation, window.open,
// permissions, openExternal URL policy.
import { describe, expect, it, vi } from 'vitest'
import {
  denyAllPermissions,
  guardSender,
  hardenWebContents,
  isSafeExternalUrl,
  isTrustedRendererUrl,
  isTrustedSender,
  rendererIndexFor,
  UntrustedSenderError,
  type TrustedOrigins
} from '../src/main/ai/guard'

const posix: TrustedOrigins = { rendererIndex: '/Applications/Bloop.app/Contents/Resources/app.asar/out/renderer/index.html', packaged: true, platform: 'darwin' }
const win: TrustedOrigins = { rendererIndex: 'C:\\Users\\Me\\AppData\\Local\\Programs\\Bloop\\resources\\app.asar\\out\\renderer\\index.html', packaged: true, platform: 'win32' }
const dev: TrustedOrigins = { rendererIndex: '/repo/out/renderer/index.html', devUrl: 'http://localhost:5173', packaged: false, platform: 'linux' }

describe('isSafeExternalUrl (openExternal / window.open policy)', () => {
  it('allows plain https links only', () => {
    expect(isSafeExternalUrl('https://ollama.com/download')).toBe(true)
    expect(isSafeExternalUrl('https://console.anthropic.com/settings/keys')).toBe(true)
    for (const bad of [
      'http://example.com',
      'file:///etc/passwd',
      'javascript:alert(1)',
      'smb://host/share',
      'ms-settings:privacy',
      'x-apple.systempreferences:com.apple.preference.security',
      'https://user:pass@example.com/',
      'not a url',
      '',
      'https://' + 'a'.repeat(3000) + '.com',
      42,
      null,
      { toString: () => 'https://x.com' }
    ]) {
      expect(isSafeExternalUrl(bad), String(bad)).toBe(false)
    }
  })
})

describe('isTrustedRendererUrl', () => {
  it('accepts exactly our packaged index.html (any hash route)', () => {
    expect(isTrustedRendererUrl('file:///Applications/Bloop.app/Contents/Resources/app.asar/out/renderer/index.html#/settings', posix)).toBe(true)
    expect(isTrustedRendererUrl('file:///Applications/Bloop.app/Contents/Resources/app.asar/out/renderer/other.html', posix)).toBe(false)
    expect(isTrustedRendererUrl('file:///Users/me/Downloads/evil.html', posix)).toBe(false)
    expect(isTrustedRendererUrl('file:///Applications/Bloop.app/Contents/Resources/app.asar/out/renderer/../../../../../../tmp/index.html', posix)).toBe(false)
    expect(isTrustedRendererUrl('https://evil.example/', posix)).toBe(false)
    expect(isTrustedRendererUrl('about:blank', posix)).toBe(false)
    expect(isTrustedRendererUrl('', posix)).toBe(false)
    expect(isTrustedRendererUrl(null, posix)).toBe(false)
  })
  it('handles Windows drive paths case-insensitively', () => {
    expect(isTrustedRendererUrl('file:///C:/Users/Me/AppData/Local/Programs/Bloop/resources/app.asar/out/renderer/index.html#/panel', win)).toBe(true)
    expect(isTrustedRendererUrl('file:///c:/users/me/appdata/local/programs/bloop/resources/app.asar/out/renderer/index.html', win)).toBe(true)
    expect(isTrustedRendererUrl('file:///D:/evil/index.html', win)).toBe(false)
    expect(isTrustedRendererUrl('file://evilhost/share/index.html', win)).toBe(false)
  })
  it('trusts the dev server origin only when not packaged', () => {
    expect(isTrustedRendererUrl('http://localhost:5173/#/panel', dev)).toBe(true)
    expect(isTrustedRendererUrl('http://localhost:5174/', dev)).toBe(false)
    expect(isTrustedRendererUrl('http://evil.localhost:5173/', dev)).toBe(false)
    expect(isTrustedRendererUrl('http://localhost:5173/', { ...dev, packaged: true })).toBe(false)
  })
  it('rendererIndexFor points at out/renderer/index.html inside the app root', () => {
    expect(rendererIndexFor('/x/app.asar').replace(/\\/g, '/')).toBe('/x/app.asar/out/renderer/index.html')
  })
})

describe('isTrustedSender / guardSender', () => {
  const ok = { senderFrame: { url: 'file:///Applications/Bloop.app/Contents/Resources/app.asar/out/renderer/index.html#/settings', parent: null } }
  it('accepts the top frame of our renderer', () => {
    expect(isTrustedSender(ok, posix)).toBe(true)
    expect(() => guardSender('ai:set-api-key', ok, posix)).not.toThrow()
  })
  it('rejects subframes, destroyed frames and foreign pages', () => {
    expect(isTrustedSender({ senderFrame: { ...ok.senderFrame, parent: {} } }, posix)).toBe(false)
    expect(isTrustedSender({ senderFrame: null }, posix)).toBe(false)
    expect(isTrustedSender({}, posix)).toBe(false)
    const foreign = { senderFrame: { url: 'https://evil.example/', parent: null } }
    expect(() => guardSender('ai:set-api-key', foreign, posix)).toThrow(UntrustedSenderError)
  })
})

function fakeContents() {
  const handlers: Record<string, (ev: { preventDefault(): void }, url: string) => void> = {}
  let openHandler: ((d: { url: string }) => { action: 'deny' }) | null = null
  return {
    handlers,
    get openHandler() {
      return openHandler!
    },
    setWindowOpenHandler: (h: (d: { url: string }) => { action: 'deny' }) => {
      openHandler = h
    },
    on: (event: string, l: (ev: { preventDefault(): void }, url: string) => void) => {
      handlers[event] = l
    }
  }
}

describe('hardenWebContents', () => {
  it('denies every new window; https ones open in the system browser', () => {
    const c = fakeContents()
    const open = vi.fn()
    hardenWebContents(c as never, posix, open)
    expect(c.openHandler({ url: 'https://ollama.com/download' })).toEqual({ action: 'deny' })
    expect(c.openHandler({ url: 'file:///etc/passwd' })).toEqual({ action: 'deny' })
    expect(c.openHandler({ url: 'http://example.com' })).toEqual({ action: 'deny' })
    expect(open).toHaveBeenCalledTimes(1)
    expect(open).toHaveBeenCalledWith('https://ollama.com/download')
  })
  it('blocks navigation away from the renderer and refuses <webview>', () => {
    const c = fakeContents()
    const open = vi.fn()
    hardenWebContents(c as never, posix, open)
    const ev = () => ({ preventDefault: vi.fn() })
    const away = ev()
    c.handlers['will-navigate']!(away, 'https://evil.example/')
    expect(away.preventDefault).toHaveBeenCalled()
    expect(open).toHaveBeenCalledWith('https://evil.example/') // a stray <a href> opens the browser instead
    const fileNav = ev()
    c.handlers['will-navigate']!(fileNav, 'file:///tmp/x.html')
    expect(fileNav.preventDefault).toHaveBeenCalled()
    const redirect = ev()
    c.handlers['will-redirect']!(redirect, 'http://169.254.169.254/')
    expect(redirect.preventDefault).toHaveBeenCalled()
    const self = ev()
    c.handlers['will-navigate']!(self, 'file:///Applications/Bloop.app/Contents/Resources/app.asar/out/renderer/index.html#/panel')
    expect(self.preventDefault).not.toHaveBeenCalled()
    const wv = ev()
    c.handlers['will-attach-webview']!(wv, '')
    expect(wv.preventDefault).toHaveBeenCalled()
  })
})

describe('denyAllPermissions', () => {
  it('denies camera, mic, notifications, geolocation... and every permission check', () => {
    let req: ((wc: unknown, p: string, cb: (g: boolean) => void) => void) | null = null
    let check: ((wc: unknown, p: string) => boolean) | null = null
    let device: ((d: unknown) => boolean) | null = null
    denyAllPermissions({
      setPermissionRequestHandler: (h) => (req = h),
      setPermissionCheckHandler: (h) => (check = h),
      setDevicePermissionHandler: (h) => (device = h)
    })
    for (const p of ['media', 'notifications', 'geolocation', 'clipboard-read', 'openExternal', 'fullscreen', 'hid', 'serial']) {
      const cb = vi.fn()
      req!(null, p, cb)
      expect(cb).toHaveBeenCalledWith(false)
      expect(check!(null, p)).toBe(false)
    }
    expect(device!({})).toBe(false)
  })
})
