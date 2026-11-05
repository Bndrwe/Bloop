import { useCallback, useEffect, useState } from 'react'
import type { BrightspaceStatus } from '@shared/types'

/** Live Brightspace login status: the first load, then every `brightspace:status-push`. */
export function useBrightspace(): { status: BrightspaceStatus | null; setStatus: (s: BrightspaceStatus) => void; reload: () => void } {
  const [status, setStatus] = useState<BrightspaceStatus | null>(null)
  const reload = useCallback(() => {
    const api = window.studyPet
    if (!api?.brightspaceStatus) return
    api.brightspaceStatus().then(setStatus).catch(() => undefined)
  }, [])
  useEffect(() => {
    const api = window.studyPet
    if (!api?.onBrightspaceStatus) return
    let alive = true
    reload()
    const off = api.onBrightspaceStatus((s) => alive && setStatus(s))
    return () => {
      alive = false
      off()
    }
  }, [reload])
  return { status, setStatus, reload }
}
