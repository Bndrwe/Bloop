import { useEffect, useId, useRef } from 'react'
import type { CSSProperties } from 'react'
import type { PetMood } from '@shared/types'
import { skins, DEFAULT_SKIN, type SkinName } from './skins'
import { startMoodMotion } from './motion'
import './pet.css'

export interface PetProps {
  mood: PetMood
  /** Rendered width/height in px. */
  size: number
  skin?: SkinName
  /** Desktop pet (kept for API stability; the ink-outlined art already reads on any wallpaper). */
  outlined?: boolean
  className?: string
}

const MOOD_LABEL: Record<PetMood, string> = {
  idle: 'calm',
  happy: 'happy',
  worried: 'worried',
  sad: 'sad',
  sleeping: 'asleep',
  celebrate: 'celebrating',
  wave: 'waving'
}

/** The one swappable pet component. Art comes from the skins registry; motion from pet/motion.ts. */
export function Pet({ mood, size, skin = DEFAULT_SKIN, outlined = false, className }: PetProps): JSX.Element {
  const ref = useRef<HTMLDivElement>(null)
  const Skin = skins[skin] ?? skins[DEFAULT_SKIN]

  // Restart choreography only when the mood or skin changes (not on status ticks).
  useEffect(() => {
    const el = ref.current
    if (!el) return
    return startMoodMotion(el, mood)
  }, [mood, skin])

  // A flat white "sticker cut" around the ink outline (dilate, no blur): invisible on light
  // backgrounds, it keeps the black linework legible on dark wallpapers and the black panel.
  const haloId = `pet-halo-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`
  const halo = Math.max(1, Math.round(size / 55))
  const style = { width: size, height: size, '--pet-halo': `url(#${haloId})` } as CSSProperties
  return (
    <div
      ref={ref}
      className={`pet pet--${mood}${outlined ? ' pet--outlined' : ''}${className ? ` ${className}` : ''}`}
      style={style}
      role="img"
      aria-label={`Study Pet, ${MOOD_LABEL[mood]}`}
    >
      <svg className="pet-halo-defs" width="0" height="0" aria-hidden="true" focusable="false">
        <filter id={haloId} x="-20%" y="-20%" width="140%" height="140%" colorInterpolationFilters="sRGB">
          <feMorphology in="SourceAlpha" operator="dilate" radius={halo} result="grown" />
          <feFlood floodColor="#fff" result="paper" />
          <feComposite in="paper" in2="grown" operator="in" result="halo" />
          <feMerge>
            <feMergeNode in="halo" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </svg>
      <Skin mood={mood} />
    </div>
  )
}
