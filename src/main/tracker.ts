import { execFile } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { normalizeOwner } from './classifier'
import { classifyTrackerError, createRateLimitedLog, linuxTrackingInfo } from './linux'
import { getScreenRecordingState, runOsascript, setAutomationState } from './permissions'

export interface RawActive {
  app: string
  title: string
  url?: string
}

const isMac = process.platform === 'darwin'

/** AppleScript to read the front tab URL, keyed by macOS owner name. */
const URL_SCRIPTS: Record<string, string> = {
  'Google Chrome': 'tell application "Google Chrome" to get URL of active tab of front window',
  'Google Chrome Canary': 'tell application "Google Chrome Canary" to get URL of active tab of front window',
  Chromium: 'tell application "Chromium" to get URL of active tab of front window',
  'Brave Browser': 'tell application "Brave Browser" to get URL of active tab of front window',
  'Microsoft Edge': 'tell application "Microsoft Edge" to get URL of active tab of front window',
  Arc: 'tell application "Arc" to get URL of active tab of front window',
  Safari: 'tell application "Safari" to get URL of front document'
}

let loggedTrackerError = false
const isLinux = process.platform === 'linux'
/** Failures repeat every sample (a few seconds); log each kind at most once per 10 minutes. */
const logLimited = createRateLimitedLog((m) => console.log(m))
let linuxChecked = false

/** Linux: log once how well active-window tracking can work here. Returns false if it cannot work at all. */
function linuxPrecheck(): boolean {
  if (linuxChecked) return linuxUsable
  linuxChecked = true
  const info = linuxTrackingInfo()
  console.log(`[bloop] linux tracking: ${info.note}`)
  linuxUsable = info.missingTools.length === 0 && !(info.session === 'unknown' && !process.env['DISPLAY'])
  return linuxUsable
}
let linuxUsable = true

async function readFake(path: string): Promise<RawActive | null> {
  try {
    const j = JSON.parse(await readFile(path, 'utf8')) as Partial<RawActive> | null
    if (!j || typeof j.app !== 'string') return null
    return { app: j.app, title: typeof j.title === 'string' ? j.title : '', url: typeof j.url === 'string' ? j.url : undefined }
  } catch (e) {
    console.log(`[bloop] fake active window read failed: ${(e as Error).message}`)
    return null
  }
}

export async function getBrowserUrl(app: string): Promise<string | undefined> {
  const script = URL_SCRIPTS[app]
  if (!isMac || !script) return undefined
  const r = await runOsascript(script, 2000)
  if (r.ok) {
    setAutomationState('granted')
    return r.out && r.out !== 'missing value' ? r.out : undefined
  }
  if (r.denied) setAutomationState('denied')
  return undefined
}

interface NativeWindow {
  title?: string
  url?: string
  owner?: { name?: string; path?: string }
}

/**
 * Path of get-windows' macOS helper binary. In the packaged app it lives in
 * app.asar.unpacked (see build.asarUnpack): get-windows itself would spawn it via the app.asar
 * path, and because it calls the promisified execFile (Node's original, not Electron's asar-aware
 * wrapper) that fails with "spawn ENOTDIR", so every sample came back "Unknown".
 */
function macWindowsBinary(): string {
  const dir = dirname(createRequire(import.meta.url).resolve('get-windows'))
  return join(dir, 'main').replace(/\.asar([\\/])/, '.asar.unpacked$1')
}

function macActiveWindow(screenRecording: boolean): Promise<NativeWindow | null> {
  const args = ['--no-accessibility-permission']
  if (!screenRecording) args.push('--no-screen-recording-permission')
  return new Promise((resolve, reject) => {
    execFile(macWindowsBinary(), args, { timeout: 4000 }, (err, stdout) => {
      if (err) return reject(err)
      try {
        resolve(JSON.parse(String(stdout)) as NativeWindow | null)
      } catch {
        reject(new Error('could not parse active window data'))
      }
    })
  })
}

/**
 * Sample the frontmost window. Returns null if it can't be determined (e.g. no window server
 * on Linux). If BLOOP_FAKE_ACTIVE points at a JSON file `{app, url?, title?}`, that is used instead.
 */
export async function sampleActiveWindow(): Promise<RawActive | null> {
  const fake = process.env['BLOOP_FAKE_ACTIVE']
  if (fake) return readFake(fake)
  if (isLinux && !linuxPrecheck()) return null
  try {
    const screenRecording = getScreenRecordingState() === 'granted'
    let w: NativeWindow | null
    if (isMac) w = await macActiveWindow(screenRecording)
    else {
      const { activeWindow } = await import('get-windows')
      w = (await activeWindow({ accessibilityPermission: false, screenRecordingPermission: screenRecording })) ?? null
    }
    if (!w) {
      // get-windows returns undefined (instead of throwing) when its native binary is missing
      if (process.platform === 'win32' && !loggedTrackerError) {
        loggedTrackerError = true
        console.log('[bloop] get-windows returned no window (native Windows binary missing or no foreground window)')
      }
      // Wayland: focus on a native Wayland window leaves no X11 active window
      if (isLinux) logLimited('linux-nowin', '[bloop] no active X11 window (on Wayland, native Wayland apps are invisible to tracking)')
      return null
    }
    const { app, title } = isMac ? { app: w.owner?.name ?? '', title: w.title ?? '' } : normalizeOwner(w.owner, w.title ?? '')
    const res: RawActive = { app, title }
    const native = 'url' in w && typeof w.url === 'string' ? w.url : undefined
    res.url = native ?? (await getBrowserUrl(app))
    if (process.env['BLOOP_TRACE'] === '1') {
      console.log(`[bloop] trace raw: app="${app}" titleLen=${res.title.length} url=${res.url ?? '-'} nativeUrl=${native ? 'yes' : 'no'}`)
    }
    return res
  } catch (e) {
    const kind = isLinux ? classifyTrackerError(e) : 'other'
    if (kind === 'missing-xprop') {
      linuxUsable = false // stop spawning a failing process every sample
      logLimited(kind, '[bloop] active window unavailable: xprop/xwininfo not found. Install x11-utils (sudo apt install x11-utils)')
    } else if (kind === 'no-display') {
      logLimited(kind, '[bloop] active window unavailable: cannot open the X display (is DISPLAY set? Wayland-only session?)')
    } else {
      logLimited(kind, `[bloop] active window unavailable: ${(e as Error).message}`)
    }
    return null
  }
}
