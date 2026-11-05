// Use Local: Bloop downloader, Ollama client, local module 'auto' order. No real network/models.
import { mkdirSync, mkdtempSync, existsSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ app: { getPath: () => tmpdir(), isPackaged: false } }))
vi.mock('../src/main/store', () => ({ getAiSettings: () => ({ choice: { kind: 'auto' }, cloudModels: {}, autoCloud: [], ollamaUrl: 'http://127.0.0.1:11434', bloopOfferDismissed: false, bloopEnabled: false }) }))
const execFileMock = vi.fn()
vi.mock('node:child_process', () => ({ execFile: (...a: unknown[]) => execFileMock(...a) }))

import { BloopManager, BloopRuntime, bundledModelDirs, type BloopCatalogEntry } from '../src/main/ai/local/bloop'
import {
  findOllamaBinary,
  friendlyOllamaError,
  ollamaChat,
  parseChat,
  parseTags,
  pickAutoOllamaModel,
  probeOllama,
  pullOllamaModel
} from '../src/main/ai/local/ollama'
import { createLocalModule } from '../src/main/ai/local'
import type { AiSettings } from '../src/shared/ai'

const DATA = Buffer.from('GGUF' + 'x'.repeat(2000))
const catalog = (over: Partial<BloopCatalogEntry> = {}): BloopCatalogEntry => ({
  id: 'bloop-qwen3.5-0.8b',
  label: 'Bloop',
  url: 'https://example.test/bloop.gguf',
  sha256: createHash('sha256').update(DATA).digest('hex'),
  bytes: DATA.length,
  file: 'bloop.gguf',
  ...over
})
const bodyOf = (buf: Buffer): ReadableStream<Uint8Array> =>
  new ReadableStream({
    start(c) {
      for (let i = 0; i < buf.length; i += 500) c.enqueue(new Uint8Array(buf.subarray(i, i + 500)))
      c.close()
    }
  })

let dir: string
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'bloop-test-'))
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('BloopManager download', () => {
  it('refuses without confirmation and touches nothing', async () => {
    const f = vi.fn()
    const m = new BloopManager({ modelsDir: () => dir, catalog: catalog(), fetch: f as never })
    for (const c of [false, undefined, 'true', 1] as unknown[]) {
      const r = await m.download(c as boolean)
      expect(r.ok).toBe(false)
      expect(r.error).toMatch(/confirm/i)
    }
    expect(f).not.toHaveBeenCalled()
    expect(m.status().progress).toBeUndefined()
  })

  it('is disabled while the model is not published', async () => {
    const f = vi.fn()
    const m = new BloopManager({ modelsDir: () => dir, catalog: catalog({ url: '' }), fetch: f as never })
    const r = await m.download(true)
    expect(r).toMatchObject({ ok: false })
    expect(r.error).toMatch(/Not published yet/)
    expect(f).not.toHaveBeenCalled()
  })

  it('streams to .part, verifies sha256, renames, reports progress', async () => {
    const sha = createHash('sha256').update(DATA).digest('hex')
    const f = vi.fn(async () => new Response(bodyOf(DATA), { status: 200, headers: { 'content-length': String(DATA.length) } }))
    const onChange = vi.fn()
    const m = new BloopManager({ modelsDir: () => dir, catalog: catalog({ sha256: sha }), fetch: f as never, onChange, freeBytes: async () => 1e12 })
    expect(await m.download(true)).toEqual({ ok: true })
    expect(readFileSync(join(dir, 'bloop.gguf')).equals(DATA)).toBe(true)
    expect(existsSync(join(dir, 'bloop.gguf.part'))).toBe(false)
    const st = m.status()
    expect(st.downloaded).toBe(true)
    expect(st.progress?.state).toBe('done')
    expect(onChange).toHaveBeenCalled()
  })

  it('resumes with a Range request from an existing .part', async () => {
    writeFileSync(join(dir, 'bloop.gguf.part'), DATA.subarray(0, 800))
    const f = vi.fn(async (_u: string, init: RequestInit) => {
      expect((init.headers as Record<string, string>).Range).toBe('bytes=800-')
      const rest = DATA.subarray(800)
      return new Response(bodyOf(rest), { status: 206, headers: { 'content-length': String(rest.length) } })
    })
    const m = new BloopManager({ modelsDir: () => dir, catalog: catalog(), fetch: f as never, freeBytes: async () => 1e12 })
    expect(await m.download(true)).toEqual({ ok: true })
    expect(readFileSync(join(dir, 'bloop.gguf')).equals(DATA)).toBe(true)
  })

  it('rejects a checksum mismatch and deletes the file', async () => {
    const f = vi.fn(async () => new Response(bodyOf(DATA), { status: 200 }))
    const m = new BloopManager({ modelsDir: () => dir, catalog: catalog({ sha256: 'ab'.repeat(32) }), fetch: f as never, freeBytes: async () => 1e12 })
    const r = await m.download(true)
    expect(r.ok).toBe(false)
    expect(r.error).toMatch(/checksum/)
    expect(existsSync(join(dir, 'bloop.gguf'))).toBe(false)
    expect(existsSync(join(dir, 'bloop.gguf.part'))).toBe(false)
  })

  it('checks free disk space first', async () => {
    const f = vi.fn()
    const m = new BloopManager({ modelsDir: () => dir, catalog: catalog({ bytes: 500e6 }), fetch: f as never, freeBytes: async () => 100e6 })
    const r = await m.download(true)
    expect(r.error).toMatch(/disk space/)
    expect(f).not.toHaveBeenCalled()
  })

  it('imports a .gguf and refuses other files', async () => {
    const src = join(dir, 'mine.gguf')
    writeFileSync(src, DATA)
    const bad = join(dir, 'bad.gguf')
    writeFileSync(bad, 'nope')
    const m = new BloopManager({ modelsDir: () => join(dir, 'models'), catalog: catalog() })
    expect((await m.importFile(bad)).ok).toBe(false)
    expect((await m.importFile(src)).ok).toBe(true)
    expect(m.isDownloaded()).toBe(true)
    await m.delete()
    expect(m.isDownloaded()).toBe(false)
  })
})

describe('BloopRuntime (mocked node-llama-cpp)', () => {
  it('loads lazily with a 4096 context, uses a JSON-schema grammar and reuses the model', async () => {
    const prompt = vi.fn(async (_p: string, _o: Record<string, unknown>) => '{"ok":true}')
    const createGrammarForJsonSchema = vi.fn(async () => ({ grammar: true }))
    const createContext = vi.fn(async () => ({ getSequence: () => ({}), dispose: async () => undefined }))
    const loadModel = vi.fn(async () => ({ createContext, dispose: async () => undefined }))
    const getLlama = vi.fn(async () => ({ loadModel, createGrammarForJsonSchema, dispose: async () => undefined }))
    class LlamaChatSession {
      prompt = prompt
      dispose = vi.fn()
    }
    const load = vi.fn(async () => ({ getLlama, LlamaChatSession, LlamaLogLevel: { warn: 'warn' } }) as never)
    const rt = new BloopRuntime({ load, idleMs: 60_000 })
    expect(load).not.toHaveBeenCalled()
    const out = await rt.complete('/m.gguf', 'hi', { jsonSchema: { type: 'object' }, maxTokens: 50 })
    expect(out).toBe('{"ok":true}')
    await rt.complete('/m.gguf', 'again')
    expect(loadModel).toHaveBeenCalledTimes(1)
    expect(createContext).toHaveBeenCalledWith({ contextSize: 4096 })
    expect(createGrammarForJsonSchema).toHaveBeenCalledWith({ type: 'object' })
    expect(prompt.mock.calls[0]![1]).toMatchObject({ grammar: { grammar: true }, maxTokens: 50 })
    await rt.unload()
    expect(rt.isLoaded()).toBe(false)
  })
})

describe('Ollama', () => {
  it('parses /api/tags', () => {
    const models = parseTags({
      models: [
        { name: 'qwen3.5:0.8b', size: 1_000_000_000, details: { family: 'qwen35' } },
        { model: 'llama3.2:1b', size: 1_300_000_000, details: {} },
        { size: 5 }
      ]
    })
    expect(models).toEqual([
      { name: 'llama3.2:1b', sizeBytes: 1_300_000_000 },
      { name: 'qwen3.5:0.8b', sizeBytes: 1_000_000_000, family: 'qwen35' }
    ])
    expect(parseTags(null)).toEqual([])
  })

  it('probes version + tags and reports not running on failure', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) =>
        url.endsWith('/api/version') ? Response.json({ version: '0.12.3' }) : Response.json({ models: [{ name: 'a:1b', size: 10 }] })
      )
    )
    expect(await probeOllama('http://h:1/')).toEqual({ running: true, version: '0.12.3', models: [{ name: 'a:1b', sizeBytes: 10 }] })
    vi.stubGlobal('fetch', vi.fn(async () => Promise.reject(new TypeError('fetch failed'))))
    expect(await probeOllama('http://h:1')).toEqual({ running: false, models: [] })
  })

  it('chats with stream:false, format = schema and num_predict', async () => {
    const f = vi.fn(async () => Response.json({ message: { role: 'assistant', content: '{"a":1}' }, done: true }))
    vi.stubGlobal('fetch', f)
    const schema = { type: 'object' }
    expect(await ollamaChat('http://h:1', 'qwen3.5:0.8b', 'hello', { jsonSchema: schema, maxTokens: 300 })).toBe('{"a":1}')
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('http://h:1/api/chat')
    expect(JSON.parse(String(init.body))).toEqual({
      model: 'qwen3.5:0.8b',
      messages: [{ role: 'user', content: 'hello' }],
      stream: false,
      think: false,
      format: schema,
      options: { num_predict: 300 }
    })
    expect(() => parseChat({ error: 'boom' })).toThrow('boom')
  })

  it('retries without think when the server rejects it', async () => {
    const f = vi
      .fn()
      .mockResolvedValueOnce(Response.json({ error: 'invalid field: think' }, { status: 400 }))
      .mockResolvedValueOnce(Response.json({ message: { content: 'ok' } }))
    vi.stubGlobal('fetch', f)
    expect(await ollamaChat('http://h:1', 'llama3.2:1b', 'hi')).toBe('ok')
    expect(JSON.parse(String((f.mock.calls[0] as unknown as [string, RequestInit])[1].body)).think).toBe(false)
    expect('think' in JSON.parse(String((f.mock.calls[1] as unknown as [string, RequestInit])[1].body))).toBe(false)
  })

  it('maps a 404 to "model not found" and a refused connection to "open Ollama"', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ error: "model 'x' not found" }, { status: 404 })))
    await expect(ollamaChat('http://h:1', 'x', 'p')).rejects.toThrow(/model not found/)
    const e = friendlyOllamaError(Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNREFUSED' } }), { installed: true, url: 'u' })
    expect(e.message).toBe('Ollama is installed but not running: open Ollama')
  })

  it('pull refuses without confirmation', async () => {
    const f = vi.fn()
    vi.stubGlobal('fetch', f)
    const r = await pullOllamaModel('http://h:1', 'qwen3.5:0.8b', false, () => undefined)
    expect(r.ok).toBe(false)
    expect(f).not.toHaveBeenCalled()
  })

  it('pull streams NDJSON progress when confirmed', async () => {
    const lines = [
      { status: 'pulling manifest' },
      { status: 'pulling a', digest: 'a', total: 100, completed: 40 },
      { status: 'pulling a', digest: 'a', total: 100, completed: 100 },
      { status: 'success' }
    ]
    const text = lines.map((l) => JSON.stringify(l)).join('\n')
    vi.stubGlobal('fetch', vi.fn(async () => new Response(text)))
    const seen: number[] = []
    const r = await pullOllamaModel('http://h:1', 'qwen3.5:0.8b', true, (p) => seen.push(p.receivedBytes))
    expect(r).toEqual({ ok: true })
    expect(seen).toContain(40)
    expect(seen.at(-1)).toBe(100)
  })

  it('auto picks qwen3.5:0.8b, else the smallest', () => {
    expect(pickAutoOllamaModel([{ name: 'big', sizeBytes: 9 }, { name: 'qwen3.5:0.8b', sizeBytes: 99 }])?.name).toBe('qwen3.5:0.8b')
    expect(pickAutoOllamaModel([{ name: 'big', sizeBytes: 9 }, { name: 'small', sizeBytes: 3 }])?.name).toBe('small')
    expect(pickAutoOllamaModel([])).toBeNull()
  })

  it('finds the binary with `where` on Windows', async () => {
    execFileMock.mockImplementation((_c: string, _a: string[], _o: unknown, cb: (e: null, out: string) => void) => cb(null, 'C:\\Ollama\\ollama.exe\r\n'))
    expect(await findOllamaBinary('win32')).toBe('C:\\Ollama\\ollama.exe')
    expect(execFileMock.mock.calls[0]![0]).toBe('where')
  })
})

describe('local module', () => {
  let settings: AiSettings = { choice: { kind: 'auto' }, cloudModels: {}, autoCloud: [], ollamaUrl: 'http://h:1', bloopOfferDismissed: false, bloopEnabled: true }
  beforeEach(() => {
    settings = { choice: { kind: 'auto' }, cloudModels: {}, autoCloud: [], ollamaUrl: 'http://h:1', bloopOfferDismissed: false, bloopEnabled: true }
  })
  const make = (downloaded: boolean, models: { name: string; sizeBytes?: number }[], running = true) => {
    const bloop = new BloopManager({ modelsDir: () => dir, catalog: catalog() })
    if (downloaded) writeFileSync(join(dir, 'bloop.gguf'), DATA)
    const download = vi.spyOn(bloop, 'download')
    const runtime = { complete: vi.fn(async () => 'bloop says hi'), unload: vi.fn(async () => undefined) }
    const fetchSpy = vi.fn(async () => Response.json({ message: { content: 'ollama says hi' } }))
    vi.stubGlobal('fetch', fetchSpy)
    const mod = createLocalModule({
      getSettings: () => settings,
      onChange: () => undefined,
      bloop,
      runtime,
      findBinary: async () => '/usr/local/bin/ollama',
      probe: async () => ({ running, models })
    })
    return { mod, download, fetchSpy, runtime }
  }

  it('auto prefers a downloaded Bloop model', async () => {
    const { mod } = make(true, [{ name: 'qwen3.5:0.8b' }])
    expect((await mod.autoProvider())?.label).toBe('Bloop model (on-device)')
  })

  it('auto falls back to Ollama (qwen3.5:0.8b, else smallest)', async () => {
    expect((await make(false, [{ name: 'llama3:8b', sizeBytes: 5e9 }, { name: 'qwen3.5:0.8b', sizeBytes: 1e9 }]).mod.autoProvider())?.label).toBe(
      'Ollama · qwen3.5:0.8b'
    )
    expect((await make(false, [{ name: 'llama3:8b', sizeBytes: 5e9 }, { name: 'phi:2b', sizeBytes: 2e9 }]).mod.autoProvider())?.label).toBe('Ollama · phi:2b')
  })

  it('auto never downloads or pulls', async () => {
    const { mod, download, fetchSpy } = make(false, [])
    expect(await mod.autoProvider()).toBeNull()
    expect(download).not.toHaveBeenCalled()
    expect(fetchSpy).not.toHaveBeenCalled()
    const none = make(false, [], false)
    expect(await none.mod.autoProvider()).toBeNull()
    expect(none.fetchSpy).not.toHaveBeenCalled()
  })

  it('explains why an explicit choice is not ready', async () => {
    const { mod } = make(false, [{ name: 'a:1b' }])
    expect(await mod.provider({ kind: 'local', runtime: 'bloop', model: 'bloop-qwen3.5-0.8b' })).toBeInstanceOf(Error)
    const e = await mod.provider({ kind: 'local', runtime: 'ollama', model: 'qwen3.5:0.8b' })
    expect((e as Error).message).toMatch(/model not found/)
    const off = make(false, [], false)
    expect(((await off.mod.provider({ kind: 'local', runtime: 'ollama', model: 'a:1b' })) as Error).message).toBe(
      'Ollama is installed but not running: open Ollama'
    )
  })

  it('pullOllama refuses without confirmation', async () => {
    const { mod, fetchSpy } = make(false, [])
    expect((await mod.pullOllama('qwen3.5:0.8b', false)).ok).toBe(false)
    expect(fetchSpy).not.toHaveBeenCalled()
  })
})


describe('bundled Bloop model', () => {
  const sha = createHash('sha256').update(DATA).digest('hex')
  let res: string // fake <process.resourcesPath>
  let app: string // fake repo root
  const bundleAt = (root: string, withMeta = true): string => {
    const d = join(root, 'resources', 'models')
    mkdirSync(d, { recursive: true })
    writeFileSync(join(d, 'bloop-qwen3.5-0.8b-Q4_K_M.gguf'), DATA)
    if (withMeta) {
      writeFileSync(
        join(d, 'bloop-model.json'),
        JSON.stringify({ file: 'bloop-qwen3.5-0.8b-Q4_K_M.gguf', bytes: DATA.length, sha256: sha, base: 'Qwen3.5-0.8B', builtAt: '2026-01-01T00:00:00.000Z' })
      )
    }
    return join(d, 'bloop-qwen3.5-0.8b-Q4_K_M.gguf')
  }
  const mgr = (extra: Partial<ConstructorParameters<typeof BloopManager>[0]> = {}) =>
    new BloopManager({ modelsDir: () => join(dir, 'userData'), catalog: catalog(), bundledDirs: () => bundledModelDirs(app, res), ...extra })
  let settings: AiSettings
  const mod = (m: BloopManager) => {
    const runtime = { complete: vi.fn(async () => 'hi'), unload: vi.fn(async () => undefined) }
    const local = createLocalModule({ getSettings: () => settings, onChange: () => undefined, bloop: m, runtime, findBinary: async () => null, probe: async () => ({ running: false, models: [] }) })
    return { local, runtime }
  }
  beforeEach(() => {
    res = join(dir, 'Resources')
    app = join(dir, 'repo')
    settings = { choice: { kind: 'auto' }, cloudModels: {}, autoCloud: [], ollamaUrl: 'http://h:1', bloopOfferDismissed: false, bloopEnabled: false }
  })

  it('builds the packaged and dev directories', () => {
    // path.join uses the platform's separator, so build the expectations the same way (Windows CI)
    expect(bundledModelDirs('/repo', '/App/Contents/Resources')).toEqual([join('/App/Contents/Resources', 'resources', 'models'), join('/repo', 'resources', 'models')])
    expect(bundledModelDirs('/repo', undefined)).toEqual([join('/repo', 'resources', 'models')])
  })

  it('detects a model at the packaged path', () => {
    const p = bundleAt(res)
    const s = mgr().status()
    expect(s).toMatchObject({ source: 'bundled', downloaded: true, enabled: false, path: p, sizeBytes: DATA.length, base: 'Qwen3.5-0.8B' })
  })

  it('detects a model at the dev path (also without bloop-model.json)', () => {
    const p = bundleAt(app, false)
    expect(mgr().status()).toMatchObject({ source: 'bundled', path: p })
  })

  it('prefers bundled over a downloaded/imported model; reports other sources', () => {
    const m = mgr()
    expect(m.status().source).toBeNull()
    mkdirSync(join(dir, 'userData'), { recursive: true })
    writeFileSync(join(dir, 'userData', 'bloop.gguf'), DATA)
    expect(m.status().source).toBe('downloaded')
    writeFileSync(join(dir, 'userData', 'bloop.gguf.imported'), '')
    expect(m.status().source).toBe('imported')
    const p = bundleAt(res)
    expect(m.status()).toMatchObject({ source: 'bundled', path: p })
  })

  it("'auto' ignores the bundled model until it is enabled, then uses it", async () => {
    bundleAt(res)
    const { local } = mod(mgr())
    expect(await local.autoProvider()).toBeNull()
    settings = { ...settings, bloopEnabled: true }
    expect((await local.autoProvider())?.label).toBe('Bloop model (on-device)')
  })

  it('an explicit Bloop choice still needs the bundled model to be enabled', async () => {
    bundleAt(res)
    const { local } = mod(mgr())
    const choice = { kind: 'local' as const, runtime: 'bloop' as const, model: 'bloop-qwen3.5-0.8b' }
    expect(((await local.provider(choice)) as Error).message).toMatch(/off/i)
    settings = { ...settings, choice, bloopEnabled: true }
    const p = await local.provider(choice)
    expect(p).not.toBeInstanceOf(Error)
  })

  it('status carries enabled from settings; enabling never downloads', async () => {
    bundleAt(res)
    const m = mgr({ fetch: vi.fn() as never })
    const download = vi.spyOn(m, 'download')
    const fetchSpy = vi.fn()
    vi.stubGlobal('fetch', fetchSpy)
    const { local } = mod(m)
    expect((await local.status()).bloop).toMatchObject({ source: 'bundled', enabled: false })
    expect(await local.verifyBloop()).toEqual({ ok: true })
    settings = { ...settings, bloopEnabled: true }
    expect((await local.status()).bloop.enabled).toBe(true)
    expect(download).not.toHaveBeenCalled()
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('verifies the checksum once and caches by size+mtime', async () => {
    const p = bundleAt(res)
    const cache = join(dir, 'verified.json')
    const m = mgr({ verifyCacheFile: () => cache })
    expect(await m.verifyBundled()).toEqual({ ok: true })
    expect(existsSync(cache)).toBe(true)
    // A fresh manager trusts the cache without re-hashing: same size+mtime, even if the bytes were swapped.
    const st = (await import('node:fs')).statSync(p)
    writeFileSync(p, Buffer.from('GGUF' + 'y'.repeat(2000)))
    ;(await import('node:fs')).utimesSync(p, st.atime, st.mtime)
    expect(await mgr({ verifyCacheFile: () => cache }).verifyBundled()).toEqual({ ok: true })
    // A changed mtime forces a re-hash, which now fails.
    ;(await import('node:fs')).utimesSync(p, st.atime, new Date(st.mtimeMs + 5000))
    const r = await mgr({ verifyCacheFile: () => cache }).verifyBundled()
    expect(r.ok).toBe(false)
    expect(r.error).toMatch(/checksum/i)
  })

  it('cannot be deleted or replaced by an import', async () => {
    const p = bundleAt(res)
    const m = mgr()
    await expect(m.delete()).rejects.toThrow(/can't be deleted/)
    const { local, runtime } = mod(m)
    await expect(local.deleteBloop()).rejects.toThrow(/can't be deleted/)
    expect(runtime.unload).not.toHaveBeenCalled()
    expect(existsSync(p)).toBe(true)
    const src = join(dir, 'x.gguf')
    writeFileSync(src, DATA)
    expect((await m.importFile(src)).ok).toBe(false)
  })
})
