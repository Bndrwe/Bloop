import { useCallback, useEffect, useState } from 'react'
import type { AiSettings, AiStatus } from '@shared/ai'

/**
 * Live AI status + settings for any window: the first load, then every `ai:status` push.
 * Settings are re-read on each push (choices made in another window show up here too).
 */
export function useAi(): {
  status: AiStatus | null
  settings: AiSettings | null
  setSettings: (s: AiSettings) => void
  refresh: (deep?: boolean) => Promise<void>
} {
  const [status, setStatus] = useState<AiStatus | null>(null)
  const [settings, setSettings] = useState<AiSettings | null>(null)

  const refresh = useCallback(async (deep = false) => {
    const ai = window.studyPet?.ai
    if (!ai) return
    const [st, se] = await Promise.all([ai.getStatus(deep), ai.getSettings()])
    setStatus(st)
    setSettings(se)
  }, [])

  useEffect(() => {
    const ai = window.studyPet?.ai
    if (!ai) return
    let alive = true
    refresh().catch(() => undefined)
    const off = ai.onStatus((s) => {
      if (!alive) return
      setStatus(s)
      ai.getSettings()
        .then((se) => alive && setSettings(se))
        .catch(() => undefined)
    })
    return () => {
      alive = false
      off()
    }
  }, [refresh])

  return { status, settings, setSettings, refresh }
}

export function formatBytes(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n) || n <= 0) return '—'
  if (n >= 1024 ** 3) return `${(n / 1024 ** 3).toFixed(1)} GB`
  return `${Math.max(1, Math.round(n / 1024 ** 2))} MB`
}
