import { useEffect, useState, type KeyboardEvent } from 'react'
import type { GoogleService, GoogleStatus, StudyWindow } from '@shared/planner'
import { Icon } from '../../lib/Icon'
import { errMsg } from '../../lib/format'
import { useBlocker, usePlanner } from '../../hooks/usePlanner'
import './planner.css'

/** Settings → Study planner: the daily window blocks are placed in. */
function StudyWindowSection(): JSX.Element {
  const [state] = usePlanner()
  const [draft, setDraft] = useState<StudyWindow | null>(null)
  const [note, setNote] = useState<{ text: string; ok: boolean } | null>(null)
  useEffect(() => {
    if (state && !draft) setDraft(state.window)
  }, [state, draft])

  const save = (next: StudyWindow): void => {
    setDraft(next)
    window.studyPet.planner
      .setWindow(next)
      .then((r) => setNote(r.ok ? { text: 'Saved. Blocks were re-planned.', ok: true } : { text: r.error, ok: false }))
      .catch((e) => setNote({ text: errMsg(e), ok: false }))
  }
  const w = draft ?? state?.window
  return (
    <section className="card enter">
      <h2>Study planner</h2>
      <p className="section-sub muted">
        Bloop splits big work into steps and books a study block for each one before it’s due, all inside this daily window. Blocks
        never overlap.
      </p>
      {w && (
        <>
          <label className="field">
            <span className="field-label">Study from</span>
            <span className="field-input">
              <input type="time" value={w.start} onChange={(e) => save({ ...w, start: e.target.value })} />
            </span>
          </label>
          <label className="field">
            <span className="field-label">Until</span>
            <span className="field-input">
              <input type="time" value={w.end} onChange={(e) => save({ ...w, end: e.target.value })} />
            </span>
          </label>
        </>
      )}
      {note && (
        <p className={`muted pls-note${note.ok ? '' : ' pls-note--error'}`} role="status">
          {!note.ok && <Icon name="alert" size={13} />}
          {note.text}
        </p>
      )}
    </section>
  )
}

/** Settings → Website blocker: the sites to block. */
function BlockedSitesSection(): JSX.Element | null {
  const [status, setStatus] = useBlocker()
  const [draft, setDraft] = useState('')
  if (!status) return null
  if (!status.supported) {
    return (
      <section className="card enter">
        <h2>Website blocker</h2>
        <p className="section-sub muted">Website blocking is available on macOS for now.</p>
      </section>
    )
  }
  const save = (sites: string[]): void => {
    window.studyPet.blocker
      .setSites(sites)
      .then(setStatus)
      .catch(() => undefined)
  }
  const add = (): void => {
    const v = draft.trim()
    if (v) save([...status.sites, v])
    setDraft('')
  }
  const onKey = (e: KeyboardEvent<HTMLInputElement>): void => {
    if (e.key === 'Enter') {
      e.preventDefault()
      add()
    } else if (e.key === 'Backspace' && draft === '' && status.sites.length > 0) save(status.sites.slice(0, -1))
  }
  return (
    <section className="card enter">
      <h2>Website blocker</h2>
      <p className="section-sub muted">
        These sites won’t load while a study block runs, or whenever you switch the blocker on in the panel. The first time, macOS asks
        for your password once so Bloop can block them for every browser.
      </p>
      <div className="chiplist">
        <div className="chiplist-head">
          <h4>Blocked sites</h4>
          <span className="muted">www. and m. versions are blocked too</span>
        </div>
        <div className="chiplist-box">
          {status.sites.map((site) => (
            <span key={site} className="chip chip--distract">
              {site}
              <button aria-label={`Remove ${site}`} onClick={() => save(status.sites.filter((x) => x !== site))}>
                <Icon name="close" size={10} />
              </button>
            </span>
          ))}
          <input
            value={draft}
            placeholder={status.sites.length === 0 ? 'e.g. youtube.com, then Enter' : 'Add…'}
            aria-label="Add a site to block"
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={onKey}
            onBlur={add}
          />
        </div>
      </div>
      {status.error && (
        <p className="muted pls-note pls-note--error" role="status">
          <Icon name="alert" size={13} />
          {status.error}
        </p>
      )}
    </section>
  )
}

const GOOGLE_ROWS: { id: GoogleService; name: string; what: string }[] = [
  { id: 'gmail', name: 'Gmail', what: 'Find assignments and due dates in course emails' },
  { id: 'calendar', name: 'Google Calendar', what: 'Plan study blocks around your events' }
]

/** Settings → Google: Gmail and Calendar. A stand-in for now: nothing is sent to Google. */
function GoogleSection(): JSX.Element {
  const [status, setStatus] = useState<GoogleStatus | null>(null)
  const [busy, setBusy] = useState<GoogleService | null>(null)
  useEffect(() => {
    window.studyPet.google.get().then(setStatus).catch(() => undefined)
  }, [])
  const toggle = (id: GoogleService, connected: boolean): void => {
    setBusy(id)
    const g = window.studyPet.google
    const p = connected ? g.disconnect(id) : g.connect(id).then((r) => (r.ok ? r.value : status))
    p.then((s) => s && setStatus(s))
      .catch(() => undefined)
      .finally(() => setBusy(null))
  }
  return (
    <section className="card enter">
      <div className="section-head">
        <h2>Google</h2>
        {status?.mock && <span className="tag tag--dashed">preview</span>}
      </div>
      <p className="section-sub muted">Connect Gmail and Calendar. This is a preview: no Google sign-in happens and nothing leaves your Mac yet.</p>
      {GOOGLE_ROWS.map((row) => {
        const s = status?.services[row.id]
        const connected = !!s?.connected
        return (
          <div key={row.id} className="field pls-google">
            <span className="pls-google-text">
              <span className="field-label">
                {row.name} <span className={`tag ${connected ? '' : 'tag--outline'} pls-google-tag`}>{connected ? 'connected' : 'not connected'}</span>
              </span>
              <span className="faint field-help">{connected && s?.account ? s.account : row.what}</span>
            </span>
            <button
              className={`btn btn--small${connected ? '' : ' btn--primary'}`}
              disabled={!status || busy === row.id}
              onClick={() => toggle(row.id, connected)}
            >
              {connected ? 'Disconnect' : `Connect ${row.name.replace('Google ', '')}`}
            </button>
          </div>
        )
      })}
    </section>
  )
}

/** The planner's Settings sections, in order. */
export function PlannerSettings(): JSX.Element {
  return (
    <>
      <StudyWindowSection />
      <BlockedSitesSection />
      <GoogleSection />
    </>
  )
}
