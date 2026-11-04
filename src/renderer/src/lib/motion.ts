import { useEffect, useRef, type RefObject } from 'react'
import { animate, stagger } from 'animejs'

export function prefersReducedMotion(): boolean {
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches
  } catch {
    return false
  }
}

/**
 * Staggered entrance for the direct children of `ref` matching `selector`, once `ready` is true.
 * Runs once per mount; reduced motion = a short opacity-only fade.
 */
export function useEntrance(ref: RefObject<HTMLElement>, selector: string, ready = true): void {
  const done = useRef(false)
  useEffect(() => {
    const root = ref.current
    if (!root || !ready || done.current) return
    done.current = true
    const targets = Array.from(root.querySelectorAll<HTMLElement>(selector))
    if (targets.length === 0) return
    const reduce = prefersReducedMotion()
    const anim = animate(
      targets,
      reduce
        ? { opacity: { from: 0, to: 1 }, duration: 180, ease: 'linear' }
        : {
            opacity: { from: 0, to: 1 },
            translateY: { from: 12, to: 0 },
            filter: { from: 'blur(6px)', to: 'blur(0px)' },
            duration: 620,
            delay: stagger(55, { start: 40 }),
            ease: 'outExpo',
            onComplete: () => targets.forEach((t) => (t.style.filter = ''))
          }
    )
    return () => {
      anim.pause()
      targets.forEach((t) => {
        t.style.opacity = ''
        t.style.transform = ''
        t.style.filter = ''
      })
    }
  }, [ref, selector, ready])
}

/** Fade/rise a single element in when it first mounts (e.g. a late-loading section). */
export function useReveal(ref: RefObject<HTMLElement>, active: boolean): void {
  const done = useRef(false)
  useEffect(() => {
    const el = ref.current
    if (!el || !active || done.current) return
    done.current = true
    const reduce = prefersReducedMotion()
    const anim = animate(el, {
      opacity: { from: 0, to: 1 },
      ...(reduce ? {} : { translateY: { from: 8, to: 0 } }),
      duration: reduce ? 180 : 480,
      ease: 'outExpo'
    })
    return () => {
      anim.pause()
      el.style.opacity = ''
      el.style.transform = ''
    }
  }, [ref, active])
}

/** Pop a freshly mounted element in (toasts, inline confirmations). Remount it (new key) to replay. */
export function usePopIn(ref: RefObject<HTMLElement>): void {
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const reduce = prefersReducedMotion()
    const anim = animate(
      el,
      reduce
        ? { opacity: { from: 0, to: 1 }, duration: 160, ease: 'linear' }
        : { opacity: { from: 0, to: 1 }, translateY: { from: 10, to: 0 }, scale: { from: 0.94, to: 1 }, duration: 420, ease: 'outBack(1.6)' }
    )
    return () => {
      anim.revert()
    }
  }, [ref])
}

/**
 * One-time staggered pop for small repeated items (chips, bars) inside `ref`, once `ready`.
 * `grow` makes items rise from their baseline (scaleY) instead of popping (scale).
 */
export function useStaggerIn(ref: RefObject<Element>, selector: string, ready = true, grow = false): void {
  const done = useRef(false)
  useEffect(() => {
    const root = ref.current
    if (!root || !ready || done.current) return
    const targets = Array.from(root.querySelectorAll<HTMLElement | SVGElement>(selector))
    if (targets.length === 0) return
    done.current = true
    if (prefersReducedMotion()) return
    const anim = animate(
      targets,
      grow
        ? { scaleY: { from: 0, to: 1 }, duration: 900, delay: stagger(70, { start: 260 }), ease: 'outExpo' }
        : {
            opacity: { from: 0, to: 1 },
            scale: { from: 0.6, to: 1 },
            duration: 520,
            delay: stagger(35, { start: 220 }),
            ease: 'outBack(1.8)'
          }
    )
    return () => {
      anim.revert()
    }
  }, [ref, selector, ready, grow])
}

/** Soft breathing loop for loading placeholders (replaces a CSS keyframe shimmer). */
export function useBreathe(ref: RefObject<Element>, selector: string, active: boolean): void {
  useEffect(() => {
    const root = ref.current
    if (!root || !active) return
    const targets = Array.from(root.querySelectorAll(selector))
    if (targets.length === 0 || prefersReducedMotion()) return
    const anim = animate(targets, {
      opacity: { from: 1, to: 0.35 },
      duration: 900,
      delay: stagger(160),
      ease: 'inOutSine',
      loop: true,
      alternate: true
    })
    return () => {
      anim.revert()
    }
  }, [ref, selector, active])
}

/**
 * Number that counts toward `value` with one anime.js tween whenever it changes.
 * `format` turns the in-flight number into text (e.g. minutes); null shows an em dash.
 */
export function useCountUp(
  ref: RefObject<HTMLElement>,
  value: number | null | undefined,
  format: (n: number) => string = (n) => String(Math.round(n))
): void {
  const shown = useRef({ v: 0 })
  const fmt = useRef(format)
  fmt.current = format
  useEffect(() => {
    const el = ref.current
    if (!el) return
    if (value == null) {
      el.textContent = '—'
      return
    }
    const paint = (): void => {
      el.textContent = fmt.current(shown.current.v)
    }
    if (prefersReducedMotion() || Math.abs(value - shown.current.v) < 0.5) {
      shown.current.v = value
      paint()
      return
    }
    const anim = animate(shown.current, { v: value, duration: 1000, ease: 'outExpo', onUpdate: paint, onComplete: paint })
    return () => {
      anim.pause()
    }
  }, [ref, value])
}
