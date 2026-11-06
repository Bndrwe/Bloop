// Light check of the panel layout (docs/PRODUCT.md): the three core areas come first, chat is a
// small secondary entry, not a big button in the main flow.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const src = readFileSync(join(__dirname, '../src/renderer/src/views/Panel.tsx'), 'utf8')
const body = src.slice(src.indexOf('export function Panel()'))

describe('panel layout', () => {
  it('orders score/status, reminders state, deadlines, study plan, then stats', () => {
    const order = ['<ScoreRing', '<ReminderState', '<Deadlines', '<AiPlan', 'Today</h2>'].map((m) => body.indexOf(m))
    expect(order.every((i) => i >= 0)).toBe(true)
    expect([...order].sort((a, b) => a - b)).toEqual(order)
  })
  it('chat is a header icon and a plan link, not a big button', () => {
    expect(src).not.toContain('panel-chat')
    expect(body).toContain('aria-label="Chat with Bloop"')
    expect(src).toContain('Ask Bloop about this plan')
  })
  it('the Now row shows the content verdict with corrections', () => {
    expect(src).toContain("'Counts as study'")
    expect(src).toContain('This is study')
    expect(src).toContain('Not study')
  })
  it('no em dashes in panel copy', () => {
    expect(src).not.toContain('—')
  })
})
