// Ollama: detect the app/daemon, list the user's installed models, pull (ONLY after the user
// confirms), and chat. Uses the HTTP API at AiSettings.ollamaUrl (default http://127.0.0.1:11434).
import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import type { CompleteOptions } from '../types'

/** The model we suggest pulling when Ollama is running without it. */
export const OLLAMA_SUGGESTED_MODEL = 'qwen3.5:0.8b'
export const OLLAMA_PROBE_TIMEOUT_MS = 800

export interface OllamaModel {
  name: string
  sizeBytes?: number
  family?: string
}

export interface OllamaProbe {
  running: boolean
  version?: string
  models: OllamaModel[]
}

export interface PullProgress {
  receivedBytes: number
  totalBytes: number | null
  status: string
}

export class OllamaError extends Error {
  constructor(
    message: string,
    readonly code: 'not-running' | 'not-installed' | 'model-not-found' | 'http' | 'bad-response'
  ) {
    super(message)
    this.name = 'OllamaError'
  }
}

const base = (url: string): string => url.replace(/\/+$/, '')

async function getJson(url: string, timeoutMs: number): Promise<unknown> {
  const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) })
  if (!res.ok) throw new OllamaError(`Ollama answered HTTP ${res.status}`, 'http')
  return res.json()
}

/** Parse GET /api/tags. Unknown shapes become an empty list. */
export function parseTags(json: unknown): OllamaModel[] {
  const list = (json as { models?: unknown })?.models
  if (!Array.isArray(list)) return []
  const out: OllamaModel[] = []
  for (const m of list as Record<string, unknown>[]) {
    const name = typeof m?.name === 'string' ? m.name : typeof m?.model === 'string' ? m.model : ''
    if (!name) continue
    const size = Number(m.size)
    const details = (m.details ?? {}) as Record<string, unknown>
    out.push({
      name,
      ...(Number.isFinite(size) && size > 0 ? { sizeBytes: size } : {}),
      ...(typeof details.family === 'string' && details.family ? { family: details.family } : {})
    })
  }
  return out.sort((a, b) => a.name.localeCompare(b.name))
}

/** GET /api/version + /api/tags, each with an ~800ms timeout. Never throws. */
export async function probeOllama(url: string, timeoutMs = OLLAMA_PROBE_TIMEOUT_MS): Promise<OllamaProbe> {
  try {
    const v = (await getJson(`${base(url)}/api/version`, timeoutMs)) as { version?: unknown }
    let models: OllamaModel[] = []
    try {
      models = parseTags(await getJson(`${base(url)}/api/tags`, timeoutMs))
    } catch {
      /* running but tags failed: show no models */
    }
    return { running: true, ...(typeof v?.version === 'string' ? { version: v.version } : {}), models }
  } catch {
    return { running: false, models: [] }
  }
}

function run(cmd: string, args: string[], timeoutMs: number): Promise<string | null> {
  return new Promise((resolve) => {
    try {
      execFile(cmd, args, { timeout: timeoutMs, windowsHide: true }, (err, stdout) => {
        resolve(err ? null : String(stdout).trim() || null)
      })
    } catch {
      resolve(null)
    }
  })
}

/** Where the Ollama binary / app lives, or null. Never throws. */
export async function findOllamaBinary(platform: NodeJS.Platform = process.platform): Promise<string | null> {
  if (platform === 'win32') {
    const out = await run('where', ['ollama'], 1500)
    if (out) return out.split(/\r?\n/)[0] ?? null
    const local = process.env['LOCALAPPDATA']
    const guess = local ? `${local}\\Programs\\Ollama\\ollama.exe` : null
    return guess && existsSync(guess) ? guess : null
  }
  // A login shell sees the user's PATH (GUI apps on macOS start with a minimal one).
  const shell = process.env['SHELL'] || '/bin/sh'
  const out = await run(shell, ['-lc', 'command -v ollama'], 1500)
  if (out && out.startsWith('/')) return out.split('\n')[0] ?? null
  const candidates = ['/usr/local/bin/ollama', '/opt/homebrew/bin/ollama', '/usr/bin/ollama']
  if (platform === 'darwin') candidates.push('/Applications/Ollama.app')
  return candidates.find((p) => existsSync(p)) ?? null
}

/** Case-insensitive name match where "x" and "x:latest" are the same model. */
export function sameModel(a: string, b: string): boolean {
  const n = (s: string): string => (s.includes(':') ? s : `${s}:latest`).toLowerCase()
  return n(a) === n(b)
}

/** The model 'auto' would use: qwen3.5:0.8b if present, else the smallest. */
export function pickAutoOllamaModel(models: OllamaModel[]): OllamaModel | null {
  if (!models.length) return null
  const pref = models.find((m) => sameModel(m.name, OLLAMA_SUGGESTED_MODEL))
  if (pref) return pref
  return [...models].sort((a, b) => (a.sizeBytes ?? Infinity) - (b.sizeBytes ?? Infinity))[0] ?? null
}

/** Turns a fetch failure into the message the user sees. */
export function friendlyOllamaError(e: unknown, opts: { installed: boolean; url: string; model?: string }): OllamaError {
  if (e instanceof OllamaError) return e
  const err = e as Error & { cause?: { code?: string } }
  if (err?.name === 'AbortError' || err?.name === 'TimeoutError') return new OllamaError('Ollama took too long to answer.', 'http')
  const code = err?.cause?.code
  if (err?.name === 'TypeError' || code === 'ECONNREFUSED' || code === 'ENOTFOUND') {
    return opts.installed
      ? new OllamaError('Ollama is installed but not running: open Ollama', 'not-running')
      : new OllamaError(`Ollama isn't running at ${opts.url}. Install it from ollama.com, then open it.`, 'not-installed')
  }
  return new OllamaError(err?.message || String(e), 'http')
}

async function errorFromResponse(res: Response, model: string): Promise<OllamaError> {
  let msg = ''
  try {
    msg = String(((await res.json()) as { error?: unknown }).error ?? '')
  } catch {
    /* not json */
  }
  if (res.status === 404 || /not found/i.test(msg)) {
    return new OllamaError(`model not found: ${model}. Pull it with \`ollama pull ${model}\`.`, 'model-not-found')
  }
  return new OllamaError(`Ollama error (HTTP ${res.status})${msg ? `: ${msg}` : ''}`, 'http')
}

/** Parse a POST /api/chat (stream:false) reply into the message text. */
export function parseChat(json: unknown): string {
  const j = json as { message?: { content?: unknown }; error?: unknown }
  if (typeof j?.error === 'string') throw new OllamaError(j.error, 'http')
  const content = j?.message?.content
  if (typeof content !== 'string') throw new OllamaError('Ollama sent an empty reply.', 'bad-response')
  return content
}

/** POST /api/chat with stream:false. `format` = the JSON schema when given. */
export async function ollamaChat(url: string, model: string, prompt: string, opts: CompleteOptions = {}): Promise<string> {
  const signals = [opts.signal, AbortSignal.timeout(opts.timeoutMs ?? 180_000)].filter((s): s is AbortSignal => s != null)
  const body: Record<string, unknown> = {
    model,
    messages: [{ role: 'user', content: prompt }],
    stream: false,
    ...(opts.jsonSchema ? { format: opts.jsonSchema } : {}),
    ...(opts.maxTokens ? { options: { num_predict: opts.maxTokens } } : {})
  }
  const res = await fetch(`${base(url)}/api/chat`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.any(signals)
  })
  if (!res.ok) throw await errorFromResponse(res, model)
  return parseChat(await res.json())
}

/** Folds /api/pull NDJSON lines (one per layer digest) into overall progress. */
export class PullAggregator {
  private layers = new Map<string, { total: number; completed: number }>()
  status = ''
  error: string | null = null
  success = false

  push(line: Record<string, unknown>): void {
    if (typeof line.error === 'string') this.error = line.error
    if (typeof line.status === 'string') {
      this.status = line.status
      if (line.status === 'success') this.success = true
    }
    const digest = typeof line.digest === 'string' ? line.digest : null
    const total = Number(line.total)
    if (digest && Number.isFinite(total) && total > 0) {
      const completed = Number(line.completed)
      this.layers.set(digest, { total, completed: Number.isFinite(completed) ? completed : 0 })
    }
  }

  progress(): PullProgress {
    let total = 0
    let done = 0
    for (const l of this.layers.values()) {
      total += l.total
      done += Math.min(l.completed, l.total)
    }
    return { receivedBytes: done, totalBytes: total || null, status: this.status }
  }
}

/**
 * POST /api/pull with streamed progress. Refuses unless `confirmed === true`.
 */
export async function pullOllamaModel(
  url: string,
  model: string,
  confirmed: boolean,
  onProgress: (p: PullProgress) => void,
  signal?: AbortSignal
): Promise<{ ok: boolean; error?: string }> {
  if (confirmed !== true) return { ok: false, error: 'Ollama models are only pulled after you confirm.' }
  if (!/^[\w.\-/:]+$/.test(model)) return { ok: false, error: 'That model name looks wrong.' }
  const res = await fetch(`${base(url)}/api/pull`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ model, stream: true }),
    ...(signal ? { signal } : {})
  })
  if (!res.ok || !res.body) throw await errorFromResponse(res, model)
  const agg = new PullAggregator()
  const decoder = new TextDecoder()
  let buf = ''
  const reader = res.body.getReader()
  const handle = (raw: string): void => {
    const s = raw.trim()
    if (!s) return
    try {
      agg.push(JSON.parse(s) as Record<string, unknown>)
    } catch {
      return
    }
    onProgress(agg.progress())
  }
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    buf += decoder.decode(value, { stream: true })
    let nl: number
    while ((nl = buf.indexOf('\n')) >= 0) {
      handle(buf.slice(0, nl))
      buf = buf.slice(nl + 1)
    }
  }
  handle(buf)
  if (agg.error) return { ok: false, error: /not found|does not exist/i.test(agg.error) ? `model not found: ${model}` : agg.error }
  return agg.success ? { ok: true } : { ok: false, error: 'The pull stopped before it finished.' }
}
