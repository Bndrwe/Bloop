// AiSettings validation. Pure (no electron), so tests can import it directly.
import { DEFAULT_AI_SETTINGS, type AiChoice, type AiSettings, type CloudProviderId, type LocalRuntime } from '@shared/ai'

export const CLOUD_PROVIDER_IDS: readonly CloudProviderId[] = ['claude-cli', 'codex-cli', 'gemini-cli', 'anthropic', 'openrouter']
const LOCAL_RUNTIMES: readonly LocalRuntime[] = ['ollama']

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const cleanStr = (v: unknown, max = 200): string | null => {
  if (typeof v !== 'string') return null
  const s = v.trim()
  return s && s.length <= max ? s : null
}

/** A valid AiChoice, or null. Unknown local runtimes (e.g. one this version no longer has) give null. */
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

/**
 * http(s) URL without a trailing slash, or null. A user-set Ollama address may point anywhere (a
 * LAN box is a real use case), so only the scheme is restricted: no file:, data:, ftp: etc., and no
 * user:password@ (it would be sent in clear over http). Query and hash are dropped.
 */
export function normalizeOllamaUrl(raw: unknown): string | null {
  const s = cleanStr(raw, 500)
  if (!s) return null
  try {
    const u = new URL(/^[a-z][a-z0-9+.-]*:/i.test(s) && !/^[^:/]+:\d+(\/|$)/.test(s) ? s : `http://${s}`)
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null
    if (u.username || u.password || !u.hostname) return null
    return `${u.protocol}//${u.host}${u.pathname.replace(/\/+$/, '')}`
  } catch {
    return null
  }
}

/** Known cloud ids only, no duplicates, order kept. Anything else (missing, wrong type) gives []. */
export function validateAutoCloud(raw: unknown): CloudProviderId[] {
  if (!Array.isArray(raw)) return []
  const out: CloudProviderId[] = []
  for (const id of raw) {
    if (CLOUD_PROVIDER_IDS.includes(id as CloudProviderId) && !out.includes(id as CloudProviderId)) out.push(id as CloudProviderId)
  }
  return out
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
  const autoCloud = validateAutoCloud(r.autoCloud)
  // A choice this version can't use (bad data, or a local runtime that no longer exists) falls back to Auto.
  const choice = validateChoice(r.choice) ?? { ...DEFAULT_AI_SETTINGS.choice }
  return {
    choice,
    cloudModels,
    autoCloud,
    ollamaUrl: normalizeOllamaUrl(r.ollamaUrl) ?? DEFAULT_AI_SETTINGS.ollamaUrl
  }
}
