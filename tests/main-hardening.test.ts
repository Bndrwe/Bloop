// Main-process hardening: settings whitelist/caps, Brightspace login window.
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { mergeSettings } from '../src/main/defaults'
import type { Settings } from '../src/shared/types'

describe('mergeSettings whitelist and caps', () => {
  it('drops unknown keys', () => {
    const s = mergeSettings({ focusMinutes: 30, evil: 'x', __proto__: { polluted: 1 } } as unknown as Partial<Settings>) as unknown as Record<string, unknown>
    expect(s['evil']).toBeUndefined()
    expect(s['polluted']).toBeUndefined()
    expect(s['focusMinutes']).toBe(30)
  })
  it('caps icalUrl and brightspaceHost at 2048 characters', () => {
    const s = mergeSettings({ icalUrl: 'https://x.example/' + 'a'.repeat(5000), brightspaceHost: 'a'.repeat(5000) + '.com' })
    expect(s.icalUrl.length).toBeLessThanOrEqual(2048)
    expect(s.brightspaceHost).toBe('')
  })
})

describe('Brightspace login window', () => {
  it('checks subframe navigations too (will-frame-navigate)', () => {
    expect(readFileSync('src/main/brightspaceApp.ts', 'utf8')).toMatch(/'will-frame-navigate'/)
  })
})
