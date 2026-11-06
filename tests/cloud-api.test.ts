import { beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({ file: {} as Record<string, unknown>, encAvailable: true }))

vi.mock('electron', () => ({
  safeStorage: {
    isEncryptionAvailable: () => state.encAvailable,
    encryptString: (s: string) => Buffer.from('ENC:' + Buffer.from(s).reverse().toString('latin1')),
    decryptString: (b: Buffer) => Buffer.from(b.toString().slice(4), 'latin1').reverse().toString()
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

import {
  OPENROUTER_DEFAULT_MODEL,
  _resetOpenRouterCache,
  buildOpenRouterBody,
  createOpenRouterProvider,
  fetchOpenRouterModels,
  openRouterErrorMessage,
  parseOpenRouterModels,
  parseOpenRouterResponse
} from '../src/main/ai/cloud/api'
import { cloudModule, CLOUD_ORDER, setCloudModelsReader } from '../src/main/ai/cloud'
import { getStoredKey, saveApiKey } from '../src/main/ai/cloud/secrets'
import * as detect from '../src/main/ai/cloud/cli-detect'

const KEY = 'sk-or-v1-TOPSECRETKEY1234567890'
const modelsJson = {
  data: [
    { id: 'z/zeta', name: 'Zeta', context_length: 1000, architecture: { input_modalities: ['text'], output_modalities: ['text'] }, supported_parameters: ['max_tokens'] },
    { id: OPENROUTER_DEFAULT_MODEL, name: 'Sonnet', architecture: { input_modalities: ['text', 'image'], output_modalities: ['text'] }, supported_parameters: ['structured_outputs', 'response_format'] },
    { id: 'a/img', name: 'Img', architecture: { input_modalities: ['text'], output_modalities: ['image'] } },
    { id: 'a/alpha:batch', name: 'Alpha batch', architecture: { output_modalities: ['text'] } },
    { id: 'a/alpha', name: 'Alpha', architecture: { output_modalities: ['text'] } },
    { nope: true }
  ]
}
const okJson = (body: unknown, status = 200) => ({ ok: status < 400, status, json: async () => body }) as unknown as Response

beforeEach(() => {
  state.file = {}
  state.encAvailable = true
  _resetOpenRouterCache()
  delete process.env['ANTHROPIC_API_KEY']
  setCloudModelsReader(() => ({}))
})

describe('OpenRouter models', () => {
  it('parses text models, drops batch/image/invalid, default first then A-Z', () => {
    const m = parseOpenRouterModels(modelsJson)
    expect(m.map((x) => x.id)).toEqual([OPENROUTER_DEFAULT_MODEL, 'a/alpha', 'z/zeta'])
    expect(m[0].structured).toBe(true)
    expect(m[2].structured).toBe(false)
    expect(() => parseOpenRouterModels({})).toThrow()
  })
  it('caches for 24h, backs off after a failure, serves stale on failure', async () => {
    const f = vi.fn().mockResolvedValue(okJson(modelsJson))
    const t0 = 1_000_000
    await fetchOpenRouterModels({ fetchImpl: f as never, now: t0 })
    await fetchOpenRouterModels({ fetchImpl: f as never, now: t0 + 3600e3 })
    expect(f).toHaveBeenCalledTimes(1)
    expect(f.mock.calls[0][0]).toBe('https://openrouter.ai/api/v1/models')
    const fail = vi.fn().mockRejectedValue(new Error('offline'))
    const stale = await fetchOpenRouterModels({ fetchImpl: fail as never, now: t0 + 25 * 3600e3 })
    expect(stale?.length).toBe(3)
    await fetchOpenRouterModels({ fetchImpl: fail as never, now: t0 + 25 * 3600e3 + 1000 })
    expect(fail).toHaveBeenCalledTimes(1)
  })
})

describe('OpenRouter request', () => {
  it('has the right url, headers and body', async () => {
    const f = vi.fn().mockResolvedValue(okJson({ choices: [{ message: { content: 'hello' } }] }))
    const out = await createOpenRouterProvider(KEY, 'a/alpha', f as never).complete('hi', { maxTokens: 50 })
    expect(out).toBe('hello')
    const [url, init] = f.mock.calls[0]
    expect(url).toBe('https://openrouter.ai/api/v1/chat/completions')
    expect(init.method).toBe('POST')
    expect(init.headers).toMatchObject({ Authorization: `Bearer ${KEY}`, 'X-Title': 'Bloop', 'Content-Type': 'application/json' })
    expect(init.headers).not.toHaveProperty('HTTP-Referer')
    expect(JSON.parse(init.body)).toEqual({ model: 'a/alpha', max_tokens: 50, messages: [{ role: 'user', content: 'hi' }] })
  })
  it('uses json_schema when supported, plain JSON prompting otherwise', () => {
    const schema = { type: 'object' }
    const a = buildOpenRouterBody('m', 'p', { jsonSchema: schema }, true)
    expect(a['response_format']).toMatchObject({ type: 'json_schema', json_schema: { strict: true, schema } })
    const b = buildOpenRouterBody('m', 'p', { jsonSchema: schema }, false)
    expect(b['response_format']).toBeUndefined()
    expect(JSON.stringify(b['messages'])).toContain('JSON Schema')
  })
  it('retries without response_format when the model rejects it', async () => {
    await fetchOpenRouterModels({ fetchImpl: vi.fn().mockResolvedValue(okJson(modelsJson)) as never })
    const f = vi
      .fn()
      .mockResolvedValueOnce(okJson({ error: { message: 'response_format not supported' } }, 400))
      .mockResolvedValueOnce(okJson({ choices: [{ message: { content: '{"a":1}' } }] }))
    const out = await createOpenRouterProvider(KEY, OPENROUTER_DEFAULT_MODEL, f as never).complete('p', { jsonSchema: { type: 'object' } })
    expect(out).toBe('{"a":1}')
    expect(JSON.parse(f.mock.calls[0][1].body).response_format).toBeDefined()
    expect(JSON.parse(f.mock.calls[1][1].body).response_format).toBeUndefined()
  })
  it('parses content parts and maps statuses to friendly errors', () => {
    expect(parseOpenRouterResponse({ choices: [{ message: { content: [{ type: 'text', text: 'a' }, { type: 'text', text: 'b' }] } }] })).toBe('ab')
    expect(() => parseOpenRouterResponse({ choices: [] })).toThrow(/empty/)
    expect(openRouterErrorMessage(401, {})).toMatch(/rejected/)
    expect(openRouterErrorMessage(402, {})).toMatch(/credits/)
    expect(openRouterErrorMessage(429, {})).toMatch(/Rate limited/)
  })
  it('never leaks the key in errors', async () => {
    const echo = vi.fn().mockResolvedValue(okJson({ error: { message: `bad key ${KEY}` } }, 500))
    const err = await createOpenRouterProvider(KEY, 'a/alpha', echo as never).complete('p').catch((e: Error) => e)
    expect((err as Error).message).not.toContain('TOPSECRET')
    const net = vi.fn().mockRejectedValue(new Error(`fetch failed for Bearer ${KEY}`))
    const err2 = await createOpenRouterProvider(KEY, 'a/alpha', net as never).complete('p').catch((e: Error) => e)
    expect((err2 as Error).message).not.toContain('TOPSECRET')
  })
})

describe('secrets and status', () => {
  it('encrypts at rest, never exposes the key in status', async () => {
    expect(saveApiKey('openrouter', KEY).ok).toBe(true)
    expect(JSON.stringify(state.file)).not.toContain('TOPSECRET')
    expect(getStoredKey('openrouter')).toBe(KEY)
    vi.spyOn(detect, 'resolveBinary').mockResolvedValue(null)
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(okJson(modelsJson)))
    const st = await cloudModule.status(true)
    expect(JSON.stringify(st)).not.toContain('TOPSECRET')
    const or = st.find((s) => s.id === 'openrouter')!
    expect(or).toMatchObject({ available: true, detail: 'key set' })
    expect(st.find((s) => s.id === 'anthropic')).toMatchObject({ available: false })
    vi.unstubAllGlobals()
  })
  it('refuses to store without safeStorage and explains why', () => {
    state.encAvailable = false
    const r = saveApiKey('anthropic', KEY)
    expect(r.ok).toBe(false)
    expect(r.error).toMatch(/secure storage/i)
    expect(state.file['aiKeys']).toBeUndefined()
  })
  it('setApiKey rejects bad input and removes with null, with no key in the error', async () => {
    const bad = await cloudModule.setApiKey('anthropic', 'has space in it 123456')
    expect(bad.ok).toBe(false)
    expect(bad.error).not.toContain('has space')
    await cloudModule.setApiKey('openrouter', KEY)
    expect(getStoredKey('openrouter')).toBe(KEY)
    expect((await cloudModule.setApiKey('openrouter', null)).ok).toBe(true)
    expect(getStoredKey('openrouter')).toBeNull()
  })
  it('falls back to ANTHROPIC_API_KEY from .env', async () => {
    process.env['ANTHROPIC_API_KEY'] = 'sk-ant-envkey-1234567890'
    vi.spyOn(detect, 'resolveBinary').mockResolvedValue(null)
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')))
    const a = (await cloudModule.status()).find((s) => s.id === 'anthropic')!
    expect(a.available).toBe(true)
    expect(a.detail).toBe('key set (from .env)')
    expect(JSON.stringify(a)).not.toContain('envkey')
    vi.unstubAllGlobals()
  })
})

describe('autoProvider order', () => {
  it('prefers claude-cli, then codex, gemini, anthropic, openrouter', async () => {
    const installed = new Set<string>()
    vi.spyOn(detect, 'resolveBinary').mockImplementation(async (bin) => (installed.has(bin) ? `/bin/${bin}` : null))
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')))
    expect(await cloudModule.autoProvider(CLOUD_ORDER)).toBeNull()

    saveApiKey('openrouter', KEY)
    expect((await cloudModule.autoProvider(CLOUD_ORDER))?.label).toMatch(/OpenRouter/)
    saveApiKey('anthropic', 'sk-ant-api03-abcdefghijkl')
    expect((await cloudModule.autoProvider(CLOUD_ORDER))?.label).toMatch(/Anthropic/)
    installed.add('gemini')
    expect((await cloudModule.autoProvider(CLOUD_ORDER))?.label).toMatch(/Gemini CLI/)
    installed.add('codex')
    expect((await cloudModule.autoProvider(CLOUD_ORDER))?.label).toMatch(/Codex CLI/)
    installed.add('claude')
    expect((await cloudModule.autoProvider(CLOUD_ORDER))?.label).toBe('Claude CLI')
    setCloudModelsReader(() => ({ 'claude-cli': 'opus' }))
    expect((await cloudModule.autoProvider(CLOUD_ORDER))?.label).toBe('Claude CLI (opus)')
    vi.unstubAllGlobals()
  })
  it('provider() errors when a CLI is missing or a key is not set', async () => {
    vi.spyOn(detect, 'resolveBinary').mockResolvedValue(null)
    expect(await cloudModule.provider({ kind: 'cloud', provider: 'codex-cli' })).toBeInstanceOf(Error)
    expect(await cloudModule.provider({ kind: 'cloud', provider: 'anthropic' })).toBeInstanceOf(Error)
  })
})
