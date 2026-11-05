import type { Reminder, Settings } from '@shared/types'
import { clampPercent, DEFAULT_BACKGROUND_INTENSITY, DEFAULT_BACKGROUND_SPEED } from '@shared/background'

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
  distractApps: ['Messages', 'Discord', 'Spotify', 'Steam', 'WhatsApp', 'FaceTime'],
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
  nudgeAfterSec: 60,
  notifyAfterSec: 180,
  nudgeCooldownSec: 120,
  focusMinutes: 25,
  breakMinutes: 5,
  sampleIntervalSec: 5,
  reminders: [],
  launchAtLogin: false,
  icalUrl: '',
  backgroundEnabled: true,
  backgroundIntensity: DEFAULT_BACKGROUND_INTENSITY,
  backgroundSpeed: DEFAULT_BACKGROUND_SPEED,
  backgroundInteractive: true
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
      label: typeof o.label === 'string' ? o.label : '',
      enabled: typeof o.enabled === 'boolean' ? o.enabled : true
    })
  }
  return out
}

/** Merge a (possibly partial / stale) stored settings object with defaults. Always returns fresh arrays. */
export function mergeSettings(stored: Partial<Settings> | undefined | null): Settings {
  const s = { ...DEFAULT_SETTINGS, ...(stored ?? {}) }
  for (const k of ['focusApps', 'distractApps', 'focusDomains', 'distractDomains'] as const) {
    s[k] = cleanList(s[k], DEFAULT_SETTINGS[k])
  }
  s.reminders = cleanReminders(s.reminders)
  s.icalUrl = typeof s.icalUrl === 'string' ? s.icalUrl : ''
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
    s[k] = Number.isFinite(v) && v > 0 ? v : DEFAULT_SETTINGS[k]
  }
  for (const k of ['backgroundEnabled', 'backgroundInteractive'] as const) {
    if (typeof s[k] !== 'boolean') s[k] = DEFAULT_SETTINGS[k]
  }
  s.backgroundIntensity = clampPercent(s.backgroundIntensity, DEFAULT_SETTINGS.backgroundIntensity)
  s.backgroundSpeed = clampPercent(s.backgroundSpeed, DEFAULT_SETTINGS.backgroundSpeed)
  return s
}

// Guard the shared defaults against accidental mutation (mergeSettings hands out copies).
for (const k of ['focusApps', 'distractApps', 'focusDomains', 'distractDomains', 'reminders'] as const) Object.freeze(DEFAULT_SETTINGS[k])
