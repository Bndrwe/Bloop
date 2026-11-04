import { useEffect, useState } from 'react'

export type WindowAwake = {
  /** The page reports itself visible. */
  visible: boolean
  /** The window has focus (assumed true until a blur says otherwise). */
  focused: boolean
}

/**
 * Tracks whether this window is visible and focused, so shaders can stop drawing when nobody's
 * looking. A hidden Electron window doesn't always report itself hidden, so focus is tracked too.
 */
export function useWindowAwake(): WindowAwake {
  const [state, setState] = useState<WindowAwake>(() => ({
    visible: document.visibilityState !== 'hidden',
    focused: true
  }))
  useEffect(() => {
    const onVisibility = (): void => setState((s) => ({ ...s, visible: document.visibilityState !== 'hidden' }))
    const onFocus = (): void => setState({ visible: document.visibilityState !== 'hidden', focused: true })
    const onBlur = (): void => setState((s) => ({ ...s, focused: false }))
    document.addEventListener('visibilitychange', onVisibility)
    window.addEventListener('focus', onFocus)
    window.addEventListener('blur', onBlur)
    return () => {
      document.removeEventListener('visibilitychange', onVisibility)
      window.removeEventListener('focus', onFocus)
      window.removeEventListener('blur', onBlur)
    }
  }, [])
  return state
}
