import type { CSSProperties } from 'react'
import type { PetMood } from '@shared/types'
import { skins, DEFAULT_SKIN, type SkinName } from './skins'
import './pet.css'

export interface PetProps {
  mood: PetMood
  /** Rendered width/height in px. */
  size: number
  skin?: SkinName
  className?: string
}

/** The one swappable pet component. Swap the art via the `skin` prop / skins registry. */
export function Pet({ mood, size, skin = DEFAULT_SKIN, className }: PetProps): JSX.Element {
  const Skin = skins[skin] ?? skins[DEFAULT_SKIN]
  const style: CSSProperties = { width: size, height: size }
  return (
    <div
      className={`pet pet--${mood}${className ? ` ${className}` : ''}`}
      style={style}
      role="img"
      aria-label={`Study Pet looks ${mood}`}
    >
      <Skin mood={mood} />
    </div>
  )
}
