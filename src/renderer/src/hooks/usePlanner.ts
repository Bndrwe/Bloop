import { useEffect, useState } from 'react'
import type { BlockerStatus, PlannerState } from '@shared/planner'

/** First load plus every push from main. `get` / `on` come from window.studyPet. */
function usePushed<T>(get: () => Promise<T>, on: (cb: (v: T) => void) => () => void): [T | null, (v: T) => void] {
  const [value, setValue] = useState<T | null>(null)
  useEffect(() => {
    let alive = true
    let pushed = false // a push is newer than the first load: never let the load overwrite it
    get()
      .then((v) => alive && !pushed && setValue(v))
      .catch(() => undefined)
    const off = on((v) => {
      pushed = true
      if (alive) setValue(v)
    })
    return () => {
      alive = false
      off()
    }
    // get/on are stable functions on window.studyPet
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  return [value, setValue]
}

/** Projects, tasks and their blocks, live. */
export function usePlanner(): [PlannerState | null, (s: PlannerState) => void] {
  const p = window.studyPet.planner
  return usePushed(p.get, p.onChange)
}

/** The website blocker's status, live. */
export function useBlocker(): [BlockerStatus | null, (s: BlockerStatus) => void] {
  const b = window.studyPet.blocker
  return usePushed(b.get, b.onChange)
}
