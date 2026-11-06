// Shared contract between the main process, preload bridge and renderer.
// Keep this file free of runtime imports from electron/node so both sides can use it.
import type { AiApi } from './ai'
import type { ChatApi } from './chat'

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
  /** Your school's Brightspace origin for "Log in to Brightspace", e.g. https://purdue.brightspace.com ('' = not set). */
  brightspaceHost: string
  /** Show the background smoke in the panel, settings and onboarding windows. */
  backgroundEnabled: boolean
  /** Smoke brightness, 0–100. */
  backgroundIntensity: number
  /** Smoke drift speed, 0–100 (0 is a still frame). */
  backgroundSpeed: number
  /** The pointer stirs the smoke. */
  backgroundInteractive: boolean
  /** Show the pet on screen. Off = the pet window is hidden; tracking and nudges keep running. */
  showPet: boolean
  /** While the pet is hidden, a nudge shows it for a few seconds (else notifications only). */
  showPetForNudges: boolean
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
  /** Where it came from (absent on caches written before Brightspace login existed = calendar). */
  source?: 'brightspace' | 'calendar'
  /** Brightspace item type. */
  kind?: 'assignment' | 'quiz' | 'event'
  /** All-day item: it stays upcoming until `end` (the end of its last day). */
  allDay?: boolean
  /** epoch ms the item is over; defaults to `start`. */
  end?: number
}

/** Brightspace login state for Settings and the panel. Never contains cookies or tokens. */
export interface BrightspaceStatus {
  /** Normalized origin, e.g. https://purdue.brightspace.com ('' = not set). */
  host: string
  connected: boolean
  /** The session ended: show "Log in again". */
  expired?: boolean
  /** A login window is open or a sync is running. */
  busy?: boolean
  /** Display name from whoami. */
  user?: string
  courseCount?: number
  /** epoch ms of the last successful sync. */
  lastSync?: number
  /** Number of upcoming Brightspace items in the cache. */
  itemCount?: number
  error?: string
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
  /** Fires in every window after settings are saved or reset. Returns an unsubscribe function. */
  onSettingsChanged(cb: (settings: Settings) => void): () => void
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
  /** Hide or show the pet (the "Show pet" setting). Resolves to the new state: true = shown. */
  togglePet(): Promise<boolean>
  /** Pet window only: open its right-click menu (Hide pet / Open panel / Settings… / Quit). */
  petContextMenu(point?: { x: number; y: number }): Promise<void>

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

  // Brightspace login (Settings → Deadlines)
  brightspaceStatus(): Promise<BrightspaceStatus>
  /** Opens your school's sign-in page in a separate window; resolves when it closes. */
  brightspaceLogin(host: string): Promise<Result<BrightspaceStatus>>
  brightspaceLogout(): Promise<BrightspaceStatus>
  brightspaceRefresh(): Promise<Result<BrightspaceStatus>>
  /** Fires in every window when the Brightspace status (or its deadlines) change. */
  onBrightspaceStatus(cb: (status: BrightspaceStatus) => void): () => void

  /** Open an https link in the system browser (help/install/key pages). */
  openExternal(url: string): Promise<void>

  /** AI providers: Use Local (Ollama) and Cloud. See src/shared/ai.ts. */
  ai: AiApi
  /** Chat with Bloop: conversations stored in userData/chats. See src/shared/chat.ts. */
  chat: ChatApi
}
