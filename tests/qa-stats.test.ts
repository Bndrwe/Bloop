// QA: stats day boundaries, timezones, DST, empty days and the 7-day window.
import { afterEach, describe, expect, it } from 'vitest'
import { computeStats, localDateKey } from '../src/main/stats'
import type { SessionRecord } from '../src/shared/types'

const ORIGINAL_TZ = process.env.TZ
afterEach(() => {
  if (ORIGINAL_TZ === undefined) delete process.env.TZ
  else process.env.TZ = ORIGINAL_TZ
})

function rec(start: number, over: Partial<SessionRecord> = {}): SessionRecord {
  return {
    id: String(start),
    start,
    end: start + 1_800_000,
    durationSec: 1800,
    focusSec: 1500,
    distractSec: 300,
    neutralSec: 0,
    finalScore: 80,
    topFocus: [],
    topDistract: [],
    pomodorosCompleted: 1,
    completed: true,
    ...over
  }
}

describe('localDateKey', () => {
  it('pads month and day and uses local time', () => {
    expect(localDateKey(new Date(2026, 0, 5, 23, 59, 59, 999))).toBe('2026-01-05')
    expect(localDateKey(new Date(2026, 11, 31, 0, 0, 0, 0))).toBe('2026-12-31')
  })
  it('accepts epoch numbers', () => {
    expect(localDateKey(new Date(2026, 5, 9, 12).getTime())).toBe('2026-06-09')
  })
  it('follows the process timezone (same instant, different day)', () => {
    const instant = Date.UTC(2026, 5, 10, 2, 30) // 02:30Z
    process.env.TZ = 'America/Los_Angeles'
    expect(localDateKey(instant)).toBe('2026-06-09')
    process.env.TZ = 'Asia/Tokyo'
    expect(localDateKey(instant)).toBe('2026-06-10')
    process.env.TZ = 'Pacific/Kiritimati' // UTC+14
    expect(localDateKey(instant)).toBe('2026-06-10')
    process.env.TZ = 'Pacific/Pago_Pago' // UTC-11
    expect(localDateKey(instant)).toBe('2026-06-09')
  })
})

describe('computeStats', () => {
  it('empty history: 7 empty days, nulls for today', () => {
    const now = new Date(2026, 5, 15, 10).getTime()
    const s = computeStats([], now)
    expect(s.last7).toHaveLength(7)
    expect(s.todayAvgScore).toBeNull()
    expect(s.todayFocusSec).toBe(0)
    expect(s.todaySessions).toBe(0)
    expect(s.last7.every((d) => d.avgScore === null && d.focusSec === 0 && d.sessions === 0)).toBe(true)
    expect(s.last7.map((d) => d.date)).toEqual([
      '2026-06-09', '2026-06-10', '2026-06-11', '2026-06-12', '2026-06-13', '2026-06-14', '2026-06-15'
    ])
  })

  it('window is exactly today and the 6 days before; day 8 and tomorrow are excluded', () => {
    const now = new Date(2026, 5, 15, 10).getTime()
    const sessions = [
      rec(new Date(2026, 5, 8, 23, 59).getTime()), // 8 days ago (outside)
      rec(new Date(2026, 5, 9, 0, 0).getTime()), // first day in window
      rec(new Date(2026, 5, 16, 0, 0).getTime()) // tomorrow (outside)
    ]
    const s = computeStats(sessions, now)
    expect(s.last7[0].sessions).toBe(1)
    expect(s.last7.reduce((n, d) => n + d.sessions, 0)).toBe(1)
    expect(s.todaySessions).toBe(0)
  })

  it('midnight boundary: 23:59:59.999 and 00:00:00.000 land on different days', () => {
    const now = new Date(2026, 5, 15, 10).getTime()
    const s = computeStats(
      [rec(new Date(2026, 5, 14, 23, 59, 59, 999).getTime()), rec(new Date(2026, 5, 15, 0, 0, 0, 0).getTime())],
      now
    )
    expect(s.last7[5].sessions).toBe(1)
    expect(s.last7[6].sessions).toBe(1)
  })

  it('"now" just after midnight still treats the new day as today', () => {
    const now = new Date(2026, 5, 15, 0, 0, 1).getTime()
    const s = computeStats([rec(new Date(2026, 5, 14, 22).getTime())], now)
    expect(s.todaySessions).toBe(0)
    expect(s.last7[5].sessions).toBe(1)
  })

  it('a session spanning midnight is attributed to its start day', () => {
    const start = new Date(2026, 5, 14, 23, 30).getTime()
    const s = computeStats([rec(start, { end: start + 3_600_000, durationSec: 3600 })], new Date(2026, 5, 15, 12).getTime())
    expect(s.last7[5].sessions).toBe(1)
    expect(s.todaySessions).toBe(0)
  })

  it('weights the day average by duration and rounds', () => {
    const now = new Date(2026, 5, 15, 20).getTime()
    const d = new Date(2026, 5, 15, 9).getTime()
    const s = computeStats(
      [rec(d, { durationSec: 3000, finalScore: 100 }), rec(d + 4_000_000, { durationSec: 1000, finalScore: 50 })],
      now
    )
    expect(s.todayAvgScore).toBe(88) // (3000*100 + 1000*50)/4000 = 87.5 -> 88
    expect(s.todaySessions).toBe(2)
    expect(s.todayFocusSec).toBe(3000)
  })

  it('sessions with null score or zero duration do not contribute to the average (but are counted)', () => {
    const now = new Date(2026, 5, 15, 20).getTime()
    const d = new Date(2026, 5, 15, 9).getTime()
    const s = computeStats(
      [rec(d, { finalScore: null }), rec(d + 1, { durationSec: 0, finalScore: 90, focusSec: 0 }), rec(d + 2, { finalScore: 60, durationSec: 600, focusSec: 400 })],
      now
    )
    expect(s.todayAvgScore).toBe(60)
    expect(s.todaySessions).toBe(3)
    expect(s.todayFocusSec).toBe(1500 + 0 + 400)
  })

  it('score 0 is a real score (not treated as missing)', () => {
    const now = new Date(2026, 5, 15, 20).getTime()
    const s = computeStats([rec(new Date(2026, 5, 15, 9).getTime(), { finalScore: 0 })], now)
    expect(s.todayAvgScore).toBe(0)
  })

  it('month and year boundaries', () => {
    const now = new Date(2026, 0, 2, 9).getTime()
    expect(computeStats([], now).last7.map((d) => d.date)).toEqual([
      '2025-12-27', '2025-12-28', '2025-12-29', '2025-12-30', '2025-12-31', '2026-01-01', '2026-01-02'
    ])
  })

  it('leap day', () => {
    const now = new Date(2028, 2, 2, 9).getTime()
    const dates = computeStats([], now).last7.map((d) => d.date)
    expect(dates).toContain('2028-02-29')
    expect(dates[0]).toBe('2028-02-25')
  })

  it('rounds fractional focusSec per day', () => {
    const now = new Date(2026, 5, 15, 20).getTime()
    const d = new Date(2026, 5, 15, 9).getTime()
    const s = computeStats([rec(d, { focusSec: 10.4 }), rec(d + 1, { focusSec: 10.4 })], now)
    expect(s.todayFocusSec).toBe(21)
  })
})

describe('DST and timezones', () => {
  it('US spring-forward week still yields 7 distinct consecutive days', () => {
    process.env.TZ = 'America/New_York' // 2026-03-08 is 23 hours long
    const now = new Date(2026, 2, 10, 9).getTime()
    expect(computeStats([], now).last7.map((d) => d.date)).toEqual([
      '2026-03-04', '2026-03-05', '2026-03-06', '2026-03-07', '2026-03-08', '2026-03-09', '2026-03-10'
    ])
  })

  it('US fall-back week (25-hour day) yields 7 distinct consecutive days', () => {
    process.env.TZ = 'America/New_York' // 2026-11-01 is 25 hours long
    const now = new Date(2026, 10, 3, 9).getTime()
    expect(computeStats([], now).last7.map((d) => d.date)).toEqual([
      '2026-10-28', '2026-10-29', '2026-10-30', '2026-10-31', '2026-11-01', '2026-11-02', '2026-11-03'
    ])
  })

  it('sessions around the fall-back repeated hour stay on the same day', () => {
    process.env.TZ = 'America/New_York'
    // 01:30 EDT and 01:30 EST on Nov 1
    const first = Date.UTC(2026, 10, 1, 5, 30)
    const second = Date.UTC(2026, 10, 1, 6, 30)
    expect(localDateKey(first)).toBe('2026-11-01')
    expect(localDateKey(second)).toBe('2026-11-01')
    const s = computeStats([rec(first), rec(second)], new Date(2026, 10, 1, 20).getTime())
    expect(s.todaySessions).toBe(2)
  })

  it('session on the last second of a 25-hour day and the first of the next', () => {
    process.env.TZ = 'America/New_York'
    const lastOfNov1 = new Date(2026, 10, 1, 23, 59, 59).getTime()
    const firstOfNov2 = new Date(2026, 10, 2, 0, 0, 0).getTime()
    const s = computeStats([rec(lastOfNov1), rec(firstOfNov2)], new Date(2026, 10, 2, 12).getTime())
    expect(s.last7[5].sessions).toBe(1)
    expect(s.last7[6].sessions).toBe(1)
  })

  it('midnight-DST zones (Sao Paulo used 00:00 transitions; Beirut/Havana still do)', () => {
    process.env.TZ = 'America/Havana' // spring forward at 00:00 -> 01:00
    const now = new Date(2026, 2, 10, 9).getTime()
    const dates = computeStats([], now).last7.map((d) => d.date)
    expect(new Set(dates).size).toBe(7)
    expect(dates[6]).toBe('2026-03-10')
  })

  it('the same sessions land on different calendar days in different timezones', () => {
    const t = Date.UTC(2026, 5, 15, 23, 30) // 23:30Z
    const now = Date.UTC(2026, 5, 16, 12, 0)
    process.env.TZ = 'UTC'
    expect(computeStats([rec(t)], now).last7[5].sessions).toBe(1)
    process.env.TZ = 'Asia/Kolkata' // +05:30 -> already the 16th
    expect(computeStats([rec(t)], now).last7[6].sessions).toBe(1)
  })

  it('half-hour and 45-minute offset zones', () => {
    process.env.TZ = 'Asia/Kathmandu'
    const t = Date.UTC(2026, 5, 15, 18, 20) // 00:05 on the 16th in +05:45
    expect(localDateKey(t)).toBe('2026-06-16')
  })
})
