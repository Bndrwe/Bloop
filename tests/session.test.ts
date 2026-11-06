import { describe, expect, it } from 'vitest'
import { SessionEngine, timingFrom } from '../src/main/session'
import { DEFAULT_SETTINGS } from '../src/main/defaults'
import type { SessionRecord, Settings } from '../src/shared/types'

function harness(settings: Partial<Settings> = {}) {
  let now = 1_700_000_000_000
  const timeouts: { at: number; fn: () => void; id: number }[] = []
  let nextId = 1
  const notes: string[] = []
  const saved: SessionRecord[] = []
  const s: Settings = { ...DEFAULT_SETTINGS, ...settings }
  const engine = new SessionEngine({
    now: () => now,
    setInterval: () => 0, // tests drive tick() manually
    clearInterval: () => {},
    setTimeout: (fn, ms) => {
      const id = nextId++
      timeouts.push({ at: now + ms, fn, id })
      return id
    },
    clearTimeout: (h) => {
      const i = timeouts.findIndex((t) => t.id === h)
      if (i >= 0) timeouts.splice(i, 1)
    },
    getSettings: () => s,
    sample: async () => null,
    notify: (title) => notes.push(title),
    saveSession: (r) => saved.push(r),
    log: () => {},
    random: () => 0
  })
  const advance = (sec: number, sample?: { app: string; url?: string }) => {
    for (let i = 0; i < sec; i++) {
      now += 1000
      for (const t of [...timeouts]) if (t.at <= now) {
        timeouts.splice(timeouts.indexOf(t), 1)
        t.fn()
      }
      engine.tick()
      if (sample && (i + 1) % s.sampleIntervalSec === 0) engine.recordSample({ title: '', ...sample })
    }
  }
  return { engine, advance, notes, saved }
}

describe('SessionEngine', () => {
  it('runs focus -> break -> focus and records pomodoros', () => {
    const { engine, advance, notes, saved } = harness({ focusMinutes: 1, breakMinutes: 1 })
    engine.start()
    expect(engine.getStatus().phase).toBe('focus')
    advance(60, { app: 'Code' })
    expect(engine.getStatus().phase).toBe('break')
    expect(engine.getStatus().pet.mood).toBe('sleeping')
    expect(notes).toContain('Break time!')
    advance(60)
    expect(engine.getStatus().phase).toBe('focus')
    expect(notes).toContain('Time to focus')
    engine.stop()
    expect(saved).toHaveLength(1)
    expect(saved[0].completed).toBe(true)
    expect(saved[0].pomodorosCompleted).toBe(1)
    expect(engine.getStatus().pet.mood).toBe('celebrate')
    advance(7)
    expect(engine.getStatus().phase).toBe('idle')
  })

  it('pause freezes remaining time', () => {
    const { engine, advance } = harness()
    engine.start()
    advance(10)
    engine.pause()
    const rem = engine.getStatus().remainingSec
    advance(100)
    expect(engine.getStatus().remainingSec).toBe(rem)
    engine.resume()
    advance(5)
    expect(engine.getStatus().remainingSec).toBe(rem - 5)
  })

  it('nudges after a distraction streak, notifies later, welcomes back', () => {
    const { engine, advance, notes } = harness()
    engine.start()
    advance(30, { app: 'Code' })
    expect(engine.getStatus().pet.mood).toBe('happy')
    advance(2, { app: 'Arc', url: 'https://youtube.com/' })
    // the first distracting sample: unhappy and a bubble right away
    expect(engine.getStatus().pet.mood).toBe('worried')
    expect(engine.getStatus().pet.message).not.toBeNull()
    advance(63, { app: 'Arc', url: 'https://youtube.com/' })
    expect(engine.getStatus().pet.mood).toBe('worried')
    expect(notes.filter((n) => n.includes('misses'))).toHaveLength(0)
    advance(130, { app: 'Arc', url: 'https://youtube.com/' })
    expect(notes.filter((n) => n.includes('misses'))).toHaveLength(1)
    advance(5, { app: 'Code' })
    expect(engine.getStatus().pet.mood).toBe('happy')
    expect(engine.getStatus().pet.message).toMatch(/welcome|spirit|track|there you are|woohoo/i)
    expect(engine.getStatus().score).toBeLessThan(50)
  })

  it('stop without a finished pomodoro is not completed', () => {
    const { engine, advance, saved } = harness()
    engine.start()
    advance(20, { app: 'Code' })
    engine.stop()
    expect(saved[0].completed).toBe(false)
    expect(saved[0].finalScore).toBe(100)
    expect(saved[0].focusSec).toBe(20)
  })

  it('fast mode shortens timings', () => {
    const t = timingFrom(DEFAULT_SETTINGS, true)
    expect(t.focusSec).toBe(25)
    expect(t.sampleSec).toBe(1)
    expect(t.nudgeAfterSec).toBe(0)
    expect(timingFrom({ ...DEFAULT_SETTINGS, nudgeAfterSec: 60 }, true).nudgeAfterSec).toBe(6)
  })
})
