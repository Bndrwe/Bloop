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
