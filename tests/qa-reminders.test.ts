// QA: ReminderScheduler (study reminders + exam deadline reminders) with injected clock and an in-memory store.
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mem = vi.hoisted(() => ({ fired: {} as Record<string, number>, cache: null as null | { fetchedAt: number; url: string; items: unknown[] } }))
vi.mock('../src/main/store', () => ({
  wasReminderFired: (k: string) => Boolean(mem.fired[k]),
  markReminderFired: (k: string, now = Date.now()) => {
    mem.fired[k] = now
  },
  getDeadlinesCache: () => mem.cache
}))

import { ReminderScheduler } from '../src/main/reminders'
import { DEFAULT_SETTINGS } from '../src/main/defaults'
import type { Reminder, Settings } from '../src/shared/types'

const DAY = 86400e3

function setup(reminders: Reminder[] = [], running = false) {
  let now = new Date(2026, 10, 5, 8, 59, 30).getTime() // Thursday 2026-11-05
  const settings: Settings = { ...DEFAULT_SETTINGS, reminders }
  const engine = { isRunning: vi.fn(() => running), say: vi.fn(), start: vi.fn() }
  const notify = vi.fn()
  const sched = new ReminderScheduler({ engine: engine as never, getSettings: () => settings, notify, now: () => now })
  return {
    sched,
    engine,
    notify,
    settings,
    setNow: (t: number) => (now = t),
    at: (y: number, mo: number, d: number, h: number, mi: number, s = 0) => (now = new Date(y, mo, d, h, mi, s).getTime()),
    setRunning: (r: boolean) => engine.isRunning.mockReturnValue(r)
  }
}

const rem = (over: Partial<Reminder> = {}): Reminder => ({ id: 'r1', days: [4], time: '09:00', label: 'Algorithms', enabled: true, ...over })

beforeEach(() => {
  mem.fired = {}
  mem.cache = null
  vi.spyOn(console, 'log').mockImplementation(() => {})
})

describe('study reminders', () => {
  it('fires on the matching day and minute, with a wave and a start action', () => {
    const t = setup([rem()])
    t.at(2026, 10, 5, 9, 0, 10)
    t.sched.check()
    expect(t.engine.say).toHaveBeenCalledWith('Time to study!', 'wave')
    expect(t.notify).toHaveBeenCalledTimes(1)
    const [title, body, opts] = t.notify.mock.calls[0]
    expect(title).toContain('Time to study')
    expect(body).toBe('Algorithms')
    opts.onAction()
    expect(t.engine.start).toHaveBeenCalled()
  })

  it('uses a default body when the label is empty', () => {
    const t = setup([rem({ label: '' })])
    t.at(2026, 10, 5, 9, 0)
    t.sched.check()
    expect(t.notify.mock.calls[0][1]).toMatch(/ready when you are/)
  })

  it('does not fire a minute early/late, or on the wrong weekday', () => {
    const t = setup([rem()])
    t.at(2026, 10, 5, 8, 59, 59)
    t.sched.check()
    t.at(2026, 10, 5, 9, 1, 0)
    t.sched.check()
    t.at(2026, 10, 6, 9, 0) // Friday
    t.sched.check()
    expect(t.notify).not.toHaveBeenCalled()
  })

  it('day-of-week: 0 = Sunday ... 6 = Saturday, multiple days', () => {
    const t = setup([rem({ days: [0, 6] })])
    t.at(2026, 10, 8, 9, 0) // Sunday
    t.sched.check()
    expect(t.notify).toHaveBeenCalledTimes(1)
    t.at(2026, 10, 14, 9, 0) // Saturday
    t.sched.check()
    expect(t.notify).toHaveBeenCalledTimes(2)
    t.at(2026, 10, 9, 9, 0) // Monday
    t.sched.check()
    expect(t.notify).toHaveBeenCalledTimes(2)
  })

  it('empty days list never fires; disabled never fires', () => {
    const t = setup([rem({ days: [] }), rem({ id: 'r2', enabled: false })])
    t.at(2026, 10, 5, 9, 0)
    t.sched.check()
    expect(t.notify).not.toHaveBeenCalled()
  })

  it('de-dups per date: many checks in the same minute fire once', () => {
    const t = setup([rem()])
    for (const s of [0, 20, 40, 59]) {
      t.at(2026, 10, 5, 9, 0, s)
      t.sched.check()
    }
    expect(t.notify).toHaveBeenCalledTimes(1)
  })

  it('fires again the next matching date (key includes the date)', () => {
    const t = setup([rem({ days: [4] })])
    t.at(2026, 10, 5, 9, 0)
    t.sched.check()
    t.at(2026, 10, 12, 9, 0)
    t.sched.check()
    expect(t.notify).toHaveBeenCalledTimes(2)
  })

  it('two reminders at the same time both fire (separate ids)', () => {
    const t = setup([rem(), rem({ id: 'r2', label: 'Physics' })])
    t.at(2026, 10, 5, 9, 0)
    t.sched.check()
    expect(t.notify).toHaveBeenCalledTimes(2)
  })

  it('skipped while a session is running, and not retried later in the same minute', () => {
    const t = setup([rem()], true)
    t.at(2026, 10, 5, 9, 0, 5)
    t.sched.check()
    expect(t.notify).not.toHaveBeenCalled()
    expect(t.engine.say).not.toHaveBeenCalled()
    t.setRunning(false)
    t.at(2026, 10, 5, 9, 0, 35)
    t.sched.check()
    expect(t.notify).not.toHaveBeenCalled() // marked as handled for today
  })

  it('midnight boundary: 00:00 reminder fires on the new day only', () => {
    const t = setup([rem({ days: [5], time: '00:00' })]) // Friday 00:00
    t.at(2026, 10, 5, 23, 59, 59) // Thursday, 1s before
    t.sched.check()
    expect(t.notify).not.toHaveBeenCalled()
    t.at(2026, 10, 6, 0, 0, 0)
    t.sched.check()
    expect(t.notify).toHaveBeenCalledTimes(1)
  })

  it('23:59 reminder on Thursday does not leak into Friday 00:00', () => {
    const t = setup([rem({ days: [4], time: '23:59' })])
    t.at(2026, 10, 5, 23, 59, 30)
    t.sched.check()
    t.at(2026, 10, 6, 0, 0, 0)
    t.sched.check()
    expect(t.notify).toHaveBeenCalledTimes(1)
  })

  it('padding: single-digit hours need "09:00", and unpadded "9:00" never matches', () => {
    const t = setup([rem({ time: '9:00' })])
    t.at(2026, 10, 5, 9, 0)
    t.sched.check()
    expect(t.notify).not.toHaveBeenCalled()
  })

  it('a missed minute (laptop asleep) is not caught up later', () => {
    const t = setup([rem()])
    t.at(2026, 10, 5, 9, 5)
    t.sched.check()
    expect(t.notify).not.toHaveBeenCalled()
  })

  it('start()/stop() schedule a 30s interval and are idempotent', () => {
    vi.useFakeTimers()
    try {
      const t = setup([rem()])
      t.at(2026, 10, 5, 9, 0)
      const spy = vi.spyOn(t.sched, 'check')
      t.sched.start()
      t.sched.start()
      vi.advanceTimersByTime(2_000)
      expect(spy).toHaveBeenCalledTimes(1)
      vi.advanceTimersByTime(30_000)
      expect(spy).toHaveBeenCalledTimes(2)
      t.sched.stop()
      t.sched.stop()
      vi.advanceTimersByTime(120_000)
      expect(spy).toHaveBeenCalledTimes(2)
    } finally {
      vi.useRealTimers()
    }
  })

  it('a corrupt reminder entry must not stop other reminders or the deadline check', () => {
    const t = setup([null as never, rem()])
    mem.cache = { fetchedAt: 0, url: 'x', items: [] }
    t.at(2026, 10, 5, 9, 0)
    t.sched.check() // must not throw
    expect(t.notify).toHaveBeenCalledTimes(1) // the bad entry is skipped, later ones still fire
  })

  // BUG: src/main/reminders.ts checkStudyReminders(): one malformed entry (e.g. null, or days not an
  // array - mergeSettings does not validate reminder contents) throws inside the for-loop; check()
  // swallows it, so every valid reminder after it AND checkDeadlines() are skipped forever.
  it('BUG: one malformed reminder entry must not suppress the valid reminders after it', () => {
    const t = setup([null as never, rem()])
    t.at(2026, 10, 5, 9, 0)
    t.sched.check()
    expect(t.notify).toHaveBeenCalledTimes(1)
  })
})

describe('deadline (exam) reminders', () => {
  const NOW = new Date(2026, 10, 5, 12, 0).getTime()
  const exam = (uid: string, inDays: number, over: Record<string, unknown> = {}) => ({
    uid,
    summary: 'CS101 Midterm',
    start: NOW + inDays * DAY,
    isExam: true,
    ...over
  })
  const withCache = (...items: unknown[]) => {
    mem.cache = { fetchedAt: NOW, url: 'https://x', items }
  }

  it('fires the 3-day reminder between 3 and 1 days out, once', () => {
    const t = setup()
    t.setNow(NOW)
    withCache(exam('a', 2.5))
    t.sched.check()
    t.sched.check()
    expect(t.notify).toHaveBeenCalledTimes(1)
    expect(t.notify.mock.calls[0][0]).toBe('CS101 Midterm in 3 days')
    expect(t.engine.say).toHaveBeenCalledWith('CS101 Midterm is coming up!', 'wave')
  })

  it('exactly 3 days out fires the 3-day reminder; just over 3 days does not', () => {
    const t = setup()
    t.setNow(NOW)
    withCache(exam('a', 3), exam('b', 3.0001))
    t.sched.check()
    expect(t.notify).toHaveBeenCalledTimes(1)
    expect(t.notify.mock.calls[0][0]).toContain('3 days')
  })

  it('exactly 1 day out fires the 1-day reminder (not the 3-day)', () => {
    const t = setup()
    t.setNow(NOW)
    withCache(exam('a', 1))
    t.sched.check()
    expect(t.notify).toHaveBeenCalledTimes(1)
    expect(t.notify.mock.calls[0][0]).toBe('CS101 Midterm in 1 day')
  })

  it('progresses 3d -> 1d as time passes, each exactly once', () => {
    const t = setup()
    withCache(exam('a', 3))
    t.setNow(NOW)
    t.sched.check()
    t.setNow(NOW + 1 * DAY) // 2 days left: 3d already fired
    t.sched.check()
    t.setNow(NOW + 2.5 * DAY) // 0.5 days left
    t.sched.check()
    t.setNow(NOW + 2.6 * DAY)
    t.sched.check()
    expect(t.notify.mock.calls.map((c) => c[0])).toEqual(['CS101 Midterm in 3 days', 'CS101 Midterm in 1 day'])
  })

  it('first seen inside the last day: only the 1-day reminder, never both', () => {
    const t = setup()
    t.setNow(NOW)
    withCache(exam('a', 0.5))
    t.sched.check()
    expect(t.notify.mock.calls.map((c) => c[0])).toEqual(['CS101 Midterm in 1 day'])
  })

  it('ignores non-exam events, past events and events more than 3 days away', () => {
    const t = setup()
    t.setNow(NOW)
    withCache(exam('a', 2, { isExam: false }), exam('b', -0.1), exam('c', 0), exam('d', 10))
    t.sched.check()
    expect(t.notify).not.toHaveBeenCalled()
  })

  it('does nothing without a cache', () => {
    const t = setup()
    t.setNow(NOW)
    t.sched.check()
    expect(t.notify).not.toHaveBeenCalled()
  })

  it('several exams each get their own reminder (keyed by uid)', () => {
    const t = setup()
    t.setNow(NOW)
    withCache(exam('a', 2), exam('b', 2.2, { summary: 'Final' }))
    t.sched.check()
    expect(t.notify).toHaveBeenCalledTimes(2)
  })

  it('while a session runs: still notifies, but the pet does not wave over the session', () => {
    const t = setup([], true)
    t.setNow(NOW)
    withCache(exam('a', 2))
    t.sched.check()
    expect(t.notify).toHaveBeenCalledTimes(1)
    expect(t.engine.say).not.toHaveBeenCalled()
  })

  it('records the firing time with the deadline key', () => {
    const t = setup()
    t.setNow(NOW)
    withCache(exam('a', 2))
    t.sched.check()
    expect(mem.fired['deadline|a|3d']).toBe(NOW)
  })

  it('deadline notification action starts a session', () => {
    const t = setup()
    t.setNow(NOW)
    withCache(exam('a', 2))
    t.sched.check()
    t.notify.mock.calls[0][2].onAction()
    expect(t.engine.start).toHaveBeenCalled()
  })

  it('an exam rescheduled to a later date after the 3d reminder does not re-fire the same key (known limitation)', () => {
    const t = setup()
    t.setNow(NOW)
    withCache(exam('a', 2))
    t.sched.check()
    withCache(exam('a', 2.5)) // same uid, new time
    t.sched.check()
    expect(t.notify).toHaveBeenCalledTimes(1)
  })
})
