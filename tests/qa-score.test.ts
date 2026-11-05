// QA: focus score numeric behaviour and session summaries.
import { describe, expect, it } from 'vitest'
import { computeFocusScore, DEFAULT_SAMPLE_SEC, summarizeSession, type SummarySample } from '../src/main/score'
import type { Category } from '../src/shared/types'

const NOW = 1_700_000_000_000
const mk = (n: number, cat: (i: number) => Category, stepSec = 5, endAt = NOW) =>
  Array.from({ length: n }, (_, i) => ({ t: endAt - (n - 1 - i) * stepSec * 1000, category: cat(i) }))

describe('computeFocusScore', () => {
  it('empty, all-neutral, and zero-duration inputs are null (not 0, not NaN)', () => {
    expect(computeFocusScore([], NOW)).toBeNull()
    expect(computeFocusScore(mk(100, () => 'neutral'), NOW)).toBeNull()
    expect(computeFocusScore([{ t: NOW, category: 'focus', durationSec: 0 }], NOW)).toBeNull()
  })
  it('all-focus is 100 and all-distract is 0, even when neutral is mixed in', () => {
    expect(computeFocusScore(mk(50, () => 'focus'), NOW)).toBe(100)
    expect(computeFocusScore(mk(50, () => 'distract'), NOW)).toBe(0)
    expect(computeFocusScore(mk(50, (i) => (i % 2 ? 'neutral' : 'focus')), NOW)).toBe(100)
  })
  it('neutral time neither helps nor hurts', () => {
    const base = mk(20, (i) => (i < 10 ? 'focus' : 'distract'))
    const withNeutral = [...base, ...mk(500, () => 'neutral', 5, NOW - 1)]
    expect(computeFocusScore(withNeutral, NOW)).toBe(computeFocusScore(base, NOW))
  })
  it('a single sample works', () => {
    expect(computeFocusScore([{ t: NOW, category: 'focus' }], NOW)).toBe(100)
    expect(computeFocusScore([{ t: NOW, category: 'distract' }], NOW)).toBe(0)
  })
  it('a long 8h session (5760 samples) stays in 0..100, finite, and is recency weighted', () => {
    const n = 8 * 3600 / 5
    const s = computeFocusScore(mk(n, (i) => (i < n / 2 ? 'distract' : 'focus')), NOW)!
    expect(Number.isFinite(s)).toBe(true)
    expect(s).toBeGreaterThan(95) // recent focus half dominates (half-life 10 min)
    const rev = computeFocusScore(mk(n, (i) => (i < n / 2 ? 'focus' : 'distract')), NOW)!
    expect(rev).toBeLessThan(5)
  })
  it('a 24h session of alternating categories is ~50 and does not drift', () => {
    const n = 24 * 3600 / 5
    const s = computeFocusScore(mk(n, (i) => (i % 2 ? 'focus' : 'distract')), NOW)!
    expect(s).toBeGreaterThanOrEqual(49)
    expect(s).toBeLessThanOrEqual(51)
  })
  it('is order independent', () => {
    const a = mk(40, (i) => (i % 3 ? 'focus' : 'distract'))
    expect(computeFocusScore([...a].reverse(), NOW)).toBe(computeFocusScore(a, NOW))
  })
  it('halving: a sample one half-life old counts half', () => {
    const s = [
      { t: NOW - 600_000, category: 'distract' as const },
      { t: NOW, category: 'focus' as const }
    ]
    // focus weight 1, distract 0.5 -> 100 * 1/1.5 = 66.67
    expect(computeFocusScore(s, NOW)).toBe(67)
  })
  it('custom half-life changes the weighting', () => {
    const s = [
      { t: NOW - 60_000, category: 'distract' as const },
      { t: NOW, category: 'focus' as const }
    ]
    expect(computeFocusScore(s, NOW, 60)).toBe(67)
    expect(computeFocusScore(s, NOW, 1e9)).toBe(50)
  })
  it('future samples (clock skew) are treated as age 0, never weighted above 1', () => {
    const s = computeFocusScore([{ t: NOW + 3600_000, category: 'distract' }, { t: NOW, category: 'focus' }], NOW)
    expect(s).toBe(50)
  })
  it('very old samples underflow to null rather than NaN', () => {
    const s = computeFocusScore([{ t: NOW - 100 * 86400_000, category: 'focus' }], NOW)
    expect(s === null || (s >= 0 && s <= 100)).toBe(true)
    expect(Number.isNaN(s as number)).toBe(false)
  })
  it('after a long gap the old ratio is preserved (not reset to null)', () => {
    const s = computeFocusScore(mk(10, (i) => (i < 5 ? 'focus' : 'distract')), NOW + 12 * 3600_000)
    expect(s).not.toBeNull()
    expect(s).toBeGreaterThan(0)
    expect(s).toBeLessThan(100)
  })
  it('rounds to an integer, half up', () => {
    // weights 1:1 -> exactly 50; 1:2 -> 33.33 -> 33; 2:1 -> 66.67 -> 67
    expect(computeFocusScore([{ t: NOW, category: 'focus' }, { t: NOW, category: 'distract' }], NOW)).toBe(50)
    expect(computeFocusScore([{ t: NOW, category: 'focus' }, { t: NOW, category: 'distract', durationSec: 10 }], NOW)).toBe(33)
    expect(computeFocusScore([{ t: NOW, category: 'focus', durationSec: 10 }, { t: NOW, category: 'distract' }], NOW)).toBe(67)
  })
  it('durationSec defaults to DEFAULT_SAMPLE_SEC', () => {
    expect(DEFAULT_SAMPLE_SEC).toBe(5)
    expect(computeFocusScore([{ t: NOW, category: 'focus' }, { t: NOW, category: 'distract', durationSec: 5 }], NOW)).toBe(50)
  })
  it('is fast on 100k samples', () => {
    const t0 = Date.now()
    computeFocusScore(mk(100_000, (i) => (i % 5 ? 'focus' : 'distract')), NOW)
    expect(Date.now() - t0).toBeLessThan(500)
  })
})

describe('summarizeSession', () => {
  const s = (app: string, category: Category, durationSec?: number, domain?: string): SummarySample => ({ t: NOW, app, category, durationSec, domain })

  it('empty session: zeros and empty lists', () => {
    expect(summarizeSession([])).toEqual({ focusSec: 0, distractSec: 0, neutralSec: 0, topFocus: [], topDistract: [] })
  })
  it('all neutral goes only to neutralSec and the top lists stay empty', () => {
    const r = summarizeSession([s('Finder', 'neutral'), s('Finder', 'neutral')])
    expect(r).toMatchObject({ focusSec: 0, distractSec: 0, neutralSec: 10, topFocus: [], topDistract: [] })
  })
  it('prefers the domain over the app, falls back to app, then "Unknown"', () => {
    const r = summarizeSession([s('Google Chrome', 'distract', 5, 'youtube.com'), s('Discord', 'distract'), s('', 'distract')])
    expect(r.topDistract.map((x) => x.name).sort()).toEqual(['Discord', 'Unknown', 'youtube.com'])
    expect(summarizeSession([s('Chrome', 'distract', 5, '')]).topDistract[0].name).toBe('Chrome')
  })
  it('keeps only the top 3, sorted by seconds descending', () => {
    const r = summarizeSession([s('a', 'focus', 10), s('b', 'focus', 30), s('c', 'focus', 20), s('d', 'focus', 5)])
    expect(r.topFocus).toEqual([
      { name: 'b', seconds: 30 },
      { name: 'c', seconds: 20 },
      { name: 'a', seconds: 10 }
    ])
  })
  it('aggregates repeated names and rounds fractional seconds', () => {
    const r = summarizeSession([s('a', 'focus', 0.4), s('a', 'focus', 0.4), s('a', 'focus', 0.4)])
    expect(r.focusSec).toBe(1)
    expect(r.topFocus).toEqual([{ name: 'a', seconds: 1 }])
  })
  it('category totals add up for a long mixed session', () => {
    const list = Array.from({ length: 5760 }, (_, i) => s(`app${i % 7}`, (['focus', 'distract', 'neutral'] as const)[i % 3]))
    const r = summarizeSession(list)
    expect(r.focusSec + r.distractSec + r.neutralSec).toBe(5760 * 5)
  })
  it('uses the sample duration when given (e.g. 1s fast mode samples)', () => {
    expect(summarizeSession([s('a', 'focus', 1), s('a', 'distract', 1)])).toMatchObject({ focusSec: 1, distractSec: 1 })
  })
})
