// QA: the 'auto' provider order across EVERY combination of availability:
//   Bloop (enabled x downloaded) x Ollama (down / up-no-models / up-with-models / only-big-models) x cloud (none / available)
// plus explicit-choice routing, error propagation and the cloud-provider subsets (see qa-ai-auto-cloud).
import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ app: { getPath: () => '/tmp', isPackaged: false } }))
vi.mock('../src/main/store', () => ({ getAiSettings: () => ({}) }))
vi.mock('../src/main/ai/cloud', () => ({ cloudModule: null, setCloudModelsReader: () => undefined }))

import { DEFAULT_AI_SETTINGS, type AiChoice } from '../src/shared/ai'
import { createRegistry, NO_AI_MESSAGE } from '../src/main/ai/registry'
import { createLocalModule } from '../src/main/ai/local'
import type { AiProvider, CloudModule } from '../src/main/ai/types'
import type { BloopManager } from '../src/main/ai/local/bloop'

type OllamaState = 'down' | 'up-empty' | 'up-small' | 'up-suggested'
const OLLAMA_MODELS: Record<OllamaState, { name: string; sizeBytes?: number }[]> = {
  down: [],
  'up-empty': [],
  'up-small': [{ name: 'llama3:8b', sizeBytes: 5e9 }, { name: 'phi:2b', sizeBytes: 2e9 }],
  'up-suggested': [{ name: 'llama3:8b', sizeBytes: 5e9 }, { name: 'qwen3.5:0.8b', sizeBytes: 1e9 }]
}

function build(opts: { enabled: boolean; downloaded: boolean; ollama: OllamaState; cloud: boolean; choice?: AiChoice; probeThrows?: boolean }) {
  const bloop = {
    isDownloaded: () => opts.downloaded,
    source: () => (opts.downloaded ? 'downloaded' : null),
    filePath: () => '/models/b.gguf',
    status: () => ({ id: 'b', label: 'B', url: '', sizeBytes: null, downloaded: opts.downloaded, source: opts.downloaded ? 'downloaded' : null })
  } as unknown as BloopManager
  const probe = vi.fn(async () => {
    if (opts.probeThrows) throw new Error('probe exploded')
    return { running: opts.ollama !== 'down', models: OLLAMA_MODELS[opts.ollama] }
  })
  const local = createLocalModule({
    getSettings: () => ({ ...DEFAULT_AI_SETTINGS, bloopEnabled: opts.enabled }),
    onChange: () => undefined,
    bloop,
    runtime: { complete: vi.fn(async () => 'x'), unload: vi.fn(async () => undefined) },
    findBinary: async () => null,
    probe
  })
  const cloudProvider: AiProvider = { label: 'Claude CLI', kind: 'cloud', complete: async () => 'c' }
  const cloud: CloudModule = {
    status: vi.fn(async () => []),
    provider: vi.fn(async () => cloudProvider),
    autoProvider: vi.fn(async () => (opts.cloud ? cloudProvider : null)),
    setApiKey: vi.fn(async () => ({ ok: true }))
  }
  const registry = createRegistry({ local, cloud, getSettings: () => ({ ...DEFAULT_AI_SETTINGS, choice: opts.choice ?? { kind: 'auto' } }) })
  return { registry, cloud, probe }
}

/** Independent oracle for the documented order: Bloop (only if enabled) -> Ollama -> cloud -> setup error. */
function expected(o: { enabled: boolean; downloaded: boolean; ollama: OllamaState; cloud: boolean }): string {
  if (o.enabled && o.downloaded) return 'Bloop model (on-device)'
  if (o.ollama === 'up-suggested') return 'Ollama · qwen3.5:0.8b'
  if (o.ollama === 'up-small') return 'Ollama · phi:2b'
  if (o.cloud) return 'Claude CLI'
  return 'ERROR'
}

describe("registry 'auto': every availability combination", () => {
  const states: OllamaState[] = ['down', 'up-empty', 'up-small', 'up-suggested']
  const cases = [false, true].flatMap((enabled) =>
    [false, true].flatMap((downloaded) => states.flatMap((ollama) => [false, true].map((cloud) => ({ enabled, downloaded, ollama, cloud }))))
  )
  it('covers 32 combinations', () => expect(cases).toHaveLength(32))

  it.each(cases)('bloopEnabled=$enabled downloaded=$downloaded ollama=$ollama cloud=$cloud', async (o) => {
    const { registry, cloud } = build(o)
    const r = await registry.resolve()
    const want = expected(o)
    if (want === 'ERROR') {
      expect(r).toBeInstanceOf(Error)
      expect((r as Error).message).toBe(NO_AI_MESSAGE)
    } else {
      expect(r).not.toBeInstanceOf(Error)
      expect((r as AiProvider).label).toBe(want)
    }
    // cloud is consulted only when nothing local is usable
    const localUsable = (o.enabled && o.downloaded) || o.ollama === 'up-small' || o.ollama === 'up-suggested'
    expect(cloud.autoProvider).toHaveBeenCalledTimes(localUsable ? 0 : 1)
  })

  it('the bundled/downloaded Bloop model never runs unless the user enabled it', async () => {
    const { registry } = build({ enabled: false, downloaded: true, ollama: 'down', cloud: false })
    expect(await registry.resolve()).toBeInstanceOf(Error)
  })

  it('status().active mirrors resolve() for every combination', async () => {
    for (const o of cases) {
      const { registry } = build(o)
      const st = await registry.status()
      const want = expected(o)
      if (want === 'ERROR') expect(st.active).toBeNull()
      else expect(st.active?.label).toBe(want)
      expect(st.active?.kind ?? (want === 'ERROR' ? undefined : 'x')).toBe(want === 'ERROR' ? undefined : want === 'Claude CLI' ? 'cloud' : 'local')
    }
  })

  it('a throwing Ollama probe surfaces as an Error result (when no cloud is ready), not an unhandled rejection', async () => {
    const { registry } = build({ enabled: false, downloaded: false, ollama: 'up-small', cloud: false, probeThrows: true })
    const r = await registry.resolve()
    expect(r).toBeInstanceOf(Error)
    expect((r as Error).message).toBe('probe exploded')
  })

  // BUG: registry.ts resolve() 'auto': local.autoProvider() throws when the Ollama probe throws, and the
  // catch returns that Error WITHOUT trying the cloud fallback. 'auto' is documented as "first ready
  // option: local, then cloud", so a transient local failure should still fall through to cloud.
  it('auto falls through to cloud when the local probe throws', async () => {
    const { registry } = build({ enabled: false, downloaded: false, ollama: 'up-small', cloud: true, probeThrows: true })
    const r = await registry.resolve()
    expect((r as AiProvider).label).toBe('Claude CLI')
  })

  it('no cloud module at all behaves like cloud unavailable', async () => {
    const local = createLocalModule({
      getSettings: () => DEFAULT_AI_SETTINGS,
      onChange: () => undefined,
      bloop: { isDownloaded: () => false, source: () => null, status: () => ({}) } as unknown as BloopManager,
      runtime: { complete: vi.fn(), unload: vi.fn() } as never,
      findBinary: async () => null,
      probe: async () => ({ running: false, models: [] })
    })
    const r = createRegistry({ local, cloud: null, getSettings: () => DEFAULT_AI_SETTINGS })
    expect(((await r.resolve()) as Error).message).toBe(NO_AI_MESSAGE)
    await expect(r.generateText('x')).rejects.toThrow(NO_AI_MESSAGE)
  })
})

describe('explicit choices ignore the auto order', () => {
  it('local/ollama choice with Ollama down is an error even if cloud is available (no silent fallback)', async () => {
    const { registry, cloud } = build({ enabled: true, downloaded: true, ollama: 'down', cloud: true, choice: { kind: 'local', runtime: 'ollama', model: 'qwen3.5:0.8b' } })
    const r = await registry.resolve()
    expect(r).toBeInstanceOf(Error)
    expect(cloud.autoProvider).not.toHaveBeenCalled()
  })
  it('local/ollama choice with a model that is not pulled reports model-not-found', async () => {
    const { registry } = build({ enabled: false, downloaded: false, ollama: 'up-small', cloud: false, choice: { kind: 'local', runtime: 'ollama', model: 'missing:1b' } })
    expect(((await registry.resolve()) as Error).message).toMatch(/model not found: missing:1b/)
  })
  it('local/ollama choice resolves the exact model even when auto would pick another', async () => {
    const { registry } = build({ enabled: true, downloaded: true, ollama: 'up-small', cloud: false, choice: { kind: 'local', runtime: 'ollama', model: 'llama3:8b' } })
    expect(((await registry.resolve()) as AiProvider).label).toBe('Ollama · llama3:8b')
  })
  it('bloop choice with the model on disk resolves it; unknown model id errors', async () => {
    const ok = build({ enabled: true, downloaded: true, ollama: 'down', cloud: false, choice: { kind: 'local', runtime: 'bloop', model: 'bloop-qwen3.5-0.8b' } })
    expect(((await ok.registry.resolve()) as AiProvider).label).toBe('Bloop model (on-device)')
    const bad = build({ enabled: true, downloaded: true, ollama: 'down', cloud: false, choice: { kind: 'local', runtime: 'bloop', model: 'nope' } })
    expect(((await bad.registry.resolve()) as Error).message).toMatch(/Unknown Bloop model/)
  })
  it('bloop choice without a file errors with a download hint', async () => {
    const { registry } = build({ enabled: true, downloaded: false, ollama: 'down', cloud: true, choice: { kind: 'local', runtime: 'bloop', model: 'bloop-qwen3.5-0.8b' } })
    expect(((await registry.resolve()) as Error).message).toMatch(/Settings → AI/)
  })
  it('explicit cloud choice goes to cloud.provider with the choice, not autoProvider', async () => {
    const { registry, cloud } = build({ enabled: true, downloaded: true, ollama: 'up-small', cloud: false, choice: { kind: 'cloud', provider: 'anthropic', model: 'm' } })
    await registry.resolve()
    expect(cloud.provider).toHaveBeenCalledWith({ kind: 'cloud', provider: 'anthropic', model: 'm' })
    expect(cloud.autoProvider).not.toHaveBeenCalled()
  })
  it('resolve(choice) overrides the saved choice', async () => {
    const { registry } = build({ enabled: false, downloaded: false, ollama: 'up-small', cloud: false, choice: { kind: 'cloud', provider: 'anthropic' } })
    expect(((await registry.resolve({ kind: 'auto' })) as AiProvider).label).toBe('Ollama · phi:2b')
  })
  it('non-Error throws from a module are wrapped into Errors', async () => {
    const local = { status: vi.fn(), provider: vi.fn(async () => { throw 'plain string' }), autoProvider: vi.fn() }
    const r = createRegistry({ local: local as never, cloud: null, getSettings: () => ({ ...DEFAULT_AI_SETTINGS, choice: { kind: 'local', runtime: 'bloop', model: 'x' } }) })
    const res = await r.resolve()
    expect(res).toBeInstanceOf(Error)
    expect((res as Error).message).toBe('plain string')
  })
  it('status() still reports local when the cloud status call rejects', async () => {
    const { registry, cloud } = build({ enabled: false, downloaded: false, ollama: 'up-small', cloud: false })
    ;(cloud.status as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('cloud down'))
    const st = await registry.status()
    expect(st.cloud).toEqual([])
    expect(st.active?.label).toBe('Ollama · phi:2b')
  })
})
