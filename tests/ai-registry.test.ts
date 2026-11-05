// Registry 'auto' order, AiSettings validation, and plan.ts through a mocked provider.
import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ app: { getPath: () => '/tmp', isPackaged: false } }))
vi.mock('../src/main/store', () => ({ getAiSettings: () => ({ choice: { kind: 'auto' }, cloudModels: {}, autoCloud: [], ollamaUrl: 'http://127.0.0.1:11434', bloopOfferDismissed: false, bloopEnabled: false }) }))
vi.mock('../src/main/ai/cloud', () => ({ cloudModule: null, setCloudModelsReader: () => undefined }))

import { DEFAULT_AI_SETTINGS, type AiChoice, type CloudProviderId } from '../src/shared/ai'
import { createRegistry, NO_AI_MESSAGE } from '../src/main/ai/registry'
import { normalizeOllamaUrl, validateAiSettings, validateChoice } from '../src/main/ai/settings'
import type { AiProvider, CloudModule, LocalModule } from '../src/main/ai/types'
import { buildPrompt, generatePlan, PLAN_JSON_SCHEMA, parsePlan } from '../src/main/plan'
import type { Settings, Stats } from '../src/shared/types'

const prov = (label: string, kind: 'local' | 'cloud', text = 'x'): AiProvider => ({ label, kind, complete: vi.fn(async () => text) })
const emptyLocal = { bloop: { id: 'b', label: 'B', url: '', sizeBytes: null, downloaded: false, source: null, enabled: false }, ollama: { installed: false, running: false, url: 'u', models: [] } }

function fakes(local: AiProvider | null, cloud: AiProvider | null) {
  const l: LocalModule = { status: vi.fn(async () => emptyLocal), provider: vi.fn(async () => new Error('nope')), autoProvider: vi.fn(async () => local) }
  const c: CloudModule = {
    status: vi.fn(async () => []),
    provider: vi.fn(async () => prov('Claude CLI', 'cloud')),
    autoProvider: vi.fn(async () => cloud),
    setApiKey: vi.fn(async () => ({ ok: true }))
  }
  return { l, c }
}

describe('registry', () => {
  const settings = (choice: AiChoice, autoCloud: CloudProviderId[] = []) => () => ({ ...DEFAULT_AI_SETTINGS, choice, autoCloud })

  it('auto: opted-in cloud first, then local, then a setup error', async () => {
    let f = fakes(prov('Bloop model (on-device)', 'local'), prov('Claude CLI', 'cloud'))
    let r = createRegistry({ local: f.l, cloud: f.c, getSettings: settings({ kind: 'auto' }, ['claude-cli']) })
    expect(((await r.resolve()) as AiProvider).label).toBe('Claude CLI')
    expect(f.c.autoProvider).toHaveBeenCalledWith(['claude-cli'])
    expect(f.l.autoProvider).not.toHaveBeenCalled()

    // not opted in: local wins and cloud is never asked
    f = fakes(prov('Bloop model (on-device)', 'local'), prov('Claude CLI', 'cloud'))
    r = createRegistry({ local: f.l, cloud: f.c, getSettings: settings({ kind: 'auto' }) })
    expect(((await r.resolve()) as AiProvider).label).toBe('Bloop model (on-device)')
    expect(f.c.autoProvider).not.toHaveBeenCalled()

    // opted in but nothing available: falls through to local
    f = fakes(prov('Bloop model (on-device)', 'local'), null)
    r = createRegistry({ local: f.l, cloud: f.c, getSettings: settings({ kind: 'auto' }, ['claude-cli']) })
    expect(((await r.resolve()) as AiProvider).label).toBe('Bloop model (on-device)')

    // not opted in and no local: friendly error, cloud untouched
    f = fakes(null, prov('Claude CLI', 'cloud'))
    r = createRegistry({ local: f.l, cloud: f.c, getSettings: settings({ kind: 'auto' }) })
    expect(((await r.resolve()) as Error).message).toBe(NO_AI_MESSAGE)
    expect(f.c.autoProvider).not.toHaveBeenCalled()
    await expect(r.generateText('p')).rejects.toThrow(/Turn on a model in Settings → AI/)
    expect((await r.status()).active).toBeNull()
  })

  it('routes explicit choices and reports active', async () => {
    const f = fakes(null, null)
    const r = createRegistry({ local: f.l, cloud: f.c, getSettings: settings({ kind: 'cloud', provider: 'claude-cli' }) })
    expect((await r.status()).active).toEqual({ label: 'Claude CLI', kind: 'cloud' })
    expect(f.c.provider).toHaveBeenCalledWith({ kind: 'cloud', provider: 'claude-cli' })
    const r2 = createRegistry({ local: f.l, cloud: null, getSettings: settings({ kind: 'local', runtime: 'bloop', model: 'b' }) })
    expect((await r2.status()).active).toBeNull()
  })
})

describe('AiSettings validation', () => {
  it('fills defaults and drops junk', () => {
    expect(validateAiSettings(undefined)).toEqual(DEFAULT_AI_SETTINGS)
    expect(
      validateAiSettings({
        choice: { kind: 'cloud', provider: 'nope' },
        cloudModels: { anthropic: ' claude-x ', evil: 'y', openrouter: 5 },
        ollamaUrl: 'javascript:alert(1)',
        bloopOfferDismissed: 'yes'
      })
    ).toEqual({ ...DEFAULT_AI_SETTINGS, cloudModels: { anthropic: 'claude-x' } })
  })

  it('validates choices', () => {
    expect(validateChoice({ kind: 'local', runtime: 'ollama', model: 'qwen3.5:0.8b' })).toEqual({ kind: 'local', runtime: 'ollama', model: 'qwen3.5:0.8b' })
    expect(validateChoice({ kind: 'local', runtime: 'gpu', model: 'x' })).toBeNull()
    expect(validateChoice({ kind: 'local', runtime: 'bloop', model: '' })).toBeNull()
    expect(validateChoice({ kind: 'cloud', provider: 'codex-cli', model: '' })).toEqual({ kind: 'cloud', provider: 'codex-cli' })
    expect(validateChoice('auto')).toBeNull()
  })

  it('normalizes the Ollama URL', () => {
    expect(normalizeOllamaUrl('localhost:11434/')).toBe('http://localhost:11434')
    expect(normalizeOllamaUrl('https://box.lan:8080/ollama/')).toBe('https://box.lan:8080/ollama')
    expect(normalizeOllamaUrl('ftp://x')).toBeNull()
  })
})

describe('plan.ts via a mocked provider', () => {
  const stats: Stats = { todayAvgScore: null, todayFocusSec: 0, todaySessions: 0, last7: [{ date: '2026-11-04', avgScore: 70, focusSec: 3000, sessions: 2 }] }
  const settings = { focusMinutes: 25, breakMinutes: 5 } as Settings

  it('produces a valid plan and passes the JSON schema', async () => {
    const gen = vi.fn(async () =>
      JSON.stringify({ summary: 'Go!', blocks: [{ day: 1, time: '9:05', minutes: 50, label: 'Chem' }, { day: 9, time: '10:00', minutes: 25, label: 'bad' }] })
    )
    const r = await generatePlan([], stats, settings, gen)
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.value.blocks).toEqual([{ day: 1, time: '09:05', minutes: 50, label: 'Chem' }])
    const [prompt, opts] = gen.mock.calls[0] as unknown as [string, { jsonSchema: unknown }]
    expect(prompt).toContain('- (no upcoming deadlines found)')
    expect(opts.jsonSchema).toBe(PLAN_JSON_SCHEMA)
  })

  it('passes provider errors through and flags unusable answers', async () => {
    expect(await generatePlan([], stats, settings, async () => Promise.reject(new Error(NO_AI_MESSAGE)))).toEqual({ ok: false, error: NO_AI_MESSAGE })
    const bad = await generatePlan([], stats, settings, async () => 'sorry')
    expect(bad.ok).toBe(false)
    expect(parsePlan('```json\n{"blocks":[{"day":0,"time":"08:00","minutes":25,"label":"x"}]}\n```').blocks).toHaveLength(1)
  })

  it('keeps the prompt wording the dataset mirrors', () => {
    const p = buildPrompt([], stats, settings, new Date(2026, 10, 4, 9))
    expect(p).toContain('You are a friendly study coach inside a desktop "study pet" app for a university student.')
    expect(p).toContain('Reply with ONLY a JSON object, no markdown fences, in exactly this shape:')
  })
})

describe('bloopEnabled validation', () => {
  it('defaults to false and only accepts booleans', () => {
    expect(DEFAULT_AI_SETTINGS.bloopEnabled).toBe(false)
    expect(validateAiSettings(undefined).bloopEnabled).toBe(false)
    expect(validateAiSettings({ bloopEnabled: 'yes' }).bloopEnabled).toBe(false)
    expect(validateAiSettings({ bloopEnabled: 1 }).bloopEnabled).toBe(false)
    expect(validateAiSettings({ bloopEnabled: true }).bloopEnabled).toBe(true)
    expect(validateAiSettings({ bloopEnabled: false, choice: { kind: 'local', runtime: 'bloop', model: 'b' } }).bloopEnabled).toBe(false)
  })
  it('settings saved before the flag existed keep an explicit Bloop choice on', () => {
    expect(validateAiSettings({ choice: { kind: 'local', runtime: 'bloop', model: 'b' } }).bloopEnabled).toBe(true)
    expect(validateAiSettings({ choice: { kind: 'local', runtime: 'ollama', model: 'm' } }).bloopEnabled).toBe(false)
  })
})

describe('autoCloud validation and migration', () => {
  it('defaults to [] (cloud is opt-in)', () => {
    expect(DEFAULT_AI_SETTINGS.autoCloud).toEqual([])
    expect(validateAiSettings(undefined).autoCloud).toEqual([])
    expect(validateAiSettings({}).autoCloud).toEqual([])
  })
  it('settings stored before the field existed migrate to [] and keep everything else', () => {
    const old = { choice: { kind: 'auto' }, cloudModels: { 'claude-cli': 'sonnet' }, ollamaUrl: 'http://box:11434', bloopOfferDismissed: true, bloopEnabled: true }
    expect(validateAiSettings(old)).toEqual({ ...old, autoCloud: [] })
  })
  it('an old explicit cloud choice still works and does not opt into Auto', () => {
    const s = validateAiSettings({ choice: { kind: 'cloud', provider: 'claude-cli', model: 'opus' }, cloudModels: {} })
    expect(s.choice).toEqual({ kind: 'cloud', provider: 'claude-cli', model: 'opus' })
    expect(s.autoCloud).toEqual([])
  })
  it('keeps only known ids, de-duplicates and keeps order', () => {
    expect(validateAiSettings({ autoCloud: ['openrouter', 'nope', 'claude-cli', 'openrouter', 5, null, 'claude-cli', 'codex-cli'] }).autoCloud).toEqual([
      'openrouter',
      'claude-cli',
      'codex-cli'
    ])
  })
  it('non-array values become []', () => {
    for (const v of ['claude-cli', 7, { 0: 'claude-cli' }, null, true]) expect(validateAiSettings({ autoCloud: v }).autoCloud).toEqual([])
  })
  it('is idempotent', () => {
    const once = validateAiSettings({ autoCloud: ['gemini-cli', 'anthropic'] })
    expect(validateAiSettings(once)).toEqual(once)
  })
  it('a patch merge (as store.saveAiSettings does) keeps autoCloud unless it is replaced', () => {
    const cur = validateAiSettings({ autoCloud: ['claude-cli'] })
    expect(validateAiSettings({ ...cur, ollamaUrl: 'http://x:1' }).autoCloud).toEqual(['claude-cli'])
    expect(validateAiSettings({ ...cur, autoCloud: [] }).autoCloud).toEqual([])
  })
})
