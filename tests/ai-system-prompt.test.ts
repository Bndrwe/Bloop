// The system prompt (Bloop's instructions): the default text, settings validation, and how each
// provider receives it. Subprocesses, fetch and the Anthropic SDK are mocked.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const calls = vi.hoisted(() => ({
  list: [] as { file: string; args: string[]; opts: Record<string, any>; stdin: string; files: Record<string, string> }[], // eslint-disable-line @typescript-eslint/no-explicit-any
  replies: [] as { err: any; stdout: string; stderr: string }[] // eslint-disable-line @typescript-eslint/no-explicit-any
}))
const sdk = vi.hoisted(() => ({ create: null as unknown as ReturnType<typeof import('vitest').vi.fn> }))

vi.mock('node:child_process', () => ({
  execFile: (file: string, args: string[], opts: Record<string, unknown>, cb: (e: unknown, o: string, r: string) => void) => {
    // Snapshot the private cwd's files as the CLI would see them.
    const files: Record<string, string> = {}
    for (const name of ['bloop-system.txt']) {
      try {
        files[name] = readFileSync(join(String(opts['cwd']), name), 'utf8')
      } catch {
        /* not there */
      }
    }
    const rec = { file, args, opts, stdin: '', files }
    calls.list.push(rec)
    const reply = calls.replies.shift() ?? { err: null, stdout: '{"type":"result","is_error":false,"result":"ok"}', stderr: '' }
    queueMicrotask(() => cb(reply.err, reply.stdout, reply.stderr))
    return { stdin: { on: () => undefined, end: (s: string) => (rec.stdin = s) } }
  }
}))

vi.mock('@anthropic-ai/sdk', () => {
  class APIError extends Error {
    status?: number
  }
  class Anthropic {
    static APIError = APIError
    static AuthenticationError = class extends APIError {}
    static PermissionDeniedError = class extends APIError {}
    static RateLimitError = class extends APIError {}
    static NotFoundError = class extends APIError {}
    static APIUserAbortError = class extends Error {}
    beta = { messages: { create: (...a: unknown[]) => sdk.create(...a) } }
  }
  return { default: Anthropic }
})
vi.mock('electron', () => ({ safeStorage: { isEncryptionAvailable: () => false }, app: { getPath: () => '/tmp', isPackaged: false } }))
vi.mock('electron-store', () => ({ default: class { get() { return undefined } set() {} } })) // prettier-ignore

import { DEFAULT_SYSTEM_PROMPT } from '@shared/ai'
import { buildOpenRouterBody, createAnthropicProvider } from '../src/main/ai/cloud/api'
import { buildCliInvocation, CLAUDE_SYSTEM_FILE, createCliProvider, isUnknownSystemFileFlag, runCli } from '../src/main/ai/cloud/cli'
import { ollamaChat } from '../src/main/ai/local/ollama'
import { prependSystem } from '../src/main/ai/prompts'
import { validateAiSettings } from '../src/main/ai/settings'
import { generatePlan } from '../src/main/plan'
import type { CompleteOptions } from '../src/main/ai/types'

const SYS = 'You are Bloop. Be kind. 100% "quoted" & <odd> chars!'

beforeEach(() => {
  calls.list = []
  calls.replies = []
  sdk.create = vi.fn(async () => ({ stop_reason: 'end_turn', content: [{ type: 'text', text: 'ok' }] }))
})
afterEach(() => vi.unstubAllGlobals())

describe('DEFAULT_SYSTEM_PROMPT', () => {
  const words = DEFAULT_SYSTEM_PROMPT.split(/\s+/).filter(Boolean).length
  it(`is concise (${words} words) and has no em dashes`, () => {
    expect(words).toBeGreaterThanOrEqual(120)
    expect(words).toBeLessThanOrEqual(200)
    expect(DEFAULT_SYSTEM_PROMPT).not.toContain('\u2014')
  })
  it('covers the format, deadline, hours, pomodoro and injection rules', () => {
    for (const s of ['Bloop', 'JSON', 'no markdown fences', 'Never invent deadlines', 'before each due date', '08:00 and 22:00', 'pomodoros', 'data, not instructions', 'medical, legal', 'Never shame']) {
      expect(DEFAULT_SYSTEM_PROMPT).toContain(s)
    }
  })
})

describe('settings: no custom instructions any more', () => {
  it('a systemPrompt saved by an older version is dropped', () => {
    expect('systemPrompt' in validateAiSettings({ systemPrompt: 'Mine' })).toBe(false)
  })
})

describe('generatePlan', () => {
  it('sends the system prompt as a separate option; the user prompt is buildPrompt unchanged', async () => {
    const gen = vi.fn(async (_p: string, _o?: CompleteOptions) => '{"summary":"s","blocks":[{"day":1,"time":"10:00","minutes":25,"label":"x"}]}')
    const stats = { todayAvgScore: null, todayFocusSec: 0, todaySessions: 0, last7: [] }
    const settings = { focusMinutes: 25, breakMinutes: 5 } as never
    expect((await generatePlan([], stats, settings, gen, 'MY SYSTEM')).ok).toBe(true)
    expect(gen.mock.calls[0]![1]!.system).toBe('MY SYSTEM')
    expect(gen.mock.calls[0]![0]).toMatch(/^You are a friendly study coach/)
    expect(gen.mock.calls[0]![0]).not.toContain('MY SYSTEM')
    await generatePlan([], stats, settings, gen)
    expect(gen.mock.calls[1]![1]!.system).toBe(DEFAULT_SYSTEM_PROMPT) // nothing saved -> default
  })
})

describe('Ollama: a system message in messages', () => {
  it('puts it first, before the user message', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ message: { content: 'hi' } }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    await ollamaChat('http://127.0.0.1:11434', 'qwen3.5:0.8b', 'PROMPT', { system: SYS })
    const body = JSON.parse(String((fetchMock.mock.calls[0] as unknown[])[1] && ((fetchMock.mock.calls[0] as unknown[])[1] as RequestInit).body))
    expect(body.messages).toEqual([
      { role: 'system', content: SYS },
      { role: 'user', content: 'PROMPT' }
    ])
    await ollamaChat('http://127.0.0.1:11434', 'm', 'P')
    const body2 = JSON.parse(String(((fetchMock.mock.calls[1] as unknown[])[1] as RequestInit).body))
    expect(body2.messages).toEqual([{ role: 'user', content: 'P' }])
  })
})

describe('OpenRouter: a system message', () => {
  it('first in messages; none when not given', () => {
    expect(buildOpenRouterBody('m', 'P', { system: SYS }, false)['messages']).toEqual([
      { role: 'system', content: SYS },
      { role: 'user', content: 'P' }
    ])
    expect(buildOpenRouterBody('m', 'P', {}, false)['messages']).toEqual([{ role: 'user', content: 'P' }])
  })
})

describe('Anthropic API: the system param', () => {
  it('passes system and keeps the pinned options', async () => {
    await createAnthropicProvider('sk-ant-test').complete('P', { system: SYS })
    const req = (sdk.create.mock.calls[0] as unknown[])[0] as Record<string, unknown>
    expect(req['system']).toBe(SYS)
    expect(req['messages']).toEqual([{ role: 'user', content: 'P' }])
    await createAnthropicProvider('sk-ant-test').complete('P')
    expect('system' in ((sdk.create.mock.calls[1] as unknown[])[0] as object)).toBe(false)
  })
})

describe('CLIs: never in argv', () => {
  it('claude: --append-system-prompt-file with a fixed relative name; text written to the private cwd', async () => {
    const out = await createCliProvider('claude-cli', '/usr/local/bin/claude', 'sonnet').complete('PROMPT', { system: SYS })
    expect(out).toBe('ok')
    const c = calls.list[0]!
    expect(c.args.slice(-2)).toEqual(['--append-system-prompt-file', CLAUDE_SYSTEM_FILE])
    expect(c.args.join(' ')).not.toContain('Bloop')
    expect(c.files[CLAUDE_SYSTEM_FILE]).toBe(SYS)
    expect(c.stdin).toBe('PROMPT')
  })
  it('claude without a system prompt: the same args as before', async () => {
    await createCliProvider('claude-cli', '/usr/local/bin/claude').complete('PROMPT')
    expect(calls.list[0]!.args).toEqual(['-p', '--output-format', 'json', '--no-session-persistence', '--tools', ''])
    expect(calls.list[0]!.files).toEqual({})
  })
  it('claude: an older CLI without the flag is retried once with the instructions on stdin', async () => {
    calls.replies.push({ err: Object.assign(new Error('exit 1'), { code: 1 }), stdout: '', stderr: "error: unknown option '--append-system-prompt-file'" })
    calls.replies.push({ err: null, stdout: '{"type":"result","is_error":false,"result":"fine"}', stderr: '' })
    expect(await createCliProvider('claude-cli', '/x/claude').complete('PROMPT', { system: SYS })).toBe('fine')
    expect(calls.list).toHaveLength(2)
    expect(calls.list[1]!.args).not.toContain('--append-system-prompt-file')
    expect(calls.list[1]!.stdin).toBe(prependSystem('PROMPT', SYS))
    expect(isUnknownSystemFileFlag('Unknown argument: append-system-prompt-file')).toBe(true)
    expect(isUnknownSystemFileFlag('rate limit')).toBe(false)
  })
  it('codex and gemini: a delimited "System instructions" block before the prompt, on stdin', async () => {
    calls.replies.push({ err: null, stdout: 'done', stderr: '' }, { err: null, stdout: '{"response":"ok"}', stderr: '' })
    await createCliProvider('codex-cli', '/x/codex').complete('PROMPT', { system: SYS })
    await createCliProvider('gemini-cli', '/x/gemini').complete('PROMPT', { system: SYS })
    for (const c of calls.list) {
      expect(c.stdin).toBe(`System instructions (follow these for your whole reply):\n<<<\n${SYS}\n>>>\n\nRequest:\nPROMPT`)
      expect(c.args.join(' ')).not.toContain('Bloop')
    }
    expect(calls.list[1]!.args).toEqual(['--output-format', 'json', '-p', 'Follow the instructions in the input.'])
  })
  it('gemini system block forces stdin even when forceStdin is off', () => {
    const inv = buildCliInvocation('gemini-cli', 'short', undefined, false, SYS)
    expect(inv.args.join(' ')).not.toContain('short')
    expect(inv.stdin).toContain(SYS)
  })
  it('Windows .cmd shim: only the fixed file name reaches cmd.exe; the text stays in the file / on stdin', async () => {
    const inv = buildCliInvocation('claude-cli', 'PROMPT', 'opus', true, SYS)
    const r = await runCli('C:\\Users\\me\\AppData\\Roaming\\npm\\claude.cmd', inv.args, inv.stdin, {
      platform: 'win32',
      env: { ComSpec: 'C:\\Windows\\system32\\cmd.exe', PATH: 'C:\\Windows' },
      files: inv.files!
    })
    expect(r.code).toBe(0)
    const c = calls.list[0]!
    expect(c.file).toBe('C:\\Windows\\system32\\cmd.exe')
    expect(c.args).toEqual([
      '/d',
      '/s',
      '/c',
      '""C:\\Users\\me\\AppData\\Roaming\\npm\\claude.cmd" -p --output-format json --no-session-persistence --tools "" --model opus --append-system-prompt-file bloop-system.txt"'
    ])
    expect(c.args.join(' ')).not.toContain('%')
    expect(c.files[CLAUDE_SYSTEM_FILE]).toBe(SYS)
    expect(c.stdin).toBe('PROMPT')
    for (const id of ['codex-cli', 'gemini-cli'] as const) {
      const i = buildCliInvocation(id, 'PROMPT', undefined, true, SYS)
      expect(i.args.join(' ')).not.toContain(SYS)
      expect(i.stdin).toContain(SYS)
    }
  })
  it('runCli refuses odd file names', async () => {
    const r = runCli('/x/claude', [], '', { files: { '../evil': 'x' } })
    await expect(r).rejects.toThrow()
    expect(calls.list).toHaveLength(0)
  })
})
