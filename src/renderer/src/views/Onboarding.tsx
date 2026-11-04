import { useCallback, useEffect, useRef, useState } from 'react'
import type { PermissionState, PermissionStatus } from '@shared/types'
import { Pet } from '../pet/Pet'
import { errMsg } from '../lib/format'
import { Icon } from '../lib/Icon'
import { useEntrance } from '../lib/motion'
import './onboarding.css'

function stateLabel(s: PermissionState): { ok: boolean; text: string } {
  switch (s) {
    case 'granted':
      return { ok: true, text: 'Allowed' }
    case 'denied':
      return { ok: false, text: 'Not allowed yet' }
    case 'not-applicable':
      return { ok: true, text: 'Not needed here' }
    default:
      return { ok: false, text: 'Not checked yet' }
  }
}

function StateBadge({ state }: { state: PermissionState }): JSX.Element {
  const l = stateLabel(state)
  return (
    <span className={`onb-state onb-state--${l.ok ? 'ok' : 'warn'}`}>
      <Icon name={l.ok ? 'check' : 'alert'} size={13} />
      {l.text}
    </span>
  )
}

export function Onboarding(): JSX.Element {
  const [perm, setPerm] = useState<PermissionStatus | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const rootRef = useRef<HTMLDivElement>(null)
  useEntrance(rootRef, ':scope > .enter')

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

  return (
    <div className="onb" ref={rootRef}>
      <div className="onb-hero enter">
        <Pet mood="wave" size={92} />
        <h1>
          Hi, I’m <span className="tag">Bloop</span>, your study pet
        </h1>
        <p className="muted">
          I sit in the corner, keep score of your focus, and give you a gentle nudge when you drift off.
        </p>
      </div>

      {!isMac ? (
        <div className="card onb-perm enter">
          <div className="onb-perm-head">
            <h2>Permissions</h2>
            <StateBadge state="not-applicable" />
          </div>
          <p className="muted">No extra permissions are needed on this platform. You’re all set.</p>
        </div>
      ) : (
        <>
          <div className="card onb-perm enter">
            <div className="onb-perm-head">
              <h2>Screen Recording</h2>
              <StateBadge state={perm?.screenRecording ?? 'unknown'} />
            </div>
            <p className="muted">
              Lets me read window titles, like the name of the doc you’re in. Nothing is recorded or saved.
            </p>
            {perm?.screenRecording !== 'granted' && perm?.screenRecording !== 'not-applicable' && (
              <>
                <div className="row">
                  <button className="btn btn--small" onClick={() => void window.studyPet.openPermissionSettings('screenRecording')}>
                    Open Screen Recording settings
                  </button>
                  <button className="btn btn--small btn--primary" onClick={() => void window.studyPet.relaunchApp()}>
                    Restart Bloop
                  </button>
                </div>
                <p className="muted onb-hint">Turned it on already? macOS only applies it after Bloop restarts.</p>
              </>
            )}
          </div>

          <div className="card onb-perm enter">
            <div className="onb-perm-head">
              <h2>Automation for browsers</h2>
              <StateBadge state={perm?.automation ?? 'unknown'} />
            </div>
            <p className="muted">
              Lets me read the address of your Chrome, Arc or Safari tab, so I can tell study sites from YouTube.
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

      {error && (
        <p className="onb-error enter" role="alert">
          <Icon name="alert" size={13} />
          Couldn’t check permissions: {error}
        </p>
      )}

      <hr className="zigzag enter" />

      <div className="onb-foot enter">
        <p className="onb-note faint">
          Works without these too, just with less detail. Everything stays on your Mac.
        </p>
        <div className="onb-actions">
          <button className="btn" disabled={busy} onClick={() => void refresh()}>
            <Icon name="refresh" size={14} />
            Re-check
          </button>
          <button className="btn btn--accent" onClick={() => void done()}>
            Continue
          </button>
        </div>
      </div>
    </div>
  )
}
