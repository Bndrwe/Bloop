import type { PlannerStep, PlannerTask, TimeBlock } from '@shared/planner'
import { DAY_SHORT } from '../../lib/format'

const time = (ms: number): string => new Date(ms).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })

function dayLabel(ms: number, now: number): string {
  const d = new Date(ms)
  const today = new Date(now)
  const diff = Math.round(
    (new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime() -
      new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime()) /
      86_400_000
  )
  if (diff === 0) return 'Today'
  if (diff === 1) return 'Tomorrow'
  if (diff > 1 && diff < 7) return DAY_SHORT[d.getDay()]
  return d.toLocaleDateString([], { month: 'short', day: 'numeric' })
}

/** "Today 4:00 – 5:30 PM", "Thu 6:00 – 7:00 PM". */
export function blockText(b: TimeBlock, now = Date.now()): string {
  return `${dayLabel(b.start, now)} ${time(b.start)} – ${time(b.end)}`
}

/** "due Thu 11:59 PM", "due Dec 3", "overdue". */
export function dueText(due: number, now = Date.now()): string {
  if (due < now) return 'overdue'
  return `due ${dayLabel(due, now)} ${time(due)}`
}

export const isNow = (b: TimeBlock | null, now = Date.now()): boolean => !!b && b.start <= now && now < b.end

export function progress(t: PlannerTask): { done: number; total: number } {
  return { done: t.steps.filter((s) => s.done).length, total: t.steps.length }
}

/** The next step still to do that has a block (soonest first). */
export function nextStep(t: PlannerTask): PlannerStep | null {
  const open = t.steps.filter((s) => !s.done && s.block)
  return open.sort((a, b) => (a.block as TimeBlock).start - (b.block as TimeBlock).start)[0] ?? null
}

export const unscheduledCount = (t: PlannerTask): number => t.steps.filter((s) => !s.done && !s.block).length

/** The value for <input type="datetime-local"> for a time `days` from now at 23:59. */
export function defaultDueInput(days = 2, now = Date.now()): string {
  const d = new Date(now + days * 86_400_000)
  const pad = (n: number): string => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T23:59`
}
