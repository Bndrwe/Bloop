import { useEffect, useId, useState } from 'react'
import type { LockdownStatus, LockTargetInput } from '@shared/types'
import { LOCKDOWN_MAX_MINUTES, LOCKDOWN_PRESETS } from '@shared/lockdown'
import { Icon } from '../../lib/Icon'
import { errMsg, mmss } from '../../lib/format'
import { HoldButton } from './HoldButton'
import './lockdown.css'

/**
 * Panel card: lock yourself to one app or website for a while. Running: what you're locked to,
 * the time left and "Hold to end". Not running: quick picks (what was recently in front), a
 * text box for anything else, the length, and Start.
 */
export function LockdownCard({ status }: { status: LockdownStatus | null }): JSX.Element {
  const inputId = useId()
  const [recents, setRecents] = useState<LockTargetInput[]>([])
  const [picked, setPicked] = useState<LockTargetInput | null>(null)
  const [text, setText] = useState('')
  const [minutes, setMinutes] = useState<number>(LOCKDOWN_PRESETS[0])
  const [custom, setCustom] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const active = !!status?.active

  useEffect(() => {
    if (active) return
    let alive = true
    const load = (): void => {
      window.studyPet
        .getLockTargets()
        .then((r) => alive && setRecents(r))
        .catch(() => undefined)
    }
    load()
    const id = window.setInterval(load, 5000)
    return () => {
      alive = false
      window.clearInterval(id)
    }
  }, [active])

  if (active && status?.target) {
    return (
      <section className="card section lock-card lock-card--on">
        <h2 className="section-title">
          <Icon name="lock" size={14} />
          Lockdown
          <span className="lock-left num">{mmss(status.remainingSec ?? 0)} left</span>
        </h2>
        <p className="note">
          <span>
            Locked to <strong>{status.target.label}</strong>. Anything else gets covered.
          </span>
        </p>
        <HoldButton onDone={() => void window.studyPet.stopLockdown()} />
      </section>
    )
  }

  const typed = text.trim()
  // Default: whatever was in front before you opened the panel (the newest quick pick).
  const current = recents[0] ?? null
  const chosen = picked ?? current
  const choice: LockTargetInput | null = typed ? { value: typed } : chosen
  const customMin = custom.trim() ? Number(custom) : null
  const length = customMin ?? minutes
  const lengthOk = Number.isInteger(length) && length >= 1 && length <= LOCKDOWN_MAX_MINUTES

  const start = (): void => {
    if (!choice || !lengthOk || busy) return
    setBusy(true)
    setError(null)
    window.studyPet
      .startLockdown(choice, length)
      .then((r) => {
        if (!r.ok) setError(r.error)
      })
      .catch((e) => setError(errMsg(e)))
      .finally(() => setBusy(false))
  }

  const key = (t: LockTargetInput): string => `${t.kind}:${t.value}`
  return (
    <section className="card section lock-card">
      <h2 className="section-title">
        <Icon name="lock" size={14} />
        Lockdown
      </h2>
      <p className="note">
        <span>Stay on one app or website. Bloop covers everything else until time’s up.</span>
      </p>

      {recents.length > 0 && (
        <div className="lock-picks" role="group" aria-label="Recently open">
          {recents.map((r) => (
            <button
              key={key(r)}
              type="button"
              className={`btn btn--tiny${!typed && chosen && key(chosen) === key(r) ? ' btn--on' : ''}`}
              aria-pressed={!typed && !!chosen && key(chosen) === key(r)}
              onClick={() => {
                setPicked(r)
                setText('')
              }}
              title={r.kind === 'site' ? 'Website' : 'App'}
            >
              {r.value}
              {r === current && <span className="lock-now">now</span>}
            </button>
          ))}
        </div>
      )}
      <label className="lock-field" htmlFor={inputId}>
        <span className="faint">{recents.length > 0 ? 'Or type one' : 'App or website'}</span>
        <input
          id={inputId}
          className="lock-input"
          placeholder="An app name or a website address"
          value={text}
          maxLength={200}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && start()}
        />
      </label>

      <div className="lock-picks" role="group" aria-label="Length">
        {LOCKDOWN_PRESETS.map((m) => (
          <button
            key={m}
            type="button"
            className={`btn btn--tiny${!custom.trim() && minutes === m ? ' btn--on' : ''}`}
            aria-pressed={!custom.trim() && minutes === m}
            onClick={() => {
              setMinutes(m)
              setCustom('')
            }}
          >
            {m} min
          </button>
        ))}
        <input
          className="lock-input lock-input--min"
          inputMode="numeric"
          placeholder="custom"
          aria-label="Custom length in minutes"
          value={custom}
          maxLength={3}
          onChange={(e) => setCustom(e.target.value.replace(/[^0-9]/g, ''))}
        />
      </div>

      {error && (
        <p className="note note--error" role="alert">
          <Icon name="alert" size={13} />
          {error}
        </p>
      )}
      {!lengthOk && custom.trim() && <p className="note faint">Pick 1 to {LOCKDOWN_MAX_MINUTES} minutes.</p>}
      <button className="btn btn--accent btn--wide" disabled={!choice || !lengthOk || busy} onClick={start}>
        <Icon name="lock" size={14} />
        {choice ? `Lock to ${choice.value} for ${lengthOk ? length : '…'} min` : 'Pick an app or website'}
      </button>
    </section>
  )
}
