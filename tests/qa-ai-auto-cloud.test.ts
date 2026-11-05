// QA: cloud 'auto' order for ALL 32 subsets of {claude-cli, codex-cli, gemini-cli, anthropic, openrouter}.
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

describe('cloud auto order', () => {
  it('CLOUD_ORDER is the documented order', () => {
    expect(CLOUD_ORDER).toEqual(['claude-cli', 'codex-cli', 'gemini-cli', 'anthropic', 'openrouter'])
  })

  it.each(subsets.map((s) => [s.join('+') || '(none)', s] as const))('available = %s', async (_name, avail) => {
    const installed = new Set(avail.filter((p) => BIN[p]).map((p) => BIN[p]))
    vi.spyOn(detect, 'resolveBinary').mockImplementation(async (bin) => (installed.has(bin) ? `/bin/${bin}` : null))
    if (avail.includes('anthropic')) saveApiKey('anthropic', 'sk-ant-api03-abcdefghijkl')
    if (avail.includes('openrouter')) saveApiKey('openrouter', 'sk-or-v1-abcdefghijklmnop')
    const p = await cloudModule.autoProvider()
    const first = CLOUD_ORDER.find((id) => avail.includes(id))
    if (!first) expect(p).toBeNull()
    else {
      expect(p).not.toBeNull()
      expect(p!.kind).toBe('cloud')
      expect(p!.label).toMatch(LABEL[first])
    }
  })

  it('the remembered model per provider is applied only to the provider that wins', async () => {
    vi.spyOn(detect, 'resolveBinary').mockImplementation(async (bin) => (bin === 'codex' ? '/bin/codex' : null))
    setCloudModelsReader(() => ({ 'claude-cli': 'opus', 'codex-cli': 'gpt-x' }))
    const p = await cloudModule.autoProvider()
    expect(p!.label).toMatch(/Codex CLI.*gpt-x/)
  })

  it('a throwing remembered-models reader does not break auto', async () => {
    vi.spyOn(detect, 'resolveBinary').mockImplementation(async (bin) => (bin === 'claude' ? '/bin/claude' : null))
    setCloudModelsReader(() => {
      throw new Error('store unreadable')
    })
    expect((await cloudModule.autoProvider())!.label).toBe('Claude CLI')
  })

  it('a CLI that exists but whose detection throws is skipped, not fatal', async () => {
    vi.spyOn(detect, 'resolveBinary').mockImplementation(async (bin) => {
      if (bin === 'claude') throw new Error('spawn EACCES')
      return bin === 'gemini' ? '/bin/gemini' : null
    })
    const p = await cloudModule.autoProvider()
    expect(p!.label).toMatch(/Gemini CLI/)
  })
})
