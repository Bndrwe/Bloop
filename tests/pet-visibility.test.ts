// Hide / show the pet: settings, the visibility decision, nudge pop-ups, the global shortcut,
// the Linux GNOME safety net and the pet:context-menu IPC validation (src/main/petVisibility.ts).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_SETTINGS, mergeSettings } from '../src/main/defaults'
import {
  hiddenNoticeText,
  isNudgeMood,
  needsHiddenSafetyNet,
  NUDGE_POP_MS,
  parsePetContextMenu,
  petContextMenuTemplate,
  petShortcut,
  petToggleLabel,
  PetVisibility,
  registerPetShortcut,
  shouldShowPet,
  type ShortcutRegistry
} from '../src/main/petVisibility'
import { isGnomeDesktop } from '../src/main/linux'
import type { Settings } from '../src/shared/types'

describe('mergeSettings: showPet / showPetForNudges', () => {
  it('defaults both to true (old settings files have neither)', () => {
    expect(DEFAULT_SETTINGS.showPet).toBe(true)
    expect(DEFAULT_SETTINGS.showPetForNudges).toBe(true)
    const m = mergeSettings({ focusMinutes: 30 } as Partial<Settings>)
    expect(m.showPet).toBe(true)
    expect(m.showPetForNudges).toBe(true)
    expect(mergeSettings(undefined).showPet).toBe(true)
  })
  it('keeps real booleans', () => {
    const m = mergeSettings({ showPet: false, showPetForNudges: false })
    expect(m.showPet).toBe(false)
    expect(m.showPetForNudges).toBe(false)
  })
  it('replaces anything that is not a boolean with the default', () => {
    for (const bad of ['false', 0, 1, null, {}, [], 'no']) {
      const m = mergeSettings({ showPet: bad, showPetForNudges: bad } as unknown as Partial<Settings>)
      expect(m.showPet, String(bad)).toBe(true)
      expect(m.showPetForNudges, String(bad)).toBe(true)
    }
  })
})

describe('shouldShowPet', () => {
  it('shows the pet when showPet is on, whatever else is going on', () => {
    expect(shouldShowPet({ showPet: true, showPetForNudges: false }, { nudgePopping: false })).toBe(true)
    expect(shouldShowPet({ showPet: true, showPetForNudges: true }, { nudgePopping: true })).toBe(true)
  })
  it('hidden pet: only a running nudge pop-up shows it, and only if allowed', () => {
    expect(shouldShowPet({ showPet: false, showPetForNudges: true }, { nudgePopping: false })).toBe(false)
    expect(shouldShowPet({ showPet: false, showPetForNudges: true }, { nudgePopping: true })).toBe(true)
    expect(shouldShowPet({ showPet: false, showPetForNudges: false }, { nudgePopping: true })).toBe(false)
  })
  it('treats drifting and reminders as nudges, not cheers', () => {
    expect(isNudgeMood('worried')).toBe(true)
    expect(isNudgeMood('sad')).toBe(true)
    expect(isNudgeMood('wave')).toBe(true)
    for (const m of ['happy', 'idle', 'sleeping', 'celebrate', undefined] as const) expect(isNudgeMood(m)).toBe(false)
  })
})

function harness(initial: Partial<Settings> = {}, opts: { safetyNet?: boolean; shortcut?: string | null } = {}) {
  let settings = mergeSettings(initial)
  const visible: boolean[] = []
  const notes: { title: string; body: string }[] = []
  const changes: Settings[] = []
  const pv = new PetVisibility({
    getSettings: () => settings,
    saveSettings: (patch) => (settings = mergeSettings({ ...settings, ...patch })),
    setWindowVisible: (v) => visible.push(v),
    onChange: (s) => changes.push(s),
    notify: (title, body) => notes.push({ title, body }),
    log: () => undefined,
    safetyNet: () => opts.safetyNet ?? false,
    shortcutLabel: () => (opts.shortcut === undefined ? 'Ctrl+Shift+B' : opts.shortcut)
  })
  return {
    pv,
    visible,
    notes,
    changes,
    get settings() {
      return settings
    },
    setSettings(p: Partial<Settings>) {
      const prev = settings
      settings = mergeSettings({ ...settings, ...p })
      pv.settingsChanged(prev, settings)
    }
  }
}

describe('PetVisibility', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('toggle hides and shows the window and persists showPet', () => {
    const h = harness()
    h.pv.apply()
    expect(h.visible.at(-1)).toBe(true)
    h.pv.toggle('tray')
    expect(h.settings.showPet).toBe(false)
    expect(h.visible.at(-1)).toBe(false)
    expect(h.pv.isShown()).toBe(false)
    expect(h.changes.at(-1)?.showPet).toBe(false)
    h.pv.toggle('shortcut')
    expect(h.settings.showPet).toBe(true)
    expect(h.visible.at(-1)).toBe(true)
  })

  it('a nudge pops a hidden pet up for ~8 s, then hides it again', () => {
    const h = harness({ showPet: false })
    h.pv.apply()
    expect(h.visible.at(-1)).toBe(false)
    h.pv.nudge()
    expect(h.visible.at(-1)).toBe(true)
    expect(h.pv.isShown()).toBe(true)
    expect(h.pv.wanted()).toBe(false) // the user's choice is unchanged
    vi.advanceTimersByTime(NUDGE_POP_MS - 1)
    expect(h.visible.at(-1)).toBe(true)
    vi.advanceTimersByTime(1)
    expect(h.visible.at(-1)).toBe(false)
    expect(h.settings.showPet).toBe(false)
  })

  it('a second nudge during a pop-up restarts the 8 s window', () => {
    const h = harness({ showPet: false })
    h.pv.nudge()
    vi.advanceTimersByTime(5000)
    h.pv.nudge()
    vi.advanceTimersByTime(5000)
    expect(h.pv.isShown()).toBe(true)
    vi.advanceTimersByTime(NUDGE_POP_MS - 5000)
    expect(h.pv.isShown()).toBe(false)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('showPetForNudges off: the pet stays hidden (notifications only)', () => {
    const h = harness({ showPet: false, showPetForNudges: false })
    h.pv.apply()
    h.pv.nudge()
    expect(h.visible.every((v) => v === false)).toBe(true)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('a nudge does nothing extra when the pet is already shown', () => {
    const h = harness()
    h.pv.nudge()
    expect(vi.getTimerCount()).toBe(0)
    expect(h.visible).toEqual([])
  })

  it('showing the pet (or turning pop-ups off) cancels a running pop-up', () => {
    const h = harness({ showPet: false })
    h.pv.nudge()
    h.pv.set(true, 'panel')
    expect(vi.getTimerCount()).toBe(0)
    vi.advanceTimersByTime(NUDGE_POP_MS)
    expect(h.visible.at(-1)).toBe(true)

    const h2 = harness({ showPet: false })
    h2.pv.nudge()
    h2.setSettings({ showPetForNudges: false })
    expect(h2.visible.at(-1)).toBe(false)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('the Settings toggle applies right away', () => {
    const h = harness()
    h.setSettings({ showPet: false })
    expect(h.visible.at(-1)).toBe(false)
    h.setSettings({ showPet: true })
    expect(h.visible.at(-1)).toBe(true)
  })

  it('dispose clears the pop-up timer', () => {
    const h = harness({ showPet: false })
    h.pv.nudge()
    h.pv.dispose()
    expect(vi.getTimerCount()).toBe(0)
  })
})

describe('global shortcut', () => {
  it('is Cmd+Shift+B on macOS and Ctrl+Shift+B elsewhere', () => {
    expect(petShortcut('darwin')).toEqual({ accelerator: 'Command+Shift+B', label: '⌘⇧B' })
    expect(petShortcut('win32')).toEqual({ accelerator: 'Control+Shift+B', label: 'Ctrl+Shift+B' })
    expect(petShortcut('linux')).toEqual({ accelerator: 'Control+Shift+B', label: 'Ctrl+Shift+B' })
  })

  const registry = (ok: boolean | 'throw'): ShortcutRegistry & { calls: string[] } => {
    const calls: string[] = []
    return {
      calls,
      register(acc) {
        calls.push(acc)
        if (ok === 'throw') throw new Error('bad accelerator')
        return ok
      },
      isRegistered: () => ok === true
    }
  }

  it('registers the platform accelerator and returns the label', () => {
    const gs = registry(true)
    const press = vi.fn()
    expect(registerPetShortcut(gs, 'linux', press, () => undefined)).toBe('Ctrl+Shift+B')
    expect(gs.calls).toEqual(['Control+Shift+B'])
    expect(registerPetShortcut(registry(true), 'darwin', press, () => undefined)).toBe('⌘⇧B')
  })

  it('logs and skips when another app holds the shortcut (or it throws)', () => {
    const logs: string[] = []
    expect(registerPetShortcut(registry(false), 'win32', () => undefined, (m) => logs.push(m))).toBeNull()
    expect(logs.join('\n')).toMatch(/taken/)
    expect(registerPetShortcut(registry('throw'), 'win32', () => undefined, (m) => logs.push(m))).toBeNull()
    expect(logs.join('\n')).toMatch(/could not be registered/)
  })

  it('shows the shortcut in the tray label only when it registered', () => {
    expect(petToggleLabel(true, 'Ctrl+Shift+B')).toBe('Hide pet (Ctrl+Shift+B)')
    expect(petToggleLabel(false, '⌘⇧B')).toBe('Show pet (⌘⇧B)')
    expect(petToggleLabel(true, null)).toBe('Hide pet')
    expect(petToggleLabel(false, null)).toBe('Show pet')
  })
})

describe('GNOME safety net', () => {
  it('is on for Linux GNOME, or any Linux with no tray; never elsewhere', () => {
    const gnome = isGnomeDesktop({ XDG_CURRENT_DESKTOP: 'ubuntu:GNOME' })
    expect(gnome).toBe(true)
    expect(needsHiddenSafetyNet({ platform: 'linux', gnome, trayOk: true })).toBe(true)
    expect(needsHiddenSafetyNet({ platform: 'linux', gnome: false, trayOk: false })).toBe(true)
    expect(needsHiddenSafetyNet({ platform: 'linux', gnome: false, trayOk: true })).toBe(false)
    expect(needsHiddenSafetyNet({ platform: 'darwin', gnome: false, trayOk: false })).toBe(false)
    expect(needsHiddenSafetyNet({ platform: 'win32', gnome: true, trayOk: true })).toBe(false)
  })

  it('the first hide tells you how to get Bloop back, once per run', () => {
    vi.useFakeTimers()
    const h = harness({}, { safetyNet: true })
    h.pv.set(false, 'tray')
    expect(h.notes).toEqual([
      { title: 'Bloop is hidden', body: 'Bloop is hidden. Press Ctrl+Shift+B or open Bloop again to bring it back.' }
    ])
    h.pv.set(true, 'shortcut')
    h.pv.set(false, 'shortcut')
    h.setSettings({ showPet: true })
    h.setSettings({ showPet: false })
    expect(h.notes).toHaveLength(1)
    vi.useRealTimers()
  })

  it('also fires when the Settings toggle hides it first', () => {
    const h = harness({}, { safetyNet: true })
    h.setSettings({ showPet: false })
    expect(h.notes).toHaveLength(1)
  })

  it('no notification where the tray works', () => {
    const h = harness({}, { safetyNet: false })
    h.pv.set(false, 'tray')
    expect(h.notes).toEqual([])
  })

  it('without the shortcut the notice only mentions opening Bloop again', () => {
    expect(hiddenNoticeText(null).body).toBe('Bloop is hidden. Open Bloop again to bring it back.')
    const h = harness({}, { safetyNet: true, shortcut: null })
    h.pv.set(false, 'tray')
    expect(h.notes[0]?.body).not.toMatch(/Ctrl/)
  })
})

describe('pet:context-menu IPC validation', () => {
  it('only the pet window may open the menu', () => {
    expect(parsePetContextMenu(false, [])).toBeNull()
    expect(parsePetContextMenu(false, [{ x: 1, y: 2 }])).toBeNull()
  })
  it('accepts no point, or a small finite point (rounded)', () => {
    expect(parsePetContextMenu(true, [])).toEqual({})
    expect(parsePetContextMenu(true, [undefined])).toEqual({})
    expect(parsePetContextMenu(true, [null])).toEqual({})
    expect(parsePetContextMenu(true, [{ x: 10.4, y: 99.6 }])).toEqual({ x: 10, y: 100 })
  })
  it('rejects anything else', () => {
    for (const bad of [
      [{ x: 'a', y: 1 }],
      [{ x: 1 }],
      [{ x: NaN, y: 1 }],
      [{ x: Infinity, y: 1 }],
      [{ x: 1e9, y: 1 }],
      [{ x: 1, y: 2, extra: true }],
      [[1, 2]],
      ['1,2'],
      [42],
      [{ x: 1, y: 2 }, 'more']
    ]) {
      expect(parsePetContextMenu(true, bad), JSON.stringify(bad)).toBeNull()
    }
  })
  it('the menu has Hide pet / Open panel / Settings… / Quit Bloop wired to the right actions', () => {
    const a = { hidePet: vi.fn(), openPanel: vi.fn(), openSettings: vi.fn(), quit: vi.fn() }
    const t = petContextMenuTemplate(a, 'Control+Shift+B')
    expect(t.filter((i) => i.type !== 'separator').map((i) => i.label)).toEqual(['Hide pet', 'Open panel', 'Settings…', 'Quit Bloop'])
    expect(t[0]).toMatchObject({ accelerator: 'Control+Shift+B', registerAccelerator: false })
    for (const i of t) i.click?.()
    expect(a.hidePet).toHaveBeenCalledOnce()
    expect(a.openPanel).toHaveBeenCalledOnce()
    expect(a.openSettings).toHaveBeenCalledOnce()
    expect(a.quit).toHaveBeenCalledOnce()
    expect(petContextMenuTemplate(a, null)[0]).not.toHaveProperty('accelerator')
  })
})
