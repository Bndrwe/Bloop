// Lockdown constants shared by main and the renderer.

/** "Hold to end lockdown" takes this many seconds of holding. */
export const LOCKDOWN_HOLD_SEC = 10
/** Lengths offered in the panel, in minutes. */
export const LOCKDOWN_PRESETS = [25, 50, 90] as const
export const LOCKDOWN_MIN_MINUTES = 1
export const LOCKDOWN_MAX_MINUTES = 240
