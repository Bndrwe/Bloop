// Use Local: Ollama client and the local module. No real network/models.
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ app: { getPath: () => '/tmp', isPackaged: false } }))
vi.mock('../src/main/store', () => ({ getAiSettings: () => ({ choice: { kind: 'auto' }, cloudModels: {}, autoCloud: [], ollamaUrl: 'http://127.0.0.1:11434' }) }))
const execFileMock = vi.fn()
vi.mock('node:child_process', () => ({ execFile: (...a: unknown[]) => execFileMock(...a) }))

import {
  findOllamaBinary,
  friendlyOllamaError,
  ollamaChat,
  parseChat,
  parseTags,
  probeOllama,
  pullOllamaModel
} from '../src/main/ai/local/ollama'
import { createLocalModule } from '../src/main/ai/local'
import { ollamaSetupStep, type AiSettings } from '../src/shared/ai'

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
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

  it('finds the binary with `where` on Windows', async () => {
    execFileMock.mockImplementation((_c: string, _a: string[], _o: unknown, cb: (e: null, out: string) => void) => cb(null, 'C:\\Ollama\\ollama.exe\r\n'))
    expect(await findOllamaBinary('win32')).toBe('C:\\Ollama\\ollama.exe')
    expect(execFileMock.mock.calls[0]![0]).toBe('where')
  })
})

describe('local module', () => {
  const settings: AiSettings = { choice: { kind: 'auto' }, cloudModels: {}, autoCloud: [], ollamaUrl: 'http://h:1' }
  const make = (models: { name: string; sizeBytes?: number }[], running = true) => {
    const fetchSpy = vi.fn(async () => Response.json({ message: { content: 'ollama says hi' } }))
    vi.stubGlobal('fetch', fetchSpy)
    const mod = createLocalModule({
      getSettings: () => settings,
      onChange: () => undefined,
      findBinary: async () => '/usr/local/bin/ollama',
      probe: async () => ({ running, models })
    })
    return { mod, fetchSpy }
  }

  it('has no auto provider (Auto never uses a local model)', () => {
    expect('autoProvider' in make([{ name: 'qwen3.5:0.8b' }]).mod).toBe(false)
  })

  it('an explicit Ollama choice resolves the exact model', async () => {
    const { mod, fetchSpy } = make([{ name: 'llama3:8b' }, { name: 'qwen3.5:0.8b' }])
    expect(((await mod.provider({ kind: 'local', runtime: 'ollama', model: 'llama3:8b' })) as { label: string }).label).toBe('Ollama · llama3:8b')
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('explains why an explicit choice is not ready', async () => {
    const { mod } = make([{ name: 'a:1b' }])
    const e = await mod.provider({ kind: 'local', runtime: 'ollama', model: 'qwen3.5:0.8b' })
    expect((e as Error).message).toMatch(/model not found/)
    const off = make([], false)
    expect(((await off.mod.provider({ kind: 'local', runtime: 'ollama', model: 'a:1b' })) as Error).message).toBe(
      'Ollama is installed but not running: open Ollama'
    )
  })

  it('status reports only Ollama', async () => {
    const { mod } = make([{ name: 'a:1b' }])
    const s = await mod.status()
    expect(Object.keys(s)).toEqual(['ollama'])
    expect(s.ollama).toMatchObject({ installed: true, running: true, url: 'http://h:1' })
  })

  it('pullOllama refuses without confirmation', async () => {
    const { mod, fetchSpy } = make([])
    expect((await mod.pullOllama('qwen3.5:0.8b', false)).ok).toBe(false)
    expect(fetchSpy).not.toHaveBeenCalled()
  })
})

describe('Ollama setup guide step', () => {
  it('1 when not running (installed or not), 2 when running with no models, 3 with models', () => {
    expect(ollamaSetupStep({ running: false, models: [] })).toBe(1)
    expect(ollamaSetupStep({ running: false, models: [{ name: 'stale:1b' }] })).toBe(1)
    expect(ollamaSetupStep({ running: true, models: [] })).toBe(2)
    expect(ollamaSetupStep({ running: true, models: [{ name: 'qwen3.5:0.8b' }] })).toBe(3)
  })
})
