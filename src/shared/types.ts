// Shared contract between the main process, preload bridge and renderer.
// Keep this file free of runtime imports from electron/node so both sides can use it.

export type Category = 'focus' | 'distract' | 'neutral'

/** Visual states of the pet. `wave` is used for study reminders. */
export type PetMood = 'idle' | 'happy' | 'worried' | 'sad' | 'sleeping' | 'celebrate' | 'wave'

/** idle = no session; focus/break = pomodoro phases; paused = user paused; done = just completed. */
export type SessionPhase = 'idle' | 'focus' | 'break' | 'paused' | 'done'

export interface ActiveSample {
  /** epoch ms */
  t: number
  /** Owner app name, e.g. "Google Chrome", "Code" */
  app: string
  /** Window title (empty if Screen Recording permission is missing) */
  title: string
  /** Current tab URL if a supported browser is frontmost and Automation is allowed */
  url?: string
  /** Hostname derived from url, without leading "www." */
  domain?: string
  category: Category
}

export interface Reminder {
  id: string
  /** 0 = Sunday ... 6 = Saturday */
  days: number[]
  /** 24h "HH:MM" local time */
  time: string
  label: string
  enabled: boolean
}

export interface Settings {
  focusApps: string[]
  distractApps: string[]
  focusDomains: string[]
  distractDomains: string[]
  /** Seconds continuously on a distraction before the pet gets worried + speaks. */
  nudgeAfterSec: number
  /** Seconds continuously on a distraction before a macOS notification is sent. */
  notifyAfterSec: number
  /** Minimum seconds between nudges. */
  nudgeCooldownSec: number
  focusMinutes: number
  breakMinutes: number
  /** Seconds between active-window samples. */
  sampleIntervalSec: number
  reminders: Reminder[]
  launchAtLogin: boolean
  /** Brightspace (or any) iCal subscription URL. */
  icalUrl: string
}

export interface NamedDuration {
  name: string
  seconds: number
}

export interface SessionRecord {
  id: string
  /** epoch ms */
  start: number
  end: number
  durationSec: number
  focusSec: number
  distractSec: number
  neutralSec: number
  /** 0-100, or null if no non-neutral time was recorded */
  finalScore: number | null
  topFocus: NamedDuration[]
  topDistract: NamedDuration[]
  pomodorosCompleted: number
  completed: boolean
}

export type PermissionState = 'granted' | 'denied' | 'unknown' | 'not-applicable'

export interface PermissionStatus {
  platform: string
  /** Needed for window titles. */
  screenRecording: PermissionState
  /** Needed for reading browser URLs via AppleScript. */
  automation: PermissionState
  /** True until the user dismisses the onboarding/permissions screen. */
  showOnboarding: boolean
}

export interface PetState {
  mood: PetMood
  /** Short speech bubble text, or null for none. */
  message: string | null
  /** Increments every time a new message is set, so the UI can re-trigger animations. */
  messageId: number
}

export interface AppStatus {
  phase: SessionPhase
  /** Live focus score 0-100, null when no non-neutral data yet. */
  score: number | null
  /** epoch ms when the current focus/break phase ends (null when idle/paused). */
  phaseEndsAt: number | null
  /** Seconds left in the current phase (frozen while paused). */
  remainingSec: number
  /** Total length of current phase in seconds. */
  phaseTotalSec: number
  /** Phase we will resume into when paused. */
  pausedPhase: 'focus' | 'break' | null
  pomodorosCompleted: number
  sessionStartedAt: number | null
  current: Pick<ActiveSample, 'app' | 'domain' | 'category'> | null
  pet: PetState
}

export interface DayStat {
  /** YYYY-MM-DD local date */
  date: string
  avgScore: number | null
  focusSec: number
  sessions: number
}

export interface Stats {
  todayAvgScore: number | null
  todayFocusSec: number
  todaySessions: number
  /** Oldest first, 7 entries ending today. */
  last7: DayStat[]
}

export interface Deadline {
  uid: string
  summary: string
  /** epoch ms */
  start: number
  isExam: boolean
  location?: string
}

export interface PlanBlock {
  /** 0 = Sunday ... 6 = Saturday */
  day: number
  /** "HH:MM" */
  time: string
  minutes: number
  label: string
}

export interface StudyPlan {
  generatedAt: number
  summary: string
  blocks: PlanBlock[]
}

export type Result<T> = { ok: true; value: T } | { ok: false; error: string }

/** The API exposed on `window.studyPet` by the preload script. */
export interface StudyPetApi {
  // status
  getStatus(): Promise<AppStatus>
  /** Subscribe to status pushes. Returns an unsubscribe function. */
  onStatus(cb: (status: AppStatus) => void): () => void
  /** Main asks the UI to navigate (e.g. open onboarding). */
  onNavigate(cb: (route: string) => void): () => void

  // session control
  startSession(): Promise<void>
  pauseSession(): Promise<void>
  resumeSession(): Promise<void>
  stopSession(): Promise<void>
  skipBreak(): Promise<void>

  // stats
  getStats(): Promise<Stats>
  getSessions(): Promise<SessionRecord[]>

  // settings
  getSettings(): Promise<Settings>
  saveSettings(patch: Partial<Settings>): Promise<Settings>
  resetData(): Promise<void>

  // windows
  openSettings(): Promise<void>
  togglePanel(): Promise<void>
  closePanel(): Promise<void>
  closeWindow(): Promise<void>
  /** Called on pointerdown on the pet; main follows the cursor until dragEnd. */
  dragStart(): Promise<void>
  /** Returns whether the window actually moved (so a non-move counts as a click). */
  dragEnd(): Promise<{ moved: boolean }>
  /** Pet window toggles click-through for transparent areas. */
  setIgnoreMouse(ignore: boolean): Promise<void>

  // permissions
  getPermissions(): Promise<PermissionStatus>
  openPermissionSettings(kind: 'screenRecording' | 'automation'): Promise<void>
  requestAutomation(): Promise<PermissionStatus>
  dismissOnboarding(): Promise<void>
  /** Quit and reopen Bloop (macOS only re-reads Screen Recording permission on launch). */
  relaunchApp(): Promise<void>

  // stretch: deadlines + AI plan
  getDeadlines(): Promise<Result<Deadline[]>>
  refreshDeadlines(): Promise<Result<Deadline[]>>
  getPlan(): Promise<StudyPlan | null>
  generatePlan(): Promise<Result<StudyPlan>>
  addPlanReminders(): Promise<Result<number>>
  hasApiKey(): Promise<boolean>
}
