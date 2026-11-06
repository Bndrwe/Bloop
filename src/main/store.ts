import Store from 'electron-store'
import type { Deadline, SessionRecord, Settings, Stats, StudyPlan } from '@shared/types'
import { DEFAULT_AI_SETTINGS, type AiSettings } from '@shared/ai'
import { validateAiSettings } from './ai/settings'
import { DEFAULT_SETTINGS, mergeSettings, migrateSettings, SETTINGS_VERSION } from './defaults'
import { computeStats } from './stats'

export interface DeadlinesCache {
  fetchedAt: number
  url: string
  /** Merged, de-duplicated upcoming items from every source (read by reminders, the panel and the plan). */
  items: Deadline[]
  /** Per-source items; `items` is rebuilt from these. Absent on caches from before Brightspace login. */
  sources?: { calendar?: Deadline[]; brightspace?: Deadline[] }
}

/** Brightspace login state (no cookies: those stay in the persist:brightspace session). */
export interface BrightspaceState {
  host: string
  connected: boolean
  expired?: boolean
  user?: string
  courseCount?: number
  lastSync?: number
  error?: string
}

interface Schema {
  settings: Settings
  /** Which settings migrations have run (see migrateSettings). */
  settingsVersion: number
  sessions: SessionRecord[]
  petPosition: { x: number; y: number } | null
  onboardingDismissed: boolean
  /** key `${YYYY-MM-DD}|${reminderId}` (or `deadline|uid|3d`) -> epoch ms fired */
  lastReminderFired: Record<string, number>
  studyPlan: StudyPlan | null
  deadlines: DeadlinesCache | null
  brightspace: BrightspaceState | null
  /** AI provider choice (Settings → AI). */
  ai: AiSettings
}

const DEFAULTS: Schema = {
  settings: DEFAULT_SETTINGS,
  settingsVersion: 0,
  sessions: [],
  petPosition: null,
  onboardingDismissed: false,
  lastReminderFired: {},
  studyPlan: null,
  deadlines: null,
  brightspace: null,
  ai: DEFAULT_AI_SETTINGS
}

const MAX_SESSIONS = 1000

let store: Store<Schema> | null = null
function s(): Store<Schema> {
  if (!store) {
    store = new Store<Schema>({ name: 'bloop', defaults: DEFAULTS, clearInvalidConfig: true })
    const v = Number(store.get('settingsVersion')) || 0
    if (v < SETTINGS_VERSION) {
      store.set('settings', mergeSettings(migrateSettings(store.get('settings'), v)))
      store.set('settingsVersion', SETTINGS_VERSION)
    }
  }
  return store
}

export function getSettings(): Settings {
  return mergeSettings(s().get('settings'))
}

export function saveSettings(patch: Partial<Settings>): Settings {
  const next = mergeSettings({ ...getSettings(), ...patch })
  s().set('settings', next)
  return next
}

export function getSessions(): SessionRecord[] {
  const list = s().get('sessions')
  return Array.isArray(list) ? list : []
}

export function addSession(rec: SessionRecord): void {
  const list = getSessions()
  list.push(rec)
  s().set('sessions', list.slice(-MAX_SESSIONS))
}

export function getStats(now = Date.now()): Stats {
  return computeStats(getSessions(), now)
}

export function getPetPosition(): { x: number; y: number } | null {
  const p = s().get('petPosition')
  return p && Number.isFinite(p.x) && Number.isFinite(p.y) ? p : null
}
export function setPetPosition(p: { x: number; y: number }): void {
  s().set('petPosition', { x: Math.round(p.x), y: Math.round(p.y) })
}

export function isOnboardingDismissed(): boolean {
  return s().get('onboardingDismissed') === true
}
export function setOnboardingDismissed(v: boolean): void {
  s().set('onboardingDismissed', v)
}

export function wasReminderFired(key: string): boolean {
  return Boolean(s().get('lastReminderFired')?.[key])
}
export function markReminderFired(key: string, now = Date.now()): void {
  const map = { ...(s().get('lastReminderFired') ?? {}) }
  map[key] = now
  // prune entries older than 30 days
  for (const [k, t] of Object.entries(map)) if (now - t > 30 * 86400e3) delete map[k]
  s().set('lastReminderFired', map)
}

export function getStudyPlan(): StudyPlan | null {
  return s().get('studyPlan') ?? null
}
export function setStudyPlan(p: StudyPlan | null): void {
  s().set('studyPlan', p)
}

export function getDeadlinesCache(): DeadlinesCache | null {
  return s().get('deadlines') ?? null
}
export function setDeadlinesCache(c: DeadlinesCache | null): void {
  s().set('deadlines', c)
}

export function getBrightspaceState(): BrightspaceState | null {
  const b = s().get('brightspace')
  return b && typeof b === 'object' && typeof b.host === 'string' ? b : null
}
export function setBrightspaceState(b: BrightspaceState | null): void {
  s().set('brightspace', b)
}

export function getAiSettings(): AiSettings {
  return validateAiSettings(s().get('ai'))
}
export function saveAiSettings(patch: Partial<AiSettings>): AiSettings {
  const next = validateAiSettings({ ...getAiSettings(), ...patch })
  s().set('ai', next)
  return next
}

/**
 * Reset ALL data: sessions, study plan, pet position, reminder history, deadline cache,
 * onboarding flag AND settings (back to DEFAULT_SETTINGS). Nothing is kept.
 */
export function resetData(): void {
  s().clear() // electron-store re-applies DEFAULTS after clear()
  s().set('settings', DEFAULT_SETTINGS)
  s().set('settingsVersion', SETTINGS_VERSION)
}
