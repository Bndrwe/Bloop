import type { Settings } from '@shared/types'
import { petShortcut } from '@shared/petShortcut'

const isMac = typeof navigator !== 'undefined' && /Mac/i.test(navigator.platform || navigator.userAgent)

/** Settings rows: "Show the pet on screen" (+ the shortcut) and "Pop up for nudges while hidden". */
export function PetVisibilityRows({
  settings,
  update
}: {
  settings: Settings
  update: (patch: Partial<Settings>) => void
}): JSX.Element {
  const shortcut = petShortcut(isMac ? 'darwin' : 'other').label
  return (
    <>
      <label className="row-toggle">
        <span className="row-toggle-text">
          <span>Show the pet on screen</span>
          <span className="faint field-help">
            Press <kbd>{shortcut}</kbd> anywhere to hide or show it. Tracking and nudges keep running while it’s hidden.
          </span>
        </span>
        <span className="toggle">
          <input type="checkbox" checked={settings.showPet} onChange={(e) => update({ showPet: e.target.checked })} />
          <span />
        </span>
      </label>
      <label className={`row-toggle${settings.showPet ? ' row-toggle--off' : ''}`}>
        <span className="row-toggle-text">
          <span>Pop up for nudges while hidden</span>
          <span className="faint field-help">Shows the pet for a few seconds, then hides it again. Off: notifications only.</span>
        </span>
        <span className="toggle">
          <input
            type="checkbox"
            checked={settings.showPetForNudges}
            disabled={settings.showPet}
            onChange={(e) => update({ showPetForNudges: e.target.checked })}
          />
          <span />
        </span>
      </label>
    </>
  )
}
