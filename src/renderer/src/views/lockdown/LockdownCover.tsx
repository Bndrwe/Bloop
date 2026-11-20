import { useCallback, useEffect, useState } from 'react'
import { Pet } from '../../pet/Pet'
import { Icon } from '../../lib/Icon'
import { mmss } from '../../lib/format'
import { useLockdown } from '../../hooks/useLockdown'
import { HoldButton } from './HoldButton'
import './lockdown.css'

const LINES = [
  "hey! this isn't what we locked in on.",
  'nope, not this one. back we go?',
  "I'll keep this covered till you're back.",
  "we promised each other. let's go back!",
  'so close to done. back to it?',
  'future you will thank you. back we go!'
]

/**
 * The full-screen lockdown cover (one window per display; the primary one gets the controls).
 * It shows while something other than the locked app or site is in front.
 */
export function LockdownCover({ secondary = false }: { secondary?: boolean }): JSX.Element {
  const status = useLockdown()
  const [line] = useState(() => LINES[Math.floor(Math.random() * LINES.length)])
  const target = status?.target
  const label = target?.label ?? 'your work'

  const goBack = useCallback(() => void window.studyPet.lockdownGoBack(), [])
  const end = useCallback(() => void window.studyPet.stopLockdown(), [])

  // Enter = take me back (the cover has focus when it appears)
  useEffect(() => {
    if (secondary) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Enter' && (e.target as HTMLElement | null)?.tagName !== 'BUTTON') goBack()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [goBack, secondary])

  if (secondary) {
    return (
      <div className="cover cover--secondary">
        <Pet mood="worried" size={120} />
        <p className="cover-sub">Locked to {label}</p>
      </div>
    )
  }

  return (
    <div className="cover" role="alertdialog" aria-labelledby="cover-title" aria-describedby="cover-sub">
      <div className="cover-badge">
        <Icon name="lock" size={14} />
        Lockdown
        {status?.remainingSec != null && <span className="num">{mmss(status.remainingSec)} left</span>}
      </div>
      <div className="cover-pet">
        <div className="cover-bubble">{line}</div>
        <Pet mood="worried" size={200} />
      </div>
      <h1 id="cover-title" className="serif cover-title">
        You’re locked to <em>{label}</em>
      </h1>
      <p id="cover-sub" className="cover-sub">
        Everything else stays covered until the timer runs out.
      </p>
      <button className="btn btn--accent cover-back" onClick={goBack} autoFocus>
        Take me back to {label}
      </button>
      <HoldButton onDone={end} className="cover-hold" />
    </div>
  )
}
