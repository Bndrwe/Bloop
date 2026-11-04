import type { FC } from 'react'
import type { PetMood } from '@shared/types'

export interface PetSkinProps {
  mood: PetMood
}

/**
 * A pet skin renders the creature for a given mood. It should fill its container
 * (e.g. an <svg width="100%" height="100%">) — <Pet> handles sizing and the
 * per-mood CSS animation classes (see pet.css: `.pet--<mood>` and the `pb-*` hooks).
 */
export type PetSkin = FC<PetSkinProps>
