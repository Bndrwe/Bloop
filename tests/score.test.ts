import { describe, expect, it } from 'vitest'
import { computeFocusScore, summarizeSession } from '../src/main/score'
import { computeStats } from '../src/main/stats'
import type { SessionRecord } from '../src/shared/types'

const now = 1_700_000_000_000
const s = (agoSec: number, category: 'focus' | 'distract' | 'neutral', durationSec = 5) => ({
  t: now - agoSec * 1000,
  category,
  durationSec
})

describe('computeFocusScore', () => {
  it('returns null with no data or only neutral data', () => {
    expect(computeFocusScore([], now)).toBeNull()
    expect(computeFocusScore([s(0, 'neutral'), s(5, 'neutral')], now)).toBeNull()
  })
  it('handles the 100 / 0 extremes', () => {
    expect(computeFocusScore([s(0, 'focus'), s(5, 'focus'), s(10, 'neutral')], now)).toBe(100)
    expect(computeFocusScore([s(0, 'distract'), s(5, 'distract')], now)).toBe(0)
  })
  it('ignores neutral time', () => {
    expect(computeFocusScore([s(0, 'focus'), s(0, 'distract'), s(0, 'neutral', 1000)], now)).toBe(50)
  })
  it('weights recent focus above older distraction', () => {
    const samples = [s(1200, 'distract', 60), s(0, 'focus', 60)]
    expect(computeFocusScore(samples, now)).toBeGreaterThan(50)
    const reversed = [s(1200, 'focus', 60), s(0, 'distract', 60)]
    expect(computeFocusScore(reversed, now)).toBeLessThan(50)
  })
  it('a sample one half-life old weighs half', () => {
    // focus now (w=1), distract one half-life ago (w=0.5) -> 1/(1+0.5) = 66.7%
    expect(computeFocusScore([s(0, 'focus'), s(600, 'distract')], now, 600)).toBe(67)
    // distract two half-lives old with 4x the duration balances one fresh focus sample
    expect(computeFocusScore([s(0, 'focus', 10), s(240, 'distract', 40)], now, 120)).toBe(50)
  })
  it('defaults durationSec to 5', () => {
    expect(computeFocusScore([{ t: now, category: 'focus' }, { t: now, category: 'distract', durationSec: 5 }], now)).toBe(50)
  })
})

describe('summarizeSession', () => {
  it('totals time and ranks top apps/domains', () => {
    const sum = summarizeSession([
      { t: now, app: 'Code', category: 'focus', durationSec: 30 },
      { t: now, app: 'Google Chrome', domain: 'github.com', category: 'focus', durationSec: 10 },
      { t: now, app: 'Google Chrome', domain: 'youtube.com', category: 'distract', durationSec: 20 },
      { t: now, app: 'Finder', category: 'neutral', durationSec: 5 },
      { t: now, app: 'Discord', category: 'distract' }
    ])
    expect(sum.focusSec).toBe(40)
    expect(sum.distractSec).toBe(25)
    expect(sum.neutralSec).toBe(5)
    expect(sum.topFocus).toEqual([
      { name: 'Code', seconds: 30 },
      { name: 'github.com', seconds: 10 }
    ])
    expect(sum.topDistract[0]).toEqual({ name: 'youtube.com', seconds: 20 })
  })
})

describe('computeStats', () => {
  it('duration-weights today and builds 7 days oldest first', () => {
    const today = new Date(2026, 10, 4, 15).getTime()
    const rec = (start: number, durationSec: number, finalScore: number | null): SessionRecord => ({
      id: String(start),
      start,
      end: start + durationSec * 1000,
      durationSec,
      focusSec: durationSec / 2,
      distractSec: 0,
      neutralSec: 0,
      finalScore,
      topFocus: [],
      topDistract: [],
      pomodorosCompleted: 0,
      completed: false
    })
    const st = computeStats(
      [rec(today - 3600e3, 3000, 90), rec(today - 1800e3, 1000, 50), rec(today - 86400e3 * 2, 600, 70), rec(today, 100, null)],
      today
    )
    expect(st.todayAvgScore).toBe(80)
    expect(st.todaySessions).toBe(3)
    expect(st.last7).toHaveLength(7)
    expect(st.last7[6].date).toBe('2026-11-04')
    expect(st.last7[4].avgScore).toBe(70)
    expect(st.last7[0].date).toBe('2026-10-29')
  })
})
