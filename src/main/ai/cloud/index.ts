// Cloud AI: the user's own CLIs (Claude Code, Codex, Gemini) plus API keys (Anthropic, OpenRouter).
import type { AiChoice, AiSettings, CloudProviderId, CloudProviderStatus } from '@shared/ai'
import type { AiProvider, CloudModule } from '../types'
import {
  ANTHROPIC_DEFAULT_MODEL,
  ANTHROPIC_HELP_URL,
  ANTHROPIC_MODELS,
  OPENROUTER_DEFAULT_MODEL,
  OPENROUTER_HELP_URL,
  anthropicProvider,
  cachedOpenRouterModels,
  fetchOpenRouterModels,
  openRouterProvider
} from './api'
import { CLI_IDS, CLI_SPECS, cliProvider, type CliId } from './cli'
import { resolveBinary } from './cli-detect'
import { redact } from './redact'
import { keyStatus, removeApiKey, saveApiKey, type ApiKeyProvider } from './secrets'

/** Order used by 'auto' and by the status list. */
export const CLOUD_ORDER: CloudProviderId[] = ['claude-cli', 'codex-cli', 'gemini-cli', 'anthropic', 'openrouter']

type CloudChoice = Extract<AiChoice, { kind: 'cloud' }>

let readCloudModels: () => AiSettings['cloudModels'] = () => ({})
/**
 * The registry calls this once so 'auto' can use the model the user last picked per provider
 * (AiSettings.cloudModels). Without it 'auto' uses each provider's default.
 */
export function setCloudModelsReader(fn: () => AiSettings['cloudModels']): void {
  readCloudModels = fn
}

function rememberedModel(p: CloudProviderId): string | undefined {
  try {
    return readCloudModels()?.[p] || undefined
  } catch {
    return undefined
  }
}

function isCli(p: CloudProviderId): p is CliId {
  return (CLI_IDS as string[]).includes(p)
}

async function cliStatus(id: CliId, refresh: boolean): Promise<CloudProviderStatus> {
  const spec = CLI_SPECS[id]
  const path = await resolveBinary(spec.bin, { refresh })
  return {
    id,
    label: spec.label,
    kind: 'cli',
    available: Boolean(path),
    detail: path ?? undefined,
    helpUrl: spec.helpUrl,
    models: spec.models,
    defaultModel: ''
  }
}

function keyDetail(p: ApiKeyProvider): { available: boolean; detail?: string } {
  const k = keyStatus(p)
  if (k.set) return { available: true, detail: k.source === 'env' ? 'key set (from .env)' : 'key set' }
  if (k.undecryptable) return { available: false, detail: "saved key can't be decrypted: set it again" }
  return { available: false }
}

async function status(refresh = false): Promise<CloudProviderStatus[]> {
  const [claude, codex, gemini, orModels] = await Promise.all([
    cliStatus('claude-cli', refresh),
    cliStatus('codex-cli', refresh),
    cliStatus('gemini-cli', refresh),
    fetchOpenRouterModels({ refresh, timeoutMs: 4000 })
  ])
  const a = keyDetail('anthropic')
  const o = keyDetail('openrouter')
  const orList = (orModels ?? cachedOpenRouterModels() ?? []).map((m) => ({ id: m.id, label: m.label }))
  if (!orList.some((m) => m.id === OPENROUTER_DEFAULT_MODEL)) orList.unshift({ id: OPENROUTER_DEFAULT_MODEL, label: 'Claude Sonnet 5.5' })
  return [
    claude,
    codex,
    gemini,
    { id: 'anthropic', label: 'Anthropic API', kind: 'api', ...a, helpUrl: ANTHROPIC_HELP_URL, models: ANTHROPIC_MODELS, defaultModel: ANTHROPIC_DEFAULT_MODEL },
    { id: 'openrouter', label: 'OpenRouter', kind: 'api', ...o, helpUrl: OPENROUTER_HELP_URL, models: orList, defaultModel: OPENROUTER_DEFAULT_MODEL }
  ]
}

async function provider(choice: CloudChoice): Promise<AiProvider | Error> {
  const model = choice.model || rememberedModel(choice.provider) || undefined
  try {
    if (isCli(choice.provider)) return await cliProvider(choice.provider, model)
    if (choice.provider === 'anthropic') return anthropicProvider(model)
    if (choice.provider === 'openrouter') return await openRouterProvider(model)
    return new Error(`Unknown cloud provider "${String(choice.provider)}".`)
  } catch (e) {
    return new Error(redact((e as Error).message))
  }
}

async function autoProvider(): Promise<AiProvider | null> {
  for (const id of CLOUD_ORDER) {
    const p = await provider({ kind: 'cloud', provider: id }) // uses the remembered model
    if (!(p instanceof Error)) return p
  }
  return null
}

async function setApiKey(p: ApiKeyProvider, key: string | null): Promise<{ ok: boolean; error?: string }> {
  if (p !== 'anthropic' && p !== 'openrouter') return { ok: false, error: 'Unknown provider.' }
  const r = key === null || key.trim() === '' ? removeApiKey(p) : saveApiKey(p, key)
  if (r.error) r.error = redact(r.error, [key])
  return r
}

export const cloudModule: CloudModule = { status, provider, autoProvider, setApiKey }
