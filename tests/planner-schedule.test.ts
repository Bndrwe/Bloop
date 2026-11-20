import { describe, expect, it } from 'vitest'
import { parseHm, scheduleTasks, validWindow } from '../src/main/planner/schedule'
import type { PlannerStep, PlannerTask, StudyWindow } from '../src/shared/planner'

const WIN: StudyWindow = { start: '16:00', end: '22:00' }
const MIN = 60_000
const at = (d: number, h: number, m = 0): number => new Date(2026, 10, d, h, m).getTime() // Nov 2026, local

function step(id: string, minutes: number, extra: Partial<PlannerStep> = {}): PlannerStep {
  return { id, title: id, minutes, done: false, block: null, ...extra }
}
function task(id: string, due: number, steps: PlannerStep[], kind: PlannerTask['kind'] = 'task'): PlannerTask {
  return { id, title: id, due, kind, source: 'manual', steps, classifiedBy: 'rules', createdAt: 0 }
}
const blocks = (tasks: PlannerTask[]) => tasks.flatMap((t) => t.steps.map((s) => s.block)).filter((b) => b !== null)

function noOverlap(tasks: PlannerTask[]): boolean {
  const bs = blocks(tasks).sort((a, b) => a.start - b.start)
  return bs.every((b, i) => i === 0 || bs[i - 1].end <= b.start)
}
function insideWindow(tasks: PlannerTask[]): boolean {
  return blocks(tasks).every((b) => {
    const s = new Date(b.start)
    const e = new Date(b.end)
    const sm = s.getHours() * 60 + s.getMinutes()
    const em = e.getHours() * 60 + e.getMinutes()
    return s.toDateString() === e.toDateString() && sm >= 16 * 60 && em <= 22 * 60
  })
}

describe('parseHm / validWindow', () => {
  it('parses HH:MM', () => {
    expect(parseHm('16:00')).toBe(960)
    expect(parseHm('9:05')).toBe(545)
    expect(parseHm('24:00')).toBeNull()
    expect(parseHm('nope')).toBeNull()
  })
  it('needs at least an hour', () => {
    expect(validWindow({ start: '16:00', end: '22:00' })).toBe(true)
    expect(validWindow({ start: '16:00', end: '16:30' })).toBe(false)
    expect(validWindow({ start: '22:00', end: '01:00' })).toBe(true) // past midnight
  })
})

describe('scheduleTasks', () => {
  it('places a small task inside the window, before the due date', () => {
    const now = at(20, 10)
    const out = scheduleTasks({ tasks: [task('a', at(21, 23, 59), [step('a1', 60)])], window: WIN, now })
    const b = out[0].steps[0].block!
    expect(b).not.toBeNull()
    expect(b.start).toBe(at(20, 16))
    expect(b.end - b.start).toBe(60 * MIN)
    expect(b.end).toBeLessThanOrEqual(at(21, 23, 59))
  })

  it('never overlaps blocks across tasks and keeps every block inside the window', () => {
    const now = at(20, 10)
    const tasks = [
      task('p', at(25, 23, 59), [step('p1', 90), step('p2', 120), step('p3', 90), step('p4', 60)], 'project'),
      task('a', at(21, 12), [step('a1', 60), step('a2', 60)]),
      task('b', at(22, 23, 59), [step('b1', 45)])
    ]
    const out = scheduleTasks({ tasks, window: WIN, now })
    expect(blocks(out)).toHaveLength(7)
    expect(noOverlap(out)).toBe(true)
    expect(insideWindow(out)).toBe(true)
    for (const t of out) for (const s of t.steps) expect(s.block!.end).toBeLessThanOrEqual(t.due)
  })

  it('keeps a project\'s steps in order and spreads them over days', () => {
    const now = at(20, 10)
    const out = scheduleTasks({
      tasks: [task('p', at(26, 23, 59), [step('p1', 60), step('p2', 60), step('p3', 60)], 'project')],
      window: WIN,
      now
    })
    const bs = out[0].steps.map((s) => s.block!)
    expect(bs[0].end).toBeLessThanOrEqual(bs[1].start)
    expect(bs[1].end).toBeLessThanOrEqual(bs[2].start)
    const days = new Set(bs.map((b) => new Date(b.start).toDateString()))
    expect(days.size).toBe(3)
  })

  it('starts no earlier than now (rounded up to 15 min) when inside the window', () => {
    const now = at(20, 17, 7)
    const out = scheduleTasks({ tasks: [task('a', at(20, 23), [step('a1', 30)])], window: WIN, now })
    expect(out[0].steps[0].block!.start).toBe(at(20, 17, 15))
  })

  it('leaves a step unscheduled when it cannot finish before the due date', () => {
    const now = at(20, 10)
    const out = scheduleTasks({ tasks: [task('a', at(20, 16, 30), [step('a1', 60)])], window: WIN, now })
    expect(out[0].steps[0].block).toBeNull()
  })

  it('keeps done and in-progress blocks, and reschedules missed ones', () => {
    const now = at(20, 18)
    const done = step('d', 60, { done: true, block: { start: at(19, 16), end: at(19, 17) } })
    const running = step('r', 60, { block: { start: at(20, 17, 30), end: at(20, 18, 30) } })
    const missed = step('m', 60, { block: { start: at(19, 18), end: at(19, 19) } })
    const out = scheduleTasks({ tasks: [task('p', at(23, 23), [done, running, missed], 'project')], window: WIN, now })
    const [d, r, m] = out[0].steps
    expect(d.block).toEqual(done.block)
    expect(r.block).toEqual(running.block)
    expect(m.block!.start).toBeGreaterThanOrEqual(at(20, 18, 30))
    expect(noOverlap(out)).toBe(true)
  })

  it('does not mutate its input', () => {
    const tasks = [task('a', at(21, 23), [step('a1', 60)])]
    const copy = JSON.parse(JSON.stringify(tasks))
    scheduleTasks({ tasks, window: WIN, now: at(20, 10) })
    expect(tasks).toEqual(copy)
  })

  it('stays fast for a due date far in the future (places within the horizon)', () => {
    const now = at(20, 10)
    const t0 = performance.now()
    const out = scheduleTasks({
      tasks: [task('far', new Date(9999, 0, 1).getTime(), [step('a', 60), step('b', 60), step('c', 60)], 'project')],
      window: WIN,
      now
    })
    expect(performance.now() - t0).toBeLessThan(200)
    expect(out[0].steps.every((s) => s.block !== null && s.block.start < now + 61 * 86_400_000)).toBe(true)
  })

  it('counts an after-midnight block as the window day it belongs to', () => {
    const now = at(20, 10)
    const win = { start: '23:00', end: '02:00' }
    const fixed = step('a', 60, { done: true, block: { start: at(21, 0, 30), end: at(21, 1, 30) } }) // belongs to the 20th
    const out = scheduleTasks({ tasks: [task('p', at(24, 12), [fixed, step('b', 60)], 'project')], window: win, now })
    expect(out[0].steps[1].block!.start).toBe(at(21, 23)) // next window, not later on the 20th's
  })

  it('handles a window that runs past midnight', () => {
    const now = at(20, 10)
    const out = scheduleTasks({
      tasks: [task('a', at(22, 12), [step('a1', 120)])],
      window: { start: '23:00', end: '02:00' },
      now
    })
    const b = out[0].steps[0].block!
    expect(b.start).toBe(at(20, 23))
    expect(b.end).toBe(at(21, 1))
  })
})
