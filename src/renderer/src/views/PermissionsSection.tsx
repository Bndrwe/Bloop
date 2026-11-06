import { useCallback, useEffect, useState } from 'react'
import type { PermissionResetResult, PermissionStatus } from '@shared/types'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { Icon } from '../lib/Icon'
import { errMsg } from '../lib/format'
import { PermissionBadge } from './PermissionBadge'
import './permissions.css'

type Busy = 'check' | 'browser' | 'reset' | null

/**
 * Settings → Permissions (macOS): live Screen Recording / Automation status, plus the fixes for a
 * switch that looks on but isn't (a rebuilt, ad-hoc signed app is a new app to macOS).
 */
export function PermissionsSection(): JSX.Element {
  const [perm, setPerm] = useState<PermissionStatus | null>(null)
  const [busy, setBusy] = useState<Busy>(null)
  const [error, setError] = useState<string | null>(null)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [reset, setReset] = useState<PermissionResetResult | null>(null)
  const api = window.studyPet

  const refresh = useCallback(
    async (fresh = false): Promise<void> => {
      if (fresh) setBusy('check')
      try {
        setPerm(await api.getPermissions({ fresh }))
        setError(null)
      } catch (e) {
        setError(errMsg(e))
      } finally {
        if (fresh) setBusy(null)
      }
    },
    [api]
  )

  useEffect(() => {
    void refresh()
    const onFocus = (): void => void refresh()
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [refresh])

  const askBrowser = async (): Promise<void> => {
    setBusy('browser')
    try {
      setPerm(await api.requestAutomation())
    } catch (e) {
      setError(errMsg(e))
    } finally {
      setBusy(null)
    }
  }

  const doReset = async (): Promise<void> => {
    setConfirmOpen(false)
    setBusy('reset')
    try {
      setReset(await api.resetPermissions())
      await refresh()
    } catch (e) {
      setError(errMsg(e))
    } finally {
      setBusy(null)
    }
  }

  const isMac = perm ? perm.platform === 'darwin' : true

  if (perm && !isMac) {
    return (
      <section className="card enter" id="permissions">
        <h2>Permissions</h2>
        <p className="muted">Nothing to set up on this platform. Bloop doesn’t need extra permissions here.</p>
      </section>
    )
  }

  return (
    <section className="card enter" id="permissions" aria-busy={busy != null}>
      <h2>Permissions</h2>
      <p className="section-sub muted">Bloop works without these too, just with less detail. Nothing leaves your Mac.</p>

      <div className="perm-rows">
        <div className="perm-row">
          <div>
            <h3>Screen Recording</h3>
            <p className="muted">Lets Bloop read window titles, like the name of the doc you’re in. Nothing is recorded.</p>
          </div>
          <PermissionBadge state={perm?.screenRecording ?? 'unknown'} />
        </div>
        <div className="perm-row">
          <div>
            <h3>Automation for browsers</h3>
            <p className="muted">Lets Bloop read the address of your Chrome, Arc or Safari tab.</p>
          </div>
          <PermissionBadge state={perm?.automation ?? 'unknown'} />
        </div>
      </div>

      <div className="perm-actions">
        <button className="btn btn--small" onClick={() => void api.openPermissionSettings('screenRecording')}>
          Open Screen Recording settings
        </button>
        <button className="btn btn--small" disabled={busy != null} onClick={() => void askBrowser()}>
          {busy === 'browser' ? 'Asking…' : 'Ask for browser access'}
        </button>
        <button className="btn btn--small" disabled={busy != null} onClick={() => void refresh(true)}>
          <Icon name="refresh" size={13} />
          {busy === 'check' ? 'Checking…' : 'Check again'}
        </button>
      </div>
      <div className="perm-actions">
        <button className="btn btn--small" disabled={busy != null} onClick={() => setConfirmOpen(true)}>
          {busy === 'reset' ? 'Resetting…' : 'Reset permissions…'}
        </button>
        <button className="btn btn--small" onClick={() => void api.relaunchApp()}>
          Relaunch Bloop
        </button>
        <button className="btn btn--small btn--ghost" onClick={() => void api.openPermissionsSetup()}>
          Run setup again
        </button>
      </div>

      {reset?.ok ? (
        <div className="perm-steps" role="status">
          <strong>Permissions reset. Next:</strong>
          <ol>
            <li>In the Screen Recording pane that just opened, turn on Bloop.</li>
            <li>Press Relaunch Bloop. macOS only re-reads Screen Recording when Bloop starts.</li>
            <li>After the relaunch, open your browser and press Ask for browser access.</li>
          </ol>
          <button className="btn btn--small btn--primary" onClick={() => void api.relaunchApp()}>
            Relaunch Bloop
          </button>
        </div>
      ) : reset ? (
        <p className="perm-note" role="status">
          <Icon name="alert" size={13} />
          {reset.message}
        </p>
      ) : (
        <p className="perm-note faint">
          Switch is on but Bloop says not allowed? Each new build of Bloop is a new app to macOS, so the old switch no longer
          matches. Press Reset permissions, turn Bloop on again, then relaunch.
        </p>
      )}

      {error && (
        <p className="perm-note" role="alert">
          <Icon name="alert" size={13} />
          Couldn’t check permissions: {error}
        </p>
      )}

      <ConfirmDialog
        open={confirmOpen}
        title="Reset Bloop’s permissions?"
        eyebrow="macOS"
        confirmLabel="Reset permissions"
        initialFocus="cancel"
        onConfirm={() => void doReset()}
        onCancel={() => setConfirmOpen(false)}
      >
        <p>
          This clears Bloop’s Screen Recording and Automation entries in System Settings, so a stale switch from an older build
          stops getting in the way. Then the Screen Recording pane opens: turn on Bloop and relaunch.
        </p>
      </ConfirmDialog>
    </section>
  )
}
