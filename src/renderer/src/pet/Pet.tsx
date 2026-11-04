import { useEffect, useRef } from 'react'
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
  /** Soft dark outline + drop shadow so the pet reads on any wallpaper. */
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

  const style: CSSProperties = { width: size, height: size }
  return (
    <div
      ref={ref}
      className={`pet pet--${mood}${outlined ? ' pet--outlined' : ''}${className ? ` ${className}` : ''}`}
      style={style}
      role="img"
      aria-label={`Study Pet, ${MOOD_LABEL[mood]}`}
    >
      <Skin mood={mood} />
    </div>
  )
}
