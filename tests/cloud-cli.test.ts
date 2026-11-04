import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  CLI_SPECS,
  buildClaudeArgs,
  buildCliInvocation,
  buildCodexArgs,
  buildGeminiArgs,
  cliErrorMessage,
  mapCliError,
  parseClaudeOutput,
  parseCodexOutput,
  parseGeminiOutput,
  withSchema,
  ARGV_PROMPT_LIMIT
} from '../src/main/ai/cloud/cli'
import { childPath, detectBinary, fallbackDirs, pickPathFromOutput, type DetectDeps } from '../src/main/ai/cloud/cli-detect'
import { redact } from '../src/main/ai/cloud/redact'

describe('arg builders', () => {
  it('claude: print mode, json, no tools/session, optional model, prompt on stdin', () => {
    expect(buildClaudeArgs()).toEqual(['-p', '--output-format', 'json', '--no-session-persistence', '--tools', ''])
    expect(buildClaudeArgs('opus').slice(-2)).toEqual(['--model', 'opus'])
  })
  it('codex: exec with read-only sandbox, no repo check, stdin marker last', () => {
    expect(buildCodexArgs()).toEqual(['exec', '--skip-git-repo-check', '--sandbox', 'read-only', '--ephemeral', '-'])
    const a = buildCodexArgs('gpt-6.1-sol')
    expect(a.slice(-3)).toEqual(['-m', 'gpt-6.1-sol', '-'])
  })
  it('gemini: short prompt in argv, long prompt on stdin', () => {
    expect(buildGeminiArgs(undefined, 'hi')).toEqual({ args: ['--output-format', 'json', '-p', 'hi'] })
    expect(buildGeminiArgs('flash', 'hi').args).toEqual(['--output-format', 'json', '-m', 'flash', '-p', 'hi'])
    const long = 'x'.repeat(ARGV_PROMPT_LIMIT + 1)
    const g = buildGeminiArgs(undefined, long)
    expect(g.stdin).toBe(long)
    expect(g.args.join(' ')).not.toContain(long)
  })
  it('never puts a claude/codex prompt in argv', () => {
    for (const id of ['claude-cli', 'codex-cli'] as const) {
      const inv = buildCliInvocation(id, 'SECRET PROMPT')
      expect(inv.args.join(' ')).not.toContain('SECRET PROMPT')
      expect(inv.stdin).toBe('SECRET PROMPT')
    }
  })
  it('rejects unsafe model ids and treats "" as CLI default', () => {
    expect(() => buildCliInvocation('claude-cli', 'p', 'x; rm -rf /')).toThrow()
    expect(buildCliInvocation('claude-cli', 'p', '').args).not.toContain('--model')
  })
  it('model lists start with CLI default and have unique ids', () => {
    for (const s of Object.values(CLI_SPECS)) {
      expect(s.models[0]).toEqual({ id: '', label: 'CLI default' })
      expect(new Set(s.models.map((m) => m.id)).size).toBe(s.models.length)
    }
  })
  it('withSchema appends the schema only when given', () => {
    expect(withSchema('p')).toBe('p')
    expect(withSchema('p', { type: 'object' })).toContain('{"type":"object"}')
  })
})

describe('output parsers', () => {
  it('claude: .result from the envelope', () => {
    expect(parseClaudeOutput('{"type":"result","subtype":"success","is_error":false,"result":" hello ","total_cost_usd":0}')).toBe('hello')
  })
  it('claude: array of events, error envelope, plain text fallback', () => {
    expect(parseClaudeOutput('[{"type":"system"},{"type":"result","result":"done","is_error":false}]')).toBe('done')
    expect(() => parseClaudeOutput('{"type":"result","is_error":true,"result":"Invalid API key · Please run /login"}')).toThrow(/login/)
    expect(parseClaudeOutput('just text')).toBe('just text')
    expect(() => parseClaudeOutput('')).toThrow()
  })
  it('codex: plain final message, ANSI stripped, JSONL fallback', () => {
    expect(parseCodexOutput('\u001b[1mDone\u001b[0m\n')).toBe('Done')
    const jsonl = ['{"type":"thread.started"}', '{"type":"item.completed","item":{"type":"agent_message","text":"final answer"}}', '{"type":"turn.completed"}'].join('\n')
    expect(parseCodexOutput(jsonl)).toBe('final answer')
    expect(() => parseCodexOutput('  ')).toThrow()
  })
  it('gemini: .response, tolerant of log noise, error object, plain text', () => {
    expect(parseGeminiOutput('{"response":"hi there","stats":{}}')).toBe('hi there')
    expect(parseGeminiOutput('Loaded cached credentials.\n{"response":"ok","stats":{}}\n')).toBe('ok')
    expect(() => parseGeminiOutput('{"error":{"type":"AuthError","message":"login required"}}')).toThrow(/login/)
    expect(parseGeminiOutput('plain')).toBe('plain')
  })
})

describe('friendly errors', () => {
  it('claude not logged in', () => {
    expect(mapCliError('claude-cli', 'Invalid API key · Please run /login')).toBe("Claude CLI isn't logged in: run `claude` once in Terminal and sign in.")
  })
  it('codex / gemini auth', () => {
    expect(mapCliError('codex-cli', 'ERROR: 401 Unauthorized')).toMatch(/codex login/)
    expect(mapCliError('gemini-cli', 'Please set an Auth method in settings or GEMINI_API_KEY')).toMatch(/gemini/)
  })
  it('quota / rate limit', () => {
    expect(mapCliError('claude-cli', 'Claude AI usage limit reached')).toMatch(/usage or rate limit/)
    expect(mapCliError('gemini-cli', 'RESOURCE_EXHAUSTED 429')).toMatch(/usage or rate limit/)
    expect(mapCliError('codex-cli', 'You exceeded your current quota')).toMatch(/usage or rate limit/)
  })
  it('unknown model, timeout, and generic fallbacks', () => {
    expect(mapCliError('gemini-cli', 'Model "foo" not found')).toMatch(/model/i)
    expect(mapCliError('codex-cli', 'timed out')).toMatch(/too long/)
    expect(cliErrorMessage('codex-cli', 'something odd\nlast line')).toBe('Codex CLI failed: last line')
  })
  it('redacts keys in generic errors', () => {
    const m = cliErrorMessage('gemini-cli', 'boom key=AIzaSyA1234567890abcdefghijklmnop')
    expect(m).not.toContain('AIza')
  })
})

describe('PATH resolution', () => {
  const mk = (over: Partial<DetectDeps> & { files?: string[]; shellOut?: string | Error }): DetectDeps => ({
    platform: 'darwin',
    env: { SHELL: '/bin/zsh', PATH: '/usr/bin:/bin' },
    home: '/Users/me',
    run: async () => {
      if (over.shellOut instanceof Error) throw over.shellOut
      return over.shellOut ?? ''
    },
    exists: (p) => (over.files ?? []).includes(p),
    listDir: (p) => (p === '/Users/me/.nvm/versions/node' ? ['v18.0.0', 'v22.3.0', 'v20.1.0'] : []),
    ...over
  })
  it('fallback dir list covers the required locations (nvm newest first)', () => {
    const d = fallbackDirs(mk({}))
    for (const p of ['/opt/homebrew/bin', '/usr/local/bin', '/Users/me/.local/bin', '/Users/me/.npm-global/bin', '/Users/me/.bun/bin', '/Users/me/.volta/bin']) expect(d).toContain(p)
    expect(d.indexOf('/Users/me/.nvm/versions/node/v22.3.0/bin')).toBeLessThan(d.indexOf('/Users/me/.nvm/versions/node/v18.0.0/bin'))
  })
  it('uses the login shell answer first, ignoring rc noise and aliases', async () => {
    const deps = mk({ shellOut: 'Welcome!\nalias claude=foo\n/opt/homebrew/bin/claude\n', files: ['/opt/homebrew/bin/claude'] })
    expect(await detectBinary('claude', deps)).toBe('/opt/homebrew/bin/claude')
  })
  it('falls back to the dir list when the shell fails', async () => {
    const deps = mk({ shellOut: new Error('timeout'), files: ['/Users/me/.bun/bin/codex'] })
    expect(await detectBinary('codex', deps)).toBe('/Users/me/.bun/bin/codex')
  })
  it('finds nvm installs and returns null when nothing exists', async () => {
    expect(await detectBinary('gemini', mk({ shellOut: '', files: ['/Users/me/.nvm/versions/node/v22.3.0/bin/gemini'] }))).toBe('/Users/me/.nvm/versions/node/v22.3.0/bin/gemini')
    expect(await detectBinary('gemini', mk({ shellOut: '' }))).toBeNull()
  })
  it('windows: `where`, then %APPDATA%\\npm with .cmd', async () => {
    const win = mk({ platform: 'win32', env: { APPDATA: 'C:\\Users\\me\\AppData\\Roaming', PATH: '' }, home: 'C:\\Users\\me', shellOut: new Error('x') })
    const dirs = fallbackDirs(win)
    expect(dirs[0]).toMatch(/npm$/)
    const found = mk({ platform: 'win32', env: { APPDATA: 'C:\\A', PATH: '' }, home: 'C:\\Users\\me', shellOut: new Error('x'), files: [join('C:\\A', 'npm', 'claude.cmd')] })
    expect(await detectBinary('claude', found)).toBe(join('C:\\A', 'npm', 'claude.cmd'))
    expect(pickPathFromOutput('C:\\Users\\me\\AppData\\Roaming\\npm\\claude.cmd\r\n', { platform: 'win32', exists: () => true })).toBe('C:\\Users\\me\\AppData\\Roaming\\npm\\claude.cmd')
  })
  it('childPath puts the binary dir first', () => {
    expect(childPath('/Users/me/.nvm/versions/node/v22/bin/claude', { PATH: '/usr/bin' }, 'darwin').startsWith('/Users/me/.nvm/versions/node/v22/bin:')).toBe(true)
  })
})

describe('redaction', () => {
  it('removes known and pattern-matched secrets', () => {
    const s = redact('Authorization: Bearer abcdefghijklmnop and sk-ant-api03-XXXXXXXXXXXX plus sk-or-v1-abcdef123456 and mykey12345', ['mykey12345'])
    expect(s).not.toMatch(/abcdefghijklmnop|sk-ant|sk-or-v1|mykey12345/)
  })
})
