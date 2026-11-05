import { useEffect, useState } from 'react'
import type { BrightspaceStatus } from '@shared/types'
import { Icon } from '../lib/Icon'
import { errMsg } from '../lib/format'
import { useBrightspace } from '../hooks/useBrightspace'

function ago(ms: number, now = Date.now()): string {
  const min = Math.round((now - ms) / 60_000)
  if (min < 1) return 'just now'
  if (min < 60) return `${min} min ago`
  const h = Math.round(min / 60)
  if (h < 24) return `${h} h ago`
  return new Date(ms).toLocaleDateString([], { month: 'short', day: 'numeric' })
}

const bare = (origin: string): string => origin.replace(/^https:\/\//, '')

/** Settings → Deadlines → Brightspace: log in with your school's own sign-in page. */
export function BrightspaceSection({ onSynced }: { onSynced?: (s: BrightspaceStatus) => void }): JSX.Element {
  const { status, setStatus } = useBrightspace()
  const [draft, setDraft] = useState('')
  const [note, setNote] = useState<string | null>(null)
  const [working, setWorking] = useState<'login' | 'refresh' | 'logout' | null>(null)

  useEffect(() => {
    if (status?.host && !draft) setDraft(bare(status.host))
    // only fill the field once, from the saved address
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status?.host])

  const api = window.studyPet
  const run = async (kind: 'login' | 'refresh' | 'logout'): Promise<void> => {
    setWorking(kind)
    setNote(null)
    try {
      if (kind === 'logout') {
        setStatus(await api.brightspaceLogout())
        setNote('Logged out. Bloop deleted its Brightspace cookies.')
        return
      }
      const r = kind === 'login' ? await api.brightspaceLogin(draft) : await api.brightspaceRefresh()
      if (r.ok) {
        setStatus(r.value)
        onSynced?.(r.value)
      } else {
        setNote(r.error)
        api.brightspaceStatus().then(setStatus).catch(() => undefined)
      }
    } catch (e) {
      setNote(errMsg(e))
    } finally {
      setWorking(null)
    }
  }

  const connected = !!status?.connected
  const busy = working != null || !!status?.busy
  // a fresh local note (e.g. "Login cancelled") replaces the stored error
  const error = note ?? status?.error ?? null
  const errorIsInfo = note != null && /^Logged out/.test(note)

  return (
    <div className="bs">
      <div className="bs-head">
        <h3>Brightspace</h3>
        {connected && <span className="tag tag--outline">connected</span>}
        {!connected && status?.expired && <span className="tag tag--outline">login expired</span>}
      </div>

      {connected && status ? (
        <>
          <p className="bs-who">
            <Icon name="check" size={13} />
            <span>
              Connected as <strong>{status.user || 'you'}</strong>{' '}
              <span className="muted">
                ({status.courseCount ?? 0} course{status.courseCount === 1 ? '' : 's'})
              </span>
            </span>
          </p>
          <p className="faint bs-meta">
            {bare(status.host)}
            {status.lastSync ? ` · synced ${ago(status.lastSync)}` : ''}
            {status.itemCount != null ? ` · ${status.itemCount} upcoming` : ''}
          </p>
          <div className="row">
            <button className="btn btn--small" disabled={busy} onClick={() => void run('refresh')}>
              <Icon name="refresh" size={13} />
              {working === 'refresh' || status.busy ? 'Refreshing…' : 'Refresh'}
            </button>
            <button className="btn btn--small" disabled={working != null} onClick={() => void run('logout')}>
              Log out
            </button>
          </div>
        </>
      ) : (
        <>
          <label className="field field--wide">
            <span className="field-label">Your school’s Brightspace address</span>
            <input
              className="text-input"
              type="text"
              inputMode="url"
              spellCheck={false}
              autoComplete="off"
              value={draft}
              placeholder="e.g. purdue.brightspace.com"
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && draft.trim() && !busy) void run('login')
              }}
            />
            <span className="faint field-help">
              Opens your school’s own sign-in page in a separate window. Bloop never sees your password; it reads only your
              courses and what’s due.
            </span>
          </label>
          <div className="row">
            <button className="btn btn--small btn--primary" disabled={busy || !draft.trim()} onClick={() => void run('login')}>
              {working === 'login' ? 'Waiting for sign-in…' : status?.expired ? 'Log in again' : 'Log in to Brightspace'}
            </button>
            {working === 'login' && <span className="muted">Finish signing in in the new window.</span>}
            {status?.host && !working && (
              <button className="btn btn--small btn--ghost" onClick={() => void run('logout')}>
                Log out
              </button>
            )}
          </div>
        </>
      )}

      {error && (
        <p className={`bs-note${errorIsInfo ? '' : ' bs-note--error'}`} role="status">
          {!errorIsInfo && <Icon name="alert" size={13} />}
          <span>{error}</span>
        </p>
      )}
    </div>
  )
}
