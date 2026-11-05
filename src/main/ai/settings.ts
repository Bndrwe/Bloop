// AiSettings validation. Pure (no electron), so tests can import it directly.
import { DEFAULT_AI_SETTINGS, type AiChoice, type AiSettings, type CloudProviderId, type LocalRuntime } from '@shared/ai'

export const CLOUD_PROVIDER_IDS: readonly CloudProviderId[] = ['claude-cli', 'codex-cli', 'gemini-cli', 'anthropic', 'openrouter']
const LOCAL_RUNTIMES: readonly LocalRuntime[] = ['bloop', 'ollama']

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const cleanStr = (v: unknown, max = 200): string | null => {
  if (typeof v !== 'string') return null
  const s = v.trim()
  return s && s.length <= max ? s : null
}

/** A valid AiChoice, or null. */
export function validateChoice(raw: unknown): AiChoice | null {
  if (!isObj(raw)) return null
  if (raw.kind === 'auto') return { kind: 'auto' }
  if (raw.kind === 'local') {
    const runtime = raw.runtime as LocalRuntime
    const model = cleanStr(raw.model)
    if (!LOCAL_RUNTIMES.includes(runtime) || !model) return null
    return { kind: 'local', runtime, model }
  }
  if (raw.kind === 'cloud') {
    const provider = raw.provider as CloudProviderId
    if (!CLOUD_PROVIDER_IDS.includes(provider)) return null
    const model = cleanStr(raw.model)
    return model ? { kind: 'cloud', provider, model } : { kind: 'cloud', provider }
  }
  return null
}

/** http(s) URL without a trailing slash, or null. */
export function normalizeOllamaUrl(raw: unknown): string | null {
  const s = cleanStr(raw, 500)
  if (!s) return null
  try {
    const u = new URL(/^[a-z]+:\/\//i.test(s) ? s : `http://${s}`)
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null
    return `${u.protocol}//${u.host}${u.pathname.replace(/\/+$/, '')}`
  } catch {
    return null
  }
}

/** Merge whatever is stored over the defaults, dropping anything invalid. */
export function validateAiSettings(raw: unknown): AiSettings {
  const r = isObj(raw) ? raw : {}
  const cloudModels: AiSettings['cloudModels'] = {}
  if (isObj(r.cloudModels)) {
    for (const id of CLOUD_PROVIDER_IDS) {
      const m = cleanStr(r.cloudModels[id])
      if (m) cloudModels[id] = m
    }
  }
  const choice = validateChoice(r.choice) ?? { ...DEFAULT_AI_SETTINGS.choice }
  // Settings saved before bloopEnabled existed: an explicit Bloop choice counts as turned on.
  const bloopEnabled = typeof r.bloopEnabled === 'boolean' ? r.bloopEnabled : choice.kind === 'local' && choice.runtime === 'bloop'
  return {
    choice,
    cloudModels,
    ollamaUrl: normalizeOllamaUrl(r.ollamaUrl) ?? DEFAULT_AI_SETTINGS.ollamaUrl,
    bloopOfferDismissed: r.bloopOfferDismissed === true,
    bloopEnabled
  }
}
