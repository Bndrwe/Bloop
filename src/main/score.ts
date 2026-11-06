// Pure scoring logic: no electron imports (unit-tested in tests/score.test.ts).
import type { Category, NamedDuration } from '@shared/types'

export const DEFAULT_SAMPLE_SEC = 5

export interface ScoreSample {
  /** epoch ms */
  t: number
  category: Category
  /** seconds of time this sample represents (default 5) */
  durationSec?: number
}

export interface SummarySample extends ScoreSample {
  app: string
  domain?: string
}

/** Default half-life of the score's recency weighting, in seconds. */
export const SCORE_HALF_LIFE_SEC = 600

/** Seconds of virtual focus credited at the start of tracking (the "fresh start"). */
export const FRESH_START_SEC = 120

/**
 * A "fresh start" prior: a virtual focus credit dated `t` that decays like any sample. It makes
 * the score start at 100 and fall gradually while distracted, instead of dropping to 0 on the
 * first distracting sample.
 */
export interface ScorePrior {
  /** epoch ms the credit is dated (tracking start) */
  t: number
  /** seconds of focus credited (default FRESH_START_SEC) */
  focusSec?: number
}

/**
 * Recency-weighted focus score: each sample is weighted by 0.5^(age / halfLife),
 * score = 100 * focus / (focus + distract). Neutral time is ignored. With a prior the score is
 * 100 at the start and never null; without one it is null when there is no non-neutral data.
 */
export function computeFocusScore(
  samples: ScoreSample[],
  now: number,
  halfLifeSec = SCORE_HALF_LIFE_SEC,
  prior?: ScorePrior | null
): number | null {
  let focus = 0
  let total = 0
  if (prior) {
    const ageSec = Math.max(0, (now - prior.t) / 1000)
    const d = (prior.focusSec ?? FRESH_START_SEC) * Math.pow(0.5, ageSec / halfLifeSec)
    focus += d
    total += d
  }
  for (const s of samples) {
    if (s.category === 'neutral') continue
    const ageSec = Math.max(0, (now - s.t) / 1000)
    const w = Math.pow(0.5, ageSec / halfLifeSec)
    const d = (s.durationSec ?? DEFAULT_SAMPLE_SEC) * w
    total += d
    if (s.category === 'focus') focus += d
  }
  if (total <= 0) return prior ? 100 : null
  return Math.round((100 * focus) / total)
}

export interface SessionSummary {
  focusSec: number
  distractSec: number
  neutralSec: number
  topFocus: NamedDuration[]
  topDistract: NamedDuration[]
}

function top(map: Map<string, number>, n = 3): NamedDuration[] {
  return [...map.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([name, seconds]) => ({ name, seconds: Math.round(seconds) }))
}

export function summarizeSession(samples: SummarySample[]): SessionSummary {
  let focusSec = 0
  let distractSec = 0
  let neutralSec = 0
  const f = new Map<string, number>()
  const d = new Map<string, number>()
  for (const s of samples) {
    const dur = s.durationSec ?? DEFAULT_SAMPLE_SEC
    const name = s.domain || s.app || 'Unknown'
    if (s.category === 'focus') {
      focusSec += dur
      f.set(name, (f.get(name) ?? 0) + dur)
    } else if (s.category === 'distract') {
      distractSec += dur
      d.set(name, (d.get(name) ?? 0) + dur)
    } else neutralSec += dur
  }
  return {
    focusSec: Math.round(focusSec),
    distractSec: Math.round(distractSec),
    neutralSec: Math.round(neutralSec),
    topFocus: top(f),
    topDistract: top(d)
  }
}
