// QA: cloudModule.autoProvider(allowed): only opted-in providers are tried, in the user's order.
// Every ordered subset (permutations of every subset: 326) of the five providers x availability subset is checked.
import { beforeEach, describe, expect, it, vi } from 'vitest'

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

import { cloudModule, CLOUD_ORDER, setCloudModelsReader } from '../src/main/ai/cloud'
import { saveApiKey } from '../src/main/ai/cloud/secrets'
import * as detect from '../src/main/ai/cloud/cli-detect'
import type { CloudProviderId } from '../src/shared/ai'

const BIN: Record<string, string> = { 'claude-cli': 'claude', 'codex-cli': 'codex', 'gemini-cli': 'gemini' }
const LABEL: Record<CloudProviderId, RegExp> = {
  'claude-cli': /^Claude CLI/,
  'codex-cli': /^Codex CLI/,
  'gemini-cli': /^Gemini CLI/,
  anthropic: /Anthropic/,
  openrouter: /OpenRouter/
}

const subsets: CloudProviderId[][] = Array.from({ length: 32 }, (_, mask) => CLOUD_ORDER.filter((_, i) => mask & (1 << i)))

beforeEach(() => {
  state.file = {}
  delete process.env['ANTHROPIC_API_KEY']
  setCloudModelsReader(() => ({}))
  vi.restoreAllMocks()
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')))
})

const perms = (xs: CloudProviderId[]): CloudProviderId[][] =>
  xs.length <= 1 ? [xs] : xs.flatMap((x, i) => perms([...xs.slice(0, i), ...xs.slice(i + 1)]).map((r) => [x, ...r]))
const orderedSubsets: CloudProviderId[][] = subsets.flatMap((s) => perms(s))

async function setAvailable(avail: CloudProviderId[]): Promise<void> {
  const installed = new Set(avail.filter((p) => BIN[p]).map((p) => BIN[p]))
  vi.spyOn(detect, 'resolveBinary').mockImplementation(async (bin) => (installed.has(bin) ? `/bin/${bin}` : null))
  if (avail.includes('anthropic')) saveApiKey('anthropic', 'sk-ant-api03-abcdefghijkl')
  if (avail.includes('openrouter')) saveApiKey('openrouter', 'sk-or-v1-abcdefghijklmnop')
}

describe('cloud auto: opt-in only', () => {
  it('CLOUD_ORDER (status list order) is unchanged', () => {
    expect(CLOUD_ORDER).toEqual(['claude-cli', 'codex-cli', 'gemini-cli', 'anthropic', 'openrouter'])
  })

  it('326 ordered opt-in lists', () => expect(orderedSubsets).toHaveLength(326))

  it.each(subsets.map((s) => [s.join('+') || '(none)', s] as const))('available = %s: result is the first AVAILABLE provider of every opt-in list', async (_n, avail) => {
    await setAvailable(avail)
    for (const allowed of orderedSubsets) {
      const p = await cloudModule.autoProvider(allowed)
      const first = allowed.find((id) => avail.includes(id))
      if (!first) expect(p).toBeNull()
      else {
        expect(p).not.toBeNull()
        expect(p!.kind).toBe('cloud')
        expect(p!.label).toMatch(LABEL[first])
      }
    }
  })

  it('an empty opt-in list never picks anything, even with everything available', async () => {
    await setAvailable([...CLOUD_ORDER])
    expect(await cloudModule.autoProvider([])).toBeNull()
  })

  it('an unknown id in the list is ignored', async () => {
    await setAvailable(['claude-cli'])
    expect((await cloudModule.autoProvider(['nope' as CloudProviderId, 'claude-cli']))!.label).toMatch(/^Claude CLI/)
  })

  it('the remembered model per provider is applied only to the provider that wins', async () => {
    vi.spyOn(detect, 'resolveBinary').mockImplementation(async (bin) => (bin === 'codex' ? '/bin/codex' : null))
    setCloudModelsReader(() => ({ 'claude-cli': 'opus', 'codex-cli': 'gpt-x' }))
    const p = await cloudModule.autoProvider(['claude-cli', 'codex-cli'])
    expect(p!.label).toMatch(/Codex CLI.*gpt-x/)
  })

  it('a throwing remembered-models reader does not break auto', async () => {
    vi.spyOn(detect, 'resolveBinary').mockImplementation(async (bin) => (bin === 'claude' ? '/bin/claude' : null))
    setCloudModelsReader(() => {
      throw new Error('store unreadable')
    })
    expect((await cloudModule.autoProvider(['claude-cli']))!.label).toBe('Claude CLI')
  })

  it('a CLI whose detection throws is skipped, not fatal', async () => {
    vi.spyOn(detect, 'resolveBinary').mockImplementation(async (bin) => {
      if (bin === 'claude') throw new Error('spawn EACCES')
      return bin === 'gemini' ? '/bin/gemini' : null
    })
    const p = await cloudModule.autoProvider(['claude-cli', 'gemini-cli'])
    expect(p!.label).toMatch(/Gemini CLI/)
  })
})
