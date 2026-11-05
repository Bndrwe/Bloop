// Pure classification logic: no electron imports (unit-tested in tests/classifier.test.ts).
import type { Category, Settings } from '@shared/types'
import { cleanTitle, inferDomainFromTitle } from './titleDomain'

export type ClassifyLists = Pick<Settings, 'focusApps' | 'distractApps' | 'focusDomains' | 'distractDomains'>

export interface ClassifyInput {
  app: string
  url?: string
  title?: string
}

/**
 * The site being viewed: the URL's host when known, otherwise (browsers only, e.g. Windows or
 * macOS without Automation) a domain inferred from the window title.
 */
export function resolveDomain(input: ClassifyInput): string | undefined {
  const fromUrl = domainFromUrl(input.url)
  if (fromUrl) return fromUrl
  if (input.title && isBrowser(input.app)) return inferDomainFromTitle(input.title)
  return undefined
}

/** Owner names of browsers we know about (macOS names first, then common Linux/Windows ones). */
export const BROWSER_APPS = [
  'Google Chrome',
  'Arc',
  'Safari',
  'Brave Browser',
  'Microsoft Edge',
  'Firefox',
  'Mozilla Firefox',
  'Chromium',
  'Opera',
  'Vivaldi',
  // Linux / Windows owner names
  'google-chrome',
  'chrome',
  'firefox',
  'chromium',
  'chromium-browser',
  'brave',
  'brave-browser',
  'msedge',
  'microsoft-edge'
]

/** Executable basename (no directory, no ".exe", lowercased) from a Windows or POSIX path. */
export function exeBasename(path: string | undefined | null): string {
  if (!path) return ''
  const base = path.trim().split(/[\\/]/).pop() ?? ''
  return base.toLowerCase().replace(/\.exe$/, '')
}

/** exe basename -> the canonical app name used in the default focus/distract lists. */
const EXE_APP_NAMES: Record<string, string> = {
  chrome: 'Google Chrome',
  msedge: 'Microsoft Edge',
  firefox: 'Mozilla Firefox',
  brave: 'Brave Browser',
  arc: 'Arc',
  opera: 'Opera',
  vivaldi: 'Vivaldi',
  chromium: 'Chromium',
  code: 'Visual Studio Code',
  'code - insiders': 'Visual Studio Code',
  cursor: 'Cursor',
  windowsterminal: 'Windows Terminal',
  wt: 'Windows Terminal',
  powershell: 'PowerShell',
  pwsh: 'PowerShell',
  cmd: 'Command Prompt',
  conhost: 'Command Prompt',
  openconsole: 'Command Prompt',
  winword: 'Microsoft Word',
  acrord32: 'Adobe Acrobat',
  acrobat: 'Adobe Acrobat',
  notion: 'Notion',
  obsidian: 'Obsidian',
  rstudio: 'RStudio',
  discord: 'Discord',
  spotify: 'Spotify',
  steam: 'Steam',
  whatsapp: 'WhatsApp'
}

/** Owner names that say nothing about the app (a UWP frame, a shell host, a generic runtime). */
const GENERIC_OWNER = /^(unknown|electron|application ?frame ?host|host process for windows tasks|console window host|windows? default lock screen)$/i

export interface NativeOwner {
  name?: string
  path?: string
}

/**
 * Make a get-windows result usable on Windows. The owner name there comes from the exe's version
 * info and is sometimes the bare exe name ("chrome", "Code.exe") or empty, so fall back to the exe
 * basename in owner.path. UWP apps are hosted by ApplicationFrameHost.exe and their real name is the
 * window title ("Calculator"), so the title is used as the app name.
 */
export function normalizeOwner(owner: NativeOwner | undefined, title: string): { app: string; title: string } {
  const name = (owner?.name ?? '').trim()
  const exe = exeBasename(owner?.path)
  const t = cleanTitle(title)
  if (exe === 'applicationframehost' || (!exe && /^application ?frame ?host$/i.test(name))) {
    return { app: t.trim() || 'Application Frame Host', title: t }
  }
  const mapped = EXE_APP_NAMES[exe]
  const nameIsExe = !!name && normalizeAppName(name) === exe
  if (mapped && (!name || nameIsExe || GENERIC_OWNER.test(name))) return { app: mapped, title: t }
  if (!name && exe) return { app: owner?.path ? (owner.path.split(/[\\/]/).pop() ?? exe).replace(/\.exe$/i, '') : exe, title: t }
  return { app: name, title: t }
}

/** Lowercased app name without a Windows ".exe" suffix. */
export function normalizeAppName(app: string): string {
  return app.trim().toLowerCase().replace(/\.exe$/, '')
}

export function isBrowser(app: string): boolean {
  const a = normalizeAppName(app)
  if (!a) return false
  return (
    BROWSER_APPS.some((b) => b.toLowerCase() === a) ||
    /^(google chrome|mozilla firefox|firefox|safari|brave|microsoft edge|opera|vivaldi)\b/.test(a)
  )
}

/** Hostname of a URL, lowercased, without a leading "www.". Returns undefined if not parseable. */
export function domainFromUrl(url: string | undefined | null): string | undefined {
  if (!url) return undefined
  let u = url.trim()
  if (!u) return undefined
  if (!/^[a-z][a-z0-9+.-]*:/i.test(u)) u = 'https://' + u
  try {
    const host = new URL(u).hostname.toLowerCase().replace(/\.$/, '')
    if (!host) return undefined
    return host.replace(/^www\./, '')
  } catch {
    return undefined
  }
}

function pathFromUrl(url: string): string {
  let u = url.trim()
  if (!/^[a-z][a-z0-9+.-]*:/i.test(u)) u = 'https://' + u
  try {
    return new URL(u).pathname.toLowerCase()
  } catch {
    return '/'
  }
}

function normalizePattern(p: string): { host: string; path: string } {
  let s = p.trim().toLowerCase()
  s = s.replace(/^[a-z][a-z0-9+.-]*:\/\//, '').replace(/^www\./, '').replace(/\/+$/, '')
  const slash = s.indexOf('/')
  if (slash === -1) return { host: s, path: '' }
  return { host: s.slice(0, slash), path: s.slice(slash) }
}

/**
 * Returns a specificity score (>0) when `pattern` matches the host (+path), or 0 when it does not.
 * - exact host or subdomain ("youtube.com" matches "m.youtube.com")
 * - dot-less pattern of >= 3 chars matches a non-TLD hostname label ("brightspace" matches
 *   "purdue.brightspace.com"); shorter dot-less patterns must match the host exactly.
 * - an optional path prefix ("github.com/orgs") must also match.
 */
export function domainPatternScore(pattern: string, host: string, path = '/'): number {
  const { host: ph, path: pp } = normalizePattern(pattern)
  if (!ph) return 0
  // dot-less patterns never suffix-match (so "com" doesn't match every .com site)
  let hostOk = host === ph || (ph.includes('.') && host.endsWith('.' + ph))
  if (!hostOk && !ph.includes('.') && ph.length >= 3) {
    const labels = host.split('.')
    hostOk = labels.slice(0, -1).includes(ph)
  }
  if (!hostOk) return 0
  if (pp && !(path === pp || path.startsWith(pp.endsWith('/') ? pp : pp + '/') || path.startsWith(pp + '?'))) return 0
  return ph.length + pp.length
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** Specificity score (>0) if the app owner name matches the pattern (equal, or contains it as a word). */
export function appPatternScore(pattern: string, app: string): number {
  const p = normalizeAppName(pattern)
  const a = normalizeAppName(app)
  if (!p || !a) return 0
  if (a === p) return p.length + 1000 // exact match beats any partial match
  const re = new RegExp('(^|[^a-z0-9])' + escapeRe(p) + '([^a-z0-9]|$)')
  return re.test(a) ? p.length : 0
}

function best(patterns: string[], score: (p: string) => number): number {
  let b = 0
  for (const p of patterns) b = Math.max(b, score(p))
  return b
}

function decide(focus: number, distract: number): Category {
  if (focus === 0 && distract === 0) return 'neutral'
  // longest (most specific) match wins; ties go to distract
  return focus > distract ? 'focus' : 'distract'
}

/**
 * Title fallback for browsers when no URL is available (e.g. Automation not granted):
 * the main label of each domain pattern ("youtube" from "youtube.com") must appear as a word in the title.
 */
function titlePatternScore(pattern: string, title: string): number {
  const { host } = normalizePattern(pattern)
  const labels = host.split('.')
  const main = labels.length > 1 ? labels[labels.length - 2] : labels[0]
  // only distinctive words; "x", "docs", "google" etc. are too ambiguous for titles
  if (!main || main.length < 5 || main === 'google') return 0
  const re = new RegExp('(^|[^a-z0-9])' + escapeRe(main) + '([^a-z0-9]|$)')
  return re.test(title.toLowerCase()) ? main.length : 0
}

export function classify(input: ClassifyInput, lists: ClassifyLists): Category {
  const domain = resolveDomain(input)
  if (domain) {
    const path = domainFromUrl(input.url) ? pathFromUrl(input.url as string) : '/'
    return decide(
      best(lists.focusDomains, (p) => domainPatternScore(p, domain, path)),
      best(lists.distractDomains, (p) => domainPatternScore(p, domain, path))
    )
  }
  if (isBrowser(input.app)) {
    // A browser without a URL: never classify the browser itself as focus; try the title.
    const title = input.title ?? ''
    if (!title) return 'neutral'
    return decide(
      best(lists.focusDomains, (p) => titlePatternScore(p, title)),
      best(lists.distractDomains, (p) => titlePatternScore(p, title))
    )
  }
  return decide(
    best(lists.focusApps, (p) => appPatternScore(p, input.app)),
    best(lists.distractApps, (p) => appPatternScore(p, input.app))
  )
}
