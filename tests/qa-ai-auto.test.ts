// QA: the 'auto' provider order across EVERY combination of availability:
//   Ollama (4 states) x cloud: every autoCloud list (ordered subsets of the 5 providers) x every set of available providers
// Semantics: the first opted-in available cloud (user's order), else a friendly error. Auto never uses Ollama, and un-opted cloud is never used. Nothing is pulled.
import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ app: { getPath: () => '/tmp', isPackaged: false } }))
vi.mock('../src/main/store', () => ({ getAiSettings: () => ({}) }))
vi.mock('../src/main/ai/cloud', () => ({ cloudModule: null, setCloudModelsReader: () => undefined }))

import { DEFAULT_AI_SETTINGS, type AiChoice, type CloudProviderId } from '../src/shared/ai'
import { createRegistry, NO_AI_MESSAGE } from '../src/main/ai/registry'
import { createLocalModule } from '../src/main/ai/local'
import type { AiProvider, CloudModule } from '../src/main/ai/types'

type OllamaState = 'down' | 'up-empty' | 'up-small' | 'up-suggested'
const OLLAMA_MODELS: Record<OllamaState, { name: string; sizeBytes?: number }[]> = {
  down: [],
  'up-empty': [],
  'up-small': [{ name: 'llama3:8b', sizeBytes: 5e9 }, { name: 'phi:2b', sizeBytes: 2e9 }],
  'up-suggested': [{ name: 'llama3:8b', sizeBytes: 5e9 }, { name: 'qwen3.5:0.8b', sizeBytes: 1e9 }]
}

const IDS: CloudProviderId[] = ['claude-cli', 'codex-cli', 'gemini-cli', 'anthropic', 'openrouter']
const LABELS: Record<CloudProviderId, string> = { 'claude-cli': 'Claude CLI', 'codex-cli': 'Codex CLI', 'gemini-cli': 'Gemini CLI', anthropic: 'Anthropic API', openrouter: 'OpenRouter' }
const subsetsOf = (xs: CloudProviderId[]): CloudProviderId[][] => Array.from({ length: 1 << xs.length }, (_, m) => xs.filter((_, i) => m & (1 << i)))
const perms = (xs: CloudProviderId[]): CloudProviderId[][] => (xs.length <= 1 ? [xs] : xs.flatMap((x, i) => perms([...xs.slice(0, i), ...xs.slice(i + 1)]).map((r) => [x, ...r])))
const ALL_LISTS = subsetsOf(IDS).flatMap(perms) // 326 ordered opt-in lists

interface Opts {
  ollama: OllamaState
  /** providers that are available (CLI installed / key set) */
  avail?: CloudProviderId[]
  /** AiSettings.autoCloud */
  autoCloud?: CloudProviderId[]
  choice?: AiChoice
  probeThrows?: boolean
}

function build(opts: Opts) {
  const avail = opts.avail ?? []
  // Plain counters instead of vi.fn: the exhaustive test builds >100k registries and vi.fn records stay alive.
  const probe = Object.assign(
    async () => {
      probe.calls++
      if (opts.probeThrows) throw new Error('probe exploded')
      return { running: opts.ollama !== 'down', models: OLLAMA_MODELS[opts.ollama] }
    },
    { calls: 0 }
  )
  const local = createLocalModule({
    getSettings: () => DEFAULT_AI_SETTINGS,
    onChange: () => undefined,
    findBinary: async () => null,
    probe
  })
  const mk = (id: CloudProviderId): AiProvider => ({ label: LABELS[id], kind: 'cloud', complete: async () => 'c' })
  const calls = { autoProvider: [] as CloudProviderId[][], provider: 0 }
  let autoImpl = async (allowed: CloudProviderId[]): Promise<AiProvider | null> => {
    const id = allowed.find((x) => avail.includes(x))
    return id ? mk(id) : null
  }
  const cloud: CloudModule & { calls: typeof calls; failAuto(e: Error): void } = {
    calls,
    failAuto: (e) => {
      autoImpl = async () => {
        throw e
      }
    },
    status: async () => [],
    provider: async (c) => {
      calls.provider++
      return mk(c.provider)
    },
    // Same contract as the real module: only the given (opted-in) providers are considered.
    autoProvider: async (allowed) => {
      calls.autoProvider.push(allowed)
      return autoImpl(allowed)
    },
    setApiKey: async () => ({ ok: true })
  }
  const registry = createRegistry({
    local,
    cloud,
    getSettings: () => ({ ...DEFAULT_AI_SETTINGS, autoCloud: opts.autoCloud ?? [], choice: opts.choice ?? { kind: 'auto' } })
  })
  return { registry, cloud, probe }
}

/** Independent oracle: first opted-in AVAILABLE cloud -> setup error. Ollama never counts for Auto. */
function expected(o: { ollama: OllamaState; avail?: CloudProviderId[]; autoCloud?: CloudProviderId[] }): string {
  const c = (o.autoCloud ?? []).find((id) => (o.avail ?? []).includes(id))
  if (c) return LABELS[c]
  void o.ollama
  return 'ERROR'
}

describe("registry 'auto': local readiness x opted-in cloud", () => {
  const states: OllamaState[] = ['down', 'up-empty', 'up-small', 'up-suggested']
  const localCases = states.map((ollama) => ({ ollama }))
  it('covers 4 local states and 326 opt-in lists', () => {
    expect(localCases).toHaveLength(4)
    expect(ALL_LISTS).toHaveLength(326)
  })

  // Exhaustive: 4 local states x 326 ordered opt-in lists x 32 available sets = 41,728 resolves.
  it('every combination matches the oracle; un-opted cloud is never chosen; nothing downloads', async () => {
    const availSets = subsetsOf(IDS)
    let n = 0
    for (const lc of localCases) {
      for (const autoCloud of ALL_LISTS) {
        for (const avail of availSets) {
          const { registry } = build({ ...lc, avail, autoCloud })
          const r = await registry.resolve()
          const want = expected({ ...lc, avail, autoCloud })
          const ctx = JSON.stringify({ ...lc, avail, autoCloud })
          if (want === 'ERROR') {
            expect(r, ctx).toBeInstanceOf(Error)
            expect((r as Error).message, ctx).toBe(NO_AI_MESSAGE)
          } else {
            expect((r as AiProvider).label, ctx).toBe(want)
            // a cloud provider is only ever returned when the user opted into it
            const cloudHit = IDS.find((id) => LABELS[id] === want)
            if (cloudHit) expect(autoCloud, ctx).toContain(cloudHit)
          }
          n++
        }
      }
    }
    expect(n).toBe(4 * 326 * 32)
  }, 120_000)

  it('NO_AI_MESSAGE tells the user to turn on a model in Settings → AI', () => {
    expect(NO_AI_MESSAGE).toMatch(/^Turn on a model in Settings → AI/)
  })

  it('Ollama running with a model and no opted-in cloud: Auto has nothing ready, and Ollama is not even probed', async () => {
    for (const ollama of ['up-small', 'up-suggested'] as const) {
      const { registry, probe } = build({ ollama, avail: [...IDS], autoCloud: [] })
      expect(((await registry.resolve()) as Error).message).toBe(NO_AI_MESSAGE)
      expect(probe.calls).toBe(0)
      expect((await registry.status()).active).toBeNull()
    }
  })

  it('opted-in available cloud wins over a ready local model, and local is not even probed', async () => {
    const { registry, probe } = build({ ollama: 'up-suggested', avail: ['claude-cli'], autoCloud: ['claude-cli'] })
    expect(((await registry.resolve()) as AiProvider).label).toBe('Claude CLI')
    expect(probe.calls).toBe(0)
  })

  it('un-opted cloud is never chosen even when it is the only thing available', async () => {
    const { registry, cloud } = build({ ollama: 'down', avail: [...IDS], autoCloud: [] })
    const r = await registry.resolve()
    expect((r as Error).message).toBe(NO_AI_MESSAGE)
    expect(cloud.calls.autoProvider).toEqual([])
    expect(cloud.calls.provider).toBe(0)
  })

  it('an unavailable opted-in cloud falls through to the next opted-in one, then to nothing (not Ollama)', async () => {
    let b = build({ ollama: 'up-small', avail: ['codex-cli'], autoCloud: ['claude-cli', 'codex-cli'] })
    expect(((await b.registry.resolve()) as AiProvider).label).toBe('Codex CLI')
    b = build({ ollama: 'up-small', avail: [], autoCloud: ['claude-cli', 'codex-cli'] })
    expect(((await b.registry.resolve()) as Error).message).toBe(NO_AI_MESSAGE)
  })

  it('status().active mirrors resolve() (label and kind) for every local state x sampled opt-in lists', async () => {
    const lists: CloudProviderId[][] = [[], ['claude-cli'], ['codex-cli', 'claude-cli'], ['anthropic', 'openrouter']]
    const avails: CloudProviderId[][] = [[], ['claude-cli'], ['codex-cli', 'openrouter'], [...IDS]]
    for (const lc of localCases) for (const autoCloud of lists) for (const avail of avails) {
      const { registry } = build({ ...lc, avail, autoCloud })
      const st = await registry.status()
      const want = expected({ ...lc, avail, autoCloud })
      if (want === 'ERROR') expect(st.active).toBeNull()
      else expect(st.active).toEqual({ label: want, kind: IDS.some((id) => LABELS[id] === want) ? 'cloud' : 'local' })
    }
  })

  it('cloud throws with Ollama ready -> that error, not Ollama', async () => {
    const b = build({ ollama: 'up-suggested', autoCloud: ['claude-cli'], avail: ['claude-cli'] })
    b.cloud.failAuto(new Error('cloud exploded'))
    expect(((await b.registry.resolve()) as Error).message).toBe('cloud exploded')
  })

  it('cloud throws and nothing local is ready -> that error, not a crash', async () => {
    const b = build({ ollama: 'down', autoCloud: ['claude-cli'], avail: ['claude-cli'] })
    b.cloud.failAuto(new Error('cloud exploded'))
    expect(((await b.registry.resolve()) as Error).message).toBe('cloud exploded')
  })

  it('opted-in cloud with no cloud module behaves like unavailable', async () => {
    const local = createLocalModule({
      getSettings: () => DEFAULT_AI_SETTINGS,
      onChange: () => undefined,
      findBinary: async () => null,
      probe: async () => ({ running: false, models: [] })
    })
    const r = createRegistry({ local, cloud: null, getSettings: () => ({ ...DEFAULT_AI_SETTINGS, autoCloud: ['claude-cli'] }) })
    expect(((await r.resolve()) as Error).message).toBe(NO_AI_MESSAGE)
    await expect(r.generateText('x')).rejects.toThrow(NO_AI_MESSAGE)
  })
})

describe('explicit choices ignore the auto order', () => {
  it('local/ollama choice with Ollama down is an error even if cloud is available (no silent fallback)', async () => {
    const { registry, cloud } = build({ ollama: 'down', avail: ['claude-cli'], autoCloud: ['claude-cli'], choice: { kind: 'local', runtime: 'ollama', model: 'qwen3.5:0.8b' } })
    const r = await registry.resolve()
    expect(r).toBeInstanceOf(Error)
    expect(cloud.calls.autoProvider).toEqual([])
  })
  it('local/ollama choice with a model that is not pulled reports model-not-found', async () => {
    const { registry } = build({ ollama: 'up-small', choice: { kind: 'local', runtime: 'ollama', model: 'missing:1b' } })
    expect(((await registry.resolve()) as Error).message).toMatch(/model not found: missing:1b/)
  })
  it('local/ollama choice resolves the exact model even when auto would pick another', async () => {
    const { registry } = build({ ollama: 'up-small', choice: { kind: 'local', runtime: 'ollama', model: 'llama3:8b' } })
    expect(((await registry.resolve()) as AiProvider).label).toBe('Ollama · llama3:8b')
  })
  it('explicit cloud choice goes to cloud.provider with the choice, not autoProvider', async () => {
    const { registry, cloud } = build({ ollama: 'up-small', choice: { kind: 'cloud', provider: 'anthropic', model: 'm' } })
    await registry.resolve()
    expect(cloud.calls.provider).toBe(1)
    expect(cloud.calls.autoProvider).toEqual([])
  })
  it('resolve(choice) overrides the saved choice', async () => {
    const { registry } = build({ ollama: 'up-small', choice: { kind: 'cloud', provider: 'anthropic' } })
    expect(((await registry.resolve({ kind: 'local', runtime: 'ollama', model: 'phi:2b' })) as AiProvider).label).toBe('Ollama · phi:2b')
    expect(await registry.resolve({ kind: 'auto' })).toBeInstanceOf(Error)
  })
  it('non-Error throws from a module are wrapped into Errors', async () => {
    const local = { status: vi.fn(), provider: vi.fn(async () => { throw 'plain string' }), autoProvider: vi.fn() }
    const r = createRegistry({ local: local as never, cloud: null, getSettings: () => ({ ...DEFAULT_AI_SETTINGS, choice: { kind: 'local', runtime: 'ollama', model: 'x' } }) })
    const res = await r.resolve()
    expect(res).toBeInstanceOf(Error)
    expect((res as Error).message).toBe('plain string')
  })
  it('status() still reports local when the cloud status call rejects', async () => {
    const { registry, cloud } = build({ ollama: 'up-small', choice: { kind: 'local', runtime: 'ollama', model: 'phi:2b' } })
    cloud.status = async () => {
      throw new Error('cloud down')
    }
    const st = await registry.status()
    expect(st.cloud).toEqual([])
    expect(st.active?.label).toBe('Ollama · phi:2b')
  })
})
