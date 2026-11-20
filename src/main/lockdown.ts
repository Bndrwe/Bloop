// Lockdown: pick one app or website and a length; while it runs, anything else in front gets
// covered by Bloop's full-screen lockdown screen. No electron imports: the cover window, the
// "take me back" activation and the clock are injected, so it can be driven with a fake clock.
//
// Escape hatches (on purpose): "Hold to end" (10 s) on the cover and in the panel, and quitting
// Bloop always ends a lockdown (it is never saved, so it does not come back after a restart).
import { EventEmitter } from 'node:events'
import type { LockdownStatus, LockTarget, LockTargetInput } from '@shared/types'
import { appPatternScore, domainFromUrl, domainPatternScore, isBrowser, normalizeAppName, resolveDomain } from './classifier'
import type { RawActive } from './tracker'
import { LOCKDOWN_MAX_MINUTES, LOCKDOWN_MIN_MINUTES } from '@shared/lockdown'

export { LOCKDOWN_HOLD_SEC, LOCKDOWN_MAX_MINUTES, LOCKDOWN_MIN_MINUTES } from '@shared/lockdown'

/** Off the target this long (seconds) before the cover appears: app switching and short dialogs pass. */
export const LOCKDOWN_GRACE_SEC = 2
/** After "Take me back", the cover stays down this long so the target can come to the front. */
export const LOCKDOWN_RETURN_GRACE_SEC = 8

/** Front "apps" that mean nobody is at the computer (lock screen, screen saver): never covered. */
const AWAY_APPS = /^(loginwindow|screensaverengine|lockapp|windows default lock screen)$/i

/** Host labels too generic to identify a site from a window title. */
const GENERIC_LABELS = new Set(['www', 'com', 'org', 'net', 'edu', 'app', 'web', 'online', 'site', 'home', 'login', 'docs', 'mail'])

/**
 * Is `raw` the lockdown target? null = can't tell (no sample), which never brings the cover up.
 * - app: the front app's name matches (case-insensitive, ".exe" ignored, or contains it as a word).
 * - site: a browser is in front on that site or a subdomain (from the URL, or the window title when
 *   the URL can't be read). Without a URL, a distinctive host label in the title counts
 *   ("khanacademy" for khanacademy.org, "google" for docs.google.com).
 */
export function matchesTarget(raw: RawActive | null, target: LockTarget): boolean | null {
  if (!raw || !raw.app) return null
  if (target.kind === 'app') return appPatternScore(target.app, raw.app) > 0
  if (!isBrowser(raw.app)) return false
  const domain = resolveDomain(raw)
  if (domain) return domainPatternScore(target.domain, domain) > 0
  const title = (raw.title ?? '').toLowerCase()
  if (!title) return false
  return siteLabels(target.domain).some((l) => title.includes(l))
}

/** Distinctive labels of a host, e.g. "docs.google.com" -> ["google"]. */
export function siteLabels(domain: string): string[] {
  const labels = domain.toLowerCase().split('.').filter(Boolean)
  const body = labels.length > 1 ? labels.slice(0, -1) : labels
  return body.filter((l) => l.length >= 4 && !GENERIC_LABELS.has(l))
}

/**
 * Validate what the renderer sent. Returns a clean target, or an error for the user.
 * A site is anything that parses as a web host ("docs.google.com", "https://x.org/path");
 * everything else is an app name.
 */
export function parseTarget(input: unknown, selfNames: string[]): { ok: true; value: LockTarget } | { ok: false; error: string } {
  if (!input || typeof input !== 'object') return { ok: false, error: 'Pick an app or a website.' }
  const i = input as Partial<LockTargetInput>
  const text = typeof i.value === 'string' ? i.value.trim().slice(0, 200) : ''
  if (!text) return { ok: false, error: 'Pick an app or a website.' }
  const appPath = typeof i.appPath === 'string' && i.appPath.length <= 1024 ? i.appPath : undefined
  const kind = i.kind === 'app' || i.kind === 'site' ? i.kind : looksLikeSite(text) ? 'site' : 'app'
  if (kind === 'site') {
    const domain = domainFromUrl(text)
    if (!domain || !domain.includes('.') || /\s/.test(domain)) return { ok: false, error: `“${text}” isn’t a website address.` }
    return { ok: true, value: { kind: 'site', domain, label: domain } }
  }
  const app = text.replace(/[\u0000-\u001f]/g, '')
  if (selfNames.some((n) => normalizeAppName(n) === normalizeAppName(app))) {
    return { ok: false, error: 'Lock to the app you want to work in, not Bloop itself.' }
  }
  if (isBrowser(app)) {
    // fine: the whole browser, any site (say so in the label)
    return { ok: true, value: { kind: 'app', app, label: `${app} (any site)`, ...(appPath ? { appPath } : {}) } }
  }
  return { ok: true, value: { kind: 'app', app, label: app, ...(appPath ? { appPath } : {}) } }
}

/** App names passed to a (shell-free) command line to bring the app back; anything odd is refused. */
export const SAFE_APP_NAME = /^[\p{L}\p{N} ._()+&'-]{1,120}$/u

/** The PowerShell to focus the first window of a process (Windows). `name` must pass SAFE_NAME. */
export function windowsActivateScript(name: string): string {
  const n = name.replace(/'/g, "''")
  return (
    `$p = Get-Process -Name '${n}' -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne 0 } | Select-Object -First 1; ` +
    `if ($p) { (New-Object -ComObject WScript.Shell).AppActivate($p.Id) | Out-Null }`
  )
}

export function looksLikeSite(text: string): boolean {
  const t = text.trim()
  if (/^https?:\/\//i.test(t)) return true
  return !/\s/.test(t) && /^[a-z0-9-]+(\.[a-z0-9-]+)+(\/.*)?$/i.test(t) && !/\.(app|exe)$/i.test(t)
}

export function clampMinutes(m: unknown): number | null {
  const n = typeof m === 'number' ? m : Number(m)
  if (!Number.isFinite(n)) return null
  const r = Math.round(n)
  if (r < LOCKDOWN_MIN_MINUTES || r > LOCKDOWN_MAX_MINUTES) return null
  return r
}

/** What was in front recently, offered as quick picks in the panel. In memory only. */
export class RecentTargets {
  private items: LockTargetInput[] = []
  constructor(
    private readonly selfNames: string[],
    private readonly max = 8
  ) {}

  observe(raw: RawActive | null): void {
    if (!raw || !raw.app || AWAY_APPS.test(raw.app.trim())) return
    if (this.selfNames.some((n) => normalizeAppName(n) === normalizeAppName(raw.app))) return
    const domain = isBrowser(raw.app) ? domainFromUrl(raw.url) : undefined
    const item: LockTargetInput = domain
      ? { kind: 'site', value: domain }
      : { kind: 'app', value: raw.app, ...(raw.appPath ? { appPath: raw.appPath } : {}) }
    const key = (t: LockTargetInput): string => `${t.kind}:${t.value.toLowerCase()}`
    this.items = [item, ...this.items.filter((t) => key(t) !== key(item))].slice(0, this.max)
  }

  list(): LockTargetInput[] {
    return this.items.map((t) => ({ ...t }))
  }
}

export interface LockdownDeps {
  now?: () => number
  setInterval?: (fn: () => void, ms: number) => unknown
  clearInterval?: (h: unknown) => void
  sample: () => Promise<RawActive | null>
  /** Show or hide the full-screen cover. */
  setCovered: (covered: boolean) => void
  /** Bring the target to the front (best effort). */
  activate: (target: LockTarget) => void
  notify?: (title: string, body: string) => void
  /** Front-app names that are Bloop itself (the cover, the panel): they never change anything. */
  selfNames?: string[]
  log?: (m: string) => void
}

export class Lockdown extends EventEmitter {
  private readonly d: Required<Omit<LockdownDeps, 'notify'>> & Pick<LockdownDeps, 'notify'>
  private target: LockTarget | null = null
  private startedAt = 0
  private endsAt = 0
  private covered = false
  private offSince: number | null = null
  private returnUntil = 0
  private ticker: unknown = null
  private sampling = false

  constructor(deps: LockdownDeps) {
    super()
    this.d = {
      now: () => Date.now(),
      setInterval: (fn, ms) => setInterval(fn, ms),
      clearInterval: (h) => clearInterval(h as ReturnType<typeof setInterval>),
      selfNames: ['Bloop'],
      log: (m) => console.log(`[bloop] ${m}`),
      ...deps
    } as Lockdown['d']
  }

  isActive(): boolean {
    return this.target !== null
  }

  /** The target while a lockdown runs (the score counts it as focus). */
  activeTarget(): LockTarget | null {
    return this.target
  }

  status(): LockdownStatus {
    if (!this.target) return { active: false, covered: false }
    const now = this.d.now()
    return {
      active: true,
      covered: this.covered,
      target: { ...this.target },
      startedAt: this.startedAt,
      endsAt: this.endsAt,
      remainingSec: Math.max(0, Math.ceil((this.endsAt - now) / 1000))
    }
  }

  start(target: LockTarget, minutes: number): LockdownStatus {
    const now = this.d.now()
    this.target = target
    this.startedAt = now
    this.endsAt = now + minutes * 60_000
    this.offSince = null
    this.returnUntil = now + LOCKDOWN_RETURN_GRACE_SEC * 1000
    this.setCovered(false)
    this.d.log(`lockdown started (${target.kind}, ${minutes} min)`)
    if (!this.ticker) this.ticker = this.d.setInterval(() => this.tick(), 1000)
    this.d.activate(target)
    this.emitStatus()
    return this.status()
  }

  stop(reason: 'ended' | 'done' | 'quit' = 'ended'): LockdownStatus {
    if (!this.target) return this.status()
    this.d.log(`lockdown ${reason === 'done' ? 'finished' : 'ended early'}`)
    const label = this.target.label
    this.target = null
    this.offSince = null
    if (this.ticker) {
      this.d.clearInterval(this.ticker)
      this.ticker = null
    }
    this.setCovered(false)
    if (reason === 'done') this.d.notify?.('Lockdown finished', `You stayed on ${label}. Nice work!`)
    this.emitStatus()
    return this.status()
  }

  /** "Take me back": lower the cover for a moment and bring the target to the front. */
  goBack(): void {
    if (!this.target) return
    this.returnUntil = this.d.now() + LOCKDOWN_RETURN_GRACE_SEC * 1000
    this.offSince = null
    this.setCovered(false)
    this.d.activate(this.target)
    this.emitStatus()
  }

  /** One second of lockdown: end it when time is up, else check what is in front. Public for tests. */
  tick(): void {
    if (!this.target) return
    if (this.d.now() >= this.endsAt) {
      this.stop('done')
      return
    }
    this.emitStatus()
    if (this.sampling) return
    this.sampling = true
    this.d
      .sample()
      .catch(() => null)
      .then((raw) => {
        this.sampling = false
        this.observe(raw)
      })
  }

  /** Decide from one sample whether the cover should be up. Public for tests. */
  observe(raw: RawActive | null): void {
    if (!this.target) return
    const now = this.d.now()
    if (!raw || !raw.app) return // can't tell: leave things as they are
    const app = raw.app.trim()
    if (AWAY_APPS.test(app)) return // locked screen / screen saver
    if (this.d.selfNames.some((n) => normalizeAppName(n) === normalizeAppName(app))) return // the cover or the panel
    const on = matchesTarget(raw, this.target)
    if (on === null) return
    if (on) {
      this.offSince = null
      this.returnUntil = 0
      this.setCovered(false)
      return
    }
    if (now < this.returnUntil) return // on the way back after "Take me back" / start
    if (this.offSince === null) this.offSince = now
    if (now - this.offSince >= LOCKDOWN_GRACE_SEC * 1000) this.setCovered(true)
  }

  dispose(): void {
    this.stop('quit')
  }

  private setCovered(covered: boolean): void {
    if (this.covered === covered) return
    this.covered = covered
    this.d.setCovered(covered)
    this.emitStatus()
  }

  private emitStatus(): void {
    this.emit('status', this.status())
  }
}
