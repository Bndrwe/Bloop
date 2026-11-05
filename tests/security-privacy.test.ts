// Privacy / integrity: nothing is fetched without the user's say-so, downloads are pinned and
// bounded, the Ollama URL is scheme-checked, API clients can't be redirected by env, and the
// renderer CSP stays strict.
import { mkdtempSync, existsSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { createHash } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({ file: {} as Record<string, unknown> }))
vi.mock('electron', () => ({
  safeStorage: {
    isEncryptionAvailable: () => true,
    encryptString: (s: string) => Buffer.from('ENC:' + s),
    decryptString: (b: Buffer) => b.toString().slice(4)
  }
}))
vi.mock('electron-store', () => ({
  default: class {
    get(k: string) {
      return state.file[k]
    }
    set(k: string, v: unknown) {
      state.file[k] = v
    }
  }
}))

import { BloopManager, findBundledModel, isSafeModelFileName, type BloopCatalogEntry } from '../src/main/ai/local/bloop'
import { pullOllamaModel } from '../src/main/ai/local/ollama'
import { normalizeOllamaUrl } from '../src/main/ai/settings'
import { ANTHROPIC_BASE_URL, anthropicClientOptions, _resetOpenRouterCache } from '../src/main/ai/cloud/api'
import { cloudModule } from '../src/main/ai/cloud'
import { saveApiKey } from '../src/main/ai/cloud/secrets'
import * as detect from '../src/main/ai/cloud/cli-detect'

const DATA = Buffer.from('GGUF' + 'y'.repeat(3000))
const SHA = createHash('sha256').update(DATA).digest('hex')
const catalog = (over: Partial<BloopCatalogEntry> = {}): BloopCatalogEntry => ({
  id: 'bloop-qwen3.5-0.8b',
  label: 'Bloop',
  url: 'https://example.test/bloop.gguf',
  sha256: SHA,
  bytes: DATA.length,
  file: 'bloop.gguf',
  ...over
})
const stream = (buf: Buffer): ReadableStream<Uint8Array> =>
  new ReadableStream({
    start(c) {
      for (let i = 0; i < buf.length; i += 700) c.enqueue(new Uint8Array(buf.subarray(i, i + 700)))
      c.close()
    }
  })
const fakeRes = (buf: Buffer, url = 'https://cdn.example.test/bloop.gguf') =>
  ({ ok: true, status: 200, url, body: stream(buf), headers: new Headers() }) as unknown as Response

let dir: string
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'bloop-sec-'))
  state.file = {}
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('Bloop model download integrity', () => {
  it('refuses a non-https URL or a missing / malformed sha256 without fetching', async () => {
    for (const over of [{ url: 'http://example.test/x.gguf' }, { url: 'file:///etc/passwd' }, { sha256: '' }, { sha256: 'abc' }, { file: '../evil.gguf' }]) {
      const f = vi.fn()
      const m = new BloopManager({ modelsDir: () => dir, catalog: catalog(over), fetch: f as never, freeBytes: async () => 1e12 })
      const r = await m.download(true)
      expect(r.ok, JSON.stringify(over)).toBe(false)
      expect(f).not.toHaveBeenCalled()
    }
  })
  it('stops a response bigger than the pinned size and deletes the partial file', async () => {
    const f = vi.fn(async () => fakeRes(Buffer.concat([DATA, Buffer.alloc(5000)])))
    const m = new BloopManager({ modelsDir: () => dir, catalog: catalog(), fetch: f as never, freeBytes: async () => 1e12 })
    const r = await m.download(true)
    expect(r.ok).toBe(false)
    expect(r.error).toMatch(/bigger/)
    expect(existsSync(join(dir, 'bloop.gguf.part'))).toBe(false)
    expect(existsSync(join(dir, 'bloop.gguf'))).toBe(false)
  })
  it('stops when a redirect lands on plain http', async () => {
    const f = vi.fn(async () => fakeRes(DATA, 'http://mirror.example.test/bloop.gguf'))
    const m = new BloopManager({ modelsDir: () => dir, catalog: catalog(), fetch: f as never, freeBytes: async () => 1e12 })
    const r = await m.download(true)
    expect(r.ok).toBe(false)
    expect(r.error).toMatch(/non-https/)
    expect(existsSync(join(dir, 'bloop.gguf'))).toBe(false)
  })
  it('writes .part, verifies, then renames', async () => {
    const f = vi.fn(async () => fakeRes(DATA))
    const m = new BloopManager({ modelsDir: () => dir, catalog: catalog(), fetch: f as never, freeBytes: async () => 1e12 })
    expect(await m.download(true)).toEqual({ ok: true })
    expect(readFileSync(join(dir, 'bloop.gguf')).equals(DATA)).toBe(true)
    expect(existsSync(join(dir, 'bloop.gguf.part'))).toBe(false)
  })
  it('bundled metadata cannot point outside its folder', () => {
    expect(isSafeModelFileName('bloop-qwen3.5-0.8b-Q4_K_M.gguf')).toBe(true)
    for (const bad of ['..', '../x.gguf', '..\\x.gguf', '/etc/x.gguf', '.hidden.gguf', 'x.bin', 'a/b.gguf', 'a..b.gguf']) expect(isSafeModelFileName(bad), bad).toBe(false)
    writeFileSync(join(dir, 'bloop-model.json'), JSON.stringify({ file: '..', bytes: 1, sha256: '' }))
    expect(findBundledModel(dir)).toBeNull()
  })
})

describe('Ollama', () => {
  it('pull never fetches without confirmation or with a bad model name', async () => {
    const f = vi.fn()
    vi.stubGlobal('fetch', f)
    expect((await pullOllamaModel('http://127.0.0.1:11434', 'qwen3.5:0.8b', false, () => undefined)).ok).toBe(false)
    for (const bad of ['', '-rf', 'a b', 'x'.repeat(300), 'a;b', 'a\nb']) {
      expect((await pullOllamaModel('http://127.0.0.1:11434', bad, true, () => undefined)).ok, bad).toBe(false)
    }
    expect(f).not.toHaveBeenCalled()
  })
  it('URL setting: http(s) only, no credentials, query/hash dropped', () => {
    expect(normalizeOllamaUrl('127.0.0.1:11434')).toBe('http://127.0.0.1:11434')
    expect(normalizeOllamaUrl('localhost:11434')).toBe('http://localhost:11434')
    expect(normalizeOllamaUrl('http://localhost:11434/')).toBe('http://localhost:11434')
    expect(normalizeOllamaUrl('https://ollama.lan:443/?x=1#y')).toBe('https://ollama.lan')
    for (const bad of ['file:///etc/passwd', 'file:/etc/passwd', 'javascript:alert(1)', 'data:text/plain,hi', 'ftp://x', 'http://user:pw@host:11434', '', 42, null]) {
      expect(normalizeOllamaUrl(bad), String(bad)).toBeNull()
    }
  })
})

describe('cloud: no network until the user opts in', () => {
  it('opening settings (status) does not contact OpenRouter without a key', async () => {
    _resetOpenRouterCache()
    vi.spyOn(detect, 'resolveBinary').mockResolvedValue(null)
    const f = vi.fn()
    vi.stubGlobal('fetch', f)
    await cloudModule.status(true)
    expect(f).not.toHaveBeenCalled()
    // once an OpenRouter key is saved, the (public) model list may be fetched
    expect(saveApiKey('openrouter', 'sk-or-v1-0123456789abcdef').ok).toBe(true)
    f.mockResolvedValue({ ok: true, status: 200, json: async () => ({ data: [] }) })
    await cloudModule.status(true)
    expect(f).toHaveBeenCalledTimes(1)
    expect(String(f.mock.calls[0]![0])).toMatch(/^https:\/\/openrouter\.ai\//)
  })
  it('the Anthropic client is pinned: base URL, no env auth token, no SDK logging', () => {
    const o = anthropicClientOptions('k')!
    expect(o.baseURL).toBe(ANTHROPIC_BASE_URL)
    expect(ANTHROPIC_BASE_URL).toBe('https://api.anthropic.com')
    expect(o.authToken).toBeNull()
    expect(o.logLevel).toBe('off')
  })
})

describe('renderer CSP (src/renderer/index.html)', () => {
  const html = readFileSync(resolve(__dirname, '../src/renderer/index.html'), 'utf8')
  const csp = html.match(/http-equiv="Content-Security-Policy"\s+content="([^"]+)"/)?.[1] ?? ''
  const dir = (name: string): string[] | undefined =>
    csp
      .split(';')
      .map((d) => d.trim().split(/\s+/))
      .find((d) => d[0] === name)
      ?.slice(1)
  it('is present and default-deny', () => {
    expect(csp).not.toBe('')
    expect(dir('default-src')).toEqual(["'none'"])
  })
  it('allows only our own scripts: no inline, eval or remote code', () => {
    expect(dir('script-src')).toEqual(["'self'"])
    expect(csp).not.toMatch(/unsafe-eval|https?:|\*/)
  })
  it('renderer makes no network requests of its own', () => {
    expect(dir('connect-src')).toEqual(["'self'"])
  })
  it('still allows bundled fonts and data: CSS images (works from file://)', () => {
    expect(dir('font-src')).toEqual(["'self'", 'data:'])
    expect(dir('img-src')).toEqual(["'self'", 'data:'])
  })
  it('locks down plugins, frames, base and forms', () => {
    for (const d of ['object-src', 'frame-src', 'base-uri', 'form-action']) expect(dir(d), d).toEqual(["'none'"])
  })
})
