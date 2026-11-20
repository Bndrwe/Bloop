import { useEffect, useState } from 'react'
import type { LockdownStatus } from '@shared/types'

/** Live lockdown status: the first load, then every `lockdown:push` (once a second while it runs). */
export function useLockdown(): LockdownStatus | null {
  const [status, setStatus] = useState<LockdownStatus | null>(null)
  useEffect(() => {
    const api = window.studyPet
    if (!api?.getLockdown) return
    let alive = true
    api.getLockdown().then((s) => alive && setStatus(s)).catch(() => undefined)
    const off = api.onLockdown((s) => alive && setStatus(s))
    return () => {
      alive = false
      off()
    }
  }, [])
  return status
}
