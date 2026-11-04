import { useCallback, useEffect, useRef, useState } from 'react'
import type { PointerEvent as ReactPointerEvent } from 'react'
import { animate } from 'animejs'
import { Pet } from '../pet/Pet'
import { prefersReducedMotion } from '../lib/motion'
import { useStatus } from '../hooks/useStatus'
import { mmss, phaseLabel, scoreBand, scoreLevel, scoreText } from '../lib/format'
import './pet-view.css'

const PET_SIZE = 110

/** Paper-and-ink speech bubble; pops in on mount (remounted per messageId). */
function Bubble({ text, onEnter, onLeave }: { text: string; onEnter: () => void; onLeave: () => void }): JSX.Element {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const reduce = prefersReducedMotion()
    const anim = animate(
      el,
      reduce
        ? { opacity: { from: 0, to: 1 }, duration: 160, ease: 'linear' }
        : {
            opacity: { from: 0, to: 1, duration: 200 },
            scale: { from: 0.55, to: 1 },
            translateY: { from: 8, to: 0 },
            duration: 460,
            ease: 'outBack(1.4)'
          }
    )
    return () => {
      anim.revert()
    }
  }, [])
  return (
    <div className="pv-bubble" ref={ref} role="status" onMouseEnter={onEnter} onMouseLeave={onLeave}>
      <span>{text}</span>
    </div>
  )
}

export function PetView(): JSX.Element {
  const { status, remaining } = useStatus()
  const [hover, setHover] = useState(false)
  const hoverCount = useRef(0)
  const dragging = useRef(false)
  const ignoring = useRef<boolean | null>(null)

  const setIgnore = useCallback((ignore: boolean) => {
    if (ignoring.current === ignore) return
    ignoring.current = ignore
    void window.studyPet?.setIgnoreMouse(ignore).catch(() => undefined)
  }, [])

  // Start interactive over the pet; the first mouseleave switches to click-through.
  useEffect(() => {
    setIgnore(false)
  }, [setIgnore])

  const onEnter = useCallback(() => {
    hoverCount.current += 1
    setHover(true)
    setIgnore(false)
  }, [setIgnore])

  const onLeave = useCallback(() => {
    hoverCount.current = Math.max(0, hoverCount.current - 1)
    if (hoverCount.current === 0) {
      setHover(false)
      if (!dragging.current) setIgnore(true)
    }
  }, [setIgnore])

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>): void => {
    if (e.button !== 0) return
    dragging.current = true
    try {
      e.currentTarget.setPointerCapture(e.pointerId)
    } catch {
      /* ignore */
    }
    void window.studyPet?.dragStart().catch(() => undefined)
  }

  const onPointerUp = (e: ReactPointerEvent<HTMLDivElement>): void => {
    if (!dragging.current) return
    dragging.current = false
    try {
      e.currentTarget.releasePointerCapture(e.pointerId)
    } catch {
      /* ignore */
    }
    const api = window.studyPet
    if (!api) return
    api
      .dragEnd()
      .then((r) => {
        if (!r.moved) return api.togglePanel()
        return undefined
      })
      .catch(() => undefined)
      .finally(() => {
        if (hoverCount.current === 0) setIgnore(true)
      })
  }

  const mood = status?.pet.mood ?? 'idle'
  const message = status?.pet.message ?? null
  const phase = status?.phase ?? 'idle'
  const level = scoreLevel(status?.score)
  const showTimer = phase === 'focus' || phase === 'break' || phase === 'paused'

  return (
    <div className="pv">
      {message && <Bubble key={status?.pet.messageId} text={message} onEnter={onEnter} onLeave={onLeave} />}

      <div
        className={`pv-pet level-${level}`}
        onMouseEnter={onEnter}
        onMouseLeave={onLeave}
        onPointerDown={onPointerDown}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      >
        <Pet mood={mood} size={PET_SIZE} outlined />
        {status && (status.phase !== 'idle' || status.score != null) && (
          <span className="pv-dot" aria-label={`Focus score ${scoreText(status.score)}, ${scoreBand(status.score)}`} />
        )}
        {hover && (
          <div className="pv-badge">
            <span className="pv-badge-score">{scoreText(status?.score)}</span>
            <span className="pv-badge-phase">{phaseLabel(phase)}</span>
            {showTimer && <span className="pv-badge-time">{mmss(remaining)}</span>}
          </div>
        )}
      </div>
    </div>
  )
}
