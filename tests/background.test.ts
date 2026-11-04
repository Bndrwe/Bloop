import { describe, expect, it } from 'vitest'
import { backgroundTokens, clampPercent, smokeUniforms } from '../src/shared/background'
import { DEFAULT_SETTINGS, mergeSettings } from '../src/main/defaults'

const lin = (v: number): number => (v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4))
const contrast = (fg: number, bg: number): number => (lin(fg) + 0.05) / (lin(bg) + 0.05)

describe('smokeUniforms', () => {
  it('is black at 0 and rises monotonically', () => {
    expect(smokeUniforms(0, 40).gain).toBe(0)
    let prev = -1
    for (let i = 0; i <= 100; i += 5) {
      const g = smokeUniforms(i, 40).gain
      expect(g).toBeGreaterThan(prev)
      prev = g
    }
  })
  it('puts crests around 25-35% grey at the default and stays tasteful at 100', () => {
    const g = smokeUniforms(55, 40).gain
    expect(g).toBeGreaterThan(0.25)
    expect(g).toBeLessThan(0.35)
    expect(smokeUniforms(100, 40).gain).toBeLessThanOrEqual(0.6)
    expect(smokeUniforms(25, 40).gain).toBeLessThan(0.15)
  })
  it('speed 0 is a still frame, 40 is the original drift', () => {
    expect(smokeUniforms(55, 0).speed).toBe(0)
    expect(smokeUniforms(55, 40).speed).toBeCloseTo(1)
    expect(smokeUniforms(55, 100).speed).toBeGreaterThan(smokeUniforms(55, 70).speed)
  })
  it('clamps junk input', () => {
    expect(smokeUniforms(500, -3).gain).toBeCloseTo(0.6)
    expect(smokeUniforms(NaN, NaN)).toEqual(smokeUniforms(55, 40))
    expect(clampPercent('x', 7)).toBe(7)
  })
})

describe('backgroundTokens', () => {
  it('card opacity falls from ~0.97 to ~0.90 as intensity rises', () => {
    expect(backgroundTokens(0).cardAlpha).toBeCloseTo(0.97)
    expect(backgroundTokens(100).cardAlpha).toBeCloseTo(0.9)
    expect(backgroundTokens(100, false).cardAlpha).toBeCloseTo(0.97)
  })
  it('tertiary text keeps AA contrast under the brightest smoke seen through a card', () => {
    for (let i = 0; i <= 100; i += 5) {
      const { gain } = smokeUniforms(i, 40)
      const { cardAlpha, tertiary } = backgroundTokens(i)
      const bg = gain * (1 - cardAlpha) // grey behind the text, over black card ink
      const fg = parseInt(tertiary.slice(1, 3), 16) / 255
      expect(contrast(fg, bg)).toBeGreaterThanOrEqual(4.5)
    }
  })
})

describe('background settings', () => {
  it('defaults and clamps', () => {
    expect(DEFAULT_SETTINGS.backgroundEnabled).toBe(true)
    expect(mergeSettings({ backgroundIntensity: 900, backgroundSpeed: -4 }).backgroundIntensity).toBe(100)
    expect(mergeSettings({ backgroundIntensity: 900, backgroundSpeed: -4 }).backgroundSpeed).toBe(0)
    expect(mergeSettings({ backgroundIntensity: 'x' as unknown as number }).backgroundIntensity).toBe(55)
    expect(mergeSettings({ backgroundEnabled: 'no' as unknown as boolean }).backgroundEnabled).toBe(true)
    expect(mergeSettings({}).backgroundInteractive).toBe(true)
  })
})
