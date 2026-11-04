import { useEffect, useState } from 'react'
import type { Settings } from '@shared/types'

const PREVIEW_EVENT = 'bloop:settings-preview'
/** How long a local preview outranks pushes from main (an auto-save echo can lag a drag). */
const PREVIEW_HOLD_MS = 1500

let lastPreview: { patch: Partial<Settings>; at: number } | null = null

/**
 * Show a settings change in this window right away, before it is saved
 * (the Settings window calls this on every slider tick).
 */
export function previewSettings(patch: Partial<Settings>): void {
  lastPreview = { patch: { ...(lastPreview?.patch ?? {}), ...patch }, at: Date.now() }
  window.dispatchEvent(new CustomEvent<Partial<Settings>>(PREVIEW_EVENT, { detail: patch }))
}

/**
 * Live settings for any window: the initial value, then every `settings:changed` push from main
 * and local previews. Null until the first load.
 */
export function useSettings(): Settings | null {
  const [settings, setSettings] = useState<Settings | null>(null)

  useEffect(() => {
    let alive = true
    const api = window.studyPet
    if (!api) return
    api
      .getSettings()
      .then((s) => {
        if (alive) setSettings((prev) => prev ?? s)
      })
      .catch(() => undefined)
    const off = api.onSettingsChanged((s) => {
      const hold = lastPreview && Date.now() - lastPreview.at < PREVIEW_HOLD_MS ? lastPreview.patch : {}
      setSettings({ ...s, ...hold })
    })
    const onPreview = (e: Event): void => {
      const patch = (e as CustomEvent<Partial<Settings>>).detail
      setSettings((prev) => (prev ? { ...prev, ...patch } : prev))
    }
    window.addEventListener(PREVIEW_EVENT, onPreview)
    return () => {
      alive = false
      off()
      window.removeEventListener(PREVIEW_EVENT, onPreview)
    }
  }, [])

  return settings
}
