import { useEffect, useState } from 'react'
import { Icon } from '../lib/Icon'

/** Panel header pill: hide the pet (eye-off) or, while it is hidden, show it again (eye). */
export function PetToggleButton(): JSX.Element {
  const [shown, setShown] = useState(true)

  useEffect(() => {
    const api = window.studyPet
    if (!api) return
    let alive = true
    api
      .getSettings()
      .then((s) => alive && setShown(s.showPet))
      .catch(() => undefined)
    const off = api.onSettingsChanged((s) => setShown(s.showPet))
    return () => {
      alive = false
      off()
    }
  }, [])

  const label = shown ? 'Hide pet' : 'Show pet'
  return (
    <button
      className="icon-btn icon-btn--pill"
      aria-label={label}
      title={label}
      onClick={() => {
        window.studyPet
          .togglePet()
          .then(setShown)
          .catch(() => undefined)
      }}
    >
      <Icon name={shown ? 'eye-off' : 'eye'} size={15} />
    </button>
  )
}
