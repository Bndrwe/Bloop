import { readFile } from 'node:fs/promises'
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

/**
 * Sample the frontmost window. Returns null if it can't be determined (e.g. no window server
 * on Linux). If BLOOP_FAKE_ACTIVE points at a JSON file `{app, url?, title?}`, that is used instead.
 */
export async function sampleActiveWindow(): Promise<RawActive | null> {
  const fake = process.env['BLOOP_FAKE_ACTIVE']
  if (fake) return readFake(fake)
  try {
    const { activeWindow } = await import('get-windows')
    const w = await activeWindow({
      accessibilityPermission: false,
      screenRecordingPermission: getScreenRecordingState() === 'granted'
    })
    if (!w) return null
    const app = w.owner?.name ?? ''
    const res: RawActive = { app, title: w.title ?? '' }
    const native = 'url' in w && typeof w.url === 'string' ? w.url : undefined
    res.url = native ?? (await getBrowserUrl(app))
    return res
  } catch (e) {
    if (!loggedTrackerError) {
      loggedTrackerError = true
      console.log(`[bloop] active window unavailable: ${(e as Error).message}`)
    }
    return null
  }
}
