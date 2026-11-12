// Score starts at 100, always-on watching without a session, immediate reactions, the
// "can't see this site" hint, YouTube classification and the v2 settings migration.
import { describe, expect, it } from 'vitest'
import { computeFocusScore, FRESH_START_SEC } from '../src/main/score'
import { isSiteHidden, NUDGE_LINES, SessionEngine, WATCH_RESET_AFTER_MS, WELCOME_LINES } from '../src/main/session'
import { classify } from '../src/main/classifier'
import { DEFAULT_SETTINGS, mergeSettings, migrateSettings, SETTINGS_VERSION } from '../src/main/defaults'
import { badgeText } from '../src/shared/petBadge'
import type { RawActive } from '../src/main/tracker'
import type { AppStatus, SessionRecord, Settings } from '../src/shared/types'

const T0 = new Date(2026, 10, 6, 10, 0, 0).getTime()
const CODE: RawActive = { app: 'Code', title: '' }
const YT: RawActive = { app: 'Google Chrome', title: '', url: 'https://www.youtube.com/watch?v=x' }
const CHROME_BLIND: RawActive = { app: 'Google Chrome', title: '' }

/** distracting 2 s samples from `from` to `to` seconds after T0 */
function distractFor(fromSec: number, toSec: number, category: 'distract' | 'focus' = 'distract') {
  const out = []
  for (let t = fromSec + 2; t <= toSec; t += 2) out.push({ t: T0 + t * 1000, category, durationSec: 2 })
  return out
}

describe('fresh-start prior: the score starts at 100', () => {
  const prior = { t: T0 }
  it('is 100 at the start, with no samples or only neutral ones (never null)', () => {
    expect(computeFocusScore([], T0, 600, prior)).toBe(100)
    expect(computeFocusScore([{ t: T0, category: 'neutral', durationSec: 2 }], T0 + 60_000, 600, prior)).toBe(100)
    expect(computeFocusScore([], T0 + 30 * 86400e3, 600, prior)).toBe(100) // even fully decayed
  })
  it('one distracting sample barely moves it (no instant 0)', () => {
    expect(computeFocusScore(distractFor(0, 2), T0 + 2000, 600, prior)).toBe(98)
  })
  it('falls gradually on YouTube: 1 min ~66, 3 min ~37, 5 min ~25', () => {
    const at = (sec: number) => computeFocusScore(distractFor(0, sec), T0 + sec * 1000, 600, prior)
    expect(at(60)).toBe(66)
    expect(at(180)).toBe(37)
    expect(at(300)).toBe(25)
    expect(at(600)).toBeLessThan(15)
  })
  it('recovers when back on task', () => {
    const yt = distractFor(0, 300)
    const back = (sec: number) => computeFocusScore([...yt, ...distractFor(300, 300 + sec, 'focus')], T0 + (300 + sec) * 1000, 600, prior)
    expect(back(60)).toBeGreaterThan(25)
    expect(back(300)).toBeGreaterThan(back(60) as number)
    expect(back(300)).toBeGreaterThan(60)
  })
  it('the credit decays with the same half-life', () => {
    // credit 120 s at one half-life old = 60 s of weight, vs 60 s of fresh distraction -> 50
    expect(computeFocusScore([{ t: T0 + 600_000, category: 'distract', durationSec: 60 }], T0 + 600_000, 600, prior)).toBe(50)
    expect(FRESH_START_SEC).toBe(120)
  })
  it('without a prior the old behaviour is kept', () => {
    expect(computeFocusScore([], T0)).toBeNull()
    expect(computeFocusScore(distractFor(0, 2), T0 + 2000)).toBe(0)
  })
})

function make(over: Partial<Settings> = {}) {
  let now = T0
  let raw: RawActive | null = YT
  const settings: Settings = { ...DEFAULT_SETTINGS, ...over }
  const timeouts: { at: number; fn: () => void; id: number }[] = []
  let nextId = 1
  const notes: { title: string; body: string }[] = []
  const saved: SessionRecord[] = []
  const logs: string[] = []
  let samples = 0
  const engine = new SessionEngine({
    now: () => now,
    setInterval: () => 0,
    clearInterval: () => {},
    setTimeout: (fn, ms) => {
      const id = nextId++
      timeouts.push({ at: now + ms, fn, id })
      return id
    },
    clearTimeout: (h) => {
      const i = timeouts.findIndex((t) => t.id === h)
      if (i >= 0) timeouts.splice(i, 1)
    },
    getSettings: () => settings,
    sample: async () => {
      samples++
      return raw
    },
    notify: (title, body) => notes.push({ title, body }),
    saveSession: (r) => saved.push(r),
    log: (m) => logs.push(m),
    random: () => 0
  })
  const statuses: AppStatus[] = []
  engine.on('status', (s: AppStatus) => statuses.push(s))
  const run = async (sec: number): Promise<void> => {
    for (let i = 0; i < sec; i++) {
      now += 1000
      for (const t of [...timeouts]) {
        if (t.at <= now) {
          timeouts.splice(timeouts.indexOf(t), 1)
          t.fn()
        }
      }
      engine.tick()
      for (let j = 0; j < 4; j++) await Promise.resolve()
    }
  }
  return {
    engine,
    settings,
    notes,
    saved,
    logs,
    statuses,
    run,
    jump: (sec: number) => (now += sec * 1000),
    setRaw: (r: RawActive | null) => (raw = r),
    samples: () => samples
  }
}

describe('always-on watching (no session)', () => {
  it('is on by default: idle status reports watching with a score of 100 before any sample', () => {
    const h = make()
    const st = h.engine.getStatus()
    expect(st.phase).toBe('idle')
    expect(st.watching).toBe(true)
    expect(st.score).toBe(100)
    expect(badgeText(st.score, false)).toBe('100')
  })

  it('samples on the sample interval without a session', async () => {
    const h = make()
    h.setRaw(CODE)
    await h.run(10)
    expect(h.samples()).toBe(5) // every 2 s
    const st = h.engine.getStatus()
    expect(st.current).toMatchObject({ app: 'Code', category: 'focus' })
    expect(st.pet.mood).toBe('happy')
    expect(st.score).toBe(100)
  })

  it('YouTube timeline: bubble at 0 s; bubble + notification at 60, 180, 300 s; nothing in between', async () => {
    const h = make()
    const bubbles: number[] = []
    let lastId = h.engine.getStatus().pet.messageId
    let sec = 0
    const notesAt: number[] = []
    const tick = async (n: number) => {
      for (let i = 0; i < n; i++) {
        const before = h.notes.length
        await h.run(1)
        sec++
        const st = h.engine.getStatus()
        if (st.pet.messageId !== lastId) {
          lastId = st.pet.messageId
          expect(NUDGE_LINES).toContain(st.pet.message)
          bubbles.push(sec)
        }
        if (h.notes.length > before) notesAt.push(sec)
      }
    }
    await tick(2) // first sample on the first tick (1 s)
    const st = h.engine.getStatus()
    expect(st.pet.mood).toBe('worried')
    expect(st.current).toMatchObject({ domain: 'youtube.com', category: 'distract' })
    await tick(10)
    expect(h.engine.getStatus().pet.message).toBeNull() // the bubble clears after a few seconds
    expect(h.engine.getStatus().pet.mood).toBe('worried') // still unhappy
    await tick(310)
    // the streak starts at the first sample (1 s): 0 s -> 1, 60 s -> 61, 180 s -> 181, 300 s -> 301
    expect(bubbles).toEqual([1, 61, 181, 301])
    expect(notesAt).toEqual([61, 181, 301])
    expect(new Set(h.notes.map((n) => n.title)).size).toBe(3) // a new message each time
    expect(h.logs.filter((l) => l.startsWith('nudge + notification'))).toHaveLength(3)
    expect(h.engine.getStatus().pet.mood).toBe('sad') // past sadAfterSec (5 min)
    expect(h.engine.getStatus().watching).toBe(true)
    expect(h.engine.getStatus().phase).toBe('idle')
  })

  it('returning to focus resets the reminder cycle', async () => {
    const h = make()
    await h.run(70) // first reminder at ~62 s
    expect(h.notes).toHaveLength(1)
    h.setRaw(CODE)
    await h.run(4)
    expect(WELCOME_LINES).toContain(h.engine.getStatus().pet.message)
    h.setRaw(YT)
    await h.run(58)
    expect(h.notes).toHaveLength(1)
    await h.run(4) // 60 s into the new streak
    expect(h.notes).toHaveLength(2)
  })

  it('never records watching time as a session', async () => {
    const h = make()
    await h.run(300)
    h.setRaw(CODE)
    await h.run(60)
    expect(h.saved).toHaveLength(0)
    expect(h.engine.stop()).toBeNull()
    expect(h.saved).toHaveLength(0)
  })

  it('welcomes you back after a nudge', async () => {
    const h = make()
    await h.run(4)
    h.setRaw(CODE)
    await h.run(2)
    const st = h.engine.getStatus()
    expect(st.pet.mood).toBe('happy')
    expect(WELCOME_LINES).toContain(st.pet.message)
  })

  it('is off when trackWithoutSession is false: no sampling, no reaction, score null', async () => {
    const h = make({ trackWithoutSession: false })
    await h.run(30)
    expect(h.samples()).toBe(0)
    const st = h.engine.getStatus()
    expect(st).toMatchObject({ watching: false, score: null, current: null })
    expect(st.pet.mood).toBe('idle')
    expect(badgeText(st.score, false)).toBe('+')
  })

  it('turning the setting off stops watching and calms the pet', async () => {
    const h = make()
    await h.run(4)
    expect(h.engine.getStatus().pet.mood).toBe('worried')
    h.settings.trackWithoutSession = false
    await h.run(1)
    expect(h.engine.getStatus()).toMatchObject({ watching: false, score: null, current: null })
    expect(h.engine.getStatus().pet.mood).toBe('idle')
  })

  it('starting a session switches to session behaviour with a fresh 100', async () => {
    const h = make()
    await h.run(120)
    expect(h.engine.getStatus().score).toBeLessThan(60)
    h.setRaw(CODE)
    h.engine.start()
    await h.run(1)
    const st = h.engine.getStatus()
    expect(st.phase).toBe('focus')
    expect(st.watching).toBe(false)
    expect(st.score).toBe(100)
  })

  it('does not watch during a break or while paused', async () => {
    const h = make({ focusMinutes: 1, breakMinutes: 5 })
    h.setRaw(CODE)
    h.engine.start()
    await h.run(61)
    expect(h.engine.getStatus().phase).toBe('break')
    const n = h.samples()
    h.setRaw(YT)
    await h.run(30)
    expect(h.samples()).toBe(n)
    expect(h.engine.getStatus().watching).toBe(false)
    expect(h.engine.getStatus().pet.mood).toBe('sleeping')
    h.engine.pause()
    await h.run(30)
    expect(h.samples()).toBe(n)
  })

  it('after a session ends, watching resumes with a fresh score', async () => {
    const h = make()
    h.engine.start()
    await h.run(120) // YouTube during the session
    h.setRaw(CODE)
    const rec = h.engine.stop()
    expect(rec).not.toBeNull()
    expect(h.saved).toHaveLength(1)
    await h.run(12) // done -> idle, watching on Code
    const st = h.engine.getStatus()
    expect(st.phase).toBe('idle')
    expect(st.watching).toBe(true)
    expect(st.score).toBe(100)
    expect(h.saved).toHaveLength(1)
  })

  it('starts a fresh score after 30 min away (locked screen)', async () => {
    const h = make()
    await h.run(300)
    expect(h.engine.getStatus().score).toBeLessThan(30)
    h.setRaw({ app: 'loginwindow', title: '' })
    await h.run(10)
    expect(h.engine.getStatus().current).toBeNull()
    expect(h.engine.getStatus().pet.mood).toBe('idle')
    h.jump(WATCH_RESET_AFTER_MS / 1000)
    h.setRaw(CODE)
    await h.run(2)
    expect(h.engine.getStatus().score).toBe(100)
  })

  it('starts a fresh score after the laptop slept (long gap between samples)', async () => {
    const h = make()
    await h.run(300)
    h.jump(31 * 60)
    h.setRaw(CODE)
    await h.run(2)
    expect(h.engine.getStatus().score).toBe(100)
  })

  it('starts a fresh score on a new day', async () => {
    const h = make()
    await h.run(300)
    const low = h.engine.getStatus().score as number
    h.jump(14 * 3600) // 10:05 -> 00:05 the next day, no gap check involved: keep sampling
    h.setRaw(YT)
    await h.run(2)
    expect(h.engine.getStatus().score).toBeGreaterThan(low)
    expect(h.engine.getStatus().score).toBeGreaterThanOrEqual(98)
  })
})

describe('immediate reaction during a session', () => {
  it('first distracting sample: worried + bubble right away, notification only after 60 s', async () => {
    const h = make()
    h.setRaw(CODE)
    h.engine.start()
    await h.run(10)
    h.setRaw(YT)
    await h.run(2)
    const st = h.engine.getStatus()
    expect(st.pet.mood).toBe('worried')
    expect(NUDGE_LINES).toContain(st.pet.message)
    expect(st.score).toBeGreaterThan(90)
    await h.run(56)
    expect(h.notes).toHaveLength(0)
    await h.run(4)
    expect(h.notes).toHaveLength(1)
    await h.run(120)
    expect(h.notes).toHaveLength(2)
  })

  it('a quick tab flip is worried at once, without a second instant bubble within 30 s', async () => {
    const h = make()
    h.setRaw(CODE)
    h.engine.start()
    h.setRaw(YT)
    await h.run(4)
    h.setRaw(CODE)
    await h.run(10)
    const id = h.engine.getStatus().pet.messageId
    h.setRaw(YT)
    await h.run(2)
    expect(h.engine.getStatus().pet.mood).toBe('worried')
    expect(h.engine.getStatus().pet.messageId).toBe(id)
  })

  it('the session score starts at 100 and the saved record keeps the score shown', async () => {
    const h = make()
    h.engine.start()
    expect(h.engine.getStatus().score).toBe(100)
    await h.run(60)
    const live = h.engine.getStatus().score
    expect(live).toBeGreaterThan(55)
    expect(live).toBeLessThan(75)
    expect(h.engine.stop()?.finalScore).toBe(live)
  })
})

describe("Bloop's own window in front (panel, settings, chat)", () => {
  const BLOOP: RawActive = { app: 'Bloop', title: 'Bloop' }
  for (const mode of ['watching', 'session'] as const) {
    it(`${mode}: does not cheer up the pet, keeps the streak and the reminders going`, async () => {
      const h = make()
      if (mode === 'session') h.engine.start()
      await h.run(10) // YouTube
      expect(h.engine.getStatus().pet.mood).toBe('worried')
      const score = h.engine.getStatus().score
      h.setRaw(BLOOP) // the panel was clicked
      await h.run(30)
      let st = h.engine.getStatus()
      expect(st.pet.mood).toBe('worried')
      expect(st.current).toMatchObject({ domain: 'youtube.com', category: 'distract' })
      expect(WELCOME_LINES).not.toContain(st.pet.message)
      // Bloop time is skipped in the score: it only decays, no new focus or distraction
      expect(Math.abs((st.score as number) - (score as number))).toBeLessThanOrEqual(3)
      h.setRaw(YT) // back to the browser: same streak, so the 60 s reminder comes on time
      await h.run(22) // ~62 s after the first YouTube sample
      expect(h.notes).toHaveLength(1)
      st = h.engine.getStatus()
      expect(st.pet.mood).toBe('worried')
    })
  }
  it('dev builds: "Electron" can be listed as Bloop too (selfNames)', async () => {
    let raw: RawActive = YT
    const engine = new SessionEngine({
      now: () => T0,
      setInterval: () => 0,
      getSettings: () => DEFAULT_SETTINGS,
      sample: async () => raw,
      notify: () => {},
      saveSession: () => {},
      log: () => {},
      selfNames: ['Bloop', 'Electron']
    })
    engine.recordSample(raw)
    raw = { app: 'Electron', title: '' }
    engine.recordSample(raw)
    expect(engine.getStatus().current?.domain).toBe('youtube.com')
    expect(engine.getStatus().pet.mood).toBe('worried')
  })
  it('the panel open but not focused (browser in front on YouTube): worried', async () => {
    const h = make()
    h.setRaw(CODE)
    await h.run(10)
    expect(h.engine.getStatus().pet.mood).toBe('happy')
    h.setRaw(YT)
    await h.run(2)
    expect(h.engine.getStatus().pet.mood).toBe('worried')
  })
})

describe('browser without URL or title: "can\'t see this site" hint', () => {
  it('isSiteHidden', () => {
    expect(isSiteHidden(CHROME_BLIND)).toBe(true)
    expect(isSiteHidden({ app: 'Safari', title: 'Safari' })).toBe(true)
    expect(isSiteHidden({ app: 'Google Chrome', title: 'Lofi beats - YouTube' })).toBe(false)
    expect(isSiteHidden(YT)).toBe(false)
    expect(isSiteHidden(CODE)).toBe(false)
    expect(isSiteHidden(null)).toBe(false)
  })
  it('shows in the status and is logged once', async () => {
    const h = make()
    h.setRaw(CHROME_BLIND)
    await h.run(10)
    expect(h.engine.getStatus().current).toMatchObject({ app: 'Google Chrome', category: 'neutral', siteHidden: true })
    expect(h.logs.filter((l) => l.includes("can't be read"))).toHaveLength(1)
    h.setRaw(YT)
    await h.run(2)
    expect(h.engine.getStatus().current?.siteHidden).toBeUndefined()
  })
})

describe('YouTube is distracting by default', () => {
  const c = (raw: RawActive) => classify(raw, DEFAULT_SETTINGS)
  it('by URL, including m. and music. subdomains', () => {
    for (const url of [
      'https://www.youtube.com/watch?v=x',
      'https://youtube.com/',
      'https://m.youtube.com/watch?v=x',
      'https://music.youtube.com/',
      'youtube.com/shorts/abc'
    ]) {
      expect(c({ app: 'Google Chrome', title: '', url })).toBe('distract')
    }
  })
  it('by window title ending in " - YouTube" (no URL, e.g. Automation not allowed)', () => {
    for (const [app, title] of [
      ['Google Chrome', 'Lofi beats to study to - YouTube'],
      ['Google Chrome', '(3) Lofi beats - YouTube - Google Chrome'],
      ['Safari', 'Lofi beats – YouTube'],
      ['Arc', 'YouTube'],
      ['Mozilla Firefox', 'Lofi beats — YouTube — Mozilla Firefox']
    ]) {
      expect(c({ app, title })).toBe('distract')
    }
  })
  it('the YouTube app (a browser web app) by name', () => {
    expect(c({ app: 'YouTube', title: '' })).toBe('distract')
  })
})

describe('settings migrations (v2, v3) and defaults', () => {
  it('v4: cloud judging of unclear pages turns on for existing users', () => {
    expect(mergeSettings(migrateSettings({ ...DEFAULT_SETTINGS, cloudJudge: false }, 3)).cloudJudge).toBe(true)
    expect(mergeSettings(migrateSettings({ ...DEFAULT_SETTINGS, cloudJudge: false }, 4)).cloudJudge).toBe(false)
  })

  it('moves the old defaults to the new ones and keeps custom values', () => {
    const old = { ...DEFAULT_SETTINGS, nudgeAfterSec: 60, notifyAfterSec: 180, nudgeCooldownSec: 120, sampleIntervalSec: 5 }
    expect(mergeSettings(migrateSettings(old, 0))).toMatchObject({ nudgeAfterSec: 0, notifyAfterSec: 60, nudgeCooldownSec: 120, sampleIntervalSec: 2 })
    // v2 -> v3: the v2 default 120 s moves to 60 s
    expect(mergeSettings(migrateSettings({ ...DEFAULT_SETTINGS, notifyAfterSec: 120 }, 2)).notifyAfterSec).toBe(60)
    expect(mergeSettings(migrateSettings({ ...DEFAULT_SETTINGS, notifyAfterSec: 90 }, 2)).notifyAfterSec).toBe(90)
    const custom = { ...DEFAULT_SETTINGS, nudgeAfterSec: 30, notifyAfterSec: 300, sampleIntervalSec: 10 }
    expect(mergeSettings(migrateSettings(custom, 0))).toMatchObject({ nudgeAfterSec: 30, notifyAfterSec: 300, sampleIntervalSec: 10 })
  })
  it('runs only once (an explicit 60 later is kept)', () => {
    const s = { ...DEFAULT_SETTINGS, nudgeAfterSec: 60 }
    expect(migrateSettings(s, SETTINGS_VERSION)).toBe(s)
  })
  it('handles a missing settings object', () => {
    expect(migrateSettings(undefined, 0)).toBeUndefined()
  })
  it('a 0 s nudge is valid; negative is not; trackWithoutSession must be a boolean', () => {
    expect(mergeSettings({ nudgeAfterSec: 0 }).nudgeAfterSec).toBe(0)
    expect(mergeSettings({ nudgeAfterSec: -5 }).nudgeAfterSec).toBe(DEFAULT_SETTINGS.nudgeAfterSec)
    expect(mergeSettings({ notifyAfterSec: 0 }).notifyAfterSec).toBe(DEFAULT_SETTINGS.notifyAfterSec)
    expect(mergeSettings({ trackWithoutSession: false }).trackWithoutSession).toBe(false)
    expect(mergeSettings({ trackWithoutSession: 'no' as unknown as boolean }).trackWithoutSession).toBe(true)
  })
})
