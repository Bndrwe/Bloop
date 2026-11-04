import { execFile } from 'node:child_process'
import { shell, systemPreferences } from 'electron'
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

export async function openPermissionSettings(kind: 'screenRecording' | 'automation'): Promise<void> {
  if (!isMac) return
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

const BROWSER_SCRIPTS: [string, string][] = [
  ['Google Chrome', 'get URL of active tab of front window'],
  ['Arc', 'get URL of active tab of front window'],
  ['Brave Browser', 'get URL of active tab of front window'],
  ['Microsoft Edge', 'get URL of active tab of front window'],
  ['Safari', 'get URL of front document']
]

/**
 * Trigger the macOS Automation prompt by talking to a running browser. `is running` does not launch
 * the app or prompt; the `tell` does. If no supported browser is running the state stays as is.
 */
export async function requestAutomation(): Promise<PermissionStatus> {
  if (!isMac) return getPermissions()
  for (const [app, cmd] of BROWSER_SCRIPTS) {
    const script = `if application "${app}" is running then\ntell application "${app}" to ${cmd}\nend if`
    const r = await runOsascript(script, 30000) // user may take a while to answer the prompt
    if (r.ok) {
      if (r.out) {
        setAutomationState('granted')
        break
      }
      continue // not running
    }
    if (r.denied) {
      setAutomationState('denied')
      break
    }
  }
  return getPermissions()
}
