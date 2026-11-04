import { animate, stagger, utils } from 'animejs'
import type { PetMood } from '@shared/types'
import { prefersReducedMotion } from '../lib/motion'

/**
 * Mood choreography for any skin. Skins opt in by using these class hooks on SVG groups:
 *   .pb-bob       whole body (bob / bounce / wobble / droop / breathe / jump)
 *   .pb-shadow    ground shadow
 *   .pb-eyes      open eyes (blink)
 *   .pb-sprout    head decoration (sway / wilt)
 *   .pb-arm-wave  raised arm in `wave`
 *   .pb-sparkle   sparkles in `happy`
 *   .pb-sweat     sweat drop in `worried`
 *   .pb-tear      tear in `sad`
 *   .pb-z         floating z's in `sleeping`
 *   .pb-confetto  confetti pieces in `celebrate`
 * Missing hooks are simply skipped. Returns a cleanup that reverts every animation.
 */
export function startMoodMotion(root: Element, mood: PetMood): () => void {
  const q = (sel: string): Element[] => Array.from(root.querySelectorAll(sel))
  const anims: Array<{ revert: () => unknown }> = []
  const run = (sel: string, params: Parameters<typeof animate>[1]): void => {
    const t = q(sel)
    if (t.length) anims.push(animate(t, params))
  }

  if (prefersReducedMotion()) {
    // Still poses, no loops. State stays legible through the art itself.
    if (mood === 'wave') q('.pb-arm-wave').forEach((el) => utils.set(el, { rotate: 18 }))
    if (mood === 'sleeping') q('.pb-sprout').forEach((el) => utils.set(el, { rotate: -8 }))
    if (mood === 'sad') q('.pb-sprout').forEach((el) => utils.set(el, { rotate: -16 }))
    return () => {
      q('.pb-arm-wave, .pb-sprout').forEach((el) => ((el as SVGElement).style.transform = ''))
    }
  }

  const sine = 'inOutSine'

  // Blink for any open eyes.
  run('.pb-eyes', {
    scaleY: [
      { to: 0.1, duration: 80, ease: 'inQuad' },
      { to: 1, duration: 120, ease: 'outQuad' }
    ],
    delay: 1200,
    loop: true,
    loopDelay: 4200
  })

  switch (mood) {
    case 'idle':
    case 'wave':
      run('.pb-bob', { translateY: { from: 0, to: -3.5 }, duration: 1500, ease: sine, loop: true, alternate: true })
      run('.pb-shadow', { scaleX: { from: 1, to: 0.9 }, opacity: { from: 0.13, to: 0.08 }, duration: 1500, ease: sine, loop: true, alternate: true })
      run('.pb-sprout', { rotate: { from: -4, to: 5 }, duration: 2000, ease: sine, loop: true, alternate: true })
      if (mood === 'wave') {
        run('.pb-arm-wave', { rotate: { from: -12, to: 30 }, duration: 420, ease: sine, loop: true, alternate: true })
      }
      break

    case 'happy':
      run('.pb-bob', {
        translateY: [
          { to: 0, duration: 120 },
          { to: -8, duration: 330, ease: 'outQuad' },
          { to: 0, duration: 330, ease: 'inQuad' }
        ],
        scaleX: [
          { to: 1.05, duration: 120 },
          { to: 0.97, duration: 330 },
          { to: 1, duration: 330 }
        ],
        scaleY: [
          { to: 0.95, duration: 120 },
          { to: 1.03, duration: 330 },
          { to: 1, duration: 330 }
        ],
        loop: true
      })
      run('.pb-shadow', { scaleX: { from: 1, to: 0.82 }, duration: 390, ease: sine, loop: true, alternate: true })
      run('.pb-sprout', { rotate: { from: -8, to: 8 }, duration: 390, ease: sine, loop: true, alternate: true })
      run('.pb-sparkle', {
        scale: { from: 0.55, to: 1.1 },
        rotate: { from: 0, to: 25 },
        opacity: { from: 0.35, to: 1 },
        duration: 700,
        delay: stagger(350),
        ease: sine,
        loop: true,
        alternate: true
      })
      break

    case 'worried':
      run('.pb-bob', {
        rotate: [
          { to: -3, duration: 160 },
          { to: 3, duration: 320 },
          { to: 0, duration: 160 }
        ],
        translateX: [
          { to: -1, duration: 160 },
          { to: 1, duration: 320 },
          { to: 0, duration: 160 }
        ],
        ease: sine,
        loop: true,
        loopDelay: 120
      })
      run('.pb-sprout', { rotate: { from: -6, to: 6 }, duration: 320, ease: sine, loop: true, alternate: true })
      run('.pb-sweat', {
        translateY: { from: -2, to: 8 },
        opacity: [
          { to: 1, duration: 300 },
          { to: 1, duration: 900 },
          { to: 0, duration: 300 }
        ],
        duration: 1500,
        ease: 'inQuad',
        loop: true,
        loopDelay: 300
      })
      break

    case 'sad':
      run('.pb-bob', {
        translateY: { from: 0, to: 2 },
        scaleX: { from: 1, to: 1.02 },
        scaleY: { from: 1, to: 0.96 },
        duration: 2000,
        ease: sine,
        loop: true,
        alternate: true
      })
      run('.pb-sprout', { rotate: { from: -14, to: -20 }, duration: 2000, ease: sine, loop: true, alternate: true })
      run('.pb-tear', {
        translateY: [
          { from: 0, to: 0, duration: 500 },
          { to: 14, duration: 1700, ease: 'inQuad' }
        ],
        scale: [
          { from: 0.5, to: 1, duration: 500, ease: 'outQuad' },
          { to: 1, duration: 1700 }
        ],
        opacity: [
          { from: 0, to: 1, duration: 400 },
          { to: 1, duration: 1400 },
          { to: 0, duration: 400 }
        ],
        loop: true,
        loopDelay: 400
      })
      break

    case 'sleeping':
      q('.pb-sprout').forEach((el) => utils.set(el, { rotate: -8 }))
      run('.pb-bob', {
        scaleX: { from: 1, to: 1.035 },
        scaleY: { from: 1, to: 0.965 },
        duration: 2000,
        ease: sine,
        loop: true,
        alternate: true
      })
      run('.pb-z', {
        translateX: { from: 0, to: 6 },
        translateY: { from: 4, to: -10 },
        scale: { from: 0.6, to: 1.1 },
        opacity: [
          { from: 0, to: 1, duration: 900 },
          { to: 0, duration: 2100 }
        ],
        duration: 3000,
        delay: stagger(1500),
        ease: 'outSine',
        loop: true
      })
      break

    case 'celebrate':
      run('.pb-bob', {
        translateY: [
          { to: 0, duration: 100 },
          { to: -14, duration: 300, ease: 'outCubic' },
          { to: -14, duration: 100 },
          { to: 0, duration: 300, ease: 'inCubic' }
        ],
        scaleX: [
          { to: 1.06, duration: 100 },
          { to: 0.96, duration: 300 },
          { to: 0.98, duration: 100 },
          { to: 1.06, duration: 300 }
        ],
        scaleY: [
          { to: 0.94, duration: 100 },
          { to: 1.05, duration: 300 },
          { to: 1.02, duration: 100 },
          { to: 0.94, duration: 300 }
        ],
        loop: true
      })
      run('.pb-shadow', {
        scaleX: [
          { to: 0.7, duration: 400, ease: 'outCubic' },
          { to: 1, duration: 400, ease: 'inCubic' }
        ],
        loop: true
      })
      run('.pb-sprout', { rotate: { from: -10, to: 10 }, duration: 400, ease: sine, loop: true, alternate: true })
      // Burst in, then keep tumbling.
      run('.pb-confetto', {
        scale: { from: 0, to: 1, duration: 500, ease: 'outBack(2)' },
        delay: stagger(60)
      })
      run('.pb-confetto', {
        rotate: { from: 0, to: 360 },
        translateY: [
          { to: 3, duration: 800 },
          { to: -3, duration: 800 }
        ],
        duration: 1600,
        delay: stagger(110),
        ease: 'linear',
        loop: true,
        composition: 'blend'
      })
      break
  }

  return () => anims.forEach((a) => a.revert())
}
