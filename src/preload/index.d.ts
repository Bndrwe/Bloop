import type { StudyPetApi } from '../shared/types'

declare global {
  interface Window {
    studyPet: StudyPetApi
  }
}

export {}
