import { execFile } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { BrowserWindow, app, desktopCapturer, shell, systemPreferences } from 'electron'
import type { PermissionResetResult, PermissionState, PermissionStatus } from '@shared/types'
import { APP_ID } from '@shared/appId'
import { isOnboardingDismissed } from './store'

const isMac = process.platform === 'darwin'

/** package.json build.appId: the fallback when the app's own Info.plist can't be read. */
export const DEFAULT_BUNDLE_ID = APP_ID

/** Automation (Apple Events) state, learned from osascript results. */
let automation: PermissionState = isMac ? 'unknown' : 'not-applicable'

export function setAutomationState(s: PermissionState): void {
  if (!isMac) return
  if (s === 'unknown') {
    automation = s
    return
  }
  if (s !== automation) console.log(`[bloop] automation permission -> ${s}`)
  automation = s
}

/** What macOS says (systemPreferences). Can lag, or be wrong for ad-hoc signed rebuilds. */
function mediaScreenState(): PermissionState {
  try {
    const st = systemPreferences.getMediaAccessStatus('screen')
    if (st === 'granted') return 'granted'
    if (st === 'denied' || st === 'restricted') return 'denied'
    return 'unknown'
  } catch {
    return 'unknown'
  }
}

// ------------------------------------------------------------------ Screen Recording fallback probe

/**
 * Without Screen Recording, macOS hides other apps' window titles, so the window list
 * desktopCapturer returns holds only Bloop's own (titled) windows. A titled window from another app
 * means the permission works, whatever getMediaAccessStatus says.
 */
const PROBE_TTL_MS = 60_000
let probe: { at: number; granted: boolean } | null = null
let probeInFlight: Promise<boolean> | null = null
/** Set once Bloop has asked macOS for screen capture this run (the prompt has been shown already). */
let captureRequested = false

/** Windows that belong to macOS itself and can be listed with a name even without the permission. */
const SYSTEM_WINDOW_NAMES = /^(dock|menubar|menu bar|window server|control cent(er|re)|notification cent(er|re)|wallpaper|desktop|desktop picture.*|spotlight|statusindicator|item-\d+|bloop.*|welcome to bloop)$/i

export interface ProbeSource {
  id: string
  name: string
}

/** Pure: does this window list include a titled window of another app? */
export function hasOtherAppWindows(sources: ProbeSource[], ownIds: Iterable<string>): boolean {
  const own = new Set(ownIds)
  return sources.some((s) => {
    const name = (s.name ?? '').trim()
    if (!name || own.has(s.id)) return false
    return !SYSTEM_WINDOW_NAMES.test(name)
  })
}

/** The probe only runs once the user has seen the setup (no surprise prompts on a first launch). */
function probeAllowed(): boolean {
  return captureRequested || isOnboardingDismissed()
}

function ownMediaSourceIds(): string[] {
  const ids: string[] = []
  for (const w of BrowserWindow.getAllWindows()) {
    try {
      if (!w.isDestroyed()) ids.push(w.getMediaSourceId())
    } catch {
      /* window going away */
    }
  }
  return ids
}

async function runProbe(): Promise<boolean> {
  try {
    // 0x0 thumbnails: no window is captured, only the list is read. Cheap, and it never shows the
    // Screen Recording prompt (capturing a thumbnail could).
    const sources = await desktopCapturer.getSources({ types: ['window'], thumbnailSize: { width: 0, height: 0 }, fetchWindowIcons: false })
    return hasOtherAppWindows(sources, ownMediaSourceIds())
  } catch (e) {
    console.log(`[bloop] screen recording probe failed: ${(e as Error).message}`)
    return false
  }
}

/**
 * Re-run the fallback probe if getMediaAccessStatus doesn't say granted and the cached result is
 * older than PROBE_TTL_MS (or `force`, for an explicit "Check again"). Concurrent calls share one run.
 */
export async function probeScreenRecording(force = false): Promise<void> {
  if (!isMac || mediaScreenState() === 'granted') return
  if (!force && !probeAllowed()) return
  if (!force && probe && Date.now() - probe.at < PROBE_TTL_MS) return
  if (!probeInFlight) {
    probeInFlight = runProbe().finally(() => {
      probeInFlight = null
    })
  }
  const granted = await probeInFlight
  if (granted !== probe?.granted) console.log(`[bloop] screen recording probe -> ${granted ? 'granted' : 'not granted'}`)
  probe = { at: Date.now(), granted }
}

/** For tests and after a reset. */
export function clearScreenRecordingProbe(): void {
  probe = null
}

/**
 * Effective Screen Recording state: getMediaAccessStatus, upgraded to granted when the probe saw
 * other apps' window titles. Tracking (tracker.ts) uses this same state.
 */
export function getScreenRecordingState(): PermissionState {
  if (!isMac) return 'not-applicable'
  const media = mediaScreenState()
  if (media === 'granted') return 'granted'
  if (probe?.granted) return 'granted'
  return media
}

export function getPermissions(): PermissionStatus {
  const screenRecording = getScreenRecordingState()
  const status: PermissionStatus = {
    platform: process.platform,
    screenRecording,
    automation,
    showOnboarding: false
  }
  // Non-mac (incl. the Linux demo container) never shows onboarding.
  status.showOnboarding = isMac && !isOnboardingDismissed() && (screenRecording !== 'granted' || automation !== 'granted')
  return status
}

/**
 * Ask macOS for screen capture once so Bloop shows up in System Settings → Screen Recording
 * (otherwise the user has to add it with "+"). On first call this also shows the system prompt.
 */
export async function registerScreenCapture(force = false): Promise<void> {
  if (!isMac || (!force && getScreenRecordingState() === 'granted')) return
  captureRequested = true
  try {
    await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: 1, height: 1 } })
  } catch (e) {
    console.log(`[bloop] screen capture registration failed: ${(e as Error).message}`)
  }
}

/**
 * AppleScript that asks a browser something only an authorised client may ask. `count windows`
 * works even when the browser has no window or tab open (asking for the front tab's URL then
 * fails with -1728, which used to leave Automation stuck on "unknown"). `is running` does not
 * launch the app or prompt; the `tell` does. Returns "" when the browser isn't running.
 */
function automationProbeScript(app: string): string {
  return `if application "${app}" is running then\ntell application "${app}" to count windows\nend if`
}

/**
 * Re-learn the Automation state by actually talking to a running browser.
 * Without this, "Re-check" would keep returning the state remembered from the last sample.
 */
export async function probeAutomation(timeoutMs = 4000): Promise<void> {
  if (!isMac || automation === 'granted') return
  for (const app of BROWSERS) {
    const r = await runOsascript(automationProbeScript(app), timeoutMs)
    if (r.ok) {
      if (r.out) return setAutomationState('granted')
      continue // not running
    }
    if (r.denied) return setAutomationState('denied')
  }
}

/**
 * Fresh permission status: re-probes Automation and the Screen Recording fallback (`fresh` skips the
 * probe's cache, for an explicit "Check again"). getMediaAccessStatus itself only changes after a
 * relaunch (macOS caches it per process).
 */
export async function refreshPermissions(fresh = false): Promise<PermissionStatus> {
  await Promise.all([probeAutomation(), probeScreenRecording(fresh)])
  return getPermissions()
}

/** perm:get takes nothing or one boolean ("fresh"); anything else counts as a plain read. */
export function parsePermissionQuery(args: unknown[]): { fresh: boolean } {
  return { fresh: args.length === 1 && args[0] === true }
}

// ------------------------------------------------------------------ reset

/** perm:reset: only from the Settings window, and with no arguments. */
export function parseResetRequest(fromSettings: boolean, args: unknown[]): boolean {
  return fromSettings && args.length === 0
}

const BUNDLE_ID_RE = /^[A-Za-z0-9][A-Za-z0-9.-]{0,154}$/

/** CFBundleIdentifier from an Info.plist (XML), or null. */
export function bundleIdFromPlist(xml: string): string | null {
  const m = /<key>CFBundleIdentifier<\/key>\s*<string>([^<]+)<\/string>/.exec(xml)
  const id = m?.[1]?.trim()
  return id && BUNDLE_ID_RE.test(id) ? id : null
}

/** The running app's bundle id: Contents/Info.plist next to the executable, else build.appId. */
export function appBundleId(execPath = process.execPath): string {
  try {
    // <Bloop.app>/Contents/MacOS/Bloop -> <Bloop.app>/Contents/Info.plist
    return bundleIdFromPlist(readFileSync(join(execPath, '..', '..', 'Info.plist'), 'utf8')) ?? DEFAULT_BUNDLE_ID
  } catch {
    return DEFAULT_BUNDLE_ID
  }
}

/** The tccutil calls a reset makes (argument arrays for execFile, no shell). */
export function tccResetCommands(bundleId: string): string[][] {
  if (!BUNDLE_ID_RE.test(bundleId)) throw new Error(`invalid bundle id: ${bundleId}`)
  return [
    ['reset', 'ScreenCapture', bundleId],
    ['reset', 'AppleEvents', bundleId]
  ]
}

const TCCUTIL = '/usr/bin/tccutil'

function runTccutil(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    execFile(TCCUTIL, args, { timeout: 10_000 }, (err, _stdout, stderr) => {
      if (err) reject(new Error(String(stderr || err.message).trim()))
      else resolve()
    })
  })
}

/**
 * Settings → Permissions → Reset permissions…: clears Bloop's Screen Recording and Automation
 * entries (stale ones from an older build look ON but don't match this build's signature), asks for
 * screen capture again so Bloop is listed afresh, and opens the Screen Recording pane.
 * Only the installed app: in development the permission belongs to the terminal / Electron.
 */
export async function resetPermissions(opts: { packaged?: boolean; bundleId?: string } = {}): Promise<PermissionResetResult> {
  if (!isMac) return { ok: false, reason: 'not-mac', message: 'Nothing to reset: only macOS asks for these permissions.' }
  const packaged = opts.packaged ?? app.isPackaged
  if (!packaged) {
    return {
      ok: false,
      reason: 'dev',
      message: 'Reset applies to the installed Bloop app. In development, run npm run perms -- --dev in a terminal.'
    }
  }
  const bundleId = opts.bundleId ?? appBundleId()
  try {
    for (const args of tccResetCommands(bundleId)) await runTccutil(args)
  } catch (e) {
    console.log(`[bloop] permission reset failed: ${(e as Error).message}`)
    return { ok: false, reason: 'failed', message: `Couldn't reset permissions: ${(e as Error).message}` }
  }
  console.log(`[bloop] permissions reset for ${bundleId}`)
  clearScreenRecordingProbe()
  setAutomationState('unknown')
  await registerScreenCapture(true) // Bloop shows up in the Screen Recording list again
  await shell.openExternal('x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture')
  return { ok: true, bundleId }
}

export async function openPermissionSettings(kind: 'screenRecording' | 'automation'): Promise<void> {
  if (!isMac) return
  if (kind === 'screenRecording') await registerScreenCapture()
  const anchor = kind === 'automation' ? 'Privacy_Automation' : 'Privacy_ScreenCapture'
  await shell.openExternal(`x-apple.systempreferences:com.apple.preference.security?${anchor}`)
}

/** Interpret an osascript failure: -1743 = not authorized to send Apple events. */
export function isAutomationDenied(err: unknown, stderr = ''): boolean {
  const text = `${stderr} ${err instanceof Error ? err.message : String(err ?? '')}`
  return /-1743|not authori[sz]ed|Not allowed to send Apple events/i.test(text)
}

export function runOsascript(script: string, timeoutMs = 2000): Promise<{ ok: true; out: string } | { ok: false; denied: boolean; error: string }> {
  return new Promise((resolve) => {
    execFile('osascript', ['-e', script], { timeout: timeoutMs }, (err, stdout, stderr) => {
      if (err) resolve({ ok: false, denied: isAutomationDenied(err, String(stderr)), error: String(stderr || err.message) })
      else resolve({ ok: true, out: String(stdout).trim() })
    })
  })
}

/** Browsers whose Automation permission Bloop checks (the ones tracker.ts reads tab URLs from). */
const BROWSERS = ['Google Chrome', 'Arc', 'Brave Browser', 'Microsoft Edge', 'Safari']

/**
 * Trigger the macOS Automation prompt by talking to a running browser. `is running` does not launch
 * the app or prompt; the `tell` does. If no supported browser is running the state stays as is.
 */
export async function requestAutomation(): Promise<PermissionStatus> {
  if (!isMac) return getPermissions()
  await probeAutomation(30000) // user may take a while to answer the prompt
  return getPermissions()
}
