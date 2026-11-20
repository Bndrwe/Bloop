// Places study blocks for planner steps. Pure: no clock, no store. Rules:
//  - blocks sit inside the daily study window (e.g. 16:00-22:00) and never overlap each other
//  - every block ends by its task's due date; a step that can't fit stays unscheduled (block null)
//  - a project's steps run in order, and the scheduler prefers one step per task per day
//  - done blocks and the block running now are kept; missed and future blocks are re-placed
// Tasks are handled earliest-due first, so the nearest deadline gets the earliest slots.
import type { PlannerStep, PlannerTask, StudyWindow, TimeBlock } from '@shared/planner'

const MIN = 60_000
const DAY_MS = 86_400_000
/** Blocks start on a 15-minute grid. */
export const SLOT_MIN = 15
/** The shortest study window the planner accepts. */
export const MIN_WINDOW_MIN = 60
/** Blocks are placed at most this far ahead (bounds the work for far-off due dates). */
export const HORIZON_DAYS = 60

/** "HH:MM" -> minutes after midnight, or null. */
export function parseHm(s: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(s ?? '').trim())
  if (!m) return null
  const h = Number(m[1])
  const mm = Number(m[2])
  return h <= 23 && mm <= 59 ? h * 60 + mm : null
}

/** Window start and length in minutes (an end at or before the start runs past midnight). */
function windowSpan(w: StudyWindow): { startMin: number; lenMin: number } | null {
  const s = parseHm(w.start)
  const e = parseHm(w.end)
  if (s === null || e === null) return null
  const len = e > s ? e - s : e + 24 * 60 - s
  return { startMin: s, lenMin: len }
}

export function validWindow(w: StudyWindow): boolean {
  const span = windowSpan(w)
  return span !== null && span.lenMin >= MIN_WINDOW_MIN
}

interface Segment extends TimeBlock {
  /** Which day's window this is (a past-midnight window belongs to the day it started). */
  day: string
}

function startOfDay(ms: number): number {
  const d = new Date(ms)
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
}

/** The study day a time belongs to: a 00:30 block in a 23:00-02:00 window counts as the day before. */
function studyDay(ms: number, w: StudyWindow): string {
  const span = windowSpan(w)
  return new Date(ms - (span?.startMin ?? 0) * MIN).toDateString()
}

function roundUp(ms: number, stepMin = SLOT_MIN): number {
  const step = stepMin * MIN
  return Math.ceil(ms / step) * step
}

/** Every study-window segment between `from` and `to`, clipped to that range. */
function windowSegments(from: number, to: number, w: StudyWindow): Segment[] {
  const span = windowSpan(w)
  if (!span || to <= from) return []
  const out: Segment[] = []
  // start a day early: yesterday's past-midnight window may still be open
  for (let day = startOfDay(from) - DAY_MS; day < to; day = startOfDay(day + DAY_MS + 3_600_000)) {
    const d = new Date(day)
    const start = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, span.startMin).getTime()
    const end = start + span.lenMin * MIN
    const s = Math.max(start, from)
    const e = Math.min(end, to)
    if (e > s) out.push({ start: s, end: e, day: studyDay(start, w) })
  }
  return out
}

/** Cut the busy blocks out of the segments. */
function subtract(segments: Segment[], busy: TimeBlock[]): Segment[] {
  let out = segments
  for (const b of busy) {
    out = out.flatMap((seg) => {
      if (b.end <= seg.start || b.start >= seg.end) return [seg]
      const parts: Segment[] = []
      if (b.start > seg.start) parts.push({ ...seg, end: b.start })
      if (b.end < seg.end) parts.push({ ...seg, start: b.end })
      return parts
    })
  }
  return out
}

interface FindArgs {
  free: Segment[]
  earliest: number
  durMs: number
  avoidDays: Set<string>
}

function findSlot({ free, earliest, durMs, avoidDays }: FindArgs): Segment | null {
  for (const seg of free) {
    if (avoidDays.has(seg.day)) continue
    const s = roundUp(Math.max(seg.start, earliest))
    if (s + durMs <= seg.end) return { start: s, end: s + durMs, day: seg.day }
  }
  return null
}

/** A block that stays where it is: done, or running right now. */
function isFixed(s: PlannerStep, now: number): boolean {
  if (!s.block) return false
  return s.done || (s.block.start <= now && s.block.end > now)
}

export interface ScheduleInput {
  tasks: PlannerTask[]
  window: StudyWindow
  now: number
}

/** Returns new task objects with every step's block (re)placed. The input is not changed. */
export function scheduleTasks({ tasks, window, now }: ScheduleInput): PlannerTask[] {
  const busy: TimeBlock[] = tasks.flatMap((t) => t.steps.filter((s) => isFixed(s, now)).map((s) => s.block as TimeBlock))
  const from = roundUp(now)
  const placed = new Map<string, TimeBlock | null>()
  const order = [...tasks].sort((a, b) => a.due - b.due)

  const horizon = from + HORIZON_DAYS * DAY_MS
  for (const t of order) {
    const days = new Set(t.steps.filter((s) => isFixed(s, now)).map((s) => studyDay((s.block as TimeBlock).start, window)))
    const segments = windowSegments(from, Math.min(t.due, horizon), window)
    let earliest = from
    for (const s of t.steps) {
      if (isFixed(s, now)) {
        earliest = Math.max(earliest, (s.block as TimeBlock).end)
        continue
      }
      if (s.done) continue // done without a block: nothing to place
      const free = subtract(segments, busy)
      const durMs = Math.max(SLOT_MIN, s.minutes) * MIN
      const slot =
        findSlot({ free, earliest, durMs, avoidDays: days }) ?? findSlot({ free, earliest, durMs, avoidDays: new Set() })
      const key = `${t.id}/${s.id}`
      if (!slot || slot.end > t.due) {
        placed.set(key, null)
        continue
      }
      placed.set(key, { start: slot.start, end: slot.end })
      busy.push({ start: slot.start, end: slot.end })
      days.add(slot.day)
      earliest = slot.end
    }
  }

  return tasks.map((t) => ({
    ...t,
    steps: t.steps.map((s) => {
      const key = `${t.id}/${s.id}`
      return placed.has(key) ? { ...s, block: placed.get(key) ?? null } : { ...s }
    })
  }))
}

/** The block running at `now` (not done), with its task and step, or null. */
export function activeBlock(tasks: PlannerTask[], now: number): { task: PlannerTask; step: PlannerStep; block: TimeBlock } | null {
  for (const task of tasks) {
    for (const step of task.steps) {
      const b = step.block
      if (b && !step.done && b.start <= now && now < b.end) return { task, step, block: b }
    }
  }
  return null
}
