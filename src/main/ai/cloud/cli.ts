// Cloud providers that drive the user's own logged-in CLIs (Claude Code, OpenAI Codex, Gemini CLI)
// in their non-interactive modes. The prompt is never logged and is sent over stdin when long.
//
// Invocations (verified against each tool's docs, see README "Cloud AI"):
//   claude -p --output-format json --no-session-persistence --tools "" [--model X]      (prompt on stdin)
//   codex exec --skip-git-repo-check --sandbox read-only --ephemeral [-m X] -            (prompt on stdin)
//   gemini --output-format json [-m X] -p "<prompt>"                                      (stdin if long)
import { execFile } from 'node:child_process'
import { tmpdir } from 'node:os'
import type { CloudProviderId } from '@shared/ai'
import type { AiProvider, CompleteOptions } from '../types'
import { childPath, resolveBinary } from './cli-detect'
import { redact } from './redact'

export type CliId = Extract<CloudProviderId, 'claude-cli' | 'codex-cli' | 'gemini-cli'>

export interface CliModel {
  id: string
  label: string
}

export interface CliSpec {
  id: CliId
  label: string
  bin: string
  helpUrl: string
  /** First entry is always "CLI default" (id ''), which passes no model flag. */
  models: CliModel[]
}

const DEFAULT_MODEL: CliModel = { id: '', label: 'CLI default' }

export const CLI_SPECS: Record<CliId, CliSpec> = {
  'claude-cli': {
    id: 'claude-cli',
    label: 'Claude CLI',
    bin: 'claude',
    helpUrl: 'https://docs.claude.com/en/docs/claude-code/setup',
    // aliases from https://code.claude.com/docs/en/cli-reference (--model): they track the newest version
    models: [DEFAULT_MODEL, { id: 'sonnet', label: 'Sonnet' }, { id: 'opus', label: 'Opus' }, { id: 'haiku', label: 'Haiku (fastest)' }, { id: 'fable', label: 'Fable' }]
  },
  'codex-cli': {
    id: 'codex-cli',
    label: 'Codex CLI',
    bin: 'codex',
    helpUrl: 'https://developers.openai.com/codex/cli',
    // ids from the Codex models page (-m); verified 2026-11
    models: [
      DEFAULT_MODEL,
      { id: 'gpt-6-astra', label: 'GPT-6 Astra (most capable)' },
      { id: 'gpt-6.1-sol', label: 'GPT-6.1 Sol' },
      { id: 'gpt-6.1-terra', label: 'GPT-6.1 Terra (fast)' },
      { id: 'gpt-6-luna', label: 'GPT-6 Luna (efficient)' }
    ]
  },
  'gemini-cli': {
    id: 'gemini-cli',
    label: 'Gemini CLI',
    bin: 'gemini',
    helpUrl: 'https://github.com/google-gemini/gemini-cli#installation',
    // Gemini CLI accepts the family aliases (pro / flash / flash-lite) as well as full ids
    models: [DEFAULT_MODEL, { id: 'pro', label: 'Gemini Pro' }, { id: 'flash', label: 'Gemini Flash' }, { id: 'flash-lite', label: 'Gemini Flash-Lite (fastest)' }]
  }
}

export const CLI_IDS = Object.keys(CLI_SPECS) as CliId[]

/** Model ids go on a command line (and through cmd.exe for .cmd shims on Windows), so be strict. */
export function isSafeModelId(m: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,79}$/.test(m)
}

/** Prompts longer than this go over stdin instead of argv (gemini only; the others always use stdin). */
export const ARGV_PROMPT_LIMIT = 12_000
const GEMINI_STDIN_INSTRUCTION = 'Follow the instructions in the input.'

// ---------------------------------------------------------------- arg builders (pure)

export function buildClaudeArgs(model?: string): string[] {
  const args = ['-p', '--output-format', 'json', '--no-session-persistence', '--tools', '']
  if (model) args.push('--model', model)
  return args
}

export function buildCodexArgs(model?: string): string[] {
  // read-only sandbox + no git-repo check + no saved session; the trailing "-" reads the prompt from stdin.
  // `codex exec` never asks for approval, so no approval flag is needed.
  const args = ['exec', '--skip-git-repo-check', '--sandbox', 'read-only', '--ephemeral']
  if (model) args.push('-m', model)
  args.push('-')
  return args
}

export function buildGeminiArgs(model: string | undefined, prompt: string, forceStdin = false): { args: string[]; stdin?: string } {
  const args = ['--output-format', 'json']
  if (model) args.push('-m', model)
  if (forceStdin || prompt.length > ARGV_PROMPT_LIMIT) {
    // stdin is appended to the -p text by the CLI
    args.push('-p', GEMINI_STDIN_INSTRUCTION)
    return { args, stdin: prompt }
  }
  args.push('-p', prompt)
  return { args }
}

export function buildCliInvocation(id: CliId, prompt: string, model?: string, forceStdin = false): { args: string[]; stdin?: string } {
  if (model && !isSafeModelId(model)) throw new Error('That model name has unsupported characters.')
  const m = model || undefined
  if (id === 'claude-cli') return { args: buildClaudeArgs(m), stdin: prompt }
  if (id === 'codex-cli') return { args: buildCodexArgs(m), stdin: prompt }
  return buildGeminiArgs(m, prompt, forceStdin)
}

/** Append the schema as plain-text instructions (CLIs have no structured-output flag we can rely on). */
export function withSchema(prompt: string, schema?: Record<string, unknown>): string {
  if (!schema) return prompt
  return `${prompt}\n\nReply with ONLY a JSON value (no markdown fences) that validates against this JSON Schema:\n${JSON.stringify(schema)}`
}

// ---------------------------------------------------------------- output parsers (pure)

// eslint-disable-next-line no-control-regex
const ANSI = /\u001b\[[0-9;?]*[ -/]*[@-~]/g
export function stripAnsi(s: string): string {
  return s.replace(ANSI, '')
}

function tryJson(s: string): unknown {
  try {
    return JSON.parse(s)
  } catch {
    return undefined
  }
}

/** Parse the first JSON object/array in text that may have log noise around it. */
function looseJson(text: string): unknown {
  const t = text.trim()
  const direct = tryJson(t)
  if (direct !== undefined) return direct
  const start = t.indexOf('{')
  const end = t.lastIndexOf('}')
  if (start !== -1 && end > start) return tryJson(t.slice(start, end + 1))
  return undefined
}

export class CliOutputError extends Error {
  constructor(message: string, readonly raw?: string) {
    super(message)
  }
}

/** Claude Code `--output-format json`: `{type:"result", is_error, result}` (or an array of events ending in one). */
export function parseClaudeOutput(stdout: string): string {
  const text = stripAnsi(stdout).trim()
  const j = looseJson(text)
  let env: Record<string, unknown> | undefined
  if (Array.isArray(j)) env = [...j].reverse().find((e) => e && typeof e === 'object' && (e as Record<string, unknown>)['type'] === 'result') as Record<string, unknown> | undefined
  else if (j && typeof j === 'object') env = j as Record<string, unknown>
  if (env && typeof env['result'] === 'string') {
    if (env['is_error'] === true) throw new CliOutputError(env['result'], env['result'] as string)
    return (env['result'] as string).trim()
  }
  if (env && env['is_error'] === true) throw new CliOutputError(String(env['subtype'] ?? 'error'))
  if (!text) throw new CliOutputError('empty response')
  if (env) throw new CliOutputError('unrecognised response from the Claude CLI')
  return text // not JSON (older CLI): the plain text is the answer
}

/** Codex `exec` prints the final message on stdout (progress goes to stderr). Also understands `--json` JSONL. */
export function parseCodexOutput(stdout: string): string {
  const text = stripAnsi(stdout).trim()
  if (!text) throw new CliOutputError('empty response')
  if (text.startsWith('{') && text.includes('\n')) {
    let last: string | undefined
    for (const line of text.split('\n')) {
      const o = tryJson(line.trim()) as Record<string, any> | undefined // eslint-disable-line @typescript-eslint/no-explicit-any
      if (!o || typeof o !== 'object') continue
      const item = o['item'] ?? o['msg']
      if (item?.type === 'agent_message' && typeof (item.text ?? item.message) === 'string') last = item.text ?? item.message
      else if (typeof o['last_agent_message'] === 'string') last = o['last_agent_message']
    }
    if (last) return last.trim()
  }
  return text
}

/** Gemini `--output-format json`: `{response, stats, error?}`, possibly preceded by log lines. */
export function parseGeminiOutput(stdout: string): string {
  const text = stripAnsi(stdout).trim()
  const j = looseJson(text)
  if (j && typeof j === 'object' && !Array.isArray(j)) {
    const o = j as Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any
    if (o['error']) throw new CliOutputError(String(o['error']?.message ?? o['error']?.type ?? 'error'), JSON.stringify(o['error']))
    if (typeof o['response'] === 'string') {
      if (!o['response'].trim()) throw new CliOutputError('empty response')
      return o['response'].trim()
    }
  }
  if (!text) throw new CliOutputError('empty response')
  return text
}

export function parseCliOutput(id: CliId, stdout: string): string {
  return id === 'claude-cli' ? parseClaudeOutput(stdout) : id === 'codex-cli' ? parseCodexOutput(stdout) : parseGeminiOutput(stdout)
}

// ---------------------------------------------------------------- friendly errors (pure)

export function mapCliError(id: CliId, detail: string): string {
  const spec = CLI_SPECS[id]
  const t = detail.toLowerCase()
  const authRe = /not logged in|please run \/login|\/login|not signed in|invalid api key|authentication[_ ]error|authentication failed|unauthenticated|unauthorized|\b401\b|oauth token|token (has )?expired|log ?in required|sign in|no credentials|credentials? (not found|missing)|missing (api )?key|please set an auth method|gemini_api_key|openai_api_key|codex login|\bauth(entication)? (is )?(required|missing)/
  const quotaRe = /rate.?limit|quota|\b429\b|usage limit|limit reached|resource[_ ]exhausted|too many requests|exceeded your|out of credits|credit balance|overloaded|capacity/
  const modelRe = /(model|models?).{0,40}(not found|not supported|does not exist|unavailable|invalid|unknown|not available)|unknown model|invalid model|\b404\b.{0,40}model/
  if (authRe.test(t)) {
    if (id === 'claude-cli') return "Claude CLI isn't logged in: run `claude` once in Terminal and sign in."
    if (id === 'codex-cli') return "Codex CLI isn't signed in: run `codex login` in Terminal (or set OPENAI_API_KEY / CODEX_API_KEY)."
    return "Gemini CLI isn't signed in: run `gemini` once in Terminal and choose a login (or set GEMINI_API_KEY)."
  }
  if (quotaRe.test(t)) return `${spec.label} hit its usage or rate limit. Try again later, or pick another model or provider.`
  if (modelRe.test(t)) return `${spec.label} doesn't have that model on your account. Pick another model or "CLI default".`
  if (/timed out|etimedout|timeout/.test(t)) return `${spec.label} took too long (over 2 minutes) and was stopped.`
  if (/enoent|not found.*(command|binary)|spawn .* enoent/.test(t)) return `Couldn't start ${spec.label}. Reinstall it or check it opens in Terminal.`
  return ''
}

/** Final, redacted user-facing message for a failed CLI run. Never includes the prompt. */
export function cliErrorMessage(id: CliId, detail: string, known: Array<string | null | undefined> = []): string {
  const friendly = mapCliError(id, detail)
  if (friendly) return friendly
  const line = redact(stripAnsi(detail), known).split(/\r?\n/).map((l) => l.trim()).filter(Boolean).slice(-1)[0] ?? ''
  const short = line.length > 200 ? line.slice(0, 199) + '…' : line
  return short ? `${CLI_SPECS[id].label} failed: ${short}` : `${CLI_SPECS[id].label} failed with no message.`
}

// ---------------------------------------------------------------- running

export interface RunResult {
  stdout: string
  stderr: string
  code: number | string | null
  timedOut: boolean
  aborted: boolean
  spawnError?: string
}

const MAX_BUFFER = 16 * 1024 * 1024
export const CLI_TIMEOUT_MS = 120_000

export function runCli(file: string, args: string[], stdin: string | undefined, opts: { timeoutMs?: number; signal?: AbortSignal } = {}): Promise<RunResult> {
  return new Promise((resolve) => {
    const isWinShim = process.platform === 'win32' && /\.(cmd|bat)$/i.test(file)
    const child = execFile(
      isWinShim ? `"${file}"` : file,
      args,
      {
        cwd: tmpdir(), // neutral dir: the CLIs must not read the user's projects
        timeout: opts.timeoutMs ?? CLI_TIMEOUT_MS,
        signal: opts.signal,
        maxBuffer: MAX_BUFFER,
        windowsHide: true,
        shell: isWinShim,
        encoding: 'utf8',
        env: { ...process.env, PATH: childPath(file), NO_COLOR: '1', CI: '1', TERM: 'dumb' }
      },
      (err, stdout, stderr) => {
        const e = err as (NodeJS.ErrnoException & { killed?: boolean; signal?: string; code?: number | string }) | null
        resolve({
          stdout: String(stdout ?? ''),
          stderr: String(stderr ?? ''),
          code: e ? (e.code ?? 1) : 0,
          timedOut: Boolean(e && e.killed && !opts.signal?.aborted),
          aborted: Boolean(e && (e.name === 'AbortError' || e.code === 'ABORT_ERR' || opts.signal?.aborted)),
          spawnError: e && (e.code === 'ENOENT' || e.code === 'EACCES') ? String(e.code) : undefined
        })
      }
    )
    child.stdin?.on('error', () => undefined) // EPIPE when the CLI exits before reading stdin
    child.stdin?.end(stdin ?? '')
  })
}

export function createCliProvider(id: CliId, binPath: string, model?: string): AiProvider {
  const spec = CLI_SPECS[id]
  return {
    label: model ? `${spec.label} (${model})` : spec.label,
    kind: 'cloud',
    async complete(prompt: string, opts: CompleteOptions = {}): Promise<string> {
      const { args, stdin } = buildCliInvocation(id, withSchema(prompt, opts.jsonSchema), model, process.platform === 'win32' && /\.(cmd|bat)$/i.test(binPath))
      const r = await runCli(binPath, args, stdin, { timeoutMs: opts.timeoutMs ?? CLI_TIMEOUT_MS, signal: opts.signal })
      if (r.aborted) throw new Error('Cancelled.')
      if (r.timedOut) throw new Error(mapCliError(id, 'timed out'))
      if (r.spawnError) throw new Error(mapCliError(id, 'enoent') || `Couldn't start ${spec.label}.`)
      // claude reports its errors inside the JSON on stdout; the others use stderr
      if (r.code !== 0) {
        let detail = r.stderr
        if (id === 'claude-cli') {
          try {
            parseClaudeOutput(r.stdout)
          } catch (e) {
            detail = `${(e as Error).message}\n${r.stderr}`
          }
        }
        throw new Error(cliErrorMessage(id, detail || r.stdout))
      }
      try {
        return parseCliOutput(id, r.stdout)
      } catch (e) {
        const msg = (e as Error).message
        throw new Error(mapCliError(id, `${msg}\n${r.stderr}`) || cliErrorMessage(id, r.stderr || msg))
      }
    }
  }
}

export async function cliProvider(id: CliId, model?: string): Promise<AiProvider | Error> {
  const bin = await resolveBinary(CLI_SPECS[id].bin)
  if (!bin) return new Error(`${CLI_SPECS[id].label} isn't installed (or isn't on your PATH). Install it, then press Refresh.`)
  if (model && !isSafeModelId(model)) return new Error('That model name has unsupported characters.')
  return createCliProvider(id, bin, model)
}
