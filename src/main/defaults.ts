import type { Reminder, Settings } from '@shared/types'
import { allowLocalBrightspace, cleanBrightspaceHost } from './brightspace'
import { clampPercent, DEFAULT_BACKGROUND_INTENSITY, DEFAULT_BACKGROUND_SPEED } from '@shared/background'

/** Longest stored URL / host string in Settings. */
export const MAX_URL_LENGTH = 2048

export const DEFAULT_SETTINGS: Settings = {
  focusApps: [
    'Code',
    'Visual Studio Code',
    'Cursor',
    'Terminal',
    'Windows Terminal',
    'WindowsTerminal',
    'PowerShell',
    'Command Prompt',
    'iTerm2',
    'Notion',
    'Microsoft Word',
    'WINWORD',
    'Acrobat',
    'Adobe Acrobat',
    'Pages',
    'Preview',
    'RStudio',
    'Xcode',
    'Obsidian'
  ],
  distractApps: ['Messages', 'Discord', 'Spotify', 'Steam', 'WhatsApp', 'FaceTime', 'YouTube'],
  focusDomains: [
    'brightspace',
    'docs.google.com',
    'overleaf.com',
    'github.com',
    'chatgpt.com',
    'claude.ai',
    'instructure.com',
    'canvas',
    'khanacademy.org',
    'wikipedia.org',
    'stackoverflow.com',
    'scholar.google.com'
  ],
  distractDomains: [
    'youtube.com',
    'instagram.com',
    'tiktok.com',
    'twitter.com',
    'x.com',
    'reddit.com',
    'netflix.com',
    'twitch.tv',
    'facebook.com'
  ],
  // Judged by what's on the page. youtube.com and reddit.com stay in the distracting list too: that
  // is what they count as until the page is judged (or when it can't be).
  contentDomains: ['youtube.com', 'reddit.com', 'medium.com', 'quora.com', 'vimeo.com'],
  readPageText: false,
  cloudJudge: true,
  nudgeAfterSec: 0,
  notifyAfterSec: 60,
  nudgeCooldownSec: 120,
  focusMinutes: 25,
  breakMinutes: 5,
  sampleIntervalSec: 2,
  reminders: [],
  launchAtLogin: false,
  icalUrl: '',
  brightspaceHost: '',
  backgroundEnabled: true,
  backgroundIntensity: DEFAULT_BACKGROUND_INTENSITY,
  backgroundSpeed: DEFAULT_BACKGROUND_SPEED,
  backgroundInteractive: true,
  showPet: true,
  showPetForNudges: true,
  trackWithoutSession: true
}

const MAX_LIST_LENGTH = 500

function cleanList(v: unknown, fallback: readonly string[]): string[] {
  if (!Array.isArray(v)) return [...fallback]
  const seen = new Set<string>()
  const out: string[] = []
  for (const x of v) {
    if (typeof x !== 'string') continue
    const t = x.trim()
    const key = t.toLowerCase()
    if (!t || seen.has(key)) continue
    seen.add(key)
    out.push(t)
    if (out.length >= MAX_LIST_LENGTH) break
  }
  return out
}

function cleanReminders(v: unknown): Reminder[] {
  if (!Array.isArray(v)) return []
  const out: Reminder[] = []
  const ids = new Set<string>()
  for (const r of v.slice(0, MAX_LIST_LENGTH)) {
    if (!r || typeof r !== 'object') continue
    const o = r as Record<string, unknown>
    if (!Array.isArray(o.days) || typeof o.time !== 'string') continue
    const time = o.time.trim()
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) continue
    const days = [...new Set(o.days.filter((d): d is number => typeof d === 'number' && Number.isInteger(d) && d >= 0 && d <= 6))].sort(
      (a, b) => a - b
    )
    let id = typeof o.id === 'string' && o.id.trim() ? o.id : `reminder-${out.length + 1}-${Math.random().toString(36).slice(2, 8)}`
    while (ids.has(id)) id += '_'
    ids.add(id)
    out.push({
      id,
      days,
      time,
      label: typeof o.label === 'string' ? o.label.slice(0, 200) : '',
      enabled: typeof o.enabled === 'boolean' ? o.enabled : true
    })
  }
  return out
}

/** Merge a (possibly partial / stale) stored settings object with defaults. Always returns fresh arrays. */
export function mergeSettings(stored: Partial<Settings> | undefined | null): Settings {
  // Only known keys survive (a stale or hostile settings file / IPC patch can't add others).
  const s = { ...DEFAULT_SETTINGS }
  if (stored && typeof stored === 'object') {
    const src = stored as Record<string, unknown>
    for (const k of Object.keys(DEFAULT_SETTINGS) as (keyof Settings)[]) {
      if (Object.prototype.hasOwnProperty.call(src, k) && src[k] !== undefined) (s as Record<string, unknown>)[k] = src[k]
    }
  }
  for (const k of ['focusApps', 'distractApps', 'focusDomains', 'distractDomains', 'contentDomains'] as const) {
    s[k] = cleanList(s[k], DEFAULT_SETTINGS[k])
  }
  s.reminders = cleanReminders(s.reminders)
  s.icalUrl = typeof s.icalUrl === 'string' ? s.icalUrl.slice(0, MAX_URL_LENGTH) : ''
  s.brightspaceHost = cleanBrightspaceHost(typeof s.brightspaceHost === 'string' ? s.brightspaceHost.slice(0, MAX_URL_LENGTH) : '', { allowLocal: allowLocalBrightspace() })
  if (typeof s.launchAtLogin !== 'boolean') s.launchAtLogin = DEFAULT_SETTINGS.launchAtLogin
  for (const k of [
    'nudgeAfterSec',
    'notifyAfterSec',
    'nudgeCooldownSec',
    'focusMinutes',
    'breakMinutes',
    'sampleIntervalSec'
  ] as const) {
    const v = Number(s[k])
    // "Pet speaks up after" may be 0 (right away); every other timing must be positive.
    const ok = k === 'nudgeAfterSec' ? v >= 0 : v > 0
    s[k] = Number.isFinite(v) && ok ? v : DEFAULT_SETTINGS[k]
  }
  for (const k of ['backgroundEnabled', 'backgroundInteractive', 'showPet', 'showPetForNudges', 'trackWithoutSession', 'readPageText', 'cloudJudge'] as const) {
    if (typeof s[k] !== 'boolean') s[k] = DEFAULT_SETTINGS[k]
  }
  s.backgroundIntensity = clampPercent(s.backgroundIntensity, DEFAULT_SETTINGS.backgroundIntensity)
  s.backgroundSpeed = clampPercent(s.backgroundSpeed, DEFAULT_SETTINGS.backgroundSpeed)
  return s
}

/** Bump when a default changes in a way saved settings should follow (see migrateSettings). */
export const SETTINGS_VERSION = 4

/**
 * One-time upgrade of saved settings. Settings files store every value, so a value equal to an
 * old default means "never changed": move it to the new default and keep anything custom.
 * v2: Bloop reacts right away (nudge 60 → 0 s), notifies sooner (180 → 120 s) and samples
 * every 2 s instead of 5 s. v3: first reminder after 60 s (120 → 60 s).
 */
export function migrateSettings(stored: Partial<Settings> | undefined | null, fromVersion: number): Partial<Settings> | undefined | null {
  if (!stored || typeof stored !== 'object' || fromVersion >= SETTINGS_VERSION) return stored
  const next: Partial<Settings> = { ...stored }
  if (fromVersion < 2) {
    if (Number(next.nudgeAfterSec) === 60) next.nudgeAfterSec = 0
    if (Number(next.notifyAfterSec) === 180) next.notifyAfterSec = 120
    if (Number(next.sampleIntervalSec) === 5) next.sampleIntervalSec = 2
  }
  // v3: the first reminder (bubble + notification) comes after 1 min, then every
  // nudgeCooldownSec ("Remind again every", default 120 s, unchanged).
  if (fromVersion < 3 && Number(next.notifyAfterSec) === 120) next.notifyAfterSec = 60
  // v4: a cloud AI the user set up judges unclear pages automatically (was opt-in).
  if (fromVersion < 4) next.cloudJudge = true
  return next
}

// Guard the shared defaults against accidental mutation (mergeSettings hands out copies).
for (const k of ['focusApps', 'distractApps', 'focusDomains', 'distractDomains', 'contentDomains', 'reminders'] as const) Object.freeze(DEFAULT_SETTINGS[k])
