// App-wide Electron hardening: trusted-sender checks for IPC, navigation / window-open / webview
// lockdown and a deny-by-default permission handler. Lives under ai/ because it started with the AI
// IPC; main/index.ts should use guardSender() for its own handlers too (see docs/PRIVACY.md).
//
// The URL logic is pure (no electron import) so tests can import it directly; the electron
// wiring functions take the objects they need as arguments.
import { join, posix, win32 } from 'node:path'
import { fileURLToPath } from 'node:url'

export interface TrustedOrigins {
  /** Absolute path of the packaged renderer entry (…/out/renderer/index.html, inside app.asar when packaged). */
  rendererIndex: string
  /** Vite dev server URL (ELECTRON_RENDERER_URL). Only honoured when `packaged` is false. */
  devUrl?: string
  packaged: boolean
  platform?: NodeJS.Platform
}

/** True only for https URLs (no credentials, sane length). Used for openExternal and window.open. */
export function isSafeExternalUrl(raw: unknown): raw is string {
  if (typeof raw !== 'string' || raw.length > 2048) return false
  try {
    const u = new URL(raw)
    return u.protocol === 'https:' && !u.username && !u.password && Boolean(u.hostname)
  } catch {
    return false
  }
}

/** Is `url` our own renderer (the packaged index.html, or the dev server in development)? */
export function isTrustedRendererUrl(url: string | null | undefined, o: TrustedOrigins): boolean {
  if (!url) return false
  let u: URL
  try {
    u = new URL(url)
  } catch {
    return false
  }
  if (u.protocol === 'file:') {
    const win = (o.platform ?? process.platform) === 'win32'
    const P = win ? win32 : posix
    let p: string
    try {
      p = fileURLToPath(u, { windows: win })
    } catch {
      return false
    }
    if (!P.isAbsolute(o.rendererIndex)) return false
    const a = P.normalize(p)
    const b = P.normalize(o.rendererIndex)
    return win ? a.toLowerCase() === b.toLowerCase() : a === b
  }
  if (!o.packaged && o.devUrl) {
    try {
      const dev = new URL(o.devUrl)
      return (u.protocol === 'http:' || u.protocol === 'https:') && u.origin === dev.origin
    } catch {
      return false
    }
  }
  return false
}

/** The renderer entry for an app root (app.getAppPath()). */
export function rendererIndexFor(appPath: string): string {
  return join(appPath, 'out', 'renderer', 'index.html')
}

// ---------------------------------------------------------------- electron wiring

/** Minimal shape of IpcMainInvokeEvent we rely on (keeps this file testable without electron). */
export interface SenderLike {
  senderFrame?: { url: string; parent: unknown } | null
}

/** True when an IPC message comes from the top frame of our own renderer. */
export function isTrustedSender(e: SenderLike, o: TrustedOrigins): boolean {
  const f = e.senderFrame
  if (!f) return false // frame navigated away or was destroyed
  if (f.parent) return false // never trust subframes
  return isTrustedRendererUrl(f.url, o)
}

export class UntrustedSenderError extends Error {
  constructor(channel: string) {
    super(`Blocked IPC "${channel}" from an untrusted sender.`)
    this.name = 'UntrustedSenderError'
  }
}

/** Throws unless the sender is our renderer. Call first in every ipcMain.handle. */
export function guardSender(channel: string, e: SenderLike, o: TrustedOrigins): void {
  if (!isTrustedSender(e, o)) throw new UntrustedSenderError(channel)
}

interface WebContentsLike {
  setWindowOpenHandler(h: (d: { url: string }) => { action: 'deny' }): void
  on(event: 'will-navigate' | 'will-redirect', l: (ev: { preventDefault(): void; url?: string }, url: string) => void): unknown
  on(event: 'will-attach-webview', l: (ev: { preventDefault(): void }) => void): unknown
}

/**
 * Locks a webContents down: window.open / target=_blank → https links open in the system browser,
 * everything else is denied; navigation away from our renderer is blocked; <webview> is refused.
 */
export function hardenWebContents(contents: WebContentsLike, o: TrustedOrigins, openExternal: (url: string) => void): void {
  contents.setWindowOpenHandler(({ url }) => {
    if (isSafeExternalUrl(url)) openExternal(url)
    return { action: 'deny' }
  })
  const block = (ev: { preventDefault(): void }, url: string): void => {
    if (isTrustedRendererUrl(url, o)) return
    ev.preventDefault()
    // A plain <a href="https://…"> click should still open the browser rather than do nothing.
    if (isSafeExternalUrl(url)) openExternal(url)
  }
  contents.on('will-navigate', block)
  contents.on('will-redirect', block)
  contents.on('will-attach-webview', (ev) => ev.preventDefault())
}

interface SessionLike {
  setPermissionRequestHandler(h: ((wc: unknown, permission: string, cb: (granted: boolean) => void) => void) | null): void
  setPermissionCheckHandler(h: ((wc: unknown, permission: string) => boolean) | null): void
  setDevicePermissionHandler?(h: ((d: unknown) => boolean) | null): void
}

/** The renderer needs no web permissions (notifications are shown from main). Deny everything. */
export function denyAllPermissions(session: SessionLike): void {
  session.setPermissionRequestHandler((_wc, _permission, cb) => cb(false))
  session.setPermissionCheckHandler(() => false)
  session.setDevicePermissionHandler?.(() => false)
}
