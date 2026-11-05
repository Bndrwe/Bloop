// Electron side of "Log in to Brightspace": the login window, its isolated session partition,
// the sync schedule and the status pushed to Bloop's windows. The API client and every policy
// decision are pure and live in brightspace.ts (unit-tested).
//
// Security model (see docs/PRIVACY.md):
// - The login window is a plain browser window on the `persist:brightspace` partition: no preload,
//   contextIsolation, sandbox, no node, no <webview>. It can't reach Bloop's IPC (guardSender only
//   trusts Bloop's own renderer URL) and Bloop's windows never use this partition.
// - Only webContents on that partition get the login navigation policy (any https page, for SSO);
//   every other webContents keeps the strict global guard from ai/guard.ts.
// - Bloop never sees the password. It keeps only the cookies Brightspace sets, inside the partition.
import { BrowserWindow, session, type Session, type WebContents } from 'electron'
import type { BrightspaceStatus, Result } from '@shared/types'
import {
  BRIGHTSPACE_PARTITION,
  BrightspaceClient,
  BrightspaceError,
  LOGIN_ALLOWED_PERMISSIONS,
  allowLocalBrightspace,
  friendlyError,
  isLoginSuccessUrl,
  navigationDecision,
  normalizeBrightspaceHost
} from './brightspace'
import { setSourceDeadlines } from './deadlines'
import * as store from './store'

const log = (m: string): void => console.log(`[bloop] brightspace: ${m}`)

const LOGIN_TIMEOUT_MS = 10 * 60_000
const REFRESH_EVERY_MS = 2 * 60 * 60_000
const MAX_POPUPS = 4

// ------------------------------------------------------------------ session + policy

let ses: Session | null = null

/** The isolated session for Brightspace (cookies persist in userData/Partitions/brightspace). */
export function brightspaceSession(): Session {
  if (ses) return ses
  const s = session.fromPartition(BRIGHTSPACE_PARTITION)
  // Camera, microphone, location, notifications, MIDI, HID/USB/serial… are denied. Only what SSO
  // pages can reasonably need is allowed (see LOGIN_ALLOWED_PERMISSIONS).
  s.setPermissionRequestHandler((_wc, permission, cb) => cb(LOGIN_ALLOWED_PERMISSIONS.has(permission)))
  s.setPermissionCheckHandler((_wc, permission) => LOGIN_ALLOWED_PERMISSIONS.has(permission))
  s.setDevicePermissionHandler(() => false)
  // No downloads from the login window.
  s.on('will-download', (e, item) => {
    e.preventDefault()
    item.cancel()
  })
  // Some identity providers refuse "embedded" browsers by user agent; look like plain Chromium.
  s.setUserAgent(s.getUserAgent().replace(/\s*Electron\/\S+/i, '').replace(/\s*bloop\/\S+/i, ''))
  ses = s
  return s
}

/** Is this webContents on the Brightspace partition (the login window or one of its SSO popups)? */
export function isBrightspaceContents(contents: WebContents): boolean {
  try {
    return contents.session === brightspaceSession()
  } catch {
    return false
  }
}

const popupCount = new WeakMap<WebContents, number>()

/**
 * Called from app.on('web-contents-created') for webContents on the Brightspace partition, instead
 * of the Bloop guard. Returns true when it handled `contents`.
 */
export function hardenBrightspaceContents(contents: WebContents): boolean {
  if (!isBrightspaceContents(contents)) return false
  const opts = { allowLocal: allowLocalBrightspace() }
  const check = (ev: { preventDefault(): void }, url: string): void => {
    if (navigationDecision(url, 'brightspace-login', opts) !== 'allow') {
      log(`blocked navigation to a non-https URL`)
      ev.preventDefault()
    }
  }
  contents.on('will-navigate', check)
  contents.on('will-redirect', check)
  // Subframes (SSO iframes) too: will-navigate only covers the top frame.
  contents.on('will-frame-navigate', (ev) => check(ev, ev.url))
  contents.on('will-attach-webview', (ev) => ev.preventDefault())
  // SSO popups (e.g. "Sign in with Microsoft" in a new window) stay on the same partition, with
  // the same locked-down preferences, and close with the login window.
  contents.setWindowOpenHandler(({ url }) => {
    const n = popupCount.get(contents) ?? 0
    const parent = BrowserWindow.fromWebContents(contents)
    if (navigationDecision(url, 'brightspace-login', opts) !== 'allow' || n >= MAX_POPUPS || !parent) return { action: 'deny' }
    popupCount.set(contents, n + 1)
    return {
      action: 'allow',
      overrideBrowserWindowOptions: {
        parent,
        width: 520,
        height: 680,
        autoHideMenuBar: true,
        webPreferences: loginWebPreferences()
      }
    }
  })
  return true
}

function loginWebPreferences(): Electron.WebPreferences {
  return {
    partition: BRIGHTSPACE_PARTITION,
    contextIsolation: true,
    sandbox: true,
    nodeIntegration: false,
    nodeIntegrationInSubFrames: false,
    webviewTag: false,
    safeDialogs: true,
    spellcheck: false
  }
}

// ------------------------------------------------------------------ login window

type LoginOutcome = 'success' | 'cancelled' | 'timeout'

let loginWin: BrowserWindow | null = null
let loginPromise: Promise<LoginOutcome> | null = null

function openLoginWindow(origin: string): Promise<LoginOutcome> {
  if (loginWin && !loginWin.isDestroyed() && loginPromise) {
    loginWin.show()
    loginWin.focus()
    return loginPromise
  }
  brightspaceSession() // configure handlers before the first request
  const win = new BrowserWindow({
    width: 980,
    height: 760,
    minWidth: 420,
    minHeight: 480,
    title: 'Log in to Brightspace',
    show: false,
    autoHideMenuBar: true,
    backgroundColor: '#ffffff',
    webPreferences: loginWebPreferences()
  })
  loginWin = win
  loginPromise = new Promise<LoginOutcome>((resolve) => {
    let done = false
    const finish = (o: LoginOutcome): void => {
      if (done) return
      done = true
      clearTimeout(timer)
      loginWin = null
      loginPromise = null
      log(`login window: ${o}`)
      if (!win.isDestroyed()) win.close()
      resolve(o)
    }
    const timer = setTimeout(() => finish('timeout'), LOGIN_TIMEOUT_MS)
    const onNav = (_e: unknown, url: string): void => {
      if (isLoginSuccessUrl(url, origin)) finish('success')
    }
    win.webContents.on('did-navigate', onNav)
    win.webContents.on('did-navigate-in-page', onNav)
    win.on('closed', () => finish('cancelled'))
    win.once('ready-to-show', () => {
      win.show()
      win.focus()
    })
    // keep the page title from replacing ours: the user should know this window is Bloop's
    win.on('page-title-updated', (e) => e.preventDefault())
  })
  void win.loadURL(`${origin}/d2l/login`).catch((e: Error) => log(`login page failed to load: ${e.message}`))
  return loginPromise
}

// ------------------------------------------------------------------ status + sync

let push: (s: BrightspaceStatus) => void = () => undefined
let busy = false

export function getBrightspaceStatus(): BrightspaceStatus {
  const host = store.getSettings().brightspaceHost
  const st = store.getBrightspaceState()
  const same = !!st && st.host === host && !!host
  const items = store.getDeadlinesCache()?.sources?.brightspace ?? []
  const now = Date.now()
  return {
    host,
    connected: same && st!.connected,
    ...(same && st!.expired ? { expired: true } : {}),
    ...(busy ? { busy: true } : {}),
    ...(same && st!.user ? { user: st!.user } : {}),
    ...(same && st!.courseCount != null ? { courseCount: st!.courseCount } : {}),
    ...(same && st!.lastSync ? { lastSync: st!.lastSync } : {}),
    ...(same ? { itemCount: items.filter((d) => (d.end ?? d.start) >= now).length } : {}),
    ...(same && st!.error ? { error: st!.error } : {})
  }
}

function changed(): BrightspaceStatus {
  const s = getBrightspaceStatus()
  push(s)
  return s
}

function client(origin: string): BrightspaceClient {
  const s = brightspaceSession()
  return new BrightspaceClient(origin, (url, init) => s.fetch(url, init))
}

let syncing: Promise<Result<BrightspaceStatus>> | null = null

/** Sync now (single flight). Never runs while not connected. */
export function refreshBrightspace(opts: { afterLogin?: boolean } = {}): Promise<Result<BrightspaceStatus>> {
  if (syncing) return syncing
  const st = store.getBrightspaceState()
  const host = store.getSettings().brightspaceHost
  if (!st || !st.connected || st.host !== host || !host) {
    return Promise.resolve({ ok: false, error: 'Not connected to Brightspace. Log in first.' })
  }
  busy = true
  changed()
  syncing = (async (): Promise<Result<BrightspaceStatus>> => {
    let error: string | null = null
    try {
      const r = await client(host).sync()
      setSourceDeadlines('brightspace', r.items)
      store.setBrightspaceState({
        host,
        connected: true,
        user: r.user.name,
        courseCount: r.courseCount,
        lastSync: Date.now(),
        ...(r.failures ? { error: `Some course items couldn't be loaded (${r.failures}). They'll be retried on the next refresh.` } : {})
      })
      log(`synced: ${r.courseCount} courses, ${r.items.length} upcoming (lp ${r.versions.lp}, le ${r.versions.le})`)
    } catch (e) {
      error = friendlyError(e)
      const expired = e instanceof BrightspaceError && e.kind === 'expired'
      // Logged in a moment ago but whoami says no: the school blocks the API for students.
      if (expired && opts.afterLogin) {
        error =
          "You're logged in, but Brightspace didn't let Bloop read your courses. Some schools turn off API access for students; paste your calendar link below instead."
      }
      log(`sync failed: ${e instanceof BrightspaceError ? `${e.kind} ${e.status ?? ''}` : (e as Error)?.message}`)
      // After login any failure means "not usable"; later, only an expired session disconnects
      // (a network hiccup keeps the connection and the cached items).
      store.setBrightspaceState({
        ...st,
        host,
        connected: !opts.afterLogin && !expired,
        expired: !opts.afterLogin && expired,
        error
      })
    } finally {
      busy = false
      syncing = null
    }
    const status = changed()
    return error == null ? { ok: true, value: status } : { ok: false, error }
  })()
  return syncing
}

export async function loginBrightspace(rawHost: unknown): Promise<Result<BrightspaceStatus>> {
  const h = normalizeBrightspaceHost(rawHost, { allowLocal: allowLocalBrightspace() })
  if (!h.ok) return { ok: false, error: h.error }
  const prev = store.getBrightspaceState()
  // A different school: drop the old login first.
  if (prev && prev.host !== h.origin) await clearSession()
  store.saveSettings({ brightspaceHost: h.origin })
  busy = true
  changed()
  let outcome: LoginOutcome
  try {
    outcome = await openLoginWindow(h.origin)
  } finally {
    busy = false
  }
  if (outcome !== 'success') {
    const error = outcome === 'timeout' ? 'The login window timed out. Try again.' : 'Login cancelled.'
    changed()
    return { ok: false, error }
  }
  store.setBrightspaceState({ host: h.origin, connected: true })
  // If the API refuses us right after login, refresh marks it "not connected" with a hint to use
  // the calendar link; the cookies stay until Log out.
  return refreshBrightspace({ afterLogin: true })
}

async function clearSession(): Promise<void> {
  const s = brightspaceSession()
  await s.clearStorageData()
  await s.clearCache().catch(() => undefined)
  await s.clearAuthCache().catch(() => undefined)
}

/** Log out: delete the partition's cookies and storage, the cached Brightspace items and the login state. */
export async function logoutBrightspace(): Promise<BrightspaceStatus> {
  if (loginWin && !loginWin.isDestroyed()) loginWin.close()
  await clearSession()
  store.setBrightspaceState(null)
  setSourceDeadlines('brightspace', null)
  log('logged out')
  return changed()
}

let timer: ReturnType<typeof setInterval> | null = null

/** Start pushes and the schedule: sync shortly after launch (if connected) and every 2 hours. */
export function startBrightspace(pushStatus: (s: BrightspaceStatus) => void): void {
  push = pushStatus
  const tick = (): void => {
    const st = store.getBrightspaceState()
    if (st?.connected && st.host === store.getSettings().brightspaceHost) void refreshBrightspace()
  }
  setTimeout(tick, 5_000)
  if (!timer) timer = setInterval(tick, REFRESH_EVERY_MS)
}

export function stopBrightspace(): void {
  if (timer) clearInterval(timer)
  timer = null
}
