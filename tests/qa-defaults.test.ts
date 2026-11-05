// QA: mergeSettings / DEFAULT_SETTINGS migration safety (old, partial and corrupted stored shapes).
import { describe, expect, it } from 'vitest'
import { DEFAULT_SETTINGS, mergeSettings } from '../src/main/defaults'
import { classify } from '../src/main/classifier'
import { DEFAULT_BACKGROUND_INTENSITY, DEFAULT_BACKGROUND_SPEED } from '../src/shared/background'
import type { Settings } from '../src/shared/types'

const bad = (v: unknown): Partial<Settings> => v as Partial<Settings>

describe('DEFAULT_SETTINGS sanity', () => {
  it('has sensible numbers (nudge < notify, positive timings)', () => {
    const d = DEFAULT_SETTINGS
    expect(d.nudgeAfterSec).toBeLessThan(d.notifyAfterSec)
    for (const k of ['nudgeAfterSec', 'notifyAfterSec', 'nudgeCooldownSec', 'focusMinutes', 'breakMinutes', 'sampleIntervalSec'] as const) {
      expect(d[k]).toBeGreaterThan(0)
    }
  })
  it('lists contain unique, trimmed, non-empty strings', () => {
    for (const k of ['focusApps', 'distractApps', 'focusDomains', 'distractDomains'] as const) {
      const l = DEFAULT_SETTINGS[k]
      expect(new Set(l.map((x) => x.toLowerCase())).size).toBe(l.length)
      expect(l.every((x) => x === x.trim() && x.length > 0)).toBe(true)
    }
  })
  it('no site is in both a focus and a distract list', () => {
    const f = new Set(DEFAULT_SETTINGS.focusDomains)
    expect(DEFAULT_SETTINGS.distractDomains.filter((d) => f.has(d))).toEqual([])
    const fa = new Set(DEFAULT_SETTINGS.focusApps.map((a) => a.toLowerCase()))
    expect(DEFAULT_SETTINGS.distractApps.filter((a) => fa.has(a.toLowerCase()))).toEqual([])
  })
})

describe('mergeSettings: missing / old shapes', () => {
  it('null, undefined and {} give the defaults', () => {
    expect(mergeSettings(null)).toEqual(DEFAULT_SETTINGS)
    expect(mergeSettings(undefined)).toEqual(DEFAULT_SETTINGS)
    expect(mergeSettings({})).toEqual(DEFAULT_SETTINGS)
  })
  it('a v0.1 settings file without background*/icalUrl keys gains the new defaults and keeps user values', () => {
    const old = { focusApps: ['Code'], distractApps: [], focusDomains: ['a.com'], distractDomains: ['b.com'], nudgeAfterSec: 90, notifyAfterSec: 200, nudgeCooldownSec: 150, focusMinutes: 50, breakMinutes: 10, sampleIntervalSec: 10, reminders: [], launchAtLogin: true }
    const m = mergeSettings(old as Partial<Settings>)
    expect(m).toMatchObject({ ...old, icalUrl: '', backgroundEnabled: true, backgroundIntensity: DEFAULT_BACKGROUND_INTENSITY, backgroundSpeed: DEFAULT_BACKGROUND_SPEED, backgroundInteractive: true })
  })
  it('user-emptied lists stay empty (an empty list is not "missing")', () => {
    const m = mergeSettings({ focusApps: [], distractDomains: [] })
    expect(m.focusApps).toEqual([])
    expect(m.distractDomains).toEqual([])
  })
  it('unknown extra keys from a newer/older version survive the merge', () => {
    expect((mergeSettings(bad({ futureThing: 1 })) as unknown as Record<string, unknown>)['futureThing']).toBe(1)
  })
  it('is idempotent', () => {
    const once = mergeSettings(bad({ focusMinutes: '30', backgroundIntensity: 250 }))
    expect(mergeSettings(once)).toEqual(once)
  })
})

describe('mergeSettings: corrupted values', () => {
  it.each([null, undefined, 'x', 5, {}, true])('non-array list %j falls back to the default list', (v) => {
    const m = mergeSettings(bad({ focusApps: v, distractApps: v, focusDomains: v, distractDomains: v, reminders: v }))
    expect(m.focusApps).toEqual(DEFAULT_SETTINGS.focusApps)
    expect(m.distractDomains).toEqual(DEFAULT_SETTINGS.distractDomains)
    expect(m.reminders).toEqual([])
  })
  it.each([0, -5, NaN, Infinity, -Infinity, 'abc', '', null, undefined, {}, []])('bad number %j falls back to the default', (v) => {
    const m = mergeSettings(bad({ nudgeAfterSec: v, notifyAfterSec: v, nudgeCooldownSec: v, focusMinutes: v, breakMinutes: v, sampleIntervalSec: v }))
    expect(m.nudgeAfterSec).toBe(DEFAULT_SETTINGS.nudgeAfterSec)
    expect(m.notifyAfterSec).toBe(DEFAULT_SETTINGS.notifyAfterSec)
    expect(m.nudgeCooldownSec).toBe(DEFAULT_SETTINGS.nudgeCooldownSec)
    expect(m.focusMinutes).toBe(DEFAULT_SETTINGS.focusMinutes)
    expect(m.breakMinutes).toBe(DEFAULT_SETTINGS.breakMinutes)
    expect(m.sampleIntervalSec).toBe(DEFAULT_SETTINGS.sampleIntervalSec)
  })
  it('numeric strings are coerced to real numbers', () => {
    const m = mergeSettings(bad({ focusMinutes: '45', breakMinutes: ' 7 ' }))
    expect(m.focusMinutes).toBe(45)
    expect(m.breakMinutes).toBe(7)
    expect(typeof m.focusMinutes).toBe('number')
  })
  it('background sliders clamp to 0..100 and non-numbers fall back', () => {
    expect(mergeSettings(bad({ backgroundIntensity: 250, backgroundSpeed: -3 }))).toMatchObject({ backgroundIntensity: 100, backgroundSpeed: 0 })
    expect(mergeSettings(bad({ backgroundIntensity: 'x', backgroundSpeed: null }))).toMatchObject({ backgroundIntensity: DEFAULT_BACKGROUND_INTENSITY, backgroundSpeed: DEFAULT_BACKGROUND_SPEED })
    expect(mergeSettings(bad({ backgroundIntensity: 0 })).backgroundIntensity).toBe(0) // 0 is valid, not "missing"
    expect(mergeSettings(bad({ backgroundIntensity: 55.6 })).backgroundIntensity).toBe(56)
  })
  it('background booleans must be real booleans', () => {
    expect(mergeSettings(bad({ backgroundEnabled: 'false', backgroundInteractive: 0 }))).toMatchObject({ backgroundEnabled: true, backgroundInteractive: true })
    expect(mergeSettings(bad({ backgroundEnabled: false })).backgroundEnabled).toBe(false)
  })
  it('does not mutate its input', () => {
    const input = Object.freeze({ focusMinutes: '30' }) as unknown as Partial<Settings>
    expect(() => mergeSettings(input)).not.toThrow()
  })
  it('partial update on top of valid settings keeps the rest (saveSettings pattern)', () => {
    const base = mergeSettings({ focusMinutes: 40 })
    const next = mergeSettings({ ...base, breakMinutes: 10 })
    expect(next).toMatchObject({ focusMinutes: 40, breakMinutes: 10 })
  })

  // BUG: defaults.ts mergeSettings(): `{ ...DEFAULT_SETTINGS }` is a shallow copy, so when a stored
  // list is missing/invalid the returned object shares the SAME array instance with DEFAULT_SETTINGS
  // (and with every other caller). Any in-place mutation (push/splice on settings.focusApps) corrupts
  // the global defaults for the rest of the process, incl. resetData().
  it.fails('BUG: mergeSettings returns fresh arrays, not DEFAULT_SETTINGS internals', () => {
    const m = mergeSettings({})
    expect(m.focusApps).not.toBe(DEFAULT_SETTINGS.focusApps)
    expect(m.distractDomains).not.toBe(DEFAULT_SETTINGS.distractDomains)
    expect(m.reminders).not.toBe(DEFAULT_SETTINGS.reminders)
  })

  // BUG: defaults.ts mergeSettings() only checks Array.isArray on the lists, not their elements.
  // A stored list such as [null, 5, "Code"] survives, and classify() then throws a TypeError
  // (normalizeAppName(null).trim) from SessionEngine.recordSample, so sampling dies silently.
  it.fails('BUG: non-string entries in app/domain lists are dropped so classify() cannot throw', () => {
    const m = mergeSettings(bad({ focusApps: [null, 5, 'Code'], distractDomains: [undefined, {}, 'youtube.com'] }))
    expect(() => classify({ app: 'Finder' }, m)).not.toThrow()
    expect(() => classify({ app: 'Google Chrome', url: 'https://youtube.com' }, m)).not.toThrow()
  })

  // BUG: defaults.ts mergeSettings() does not validate icalUrl / reminders contents. A non-string
  // icalUrl (e.g. 42 from a hand-edited file) is kept as is (see qa-deadlines: refreshDeadlines then
  // rejects), and reminder entries are not checked (see qa-reminders).
  it.fails('BUG: icalUrl is coerced to a string', () => {
    expect(typeof mergeSettings(bad({ icalUrl: 42 })).icalUrl).toBe('string')
  })
  it.fails('BUG: malformed reminder entries are dropped', () => {
    const m = mergeSettings(bad({ reminders: [null, { id: 'a' }, { id: 'ok', days: [1], time: '09:00', label: 'x', enabled: true }] }))
    expect(m.reminders.map((r) => r.id)).toEqual(['ok'])
  })
})
