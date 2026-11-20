import { describe, expect, it } from 'vitest'
import { isGoogleService, MockGoogleIntegration, type GoogleData } from '../src/main/google/integration'

function make() {
  let saved: GoogleData = {}
  const g = new MockGoogleIntegration({ load: () => saved, save: (d) => (saved = d), now: () => 42 })
  return { g, saved: () => saved }
}

describe('MockGoogleIntegration', () => {
  it('starts disconnected and says it is a mock', () => {
    const s = make().g.status()
    expect(s.mock).toBe(true)
    expect(s.services.gmail.connected).toBe(false)
    expect(s.services.calendar.connected).toBe(false)
  })
  it('connects and disconnects each service on its own, and persists', async () => {
    const { g, saved } = make()
    const r = await g.connect('gmail')
    expect(r.ok && r.value.services.gmail).toMatchObject({ connected: true, connectedAt: 42 })
    expect(g.status().services.calendar.connected).toBe(false)
    expect(saved().gmail?.connected).toBe(true)
    expect((await g.disconnect('gmail')).services.gmail.connected).toBe(false)
  })
  it('rejects unknown services', async () => {
    const { g } = make()
    expect((await g.connect('drive' as never)).ok).toBe(false)
    expect(isGoogleService('calendar')).toBe(true)
    expect(isGoogleService('drive')).toBe(false)
  })
})
