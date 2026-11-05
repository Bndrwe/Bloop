// CLI providers: no shell, no prompt in argv, safe cmd.exe quoting for Windows .cmd shims,
// a private throwaway cwd, and no .env secrets leaking into the child environment.
import { beforeEach, describe, expect, it, vi } from 'vitest'

const calls = vi.hoisted(() => ({
  list: [] as { file: string; args: string[]; opts: Record<string, any>; stdin: string; cwdMode?: number }[], // eslint-disable-line @typescript-eslint/no-explicit-any
  stdout: '{"type":"result","is_error":false,"result":"ok"}'
}))

vi.mock('node:child_process', async () => {
  const { statSync } = await import('node:fs')
  return {
    execFile: (file: string, args: string[], opts: Record<string, unknown>, cb: (e: unknown, o: string, r: string) => void) => {
      const rec: (typeof calls.list)[number] = { file, args, opts, stdin: '' }
      try {
        rec.cwdMode = statSync(String(opts['cwd'])).mode & 0o777
      } catch {
        rec.cwdMode = -1
      }
      calls.list.push(rec)
      queueMicrotask(() => cb(null, calls.stdout, ''))
      return { stdin: { on: () => undefined, end: (s: string) => (rec.stdin = s) } }
    }
  }
})

import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { buildCmdShimLine, cliChildEnv, createCliProvider, isWinShim, privateTempBase, quoteCmdArg, runCli, type CliId } from '../src/main/ai/cloud/cli'
import { redact } from '../src/main/ai/cloud/redact'

beforeEach(() => {
  calls.list = []
  calls.stdout = '{"type":"result","is_error":false,"result":"ok"}'
})

const INJECTION = 'Plan my week" & calc.exe & echo "%USERPROFILE%\n^| whoami'

describe('the prompt never reaches argv', () => {
  for (const [id, out] of [
    ['claude-cli', '{"type":"result","is_error":false,"result":"ok"}'],
    ['codex-cli', 'ok'],
    ['gemini-cli', '{"response":"ok"}']
  ] as [CliId, string][]) {
    it(`${id}: prompt (with cmd metacharacters) goes over stdin only`, async () => {
      calls.stdout = out
      await createCliProvider(id, '/usr/local/bin/x', 'sonnet').complete(INJECTION)
      const c = calls.list[0]!
      expect(c.stdin).toContain(INJECTION)
      expect(c.args.join(' ')).not.toContain('calc.exe')
      expect(c.opts['shell']).toBe(false)
    })
  }
})

describe('Windows .cmd shims go through cmd.exe with verbatim, quoted args', () => {
  it('detects shims only on win32', () => {
    expect(isWinShim('C:\\x\\claude.cmd', 'win32')).toBe(true)
    expect(isWinShim('C:\\x\\claude.BAT', 'win32')).toBe(true)
    expect(isWinShim('C:\\x\\claude.exe', 'win32')).toBe(false)
    expect(isWinShim('/x/claude.cmd', 'darwin')).toBe(false)
  })
  it('quotes safely and refuses what cmd.exe would reinterpret', () => {
    expect(quoteCmdArg('')).toBe('""') // `--tools ""` must survive (it was dropped with shell:true)
    expect(quoteCmdArg('--output-format')).toBe('--output-format')
    expect(quoteCmdArg('gpt-6.1-sol')).toBe('gpt-6.1-sol')
    expect(quoteCmdArg('anthropic/claude-sonnet-5.5')).toBe('anthropic/claude-sonnet-5.5')
    expect(quoteCmdArg('Follow the instructions in the input.')).toBe('"Follow the instructions in the input."')
    expect(quoteCmdArg('a&b')).toBe('"a&b"')
    expect(quoteCmdArg('a|b(c)<d>')).toBe('"a|b(c)<d>"')
    for (const bad of ['a"b', '%PATH%', 'a!b!', 'line\nbreak', 'cr\rx', 'trailing\\', 'nul\u0000']) {
      expect(() => quoteCmdArg(bad), JSON.stringify(bad)).toThrow()
    }
  })
  it('builds a /s /c line with the shim path quoted', () => {
    const line = buildCmdShimLine('C:\\Program Files (x86)\\npm\\claude.cmd', ['-p', '--tools', '', '--model', 'opus'])
    expect(line).toBe('""C:\\Program Files (x86)\\npm\\claude.cmd" -p --tools "" --model opus"')
    expect(() => buildCmdShimLine('C:\\100%\\claude.cmd', [])).toThrow()
  })
  it('runCli uses ComSpec with windowsVerbatimArguments and no shell', async () => {
    const r = await runCli('C:\\Users\\me\\AppData\\Roaming\\npm\\claude.cmd', ['-p', '--tools', ''], 'PROMPT', {
      platform: 'win32',
      env: { ComSpec: 'C:\\Windows\\system32\\cmd.exe', PATH: 'C:\\Windows' }
    })
    expect(r.code).toBe(0)
    const c = calls.list[0]!
    expect(c.file).toBe('C:\\Windows\\system32\\cmd.exe')
    expect(c.args).toEqual(['/d', '/s', '/c', '""C:\\Users\\me\\AppData\\Roaming\\npm\\claude.cmd" -p --tools """'])
    expect(c.opts['windowsVerbatimArguments']).toBe(true)
    expect(c.opts['shell']).toBe(false)
    expect(c.stdin).toBe('PROMPT')
  })
  it('refuses to run an arg cmd.exe could reinterpret (and runs nothing)', async () => {
    const r = await runCli('C:\\x\\gemini.cmd', ['-p', 'evil" & calc'], undefined, { platform: 'win32', env: {} })
    expect(r.code).toBe(1)
    expect(calls.list).toHaveLength(0)
  })
  it('a non-shim runs the binary directly without a shell', async () => {
    await runCli('/usr/local/bin/claude', ['-p'], 'x', { platform: 'darwin', env: { PATH: '/usr/bin' } })
    const c = calls.list[0]!
    expect(c.file).toBe('/usr/local/bin/claude')
    expect(c.opts['shell']).toBe(false)
    expect(c.opts['windowsVerbatimArguments']).toBe(false)
  })
})

describe('working directory', () => {
  it('is a fresh private (0700) folder per call, removed afterwards', async () => {
    await runCli('/usr/local/bin/claude', [], 'x', { platform: 'linux', env: { PATH: '/usr/bin' } })
    await runCli('/usr/local/bin/claude', [], 'x', { platform: 'linux', env: { PATH: '/usr/bin' } })
    const [a, b] = calls.list
    expect(a!.opts['cwd']).not.toBe(b!.opts['cwd'])
    expect(a!.opts['cwd']).not.toBe(tmpdir())
    if (process.platform !== 'win32') expect(a!.cwdMode).toBe(0o700)
    expect(existsSync(a!.opts['cwd'])).toBe(false)
  })
  it('prefers XDG_RUNTIME_DIR on Linux (shared /tmp is world-writable)', () => {
    expect(privateTempBase({ XDG_RUNTIME_DIR: tmpdir() }, 'linux')).toBe(tmpdir())
    expect(privateTempBase({ XDG_RUNTIME_DIR: '/definitely/not/here' }, 'linux')).toBe(tmpdir())
    expect(privateTempBase({ XDG_RUNTIME_DIR: 'relative' }, 'linux')).toBe(tmpdir())
    expect(privateTempBase({}, 'darwin')).toBe(tmpdir())
  })
})

describe('child environment', () => {
  it('drops variables added after startup (.env) and Electron/Node injection vars', () => {
    const startup = new Set(['PATH', 'HOME', 'ELECTRON_RUN_AS_NODE', 'NODE_OPTIONS', 'OPENAI_API_KEY'])
    const env = {
      PATH: '/usr/bin',
      HOME: '/Users/me',
      ELECTRON_RUN_AS_NODE: '1',
      NODE_OPTIONS: '--require /tmp/evil.js',
      OPENAI_API_KEY: 'users-own-shell-key',
      ANTHROPIC_API_KEY: 'sk-ant-from-dotenv-1234567890', // loaded from Bloop's .env after startup
      ANTHROPIC_BASE_URL: 'https://evil.example' // ditto
    }
    const out = cliChildEnv('/usr/local/bin/claude', env, startup, 'darwin')
    expect(out['HOME']).toBe('/Users/me')
    expect(out['OPENAI_API_KEY']).toBe('users-own-shell-key') // the user's own env stays: their CLI, their login
    expect(out['ANTHROPIC_API_KEY']).toBeUndefined()
    expect(out['ANTHROPIC_BASE_URL']).toBeUndefined()
    expect(out['ELECTRON_RUN_AS_NODE']).toBeUndefined()
    expect(out['NODE_OPTIONS']).toBeUndefined()
    expect(out['PATH']!.startsWith('/usr/local/bin')).toBe(true)
    expect(out['NO_COLOR']).toBe('1')
  })
})

describe('redaction covers token formats from the release checklist', () => {
  it('redacts sk-ant, sk-or, AIza, ghp_, github_pat_, hf_', () => {
    const s = redact(
      'a sk-ant-api03-ABCDEFGHIJKL b sk-or-v1-0123456789abcdef c AIzaSyA1234567890abcdefghijklmnop d ghp_abcdefghijklmnopqrstuvwxyz0123 e github_pat_11ABCDEFG0123456789_abcdefghij f hf_abcdefghijklmnopqrstuvwxyz'
    )
    for (const leak of ['ABCDEFGHIJKL', '0123456789abcdef', 'AIzaSy', 'ghp_', 'github_pat_', 'hf_']) expect(s).not.toContain(leak)
  })
})
