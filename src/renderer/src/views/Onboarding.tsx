import { useCallback, useEffect, useState } from 'react'
import type { PermissionState, PermissionStatus } from '@shared/types'
import { Pet } from '../pet/Pet'
import { errMsg } from '../lib/format'
import './onboarding.css'

function stateLabel(s: PermissionState): { icon: string; text: string; cls: string } {
  switch (s) {
    case 'granted':
      return { icon: '✅', text: 'Allowed', cls: 'ok' }
    case 'denied':
      return { icon: '⚠️', text: 'Not allowed yet', cls: 'warn' }
    case 'not-applicable':
      return { icon: '✅', text: 'Not needed on this platform', cls: 'ok' }
    default:
      return { icon: '⚠️', text: 'Not checked yet', cls: 'warn' }
  }
}

export function Onboarding(): JSX.Element {
  const [perm, setPerm] = useState<PermissionStatus | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async (): Promise<void> => {
    setBusy(true)
    try {
      setPerm(await window.studyPet.getPermissions())
      setError(null)
    } catch (e) {
      setError(errMsg(e))
    } finally {
      setBusy(false)
    }
  }, [])

  useEffect(() => {
    void refresh()
    const onFocus = (): void => void refresh()
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [refresh])

  const askBrowser = async (): Promise<void> => {
    setBusy(true)
    try {
      setPerm(await window.studyPet.requestAutomation())
    } catch (e) {
      setError(errMsg(e))
    } finally {
      setBusy(false)
    }
  }

  const done = async (): Promise<void> => {
    try {
      await window.studyPet.dismissOnboarding()
    } finally {
      await window.studyPet.closeWindow()
    }
  }

  const isMac = perm ? perm.platform === 'darwin' : true
  const sr = stateLabel(perm?.screenRecording ?? 'unknown')
  const au = stateLabel(perm?.automation ?? 'unknown')

  return (
    <div className="onb">
      <div className="onb-hero">
        <Pet mood="wave" size={120} />
        <h1>Hi! I’m your Study Pet.</h1>
        <p className="muted">
          I sit in the corner, keep score of your focus, and give you a gentle nudge when you drift off.
        </p>
      </div>

      {!isMac ? (
        <div className="card onb-perm">
          <p>✅ No extra permissions are needed on this platform. You’re all set!</p>
        </div>
      ) : (
        <>
          <div className="card onb-perm">
            <div className="onb-perm-head">
              <h2>Screen Recording</h2>
              <span className={`onb-state onb-state--${sr.cls}`}>
                {sr.icon} {sr.text}
              </span>
            </div>
            <p className="muted">
              Lets me read window titles (like the name of the doc you’re in). I never record or save your screen.
            </p>
            {perm?.screenRecording !== 'granted' && perm?.screenRecording !== 'not-applicable' && (
              <button className="btn btn--small" onClick={() => void window.studyPet.openPermissionSettings('screenRecording')}>
                Open Screen Recording settings
              </button>
            )}
          </div>

          <div className="card onb-perm">
            <div className="onb-perm-head">
              <h2>Automation (browsers)</h2>
              <span className={`onb-state onb-state--${au.cls}`}>
                {au.icon} {au.text}
              </span>
            </div>
            <p className="muted">
              Lets me read the URL of your Chrome, Arc or Safari tab so I can tell study sites from YouTube.
            </p>
            {perm?.automation !== 'granted' && perm?.automation !== 'not-applicable' && (
              <div className="row">
                <button className="btn btn--small btn--primary" disabled={busy} onClick={() => void askBrowser()}>
                  Ask for browser access
                </button>
                <button className="btn btn--small" onClick={() => void window.studyPet.openPermissionSettings('automation')}>
                  Open Automation settings
                </button>
              </div>
            )}
          </div>
        </>
      )}

      {error && <p className="onb-error">{error}</p>}

      <p className="onb-note muted">
        Study Pet still works without these, just with less detail. Everything stays on your Mac.
      </p>

      <div className="onb-actions">
        <button className="btn" disabled={busy} onClick={() => void refresh()}>
          Re-check
        </button>
        <button className="btn btn--primary" onClick={() => void done()}>
          Continue
        </button>
      </div>
    </div>
  )
}
