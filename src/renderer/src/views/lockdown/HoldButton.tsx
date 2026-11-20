import { useCallback, useEffect, useRef, useState } from 'react'
import { LOCKDOWN_HOLD_SEC } from '@shared/lockdown'

/**
 * "Hold to end lockdown": press and hold (mouse, touch, Space or Enter) for LOCKDOWN_HOLD_SEC.
 * Letting go early resets it. The friction is the point: ending should be a decision, not a reflex.
 */
export function HoldButton({ onDone, label = 'Hold to end lockdown', className = '' }: { onDone: () => void; label?: string; className?: string }): JSX.Element {
  const [progress, setProgress] = useState(0)
  const start = useRef<number | null>(null)
  const raf = useRef<number | null>(null)
  const done = useRef(false)

  const stop = useCallback(() => {
    start.current = null
    if (raf.current !== null) cancelAnimationFrame(raf.current)
    raf.current = null
    if (!done.current) setProgress(0)
  }, [])

  const step = useCallback(() => {
    if (start.current === null) return
    const p = Math.min(1, (performance.now() - start.current) / (LOCKDOWN_HOLD_SEC * 1000))
    setProgress(p)
    if (p >= 1) {
      done.current = true
      start.current = null
      raf.current = null
      onDone()
      return
    }
    raf.current = requestAnimationFrame(step)
  }, [onDone])

  const begin = useCallback(() => {
    if (start.current !== null || done.current) return
    start.current = performance.now()
    raf.current = requestAnimationFrame(step)
  }, [step])

  useEffect(() => stop, [stop])

  const left = Math.ceil(LOCKDOWN_HOLD_SEC * (1 - progress))
  return (
    <button
      type="button"
      className={`hold-btn ${className}`}
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture(e.pointerId)
        begin()
      }}
      onPointerUp={stop}
      onPointerCancel={stop}
      onLostPointerCapture={stop}
      onKeyDown={(e) => {
        if ((e.key === ' ' || e.key === 'Enter') && !e.repeat) {
          e.preventDefault()
          begin()
        }
      }}
      onKeyUp={(e) => {
        if (e.key === ' ' || e.key === 'Enter') stop()
      }}
      onBlur={stop}
      aria-label={`${label} (hold for ${LOCKDOWN_HOLD_SEC} seconds)`}
    >
      <span className="hold-fill" style={{ transform: `scaleX(${progress})` }} aria-hidden="true" />
      <span className="hold-text">{progress > 0 && progress < 1 ? `Keep holding… ${left}s` : label}</span>
    </button>
  )
}
