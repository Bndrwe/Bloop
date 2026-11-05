// Pet visibility: hide / show the pet, the global shortcut, nudge pop-ups and the Linux GNOME safety
// net. No electron imports, so everything here is unit-testable; index.ts wires it to the real
// pet window, globalShortcut, the tray and notifications.
import { petShortcut as petShortcutFor } from '@shared/petShortcut'
import type { PetMood, Settings } from '@shared/types'

export { petShortcutFor as petShortcut }

/** How long a nudge shows a hidden pet before it hides again. */
export const NUDGE_POP_MS = 8000

/** Tray / context-menu label for the toggle, with the shortcut hint when it is registered. */
export function petToggleLabel(shown: boolean, shortcutLabel: string | null): string {
  const base = shown ? 'Hide pet' : 'Show pet'
  return shortcutLabel ? `${base} (${shortcutLabel})` : base
}

/** Speech bubbles that count as nudges: drifting off task, or a study / deadline reminder. */
export function isNudgeMood(mood: PetMood | undefined): boolean {
  return mood === 'worried' || mood === 'sad' || mood === 'wave'
}

export interface PetVisibilityState {
  /** A nudge pop-up is running (the pet is shown for a few seconds even though showPet is off). */
  nudgePopping: boolean
}

/** The one decision: should the pet window be visible right now? */
export function shouldShowPet(settings: Pick<Settings, 'showPet' | 'showPetForNudges'>, state: PetVisibilityState): boolean {
  if (settings.showPet) return true
  return settings.showPetForNudges && state.nudgePopping
}

/**
 * Linux without a reachable tray (GNOME hides tray icons unless the AppIndicator extension is
 * installed; or the Tray failed outright): a hidden pet would leave Bloop with no visible way in.
 * There we lean on the global shortcut, re-launching `bloop`, and a one-time notification.
 */
export function needsHiddenSafetyNet(o: { platform: NodeJS.Platform; gnome: boolean; trayOk: boolean }): boolean {
  if (o.platform !== 'linux') return false
  return o.gnome || !o.trayOk
}

export function hiddenNoticeText(shortcutLabel: string | null): { title: string; body: string } {
  const how = shortcutLabel ? `Press ${shortcutLabel} or open Bloop again` : 'Open Bloop again'
  return { title: 'Bloop is hidden', body: `Bloop is hidden. ${how} to bring it back.` }
}

/**
 * Validate the pet:context-menu request. Only the pet window may ask, and the optional point is
 * a pair of small finite numbers (window-relative CSS px). Anything else is rejected (null).
 */
export function parsePetContextMenu(isPetSender: boolean, args: unknown[]): { x?: number; y?: number } | null {
  if (!isPetSender) return null
  if (args.length > 1) return null
  if (args.length === 0 || args[0] == null) return {}
  const p = args[0]
  if (typeof p !== 'object' || Array.isArray(p)) return null
  const o = p as Record<string, unknown>
  const keys = Object.keys(o)
  if (keys.some((k) => k !== 'x' && k !== 'y')) return null
  const { x, y } = o
  if (typeof x !== 'number' || typeof y !== 'number' || !Number.isFinite(x) || !Number.isFinite(y)) return null
  if (Math.abs(x) > 10_000 || Math.abs(y) > 10_000) return null
  return { x: Math.round(x), y: Math.round(y) }
}

type Timer = unknown

export interface PetVisibilityDeps {
  getSettings(): Settings
  saveSettings(patch: Partial<Settings>): Settings
  /** Show / hide the actual pet window (never destroy it). */
  setWindowVisible(visible: boolean): void
  /** The visible state changed (rebuild the tray, broadcast settings, …). */
  onChange?(settings: Settings): void
  notify(title: string, body: string): void
  log(msg: string): void
  /** Linux GNOME / no tray: see needsHiddenSafetyNet. */
  safetyNet(): boolean
  /** The shortcut label if the global shortcut registered, else null. */
  shortcutLabel(): string | null
  setTimeout?(fn: () => void, ms: number): Timer
  clearTimeout?(t: Timer): void
}

/** Owns the pet's shown / hidden state. Everything that toggles the pet goes through here. */
export class PetVisibility {
  private popTimer: Timer | null = null
  private noticeShown = false
  private lastShown: boolean | null = null

  constructor(private readonly d: PetVisibilityDeps) {}

  private get st(): (fn: () => void, ms: number) => Timer {
    return this.d.setTimeout ?? ((fn, ms) => setTimeout(fn, ms))
  }

  private get ct(): (t: Timer) => void {
    return this.d.clearTimeout ?? ((t) => clearTimeout(t as ReturnType<typeof setTimeout>))
  }

  /** Is the pet window supposed to be on screen right now? */
  isShown(): boolean {
    return shouldShowPet(this.d.getSettings(), { nudgePopping: this.popTimer !== null })
  }

  /** The user's choice (showPet), ignoring a running nudge pop-up. */
  wanted(): boolean {
    return this.d.getSettings().showPet
  }

  /** Push the current decision to the window. Safe to call any time (idempotent). */
  apply(): void {
    const shown = this.isShown()
    this.d.setWindowVisible(shown)
    this.lastShown = shown
  }

  /** Persist showPet and apply it. `source` is only for the log. */
  set(show: boolean, source: string): void {
    const before = this.d.getSettings()
    if (show) this.cancelPop()
    const next = before.showPet === show ? before : this.d.saveSettings({ showPet: show })
    this.d.log(`pet ${show ? 'shown' : 'hidden'} (${source})`)
    this.apply()
    if (!show) this.hiddenNotice()
    this.d.onChange?.(next)
  }

  toggle(source: string): void {
    this.set(!this.wanted(), source)
  }

  /** settings:save changed showPet / showPetForNudges (the caller broadcasts the new settings). */
  settingsChanged(prev: Settings, next: Settings): void {
    if (prev.showPet === next.showPet && prev.showPetForNudges === next.showPetForNudges) return
    if (next.showPet) this.cancelPop()
    if (!next.showPetForNudges) this.cancelPop()
    if (prev.showPet !== next.showPet) {
      this.d.log(`pet ${next.showPet ? 'shown' : 'hidden'} (settings)`)
      if (!next.showPet) this.hiddenNotice()
    }
    this.apply()
  }

  /** A nudge speech bubble: if the pet is hidden and showPetForNudges is on, pop it up briefly. */
  nudge(): void {
    const s = this.d.getSettings()
    if (s.showPet || !s.showPetForNudges) return
    if (this.popTimer !== null) this.ct(this.popTimer)
    this.popTimer = this.st(() => {
      this.popTimer = null
      this.apply()
    }, NUDGE_POP_MS)
    if (this.lastShown !== true) this.d.log('pet popped up for a nudge')
    this.apply()
  }

  /** Safety net (Linux GNOME / no tray): say once per run how to get the pet back. */
  private hiddenNotice(): void {
    if (this.noticeShown || !this.d.safetyNet()) return
    this.noticeShown = true
    const n = hiddenNoticeText(this.d.shortcutLabel())
    this.d.notify(n.title, n.body)
  }

  private cancelPop(): void {
    if (this.popTimer === null) return
    this.ct(this.popTimer)
    this.popTimer = null
  }

  dispose(): void {
    this.cancelPop()
  }
}

/** The bits of electron's globalShortcut we use (injected so tests can fake it). */
export interface ShortcutRegistry {
  register(accelerator: string, cb: () => void): boolean
  isRegistered(accelerator: string): boolean
}

/**
 * Register the show / hide shortcut. If another app already holds it (register returns false or
 * throws), log it and carry on without it. Returns the label to show in menus, or null.
 */
export function registerPetShortcut(
  gs: ShortcutRegistry,
  platform: string,
  onPress: () => void,
  log: (m: string) => void
): string | null {
  const { accelerator, label } = petShortcutFor(platform)
  try {
    if (gs.register(accelerator, onPress) && gs.isRegistered(accelerator)) {
      log(`shortcut ${label} shows / hides the pet`)
      return label
    }
    log(`shortcut ${label} is taken by another app: skipped (use the tray or the panel to hide / show the pet)`)
  } catch (e) {
    log(`shortcut ${label} could not be registered: ${(e as Error).message}`)
  }
  return null
}

export interface PetMenuActions {
  hidePet(): void
  openPanel(): void
  openSettings(): void
  quit(): void
}

/** The pet's right-click menu (plain MenuItemConstructorOptions, built into a Menu by index.ts). */
export function petContextMenuTemplate(
  a: PetMenuActions,
  accelerator: string | null
): { label?: string; type?: 'separator'; click?: () => void; accelerator?: string; registerAccelerator?: boolean }[] {
  return [
    // the accelerator is only displayed here; globalShortcut owns the real key binding
    { label: 'Hide pet', click: () => a.hidePet(), ...(accelerator ? { accelerator, registerAccelerator: false } : {}) },
    { label: 'Open panel', click: () => a.openPanel() },
    { label: 'Settings…', click: () => a.openSettings() },
    { type: 'separator' },
    { label: 'Quit Bloop', click: () => a.quit() }
  ]
}
