import { describe, expect, it } from 'vitest'
import { fillTemplate, NOTIFICATIONS, NotificationPicker, type NotifyKind } from '../src/main/notifications'

const VARS: Record<NotifyKind, string[]> = {
  drift: ['dur'],
  breakStart: ['break'],
  focusStart: [],
  studyReminder: [],
  deadline: ['title', 'days', 'when']
}

describe('notification messages', () => {
  it('has 150 messages across the five events, all unique', () => {
    const all = Object.values(NOTIFICATIONS).flat()
    expect(all).toHaveLength(150)
    expect(new Set(all.map((n) => `${n.title}|${n.body}`)).size).toBe(150)
  })

  it('no em dashes, short titles, only the known placeholders', () => {
    for (const [kind, list] of Object.entries(NOTIFICATIONS) as [NotifyKind, typeof NOTIFICATIONS.drift][]) {
      for (const n of list) {
        const text = `${n.title} ${n.body}`
        expect(text).not.toContain('—')
        expect(n.title.length).toBeLessThanOrEqual(45)
        for (const [, name] of text.matchAll(/\{(\w+)\}/g)) expect(VARS[kind]).toContain(name)
      }
    }
  })

  it('every drift message says how long; every deadline message names the deadline and the days', () => {
    for (const n of NOTIFICATIONS.drift) expect(`${n.title} ${n.body}`).toContain('{dur}')
    for (const n of NOTIFICATIONS.breakStart) expect(`${n.title} ${n.body}`).toContain('{break}')
    for (const n of NOTIFICATIONS.deadline) {
      expect(n.title).toContain('{title}')
      expect(`${n.title} ${n.body}`).toContain('{days}')
    }
  })

  it('fills placeholders and leaves unknown ones alone', () => {
    expect(fillTemplate('{a} and {b}', { a: 'x' })).toBe('x and {b}')
  })

  it('uses every message of an event once before repeating, and never repeats back to back', () => {
    let seed = 7
    const rand = (): number => ((seed = (seed * 16807) % 2147483647) / 2147483647)
    const p = new NotificationPicker(rand)
    const n = NOTIFICATIONS.drift.length
    const seen = Array.from({ length: n * 3 }, () => p.next('drift', { dur: '3 min' }))
    for (let r = 0; r < 3; r++) expect(new Set(seen.slice(r * n, (r + 1) * n).map((x) => x.title + x.body)).size).toBe(n)
    for (let i = 1; i < seen.length; i++) expect(seen[i]!.title + seen[i]!.body).not.toBe(seen[i - 1]!.title + seen[i - 1]!.body)
    expect(seen.every((x) => !x.body.includes('{dur}') && !x.title.includes('{dur}'))).toBe(true)
  })
})
