import { execFile } from 'node:child_process'
import { desktopCapturer, shell, systemPreferences } from 'electron'
import type { PermissionState, PermissionStatus } from '@shared/types'
import { isOnboardingDismissed } from './store'

const isMac = process.platform === 'darwin'

/** Automation (Apple Events) state, learned from osascript results. */
let automation: PermissionState = isMac ? 'unknown' : 'not-applicable'

export function setAutomationState(s: PermissionState): void {
  if (!isMac) return
  if (s !== automation) console.log(`[bloop] automation permission -> ${s}`)
  automation = s
}

export function getScreenRecordingState(): PermissionState {
  if (!isMac) return 'not-applicable'
  try {
    const st = systemPreferences.getMediaAccessStatus('screen')
    if (st === 'granted') return 'granted'
    if (st === 'denied' || st === 'restricted') return 'denied'
    return 'unknown'
  } catch {
    return 'unknown'
  }
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
export async function registerScreenCapture(): Promise<void> {
  if (!isMac || getScreenRecordingState() === 'granted') return
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

/** Fresh permission status: re-probes Automation. Screen Recording only refreshes after a relaunch (macOS caches it per process). */
export async function refreshPermissions(): Promise<PermissionStatus> {
  await probeAutomation()
  return getPermissions()
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
