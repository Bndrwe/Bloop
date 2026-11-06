/**
 * The pet's hover badge circle: the focus score while there is one; otherwise "+" while the panel
 * is closed and "–" while it is open (clicking the pet opens / closes it).
 */
export function badgeText(score: number | null | undefined, panelOpen: boolean): string {
  if (score != null) return String(Math.round(score))
  return panelOpen ? '–' : '+'
}

/** Accessible name for the pet, which toggles the panel on click. */
export function panelToggleLabel(panelOpen: boolean): string {
  return panelOpen ? 'Close panel' : 'Open panel'
}
