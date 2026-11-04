// Background smoke: slider values (0–100) → shader uniforms and card tokens.
// Pure, so it is shared by the shader, the renderer's CSS tokens and the tests.

export const DEFAULT_BACKGROUND_INTENSITY = 55
export const DEFAULT_BACKGROUND_SPEED = 40

export function clampPercent(value: unknown, fallback: number): number {
  const n = typeof value === 'number' ? value : Number(value)
  if (value === null || value === '' || !Number.isFinite(n)) return fallback
  return Math.min(100, Math.max(0, Math.round(n)))
}

/** Brightest smoke (a lit crest) at slider 100, as a 0–1 grey. */
export const SMOKE_MAX_PEAK = 0.6
/** Drift multiplier at slider 100. Slider 40 is 1x, the original slow drift. */
export const SMOKE_MAX_SPEED = 3.6

export interface SmokeUniforms {
  /** Grey of the brightest crest, 0–1. The shader scales its normalised smoke by this. */
  gain: number
  /** Multiplier on the drift clock. 0 holds a still frame. */
  speed: number
}

/**
 * Intensity: a power curve (t^1.2) on the peak grey, so equal slider steps look like equal steps.
 * 0 is black, 25 a faint veil (~12%), 55 clearly visible (~29% crests), 100 bold (60%).
 * Speed: 0 is still, 40 is the original dreamy drift, 100 is about 3.6x.
 */
export function smokeUniforms(intensity: number, speed: number): SmokeUniforms {
  const i = clampPercent(intensity, DEFAULT_BACKGROUND_INTENSITY) / 100
  const s = clampPercent(speed, DEFAULT_BACKGROUND_SPEED)
  return {
    gain: SMOKE_MAX_PEAK * Math.pow(i, 1.2),
    speed: s === 0 ? 0 : Math.min(SMOKE_MAX_SPEED, Math.pow(s / 40, 1.4))
  }
}

export interface BackgroundTokens {
  /** Card background opacity: ~0.60 at low intensity, ~0.45 at high, so the smoke reads through. */
  cardAlpha: number
  /** Tertiary text grey (hex), lifted as more smoke shows through so it keeps AA contrast. */
  tertiary: string
}

/** WCAG relative luminance of an sRGB grey (0–1). */
function lum(v: number): number {
  return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)
}

/** WCAG contrast ratio between two sRGB greys (0–1). */
export function greyContrast(a: number, b: number): number {
  const [hi, lo] = lum(a) > lum(b) ? [lum(a), lum(b)] : [lum(b), lum(a)]
  return (hi + 0.05) / (lo + 0.05)
}

export function backgroundTokens(intensity: number, enabled = true): BackgroundTokens {
  if (!enabled) return { cardAlpha: 0.6, tertiary: '#7d7d7d' }
  const i = clampPercent(intensity, DEFAULT_BACKGROUND_INTENSITY)
  const t = i / 100
  const cardAlpha = Math.round((0.6 - 0.15 * t) * 1000) / 1000
  // Worst case: the brightest crest seen through the card, behind the text (cards also blur it).
  const behind = smokeUniforms(i, DEFAULT_BACKGROUND_SPEED).gain * (1 - cardAlpha)
  let v = 125 // #7d at rest
  while (v < 255 && greyContrast(v / 255, behind) < 4.6) v++
  const h = v.toString(16).padStart(2, '0')
  return { cardAlpha, tertiary: `#${h}${h}${h}` }
}
