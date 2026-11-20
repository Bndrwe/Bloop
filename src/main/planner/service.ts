// The study planner: tasks typed in by hand plus items from the deadlines cache (Brightspace and the
// iCal feed), each broken down by the AI (classify.ts) and placed into the study window
// (schedule.ts). Storage is injected so tests run without electron-store.
import { randomUUID } from 'node:crypto'
import type { Deadline, Result } from '@shared/types'
import { DEFAULT_STUDY_WINDOW, PLANNER_TITLE_MAX, type PlannerState, type PlannerTask, type StudyWindow } from '@shared/planner'
import { classifyItems, type Classification, type ClassifyItem, type GenerateText } from './classify'
import { parseHm, scheduleTasks, validWindow } from './schedule'

export interface PlannerData {
  tasks: PlannerTask[]
  window: StudyWindow
  /** Deadline uids not to import (removed by the user, or not work, e.g. a lecture). */
  dismissed: string[]
}

export const EMPTY_PLANNER: PlannerData = { tasks: [], window: DEFAULT_STUDY_WINDOW, dismissed: [] }

export interface PlannerDeps {
  load(): PlannerData
  save(d: PlannerData): void
  generate: GenerateText
  getDeadlines(): Deadline[]
  now?: () => number
  onChange?: (s: PlannerState) => void
  log?: (m: string) => void
}

const DAY_MS = 86_400_000
/** Finished-by-date tasks are kept this long after they were due, then dropped. */
const KEEP_PAST_MS = 7 * DAY_MS
const DISMISSED_MAX = 500
const MAX_TASKS = 200
/** Due dates further out than this are refused (typos like year 9999). */
const MAX_DUE_AHEAD_MS = 2 * 365 * DAY_MS

/** When a deadline is due: all-day items at the end of their last day. */
export function deadlineDue(d: Deadline): number {
  return d.allDay && d.end ? d.end : d.start
}

/** Coerce whatever was on disk into PlannerData (drops malformed tasks). */
export function validatePlannerData(raw: unknown): PlannerData {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Partial<PlannerData>
  const window =
    r.window && typeof r.window.start === 'string' && typeof r.window.end === 'string' && validWindow(r.window)
      ? { start: r.window.start, end: r.window.end }
      : DEFAULT_STUDY_WINDOW
  const tasks = (Array.isArray(r.tasks) ? r.tasks : []).filter(
    (t): t is PlannerTask =>
      !!t && typeof t.id === 'string' && typeof t.title === 'string' && Number.isFinite(t.due) && Array.isArray(t.steps)
  )
  const dismissed = (Array.isArray(r.dismissed) ? r.dismissed : []).filter((u): u is string => typeof u === 'string')
  return { tasks, window, dismissed }
}

export class PlannerService {
  private data: PlannerData
  private busy = false
  /** After dispose() (Reset all data) nothing is saved or pushed any more, even by work in flight. */
  private disposed = false
  private note: string | undefined
  /** Async changes (add, sync) run one after another. */
  private queue: Promise<unknown> = Promise.resolve()
  private readonly now: () => number
  private readonly log: (m: string) => void

  constructor(private readonly deps: PlannerDeps) {
    this.data = validatePlannerData(deps.load())
    this.now = deps.now ?? Date.now
    this.log = deps.log ?? (() => undefined)
  }

  state(): PlannerState {
    return { tasks: this.data.tasks, window: this.data.window, busy: this.busy, ...(this.note ? { note: this.note } : {}) }
  }

  dispose(): void {
    this.disposed = true
  }

  tasks(): PlannerTask[] {
    return this.data.tasks
  }

  /** Re-place every future block (after a change, or as time passes and blocks are missed). */
  reschedule(): PlannerState {
    this.commit({ ...this.data })
    return this.state()
  }

  add(title: string, due: number): Promise<Result<PlannerState>> {
    const clean = String(title ?? '').replace(/[\r\n]+/g, ' ').trim().slice(0, PLANNER_TITLE_MAX)
    if (!clean) return Promise.resolve({ ok: false, error: 'Give the task a name.' })
    if (!Number.isFinite(due) || due <= this.now()) return Promise.resolve({ ok: false, error: 'Pick a due date in the future.' })
    if (due > this.now() + MAX_DUE_AHEAD_MS) return Promise.resolve({ ok: false, error: 'Pick a due date within the next two years.' })
    if (this.data.tasks.length >= MAX_TASKS) return Promise.resolve({ ok: false, error: 'That’s a lot of tasks. Finish or remove some first.' })
    return this.enqueue(async () => {
      const [task] = await this.classify([{ title: clean, due }], () => ({ source: 'manual' as const }))
      // a hand-typed task is always kept, even if the AI thinks it's not work
      const kept = task ?? this.toTask({ title: clean, due }, { kind: 'task', steps: [{ title: 'Work on it', minutes: 60 }] }, 'rules', { source: 'manual' })
      this.commit({ ...this.data, tasks: [...this.data.tasks, kept] })
      return { ok: true as const, value: this.state() }
    })
  }

  remove(id: string): PlannerState {
    const t = this.data.tasks.find((x) => x.id === id)
    if (!t) return this.state()
    const dismissed = t.sourceUid ? [...this.data.dismissed, t.sourceUid].slice(-DISMISSED_MAX) : this.data.dismissed
    this.commit({ ...this.data, tasks: this.data.tasks.filter((x) => x.id !== id), dismissed })
    return this.state()
  }

  setStepDone(taskId: string, stepId: string, done: boolean): PlannerState {
    const tasks = this.data.tasks.map((t) =>
      t.id !== taskId ? t : { ...t, steps: t.steps.map((s) => (s.id === stepId ? { ...s, done } : s)) }
    )
    this.commit({ ...this.data, tasks })
    return this.state()
  }

  setWindow(w: StudyWindow): Result<PlannerState> {
    const start = String(w?.start ?? '')
    const end = String(w?.end ?? '')
    if (parseHm(start) === null || parseHm(end) === null) return { ok: false, error: 'Use times like 16:00.' }
    if (!validWindow({ start, end })) return { ok: false, error: 'The study window needs to be at least an hour.' }
    this.commit({ ...this.data, window: { start, end } })
    return { ok: true, value: this.state() }
  }

  /** Import new upcoming deadlines (not seen, not dismissed), break them down and schedule them. */
  sync(): Promise<PlannerState> {
    return this.enqueue(async () => {
      const now = this.now()
      const known = new Set([...this.data.tasks.map((t) => t.sourceUid).filter(Boolean), ...this.data.dismissed])
      const fresh = this.deps
        .getDeadlines()
        .filter((d) => !known.has(d.uid) && deadlineDue(d) > now && deadlineDue(d) < now + MAX_DUE_AHEAD_MS)
      if (fresh.length === 0) {
        this.commit(this.pruned(this.data, now))
        return this.state()
      }
      this.log(`planner: breaking down ${fresh.length} new item(s)`)
      const items: ClassifyItem[] = fresh.map((d) => ({ title: d.summary, due: deadlineDue(d), kind: d.kind, isExam: d.isExam }))
      const made = await this.classify(items, (i) => ({ source: fresh[i].source ?? 'calendar', sourceUid: fresh[i].uid }))
      const skipped = fresh.filter((_, i) => made[i] === null).map((d) => d.uid)
      const added = made.filter((t): t is PlannerTask => t !== null)
      this.commit(
        this.pruned(
          {
            ...this.data,
            tasks: [...this.data.tasks, ...added].slice(-MAX_TASKS),
            dismissed: [...this.data.dismissed, ...skipped].slice(-DISMISSED_MAX)
          },
          now
        )
      )
      return this.state()
    })
  }

  private pruned(d: PlannerData, now: number): PlannerData {
    return { ...d, tasks: d.tasks.filter((t) => t.due > now - KEEP_PAST_MS) }
  }

  /** Break items down; null where the result is 'skip'. Sets the AI note for the panel. */
  private async classify(
    items: ClassifyItem[],
    origin: (i: number) => Pick<PlannerTask, 'source'> & { sourceUid?: string }
  ): Promise<(PlannerTask | null)[]> {
    this.setBusy(true)
    try {
      const r = await classifyItems(items, this.deps.generate, this.now())
      this.note = r.aiError ? `AI unavailable, used the built-in rules (${r.aiError})` : undefined
      if (r.aiError) this.log(`planner: AI breakdown failed, used rules: ${r.aiError}`)
      return r.results.map((res, i) => (res.classification === 'skip' ? null : this.toTask(items[i], res.classification, res.by, origin(i))))
    } finally {
      this.setBusy(false)
    }
  }

  private toTask(
    item: ClassifyItem,
    c: Exclude<Classification, 'skip'>,
    by: 'ai' | 'rules',
    origin: Pick<PlannerTask, 'source'> & { sourceUid?: string }
  ): PlannerTask {
    return {
      id: randomUUID(),
      title: item.title.slice(0, PLANNER_TITLE_MAX),
      due: item.due,
      kind: c.kind,
      ...origin,
      steps: c.steps.map((s) => ({ id: randomUUID(), title: s.title, minutes: s.minutes, done: false, block: null })),
      classifiedBy: by,
      createdAt: this.now()
    }
  }

  private enqueue<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.queue.then(fn, fn)
    this.queue = run.catch(() => undefined)
    return run
  }

  private setBusy(busy: boolean): void {
    this.busy = busy
    if (this.disposed) return
    this.deps.onChange?.(this.state())
  }

  /** Schedule, save and push. */
  private commit(next: PlannerData): void {
    if (this.disposed) return
    this.data = { ...next, tasks: scheduleTasks({ tasks: next.tasks, window: next.window, now: this.now() }) }
    this.deps.save(this.data)
    this.deps.onChange?.(this.state())
  }
}
