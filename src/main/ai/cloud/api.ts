// Cloud providers that use an API key: Anthropic (official SDK) and OpenRouter (fetch).
import Anthropic from '@anthropic-ai/sdk'
import type { AiProvider, CompleteOptions } from '../types'
import { redact, safeMessage } from './redact'
import { resolveKey } from './secrets'
import { withSchema } from './cli'

export interface ApiModel {
  id: string
  label: string
}

// ---------------------------------------------------------------- Anthropic

/** Default Anthropic API model (was PLAN_MODEL in plan.ts). Ids: platform.claude.com/docs/en/models/overview */
export const ANTHROPIC_DEFAULT_MODEL = 'claude-sonnet-5-5'
export const ANTHROPIC_MODELS: ApiModel[] = [
  { id: 'claude-sonnet-5-5', label: 'Claude Sonnet 5.5' },
  { id: 'claude-opus-5-5', label: 'Claude Opus 5.5' },
  { id: 'claude-haiku-5-5', label: 'Claude Haiku 5.5 (fastest)' },
  { id: 'claude-fable-5-1', label: 'Claude Fable 5.1' }
]
export const ANTHROPIC_HELP_URL = 'https://console.anthropic.com/settings/keys'

export function anthropicErrorMessage(e: unknown, key?: string | null): string {
  const known = [key]
  if (e instanceof Anthropic.AuthenticationError) return 'Your Anthropic API key was rejected. Replace it in Settings, Cloud.'
  if (e instanceof Anthropic.PermissionDeniedError) return "Your Anthropic API key isn't allowed to use that model."
  if (e instanceof Anthropic.RateLimitError) return 'Rate limited by the Anthropic API. Try again in a minute.'
  if (e instanceof Anthropic.NotFoundError) return "Anthropic doesn't have that model. Pick another one."
  if (e instanceof Anthropic.APIError) return `Anthropic API error ${e.status ?? ''}: ${safeMessage(e, known)}`.replace('error :', 'error:')
  if ((e as Error)?.name === 'AbortError' || e instanceof Anthropic.APIUserAbortError) return 'Cancelled.'
  return `Anthropic request failed: ${safeMessage(e, known)}`
}

export const ANTHROPIC_BASE_URL = 'https://api.anthropic.com'

/**
 * Explicit client options so nothing in the environment (e.g. a planted .env, which loadEnv merges
 * into process.env) can redirect the key or the prompt: ANTHROPIC_BASE_URL would send the stored
 * key to another host, ANTHROPIC_LOG=debug would write prompts to main.log, ANTHROPIC_AUTH_TOKEN
 * would add a second credential. Profiles / credential files are not consulted either.
 */
export function anthropicClientOptions(apiKey: string): ConstructorParameters<typeof Anthropic>[0] {
  return { apiKey, authToken: null, baseURL: ANTHROPIC_BASE_URL, logLevel: 'off', openTelemetry: false, maxRetries: 2 }
}

export function createAnthropicProvider(apiKey: string, model: string = ANTHROPIC_DEFAULT_MODEL): AiProvider {
  return {
    label: `Anthropic API (${model})`,
    kind: 'cloud',
    async complete(prompt: string, opts: CompleteOptions = {}): Promise<string> {
      try {
        const client = new Anthropic(anthropicClientOptions(apiKey))
        const res = await client.beta.messages.create(
          {
            model,
            max_tokens: opts.maxTokens ?? 16000,
            output_config: { effort: 'low' },
            // server-side refusal fallback (routes declined requests to another model automatically)
            betas: ['server-side-fallback-2026-07-01'],
            fallbacks: 'default',
            messages: [{ role: 'user', content: withSchema(prompt, opts.jsonSchema) }]
          },
          { signal: opts.signal, timeout: opts.timeoutMs }
        )
        if (res.stop_reason === 'refusal') throw new Error('The model declined to answer. Try again later.')
        return res.content.map((b) => (b.type === 'text' ? b.text : '')).join('')
      } catch (e) {
        if (e instanceof Error && e.message.startsWith('The model declined')) throw e
        throw new Error(anthropicErrorMessage(e, apiKey))
      }
    }
  }
}

export function anthropicProvider(model?: string): AiProvider | Error {
  const k = resolveKey('anthropic')
  if (!k) return new Error('No Anthropic API key. Add one in Settings, Cloud (or ANTHROPIC_API_KEY in .env).')
  return createAnthropicProvider(k.key, model || ANTHROPIC_DEFAULT_MODEL)
}

// ---------------------------------------------------------------- OpenRouter

export const OPENROUTER_BASE = 'https://openrouter.ai/api/v1'
export const OPENROUTER_DEFAULT_MODEL = 'anthropic/claude-sonnet-5.5'
export const OPENROUTER_HELP_URL = 'https://openrouter.ai/settings/keys'
export const OPENROUTER_HEADERS = { 'HTTP-Referer': 'https://bloop.local', 'X-Title': 'Bloop' } as const

export interface OpenRouterModel extends ApiModel {
  contextLength?: number
  /** supports response_format json_schema */
  structured: boolean
}

/** Parse GET /models. Keeps text-in/text-out models, drops ":batch" duplicates, default model first, then A-Z. */
export function parseOpenRouterModels(json: unknown): OpenRouterModel[] {
  const data = (json as { data?: unknown })?.data
  if (!Array.isArray(data)) throw new Error('unexpected response from OpenRouter')
  const out: OpenRouterModel[] = []
  for (const m of data as Record<string, any>[]) { // eslint-disable-line @typescript-eslint/no-explicit-any
    const id = typeof m?.id === 'string' ? m.id : ''
    if (!id || id.endsWith(':batch')) continue
    const outMods: unknown = m?.architecture?.output_modalities
    const inMods: unknown = m?.architecture?.input_modalities
    if (Array.isArray(outMods) && !outMods.includes('text')) continue
    if (Array.isArray(inMods) && !inMods.includes('text')) continue
    const params: unknown = m?.supported_parameters
    out.push({
      id,
      label: typeof m.name === 'string' && m.name ? m.name : id,
      contextLength: typeof m.context_length === 'number' ? m.context_length : undefined,
      structured: Array.isArray(params) && params.includes('structured_outputs')
    })
  }
  out.sort((a, b) => (a.id === OPENROUTER_DEFAULT_MODEL ? -1 : b.id === OPENROUTER_DEFAULT_MODEL ? 1 : a.id.localeCompare(b.id)))
  return out
}

const MODELS_TTL_MS = 24 * 3600e3
const FAIL_BACKOFF_MS = 5 * 60e3
let modelCache: { at: number; models: OpenRouterModel[] } | null = null
let lastFailAt = 0

export function _resetOpenRouterCache(): void {
  modelCache = null
  lastFailAt = 0
}

export function cachedOpenRouterModels(): OpenRouterModel[] | null {
  return modelCache?.models ?? null
}

/** Public endpoint (no key needed). Cached 24h; on failure serves the stale cache (or null) and backs off 5 min. */
export async function fetchOpenRouterModels(opts: { refresh?: boolean; timeoutMs?: number; fetchImpl?: typeof fetch; now?: number } = {}): Promise<OpenRouterModel[] | null> {
  const now = opts.now ?? Date.now()
  if (modelCache && !opts.refresh && now - modelCache.at < MODELS_TTL_MS) return modelCache.models
  if (!opts.refresh && lastFailAt && now - lastFailAt < FAIL_BACKOFF_MS) return modelCache?.models ?? null
  try {
    const f = opts.fetchImpl ?? globalThis.fetch
    const res = await f(`${OPENROUTER_BASE}/models`, { headers: { ...OPENROUTER_HEADERS, Accept: 'application/json' }, signal: AbortSignal.timeout(opts.timeoutMs ?? 6000) })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const models = parseOpenRouterModels(await res.json())
    if (models.length) {
      modelCache = { at: now, models }
      lastFailAt = 0
    }
    return modelCache?.models ?? null
  } catch {
    lastFailAt = now
    return modelCache?.models ?? null
  }
}

export function buildOpenRouterBody(model: string, prompt: string, opts: CompleteOptions, structured: boolean): Record<string, unknown> {
  const body: Record<string, unknown> = {
    model,
    max_tokens: opts.maxTokens ?? 8000,
    messages: [{ role: 'user', content: opts.jsonSchema && !structured ? withSchema(prompt, opts.jsonSchema) : prompt }]
  }
  if (opts.jsonSchema && structured) {
    body['response_format'] = { type: 'json_schema', json_schema: { name: 'bloop_response', strict: true, schema: opts.jsonSchema } }
  }
  return body
}

export function openRouterHeaders(apiKey: string): Record<string, string> {
  return { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json', ...OPENROUTER_HEADERS }
}

export function openRouterErrorMessage(status: number, body: unknown, key?: string | null): string {
  const msg = redact(String((body as { error?: { message?: unknown } })?.error?.message ?? ''), [key]).replace(/\s+/g, ' ').trim().slice(0, 200)
  if (status === 401 || status === 403) return 'Your OpenRouter API key was rejected. Replace it in Settings, Cloud.'
  if (status === 402) return 'OpenRouter says your account is out of credits. Add credits at openrouter.ai/credits.'
  if (status === 404) return `OpenRouter doesn't have that model${msg ? `: ${msg}` : '.'} Pick another one.`
  if (status === 408) return 'OpenRouter timed out. Try again.'
  if (status === 429) return 'Rate limited by OpenRouter. Try again in a minute.'
  return `OpenRouter error ${status}${msg ? `: ${msg}` : ''}`
}

/** message.content is a string, or (rarely) an array of {type:'text', text} parts. */
export function parseOpenRouterResponse(json: unknown): string {
  const c = (json as { choices?: { message?: { content?: unknown } }[] })?.choices?.[0]?.message?.content
  if (typeof c === 'string' && c.trim()) return c
  if (Array.isArray(c)) {
    const t = c.map((p) => (typeof p === 'string' ? p : typeof (p as { text?: unknown })?.text === 'string' ? (p as { text: string }).text : '')).join('')
    if (t.trim()) return t
  }
  throw new Error('OpenRouter returned an empty reply. Try again or pick another model.')
}

export function createOpenRouterProvider(apiKey: string, model: string, fetchImpl?: typeof fetch): AiProvider {
  return {
    label: `OpenRouter (${model})`,
    kind: 'cloud',
    async complete(prompt: string, opts: CompleteOptions = {}): Promise<string> {
      const f = fetchImpl ?? globalThis.fetch
      const known = cachedOpenRouterModels()?.find((m) => m.id === model)
      let structured = Boolean(opts.jsonSchema) && known?.structured === true
      const signals = [AbortSignal.timeout(opts.timeoutMs ?? 120_000)]
      if (opts.signal) signals.push(opts.signal)
      const signal = AbortSignal.any(signals)
      try {
        for (let attempt = 0; attempt < 2; attempt++) {
          const res = await f(`${OPENROUTER_BASE}/chat/completions`, {
            method: 'POST',
            headers: openRouterHeaders(apiKey),
            body: JSON.stringify(buildOpenRouterBody(model, prompt, opts, structured)),
            signal
          })
          const json: unknown = await res.json().catch(() => null)
          if (res.ok) {
            const err = (json as { error?: { message?: string } })?.error
            if (err) throw new Error(openRouterErrorMessage(502, json, apiKey))
            return parseOpenRouterResponse(json)
          }
          // model rejected response_format: retry once with plain JSON prompting
          if (structured && attempt === 0 && res.status === 400 && /response_format|structured|json_schema/i.test(JSON.stringify(json))) {
            structured = false
            continue
          }
          throw new Error(openRouterErrorMessage(res.status, json, apiKey))
        }
        throw new Error('OpenRouter request failed.')
      } catch (e) {
        if (opts.signal?.aborted) throw new Error('Cancelled.')
        if ((e as Error)?.name === 'TimeoutError') throw new Error('OpenRouter took too long (over 2 minutes) and was stopped.')
        if (e instanceof Error && /^(OpenRouter|Your OpenRouter|Rate limited by OpenRouter)/.test(e.message)) throw e
        throw new Error(`OpenRouter request failed: ${safeMessage(e, [apiKey])}`)
      }
    }
  }
}

export async function openRouterProvider(model?: string): Promise<AiProvider | Error> {
  const k = resolveKey('openrouter')
  if (!k) return new Error('No OpenRouter API key. Add one in Settings, Cloud.')
  const m = model || OPENROUTER_DEFAULT_MODEL
  if (!/^[\w.:/@+-]{1,120}$/.test(m)) return new Error('That OpenRouter model id has unsupported characters.')
  await fetchOpenRouterModels({ timeoutMs: 3000 }) // warm the cache so structured-output support is known
  return createOpenRouterProvider(k.key, m)
}
