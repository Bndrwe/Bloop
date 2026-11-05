import { beforeEach, describe, expect, it, vi } from 'vitest'

const calls = vi.hoisted(() => ({ list: [] as { file: string; args: string[]; opts: Record<string, any>; stdin: string }[], reply: { err: null as any, stdout: '', stderr: '' } })) // eslint-disable-line @typescript-eslint/no-explicit-any

vi.mock('node:child_process', () => ({
  execFile: (file: string, args: string[], opts: Record<string, unknown>, cb: (e: unknown, o: string, r: string) => void) => {
    const rec = { file, args, opts, stdin: '' }
    calls.list.push(rec)
    queueMicrotask(() => cb(calls.reply.err, calls.reply.stdout, calls.reply.stderr))
    return { stdin: { on: () => undefined, end: (s: string) => (rec.stdin = s) } }
  }
}))

import { existsSync } from 'node:fs'
import { createCliProvider, privateTempBase } from '../src/main/ai/cloud/cli'

beforeEach(() => {
  calls.list = []
  calls.reply = { err: null, stdout: '', stderr: '' }
})

describe('createCliProvider (child_process mocked)', () => {
  it('runs claude with execFile in a fresh private cwd, prompt on stdin, 120s timeout', async () => {
    calls.reply.stdout = '{"type":"result","is_error":false,"result":"yo"}'
    const out = await createCliProvider('claude-cli', '/opt/homebrew/bin/claude', 'sonnet').complete('my private prompt')
    expect(out).toBe('yo')
    const c = calls.list[0]
    expect(c.file).toBe('/opt/homebrew/bin/claude')
    expect(c.args).toEqual(['-p', '--output-format', 'json', '--no-session-persistence', '--tools', '', '--model', 'sonnet'])
    expect(c.stdin).toBe('my private prompt')
    expect(c.opts['cwd']).toMatch(/bloop-cli-/)
    expect(c.opts['cwd'].startsWith(privateTempBase())).toBe(true)
    expect(existsSync(c.opts['cwd'])).toBe(false) // removed after the run
    expect(c.opts['timeout']).toBe(120_000)
    expect(c.opts['shell']).toBe(false)
    if (process.platform !== 'win32') expect(c.opts['env'].PATH.startsWith('/opt/homebrew/bin')).toBe(true)
  })
  it('maps a claude auth failure reported in stdout JSON', async () => {
    calls.reply.err = Object.assign(new Error('exit 1'), { code: 1 })
    calls.reply.stdout = '{"type":"result","is_error":true,"result":"Invalid API key · Please run /login"}'
    await expect(createCliProvider('claude-cli', '/x/claude').complete('p')).rejects.toThrow("Claude CLI isn't logged in: run `claude` once in Terminal")
  })
  it('maps codex quota on stderr and does not echo the prompt', async () => {
    calls.reply.err = Object.assign(new Error('exit 1 PROMPTTEXT'), { code: 1 })
    calls.reply.stderr = 'ERROR: 429 Too Many Requests'
    const e = await createCliProvider('codex-cli', '/x/codex').complete('PROMPTTEXT').catch((x: Error) => x)
    expect((e as Error).message).toMatch(/usage or rate limit/)
    expect((e as Error).message).not.toContain('PROMPTTEXT')
  })
  it('reports timeouts and missing binaries', async () => {
    calls.reply.err = Object.assign(new Error('t'), { killed: true, signal: 'SIGTERM' })
    await expect(createCliProvider('gemini-cli', '/x/gemini').complete('p')).rejects.toThrow(/too long/)
    calls.reply.err = Object.assign(new Error('spawn'), { code: 'ENOENT' })
    await expect(createCliProvider('gemini-cli', '/x/gemini').complete('p')).rejects.toThrow(/Couldn't start/)
  })
  it('gemini prompt goes over stdin, never argv, and parses .response', async () => {
    calls.reply.stdout = '{"response":"ok"}'
    expect(await createCliProvider('gemini-cli', '/x/gemini', 'flash').complete('hello')).toBe('ok')
    expect(calls.list[0].args).toEqual(['--output-format', 'json', '-m', 'flash', '-p', 'Follow the instructions in the input.'])
    expect(calls.list[0].stdin).toBe('hello')
  })
})
