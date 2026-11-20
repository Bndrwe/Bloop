// Shared contract for the study planner (projects, tasks, time blocks), the website blocker and the
// Google integration. No runtime imports from electron/node: both sides use this file.
import type { Result } from './types'

/** A project is a big, multi-day piece of work broken into steps; a task gets 1-2 blocks. */
export type PlannerKind = 'project' | 'task'

export type PlannerSource = 'manual' | 'brightspace' | 'calendar'

/** A scheduled study block, epoch ms. */
export interface TimeBlock {
  start: number
  end: number
}

export interface PlannerStep {
  id: string
  title: string
  minutes: number
  done: boolean
  /** null = it could not fit before the due date inside the study window. */
  block: TimeBlock | null
}

export interface PlannerTask {
  id: string
  title: string
  /** epoch ms: every block ends by then */
  due: number
  kind: PlannerKind
  source: PlannerSource
  /** The deadline uid it came from (Brightspace / calendar), so a re-sync doesn't add it twice. */
  sourceUid?: string
  steps: PlannerStep[]
  /** Who broke it down: the AI, or the built-in rules when no AI was ready. */
  classifiedBy: 'ai' | 'rules'
  createdAt: number
}

/** The daily window blocks are placed in, local "HH:MM" (24h). End before start = past midnight. */
export interface StudyWindow {
  start: string
  end: string
}

export const DEFAULT_STUDY_WINDOW: StudyWindow = { start: '16:00', end: '22:00' }

export interface PlannerState {
  tasks: PlannerTask[]
  window: StudyWindow
  /** A sync / AI breakdown is running. */
  busy: boolean
  /** The last sync problem, shown in the panel (e.g. "No AI ready, used the built-in rules"). */
  note?: string
}

export const PLANNER_TITLE_MAX = 200

export interface PlannerApi {
  get(): Promise<PlannerState>
  onChange(cb: (s: PlannerState) => void): () => void
  /** Add a task by hand; the AI decides project vs task and schedules it. `due` is epoch ms. */
  add(title: string, due: number): Promise<Result<PlannerState>>
  /** Remove a task (an imported one stays hidden after the next sync). */
  remove(id: string): Promise<PlannerState>
  setStepDone(taskId: string, stepId: string, done: boolean): Promise<PlannerState>
  setWindow(window: StudyWindow): Promise<Result<PlannerState>>
  /** Pull new items from Brightspace / the calendar feed now. */
  sync(): Promise<PlannerState>
}

// ------------------------------------------------------------------ website blocker

export interface BlockerStatus {
  /** macOS only for now. */
  supported: boolean
  /** Sites are blocked right now. */
  active: boolean
  /** Why: the user turned it on, or a study block is running. */
  reason: 'manual' | 'block' | null
  manual: boolean
  sites: string[]
  /** The running block's step, when reason = 'block'. */
  blockLabel?: string
  /** epoch ms the running block ends */
  until?: number
  /** Applying or removing the block (the admin prompt may be up). */
  busy: boolean
  error?: string
}

export const BLOCKER_SITES_MAX = 100

export interface BlockerApi {
  get(): Promise<BlockerStatus>
  onChange(cb: (s: BlockerStatus) => void): () => void
  setSites(sites: string[]): Promise<BlockerStatus>
  /** Turn blocking on / off by hand. Turning it on may show the macOS admin prompt once. */
  setManual(on: boolean): Promise<BlockerStatus>
}

// ------------------------------------------------------------------ Google (mock)

export type GoogleService = 'gmail' | 'calendar'
export const GOOGLE_SERVICES: readonly GoogleService[] = ['gmail', 'calendar']

export interface GoogleServiceStatus {
  connected: boolean
  account?: string
  connectedAt?: number
}

export interface GoogleStatus {
  services: Record<GoogleService, GoogleServiceStatus>
  /** True while the integration is a stand-in (no OAuth, no API calls). */
  mock: boolean
}

export interface GoogleApi {
  get(): Promise<GoogleStatus>
  connect(service: GoogleService): Promise<Result<GoogleStatus>>
  disconnect(service: GoogleService): Promise<GoogleStatus>
}
