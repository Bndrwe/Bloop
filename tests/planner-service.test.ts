import { describe, expect, it } from 'vitest'
import { EMPTY_PLANNER, PlannerService, validatePlannerData, type PlannerData } from '../src/main/planner/service'
import type { Deadline } from '../src/shared/types'

const NOW = new Date(2026, 10, 20, 10).getTime()
const DAY = 86_400_000
const noAi = async (): Promise<string> => {
  throw new Error('No AI ready')
}

function make(opts: { deadlines?: Deadline[]; generate?: () => Promise<string>; data?: PlannerData } = {}) {
  let saved: PlannerData = opts.data ?? EMPTY_PLANNER
  const pushes: unknown[] = []
  const svc = new PlannerService({
    load: () => saved,
    save: (d) => (saved = d),
    generate: opts.generate ?? noAi,
    getDeadlines: () => opts.deadlines ?? [],
    now: () => NOW,
    onChange: (s) => pushes.push(s)
  })
  return { svc, saved: () => saved, pushes }
}

const dl = (uid: string, summary: string, inDays: number, extra: Partial<Deadline> = {}): Deadline => ({
  uid,
  summary,
  start: NOW + inDays * DAY,
  isExam: false,
  source: 'brightspace',
  ...extra
})

describe('PlannerService', () => {
  it('adds a manual task, schedules it and saves it', async () => {
    const { svc, saved } = make()
    const r = await svc.add('Problem set 5', NOW + 2 * DAY)
    expect(r.ok).toBe(true)
    const t = saved().tasks[0]
    expect(t.source).toBe('manual')
    expect(t.steps.every((s) => s.block !== null)).toBe(true)
    expect(svc.state().note).toMatch(/built-in rules/)
  })

  it('rejects an empty title and a past due date', async () => {
    const { svc } = make()
    expect((await svc.add('  ', NOW + DAY)).ok).toBe(false)
    expect((await svc.add('x', NOW - 1)).ok).toBe(false)
  })

  it('imports deadlines once, skipping non-work items and remembering them', async () => {
    const deadlines = [dl('a', 'ENGL 101: Research essay', 9), dl('b', 'Quiz 4', 2, { kind: 'quiz' }), dl('c', 'CHEM Lecture', 1)]
    const { svc, saved } = make({ deadlines })
    await svc.sync()
    expect(saved().tasks.map((t) => t.sourceUid).sort()).toEqual(['a', 'b'])
    expect(saved().tasks.find((t) => t.sourceUid === 'a')!.kind).toBe('project')
    expect(saved().dismissed).toContain('c')
    await svc.sync()
    expect(saved().tasks).toHaveLength(2)
  })

  it('uses the AI breakdown when the AI answers', async () => {
    const gen = async () =>
      JSON.stringify({ items: [{ index: 0, type: 'project', steps: [{ title: 'Pick topic', minutes: 30 }, { title: 'Draft', minutes: 90 }] }] })
    const { svc, saved } = make({ deadlines: [dl('a', 'Capstone', 6)], generate: gen })
    await svc.sync()
    const t = saved().tasks[0]
    expect(t.classifiedBy).toBe('ai')
    expect(t.steps.map((s) => s.title)).toEqual(['Pick topic', 'Draft'])
    expect(svc.state().note).toBeUndefined()
  })

  it('a removed import stays gone after the next sync', async () => {
    const { svc, saved } = make({ deadlines: [dl('a', 'Lab report', 5)] })
    await svc.sync()
    svc.remove(saved().tasks[0].id)
    await svc.sync()
    expect(saved().tasks).toHaveLength(0)
  })

  it('marks a step done', async () => {
    const { svc, saved } = make()
    await svc.add('Worksheet', NOW + 3 * DAY)
    const t = saved().tasks[0]
    svc.setStepDone(t.id, t.steps[0].id, true)
    expect(saved().tasks[0].steps[0].done).toBe(true)
  })

  it('validates the study window and reschedules into it', async () => {
    const { svc, saved } = make()
    await svc.add('Worksheet', NOW + 3 * DAY)
    expect(svc.setWindow({ start: '18:00', end: '18:30' }).ok).toBe(false)
    expect(svc.setWindow({ start: '25:00', end: '18:30' }).ok).toBe(false)
    expect(svc.setWindow({ start: '08:00', end: '12:00' }).ok).toBe(true)
    const b = saved().tasks[0].steps[0].block!
    expect(new Date(b.start).getHours()).toBeGreaterThanOrEqual(8)
    expect(new Date(b.end).getHours()).toBeLessThanOrEqual(12)
  })

  it('refuses a due date years away (typo guard)', async () => {
    const { svc } = make()
    expect((await svc.add('x', NOW + 3 * 365 * DAY)).ok).toBe(false)
  })

  it('after dispose, work in flight saves nothing (Reset all data)', async () => {
    let release: (v: string) => void = () => undefined
    const gen = () => new Promise<string>((r) => (release = r))
    const { svc, saved } = make({ generate: gen })
    const pending = svc.add('Essay', NOW + 5 * DAY)
    await Promise.resolve()
    svc.dispose()
    release(JSON.stringify({ items: [] }))
    await pending
    expect(saved().tasks).toHaveLength(0)
  })

  it('reports busy while breaking down', async () => {
    const { svc, pushes } = make()
    await svc.add('Essay on climate', NOW + 8 * DAY)
    expect(pushes.some((p) => (p as { busy: boolean }).busy)).toBe(true)
    expect(svc.state().busy).toBe(false)
  })
})

describe('validatePlannerData', () => {
  it('falls back to defaults for junk', () => {
    expect(validatePlannerData(null)).toEqual(EMPTY_PLANNER)
    expect(validatePlannerData({ tasks: [{ nope: 1 }], window: { start: 'x', end: 'y' }, dismissed: [1, 'a'] })).toEqual({
      ...EMPTY_PLANNER,
      dismissed: ['a']
    })
  })
})
