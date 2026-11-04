import { useEffect, useState } from 'react'
import type { AppStatus } from '@shared/types'

export interface LiveStatus {
  status: AppStatus | null
  /** Live seconds remaining in the current phase. */
  remaining: number
}

export function computeRemaining(status: AppStatus | null, now: number): number {
  if (!status) return 0
  if ((status.phase === 'focus' || status.phase === 'break') && status.phaseEndsAt != null) {
    return Math.max(0, Math.ceil((status.phaseEndsAt - now) / 1000))
  }
  return Math.max(0, Math.round(status.remainingSec))
}

/** Initial status + live pushes from main, with a local 1s clock for the countdown. */
export function useStatus(): LiveStatus {
  const [status, setStatus] = useState<AppStatus | null>(null)
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    let alive = true
    const api = window.studyPet
    if (!api) return
    api
      .getStatus()
      .then((s) => {
        if (alive) setStatus((prev) => prev ?? s)
      })
      .catch(() => undefined)
    const off = api.onStatus((s) => {
      setStatus(s)
      setNow(Date.now())
    })
    return () => {
      alive = false
      off()
    }
  }, [])

  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(id)
  }, [])

  return { status, remaining: computeRemaining(status, now) }
}
