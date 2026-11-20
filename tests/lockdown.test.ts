import { describe, expect, it } from 'vitest'
import {
  clampMinutes,
  Lockdown,
  LOCKDOWN_GRACE_SEC,
  LOCKDOWN_RETURN_GRACE_SEC,
  looksLikeSite,
  matchesTarget,
  parseTarget,
  RecentTargets,
  SAFE_APP_NAME,
  siteLabels,
  windowsActivateScript
} from '../src/main/lockdown'
import { SessionEngine } from '../src/main/session'
import { DEFAULT_SETTINGS } from '../src/main/defaults'
import type { LockTarget } from '../src/shared/types'
import type { RawActive } from '../src/main/tracker'

const SELF = ['Bloop', 'Electron']
const site = (domain: string): LockTarget => ({ kind: 'site', domain, label: domain })
const appT = (app: string): LockTarget => ({ kind: 'app', app, label: app })

describe('matchesTarget', () => {
  it('apps match by name, case and .exe ignored', () => {
    expect(matchesTarget({ app: 'Notion', title: '' }, appT('notion'))).toBe(true)
    expect(matchesTarget({ app: 'Code.exe', title: '' }, appT('Code'))).toBe(true)
    expect(matchesTarget({ app: 'Slack', title: '' }, appT('Notion'))).toBe(false)
  })
  it('sites match the host or a subdomain, only in a browser', () => {
    const t = site('google.com')
    expect(matchesTarget({ app: 'Google Chrome', title: '', url: 'https://docs.google.com/d/1' }, t)).toBe(true)
    expect(matchesTarget({ app: 'Google Chrome', title: '', url: 'https://youtube.com/' }, t)).toBe(false)
    expect(matchesTarget({ app: 'Notion', title: 'google.com' }, t)).toBe(false)
  })
  it('a browser without a URL falls back to the title', () => {
    const t = site('khanacademy.org')
    expect(matchesTarget({ app: 'chrome', title: 'Derivatives | Khan Academy - Google Chrome' }, t)).toBe(true) // known site name
    expect(matchesTarget({ app: 'chrome', title: 'Funny cats - YouTube - Google Chrome' }, t)).toBe(false)
    expect(matchesTarget({ app: 'chrome', title: 'khanacademy.org - Google Chrome' }, t)).toBe(true)
    expect(matchesTarget({ app: 'Safari', title: '' }, t)).toBe(false)
  })
  it('no sample means "can\'t tell"', () => {
    expect(matchesTarget(null, appT('Notion'))).toBeNull()
  })
  it('site labels skip TLDs and generic words', () => {
    expect(siteLabels('docs.google.com')).toEqual(['google'])
    expect(siteLabels('khanacademy.org')).toEqual(['khanacademy'])
  })
})

describe('parseTarget / clampMinutes', () => {
  it('guesses sites from addresses and apps from names', () => {
    expect(looksLikeSite('docs.google.com')).toBe(true)
    expect(looksLikeSite('https://x.org/a b')).toBe(true)
    expect(looksLikeSite('Visual Studio Code')).toBe(false)
    expect(looksLikeSite('Notion.app')).toBe(false)
    expect(parseTarget({ value: 'https://www.Notion.so/page' }, SELF)).toEqual({ ok: true, value: site('notion.so') })
    expect(parseTarget({ value: 'Notion' }, SELF)).toEqual({ ok: true, value: appT('Notion') })
  })
  it('refuses Bloop itself, empty input and non-sites', () => {
    expect(parseTarget({ value: 'bloop' }, SELF).ok).toBe(false)
    expect(parseTarget({ value: '   ' }, SELF).ok).toBe(false)
    expect(parseTarget(null, SELF).ok).toBe(false)
    expect(parseTarget({ kind: 'site', value: 'not a site' }, SELF).ok).toBe(false)
  })
  it('a browser as the target means any site in it', () => {
    const r = parseTarget({ value: 'Google Chrome' }, SELF)
    expect(r.ok && r.value.label).toBe('Google Chrome (any site)')
  })
  it('lengths are whole minutes from 1 to 240', () => {
    expect(clampMinutes(25)).toBe(25)
    expect(clampMinutes('50')).toBe(50)
    expect(clampMinutes(0)).toBeNull()
    expect(clampMinutes(241)).toBeNull()
    expect(clampMinutes(NaN)).toBeNull()
  })
})

describe('Windows activation script', () => {
  it('only safe names pass, and quotes are doubled', () => {
    expect(SAFE_APP_NAME.test('Code')).toBe(true)
    expect(SAFE_APP_NAME.test('a; rm -rf /')).toBe(false)
    expect(SAFE_APP_NAME.test('$(evil)')).toBe(false)
    expect(windowsActivateScript("O'Neil")).toContain("-Name 'O''Neil'")
  })
})

describe('RecentTargets', () => {
  it('keeps distinct recent apps and sites, newest first, never Bloop or the lock screen', () => {
    const r = new RecentTargets(SELF, 3)
    r.observe({ app: 'Notion', title: '' })
    r.observe({ app: 'Google Chrome', title: '', url: 'https://docs.google.com/x' })
    r.observe({ app: 'Bloop', title: '' })
    r.observe({ app: 'loginwindow', title: '' })
    r.observe({ app: 'Notion', title: '' })
    expect(r.list()).toEqual([
      { kind: 'app', value: 'Notion' },
      { kind: 'site', value: 'docs.google.com' }
    ])
  })
})

function harness(target: LockTarget = appT('Notion')) {
  let now = 1_700_000_000_000
  let front: RawActive | null = { app: 'Notion', title: '' }
  const covers: boolean[] = []
  const activated: LockTarget[] = []
  const notes: string[] = []
  const lock = new Lockdown({
    now: () => now,
    setInterval: () => 1,
    clearInterval: () => {},
    sample: async () => front,
    setCovered: (c) => covers.push(c),
    activate: (t) => activated.push(t),
    notify: (title) => notes.push(title),
    selfNames: SELF,
    log: () => {}
  })
  const step = (sec: number, raw: RawActive | null = front) => {
    front = raw
    for (let i = 0; i < sec; i++) {
      now += 1000
      lock.tick()
      lock.observe(front) // tick samples asynchronously; observe directly to stay synchronous
    }
  }
  return { lock, covers, activated, notes, step, start: (m = 25) => lock.start(target, m) }
}

describe('Lockdown', () => {
  it('start brings the target forward and does not cover it', () => {
    const h = harness()
    const s = h.start()
    expect(s.active).toBe(true)
    expect(s.remainingSec).toBe(25 * 60)
    expect(h.activated).toHaveLength(1)
    h.step(30)
    expect(h.lock.status().covered).toBe(false)
  })

  it('covers after the grace period off target, uncovers when the target is back', () => {
    const h = harness()
    h.start()
    h.step(LOCKDOWN_RETURN_GRACE_SEC + 1) // past the start grace, on target
    h.step(1, { app: 'Slack', title: '' })
    expect(h.lock.status().covered).toBe(false) // a quick switch passes
    h.step(LOCKDOWN_GRACE_SEC + 1, { app: 'Slack', title: '' })
    expect(h.lock.status().covered).toBe(true)
    h.step(3, { app: 'Bloop', title: '' }) // the cover itself in front changes nothing
    expect(h.lock.status().covered).toBe(true)
    h.step(1, { app: 'Notion', title: '' })
    expect(h.lock.status().covered).toBe(false)
    expect(h.covers).toEqual([true, false])
  })

  it('the lock screen and unknown samples never bring the cover up', () => {
    const h = harness()
    h.start()
    h.step(LOCKDOWN_RETURN_GRACE_SEC + 1)
    h.step(20, { app: 'loginwindow', title: '' })
    h.step(20, null)
    expect(h.lock.status().covered).toBe(false)
  })

  it('"Take me back" lowers the cover for a moment and activates the target', () => {
    const h = harness()
    h.start()
    h.step(LOCKDOWN_RETURN_GRACE_SEC + LOCKDOWN_GRACE_SEC + 2, { app: 'Slack', title: '' })
    expect(h.lock.status().covered).toBe(true)
    h.lock.goBack()
    expect(h.lock.status().covered).toBe(false)
    expect(h.activated).toHaveLength(2)
    h.step(LOCKDOWN_RETURN_GRACE_SEC - 1, { app: 'Slack', title: '' })
    expect(h.lock.status().covered).toBe(false)
    h.step(LOCKDOWN_GRACE_SEC + 2, { app: 'Slack', title: '' })
    expect(h.lock.status().covered).toBe(true)
  })

  it('ends by itself when time is up, uncovers and says well done', () => {
    const h = harness()
    h.start(1)
    h.step(LOCKDOWN_RETURN_GRACE_SEC + LOCKDOWN_GRACE_SEC + 2, { app: 'Slack', title: '' })
    expect(h.lock.status().covered).toBe(true)
    h.step(60, { app: 'Slack', title: '' })
    expect(h.lock.status()).toEqual({ active: false, covered: false })
    expect(h.covers.at(-1)).toBe(false)
    expect(h.notes).toEqual(['Lockdown finished'])
  })

  it('ending early (and quitting) stops it without the "finished" note', () => {
    const h = harness()
    h.start()
    h.lock.stop('ended')
    expect(h.lock.isActive()).toBe(false)
    h.start()
    h.lock.dispose()
    expect(h.lock.isActive()).toBe(false)
    expect(h.notes).toEqual([])
  })

  it('works for sites too', () => {
    const h = harness(site('docs.google.com'))
    h.start()
    h.step(LOCKDOWN_RETURN_GRACE_SEC + 1, { app: 'Google Chrome', title: '', url: 'https://docs.google.com/d' })
    h.step(LOCKDOWN_GRACE_SEC + 1, { app: 'Google Chrome', title: '', url: 'https://www.youtube.com/' })
    expect(h.lock.status().covered).toBe(true)
  })
})

describe('session engine during a lockdown', () => {
  it('the locked target counts as focus even when the lists call it distracting', () => {
    let now = 1_700_000_000_000
    let locked: LockTarget | null = site('youtube.com')
    const engine = new SessionEngine({
      now: () => now,
      setInterval: () => 0,
      clearInterval: () => {},
      setTimeout: () => 0,
      clearTimeout: () => {},
      getSettings: () => ({ ...DEFAULT_SETTINGS, contentDomains: [] }),
      sample: async () => null,
      notify: () => {},
      saveSession: () => {},
      log: () => {},
      forceFocus: (raw) => !!locked && matchesTarget(raw, locked) === true
    })
    engine.start()
    now += 1000
    engine.recordSample({ app: 'Google Chrome', title: '', url: 'https://www.youtube.com/watch?v=1' })
    expect(engine.getStatus().current?.category).toBe('focus')
    locked = null
    now += 1000
    engine.recordSample({ app: 'Google Chrome', title: '', url: 'https://www.youtube.com/watch?v=1' })
    expect(engine.getStatus().current?.category).toBe('distract')
    engine.dispose()
  })
})
