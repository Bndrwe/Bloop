// Linux desktop helpers. No electron imports so everything here is unit-testable.
import { accessSync, constants, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { delimiter, join } from 'node:path'

export type SessionType = 'x11' | 'wayland' | 'unknown'

type Env = Record<string, string | undefined>

/** X11 vs Wayland, from XDG_SESSION_TYPE with WAYLAND_DISPLAY / DISPLAY as fallbacks. */
export function detectSessionType(env: Env = process.env): SessionType {
  const t = (env['XDG_SESSION_TYPE'] ?? '').toLowerCase()
  if (t === 'wayland') return 'wayland'
  if (t === 'x11') return 'x11'
  if (env['WAYLAND_DISPLAY']) return 'wayland'
  if (env['DISPLAY']) return 'x11'
  return 'unknown'
}

/** True when XDG_CURRENT_DESKTOP (a colon-separated list, e.g. "ubuntu:GNOME") includes GNOME. */
export function isGnomeDesktop(env: Env = process.env): boolean {
  return (env['XDG_CURRENT_DESKTOP'] ?? '').split(':').some((d) => d.trim().toUpperCase() === 'GNOME')
}

/** True if `name` is an executable file in one of the PATH directories. */
export function hasBinary(name: string, env: Env = process.env): boolean {
  for (const dir of (env['PATH'] ?? '').split(delimiter)) {
    if (!dir) continue
    try {
      accessSync(join(dir, name), constants.X_OK)
      return true
    } catch {
      /* keep looking */
    }
  }
  return false
}

export interface LinuxTrackingInfo {
  session: SessionType
  /** Wayland: get-windows only sees XWayland clients, so native Wayland apps read as "unknown". */
  limited: boolean
  /** Missing tools from `xprop` / `xwininfo` (both ship in x11-utils). */
  missingTools: string[]
  /** One-line, user-facing description for the log (and for a future PermissionStatus note). */
  note: string
}

export function linuxTrackingInfo(env: Env = process.env, has: (n: string) => boolean = (n) => hasBinary(n, env)): LinuxTrackingInfo {
  const session = detectSessionType(env)
  const missingTools = ['xprop', 'xwininfo'].filter((t) => !has(t))
  const limited = session === 'wayland'
  let note: string
  if (session === 'unknown' && !env['DISPLAY']) note = 'no display session detected: active-window tracking is off'
  else if (missingTools.length) note = `${missingTools.join(' and ')} not found: install x11-utils (sudo apt install x11-utils / sudo dnf install xorg-x11-utils)`
  else if (limited) note = 'Wayland session: active-window tracking is limited to XWayland apps; native Wayland apps will not be seen. Use an X11 session for full tracking'
  else note = 'X11 session: active-window tracking available'
  return { session, limited, missingTools, note }
}

/** Log-line rate limiter: each key is logged at most once per `intervalMs`; suppressed repeats are counted. */
export function createRateLimitedLog(sink: (m: string) => void, intervalMs = 10 * 60_000, now: () => number = Date.now) {
  const last = new Map<string, { at: number; suppressed: number }>()
  return (key: string, message: string): boolean => {
    const t = now()
    const e = last.get(key)
    if (e && t - e.at < intervalMs) {
      e.suppressed++
      return false
    }
    sink(e && e.suppressed ? `${message} (${e.suppressed} similar suppressed)` : message)
    last.set(key, { at: t, suppressed: 0 })
    return true
  }
}

/** Short stable key for an error, so "xprop ENOENT" and "timeout" are rate-limited separately. */
export function classifyTrackerError(err: unknown): 'missing-xprop' | 'no-display' | 'timeout' | 'other' {
  const e = err as NodeJS.ErrnoException & { killed?: boolean; stderr?: string }
  const text = `${e?.code ?? ''} ${e?.message ?? ''} ${e?.stderr ?? ''}`
  if (/ENOENT/.test(text) && /xprop|xwininfo/.test(text)) return 'missing-xprop'
  if (/cannot open display|unable to open display|No protocol specified/i.test(text)) return 'no-display'
  if (e?.killed || /ETIMEDOUT|timed out/i.test(text)) return 'timeout'
  return 'other'
}

// ------------------------------------------------------------------ autostart

/** Quote one Exec argument per the Desktop Entry spec (double quotes; \ " ` $ escaped; % doubled). */
export function quoteExecArg(arg: string): string {
  // A literal backslash is `\\` in the Exec grammar, which the string-value rules double again.
  const inner = arg
    .replace(/[\\"`$]/g, (c) => (c === '\\' ? '\\\\\\\\' : `\\${c}`))
    .replace(/%/g, '%%')
  return `"${inner}"`
}

export interface AutostartOptions {
  env?: Env
  /** Defaults to os.homedir(). */
  home?: string
  /** Defaults to process.execPath. */
  execPath?: string
  /** Extra arguments after the executable. */
  args?: string[]
  name?: string
}

export function autostartFilePath(opts: AutostartOptions = {}): string {
  const env = opts.env ?? process.env
  const xdg = env['XDG_CONFIG_HOME']
  const base = xdg && xdg.startsWith('/') ? xdg : join(opts.home ?? homedir(), '.config')
  return join(base, 'autostart', 'bloop.desktop')
}

export function autostartContents(opts: AutostartOptions = {}): string {
  const env = opts.env ?? process.env
  // AppImage: the .AppImage file (process.execPath points into a temporary mount).
  const exe = env['APPIMAGE'] || opts.execPath || process.execPath
  const exec = [exe, ...(opts.args ?? [])].map(quoteExecArg).join(' ')
  return [
    '[Desktop Entry]',
    'Type=Application',
    `Name=${opts.name ?? 'Bloop'}`,
    'Comment=Your little study pet',
    `Exec=${exec}`,
    'Terminal=false',
    'X-GNOME-Autostart-enabled=true',
    ''
  ].join('\n')
}

/** Write or remove ~/.config/autostart/bloop.desktop (honours XDG_CONFIG_HOME). Returns the file path. */
export function setLinuxAutostart(enabled: boolean, opts: AutostartOptions = {}): string {
  const file = autostartFilePath(opts)
  if (!enabled) {
    rmSync(file, { force: true })
    return file
  }
  mkdirSync(join(file, '..'), { recursive: true })
  writeFileSync(file, autostartContents(opts), { mode: 0o644 })
  return file
}
