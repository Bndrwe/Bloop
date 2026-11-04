import type { Settings } from '@shared/types'

export const DEFAULT_SETTINGS: Settings = {
  focusApps: [
    'Code',
    'Visual Studio Code',
    'Cursor',
    'Terminal',
    'iTerm2',
    'Notion',
    'Microsoft Word',
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
  icalUrl: ''
}

/** Merge a (possibly partial / stale) stored settings object with defaults. */
export function mergeSettings(stored: Partial<Settings> | undefined | null): Settings {
  const s = { ...DEFAULT_SETTINGS, ...(stored ?? {}) }
  // Defensive: make sure arrays stay arrays and numbers stay sane.
  for (const k of ['focusApps', 'distractApps', 'focusDomains', 'distractDomains', 'reminders'] as const) {
    if (!Array.isArray(s[k])) (s as Record<string, unknown>)[k] = DEFAULT_SETTINGS[k]
  }
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
  return s
}
