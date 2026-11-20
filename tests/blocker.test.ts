import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  adminAppleScript,
  expandHostnames,
  HELPER_PATH,
  HELPER_SCRIPT,
  installCommand,
  normalizeSite,
  renderHosts,
  SECTION_BEGIN,
  SECTION_END,
  sudoersLine
} from '../src/main/blocker/hosts'
import { SiteBlocker, NeedsSetupError, type Runner } from '../src/main/blocker/siteBlocker'
import { BlockerController, cleanSites, type BlockerData, type RunningBlock } from '../src/main/blocker/controller'

const BASE_HOSTS = '##\n# Host Database\n##\n127.0.0.1\tlocalhost\n::1             localhost\n'

describe('normalizeSite / expandHostnames', () => {
  it('trims links down to the hostname', () => {
    expect(normalizeSite('https://www.YouTube.com/watch?v=1')).toBe('youtube.com')
    expect(normalizeSite('reddit.com:443/r/x')).toBe('reddit.com')
    expect(normalizeSite('localhost')).toBeNull()
    expect(normalizeSite('bad host.com')).toBeNull()
    expect(normalizeSite('x.com; rm -rf /')).toBeNull()
    expect(normalizeSite('apple.com')).toBeNull()
    expect(normalizeSite('https://support.apple.com/x')).toBeNull()
  })
  it('adds www. and m. variants without duplicates', () => {
    expect(expandHostnames(['youtube.com', 'www.youtube.com', 'nope'])).toEqual(['youtube.com', 'www.youtube.com', 'm.youtube.com'])
  })
})

describe('renderHosts', () => {
  it('adds a marked section and removes it again, leaving the rest alone', () => {
    const on = renderHosts(BASE_HOSTS, ['youtube.com'])
    expect(on).toContain(`${SECTION_BEGIN}\n0.0.0.0 youtube.com\n:: youtube.com\n${SECTION_END}\n`)
    expect(on.startsWith(BASE_HOSTS.trimEnd())).toBe(true)
    expect(renderHosts(on, [])).toBe(BASE_HOSTS)
  })
  it('replaces an existing section instead of stacking', () => {
    const twice = renderHosts(renderHosts(BASE_HOSTS, ['a.com']), ['b.com'])
    expect(twice).not.toContain('a.com')
    expect(twice.split(SECTION_BEGIN)).toHaveLength(2)
  })
})

describe.skipIf(process.platform === 'win32')('helper script (run with sh on a temp hosts file)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'bloop-blocker-'))
  const script = join(dir, 'helper.sh')
  const hosts = join(dir, 'hosts')
  expect(HELPER_SCRIPT).toContain('HOSTS=/etc/hosts\n')
  writeFileSync(script, HELPER_SCRIPT.replace('HOSTS=/etc/hosts\n', `HOSTS=${hosts}\n`), { mode: 0o755 })
  const run = (...args: string[]): string => execFileSync('/bin/sh', [script, ...args], { stdio: ['ignore', 'pipe', 'ignore'] }).toString()

  it('blocks and unblocks exactly like renderHosts', () => {
    writeFileSync(hosts, BASE_HOSTS)
    run('block', 'youtube.com', 'www.youtube.com')
    expect(readFileSync(hosts, 'utf8')).toBe(renderHosts(BASE_HOSTS, ['youtube.com', 'www.youtube.com']))
    run('block', 'reddit.com')
    expect(readFileSync(hosts, 'utf8')).toBe(renderHosts(BASE_HOSTS, ['reddit.com']))
    run('unblock')
    expect(readFileSync(hosts, 'utf8')).toBe(BASE_HOSTS)
  })
  it('refuses anything that is not a plain hostname and leaves the file alone', () => {
    writeFileSync(hosts, BASE_HOSTS)
    for (const bad of ['evil.com\n1.2.3.4 bank.com', '$(id).com', '-rf', 'localhost']) {
      expect(() => run('block', bad)).toThrow()
    }
    expect(() => run('rm')).toThrow()
    expect(readFileSync(hosts, 'utf8')).toBe(BASE_HOSTS)
  })
  it('refuses protected Apple / certificate domains', () => {
    writeFileSync(hosts, BASE_HOSTS)
    expect(() => run('block', 'apple.com')).toThrow()
    expect(() => run('block', 'swscan.apple.com')).toThrow()
    expect(readFileSync(hosts, 'utf8')).toBe(BASE_HOSTS)
  })
  it('keeps foreign lines when the end marker was deleted, and writes no empty file', () => {
    const broken = `${BASE_HOSTS}${SECTION_BEGIN}\n0.0.0.0 youtube.com\n10.0.0.5 nas.local\n`
    writeFileSync(hosts, broken)
    run('unblock')
    const out = readFileSync(hosts, 'utf8')
    expect(out).toContain('10.0.0.5 nas.local')
    expect(out).not.toContain('youtube.com')
    expect(out).toBe(renderHosts(broken, []))
  })
  it('has no environment override for the hosts path', () => {
    expect(HELPER_SCRIPT).not.toMatch(/BLOOP_HOSTS_FILE/)
  })
  it('reports its version', () => {
    expect(run('version').trim()).toBe('1')
  })
})

describe('install command', () => {
  it('scopes sudo to the helper for one safe user name', () => {
    expect(sudoersLine('ryan')).toBe(`ryan ALL=(root) NOPASSWD: ${HELPER_PATH}\n`)
    expect(() => sudoersLine('ryan ALL=(ALL) ALL')).toThrow()
    const cmd = installCommand('ryan')
    expect(cmd).toContain('visudo -cf /etc/sudoers.d/.bloop-site-blocker.new')
    expect(cmd).toContain('chmod 440')
    expect(cmd).not.toContain('mktemp')
    expect(cmd).toMatch(/; S=\$\?; \/bin\/rm -f .*; exit \$S$/)
  })
  it.skipIf(process.platform !== 'darwin')('is valid sh, and valid AppleScript once wrapped', () => {
    execFileSync('/bin/sh', ['-n', '-c', installCommand('ryan')])
    execFileSync('/usr/bin/osacompile', ['-o', join(mkdtempSync(join(tmpdir(), 'bloop-osa-')), 'x.scpt'), '-e', adminAppleScript(installCommand('ryan'), 'Why')])
  })
  it('escapes the command for AppleScript', () => {
    expect(adminAppleScript('echo "hi" \\ x', 'Why')).toBe('do shell script "echo \\"hi\\" \\\\ x" with prompt "Why" with administrator privileges')
  })
})

function fakeRunner(opts: { installed?: boolean; cancel?: boolean } = {}) {
  let installed = opts.installed ?? false
  const calls: string[][] = []
  const run: Runner = async (file, args) => {
    calls.push([file, ...args])
    if (file.endsWith('osascript')) {
      if (opts.cancel) return { code: 1, stdout: '', stderr: 'execution error: User canceled. (-128)' }
      installed = true
      return { code: 0, stdout: '', stderr: '' }
    }
    if (!installed) return { code: 1, stdout: '', stderr: 'sudo: a password is required' }
    return { code: 0, stdout: args[2] === 'version' ? '1\n' : '', stderr: '' }
  }
  return { run, calls }
}

describe('SiteBlocker', () => {
  it('installs the helper once with the admin prompt, then blocks without it', async () => {
    const r = fakeRunner()
    const b = new SiteBlocker({ run: r.run, user: 'ryan' })
    await b.block(['youtube.com'], true)
    await b.block(['reddit.com'], true)
    expect(r.calls.filter((c) => c[0].endsWith('osascript'))).toHaveLength(1)
    expect(r.calls.some((c) => c.join(' ').endsWith(`${HELPER_PATH} block reddit.com`))).toBe(true)
  })
  it('does not prompt when not allowed', async () => {
    const b = new SiteBlocker({ run: fakeRunner().run, user: 'ryan' })
    await expect(b.block(['youtube.com'], false)).rejects.toBeInstanceOf(NeedsSetupError)
  })
  it('explains a cancelled prompt', async () => {
    const b = new SiteBlocker({ run: fakeRunner({ cancel: true }).run, user: 'ryan' })
    await expect(b.block(['youtube.com'], true)).rejects.toThrow(/password once/)
  })
  it('unblock without the helper is a no-op', async () => {
    const r = fakeRunner()
    await new SiteBlocker({ run: r.run, user: 'ryan' }).unblock()
    expect(r.calls.every((c) => c.includes('version'))).toBe(true)
  })
})

function controller(opts: { sites?: string[]; manual?: boolean; fail?: boolean; failUnblock?: boolean } = {}) {
  let data: BlockerData = { sites: opts.sites ?? ['youtube.com'], manual: opts.manual ?? false }
  let block: RunningBlock | null = null
  const applied: string[][] = []
  let unblockAttempts = 0
  const c = new BlockerController({
    supported: true,
    load: () => data,
    save: (d) => (data = d),
    activeBlock: () => block,
    blocker: {
      block: async (h) => {
        if (opts.fail) throw new Error('User said no')
        applied.push(h)
      },
      unblock: async () => {
        unblockAttempts++
        if (opts.failUnblock) throw new Error('helper exit 1')
        applied.push([])
      }
    }
  })
  return { c, applied, setBlock: (b: RunningBlock | null) => (block = b), data: () => data, unblockAttempts: () => unblockAttempts }
}

describe('BlockerController', () => {
  it('blocks while a study block runs and unblocks when it ends', async () => {
    const t = controller()
    await t.c.tick() // launch: clears any stale block
    t.setBlock({ label: 'Outline essay', until: 123 })
    const on = await t.c.tick()
    expect(on.active).toBe(true)
    expect(on.reason).toBe('block')
    expect(on.blockLabel).toBe('Outline essay')
    t.setBlock(null)
    const off = await t.c.tick()
    expect(off.active).toBe(false)
    expect(t.applied).toEqual([[], ['youtube.com', 'www.youtube.com', 'm.youtube.com'], []])
  })
  it('manual on/off, and refuses with an empty list', async () => {
    const t = controller()
    expect((await t.c.setManual(true)).active).toBe(true)
    expect(t.data().manual).toBe(true)
    expect((await t.c.setManual(false)).active).toBe(false)
    const empty = controller({ sites: [] })
    const s = await empty.c.setManual(true)
    expect(s.active).toBe(false)
    expect(s.error).toMatch(/Add a site/)
  })
  it('re-applies when the list changes while active', async () => {
    const t = controller({ manual: true })
    await t.c.tick()
    await t.c.setSites(['reddit.com', 'bad host', 'reddit.com'])
    expect(t.data().sites).toEqual(['reddit.com'])
    expect(t.applied.at(-1)).toEqual(['reddit.com', 'www.reddit.com', 'm.reddit.com'])
  })
  it('turns manual off and shows the error when blocking fails', async () => {
    const t = controller({ fail: true })
    const s = await t.c.setManual(true)
    expect(s.active).toBe(false)
    expect(s.manual).toBe(false)
    expect(s.error).toBe('User said no')
  })
  it('a failed unblock is not retried every tick', async () => {
    const t = controller({ failUnblock: true })
    await t.c.tick()
    expect(t.c.status().error).toBe('helper exit 1')
    for (let i = 0; i < 3; i++) await t.c.tick()
    expect(t.unblockAttempts()).toBe(1)
  })
  it('a failed first block keeps assuming a stale block may be there (quit still lifts it)', async () => {
    const t = controller({ fail: true, manual: true })
    await t.c.tick()
    expect(t.c.hasBlock()).toBe(true)
  })
  it('does nothing after dispose', async () => {
    const t = controller()
    t.c.dispose()
    await t.c.setManual(true)
    expect(t.applied).toEqual([])
  })
  it('cleanSites normalizes and de-duplicates', () => {
    expect(cleanSites(['https://www.x.com/home', 'x.com', 3, 'tiktok.com'])).toEqual(['x.com', 'tiktok.com'])
    expect(cleanSites('nope')).toEqual([])
  })
})
