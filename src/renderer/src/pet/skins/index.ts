import { Blobby } from './Blobby'
import type { PetSkin } from './types'

export type { PetSkin, PetSkinProps } from './types'

/** Registry of available pet skins. Add custom art here and select it by name. */
export const skins = {
  blobby: Blobby
} satisfies Record<string, PetSkin>

export type SkinName = keyof typeof skins

export const DEFAULT_SKIN: SkinName = 'blobby'
