import type { SessionPhase } from '@shared/types'

export function mmss(totalSec: number): string {
  const s = Math.max(0, Math.round(totalSec))
  const m = Math.floor(s / 60)
  return `${String(m).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`
}

export type ScoreLevel = 'good' | 'ok' | 'bad' | 'none'

export function scoreLevel(score: number | null | undefined): ScoreLevel {
  if (score == null) return 'none'
  if (score >= 70) return 'good'
  if (score >= 40) return 'ok'
  return 'bad'
}

export function scoreText(score: number | null | undefined): string {
  return score == null ? '—' : String(Math.round(score))
}

export function phaseLabel(phase: SessionPhase): string {
  switch (phase) {
    case 'focus':
      return 'Focus'
    case 'break':
      return 'Break'
    case 'paused':
      return 'Paused'
    case 'done':
      return 'Done'
    default:
      return 'Idle'
  }
}

export function minutes(sec: number): string {
  const m = Math.round(sec / 60)
  if (m < 60) return `${m}m`
  return `${Math.floor(m / 60)}h ${m % 60}m`
}

export const DAY_LETTERS = ['S', 'M', 'T', 'W', 'T', 'F', 'S']
export const DAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

/** Parse "YYYY-MM-DD" as a local date. */
export function parseLocalDate(ymd: string): Date {
  const [y, m, d] = ymd.split('-').map(Number)
  return new Date(y, (m || 1) - 1, d || 1)
}

export function relativeDate(ms: number, now = Date.now()): string {
  const start = new Date(now)
  start.setHours(0, 0, 0, 0)
  const target = new Date(ms)
  const t0 = new Date(target)
  t0.setHours(0, 0, 0, 0)
  const days = Math.round((t0.getTime() - start.getTime()) / 86_400_000)
  const time = target.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
  if (days < 0) return 'past'
  if (days === 0) return `today ${time}`
  if (days === 1) return `tomorrow ${time}`
  if (days < 7) return `${DAY_SHORT[target.getDay()]} ${time} · in ${days}d`
  return target.toLocaleDateString([], { month: 'short', day: 'numeric' }) + ` · in ${days}d`
}

export function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}
