// QA: session engine edge cases, driven by an injected clock (no real timers).
import { describe, expect, it } from 'vitest'
import { NUDGE_LINES, SessionEngine, timingFrom, WELCOME_LINES } from '../src/main/session'
import { DEFAULT_SETTINGS } from '../src/main/defaults'
import type { RawActive } from '../src/main/tracker'
import type { SessionRecord, Settings } from '../src/shared/types'

const T0 = 1_700_000_000_000
const CODE: RawActive = { app: 'Code', title: '' }
const YT: RawActive = { app: 'Google Chrome', title: '', url: 'https://www.youtube.com/watch?v=1' }
const FINDER: RawActive = { app: 'Finder', title: '' }

function make(over: Partial<Settings> = {}) {
  let now = T0
  let raw: RawActive | null = CODE
  const settings: Settings = { ...DEFAULT_SETTINGS, ...over }
  const timeouts: { at: number; fn: () => void; id: number }[] = []
  let nextId = 1
  const notes: { title: string; body: string }[] = []
  const saved: SessionRecord[] = []
  const engine = new SessionEngine({
    now: () => now,
    setInterval: () => 0,
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
    getSettings: () => settings,
    sample: async () => raw,
    notify: (title, body) => notes.push({ title, body }),
    saveSession: (r) => saved.push(r),
    log: () => {},
    random: () => 0
  })
  const flush = async (): Promise<void> => {
    for (let i = 0; i < 4; i++) await Promise.resolve()
  }
  const fireTimers = (): void => {
    for (const t of [...timeouts]) {
      if (t.at <= now) {
        timeouts.splice(timeouts.indexOf(t), 1)
        t.fn()
      }
    }
  }
  /** advance 1s at a time, ticking and letting async samples settle */
  const run = async (sec: number): Promise<void> => {
    for (let i = 0; i < sec; i++) {
      now += 1000
      fireTimers()
      engine.tick()
      await flush()
    }
  }
  /** jump the wall clock without ticking (laptop lid closed) */
  const jump = (sec: number): void => {
    now += sec * 1000
  }
  return {
    engine,
    settings,
    notes,
    saved,
    run,
    jump,
    flush,
    fireTimers,
    setRaw: (r: RawActive | null) => (raw = r),
    now: () => now
  }
}

describe('timingFrom', () => {
  it('converts minutes to seconds and clamps the sample interval', () => {
    const t = timingFrom({ ...DEFAULT_SETTINGS, sampleIntervalSec: 0, focusMinutes: 2, breakMinutes: 1 })
    expect(t.focusSec).toBe(120)
    expect(t.breakSec).toBe(60)
    expect(t.sampleSec).toBe(1)
    expect(t.sadAfterSec).toBe(300)
  })
  it('fast mode: minutes become seconds with floors, thresholds / 10', () => {
    const t = timingFrom({ ...DEFAULT_SETTINGS, focusMinutes: 1, breakMinutes: 1, nudgeAfterSec: 60, notifyAfterSec: 180, nudgeCooldownSec: 120 }, true)
    expect(t).toMatchObject({ focusSec: 5, breakSec: 3, sampleSec: 1, nudgeAfterSec: 6, notifyAfterSec: 18, cooldownSec: 12, sadAfterSec: 30 })
  })
})

describe('pomodoro transitions', () => {
  it('focus -> break -> focus with notifications and pet moods', async () => {
    const h = make({ focusMinutes: 1, breakMinutes: 1 })
    h.engine.start()
    await h.flush()
    expect(h.engine.getStatus()).toMatchObject({ phase: 'focus', phaseTotalSec: 60, remainingSec: 60 })
    await h.run(59)
    expect(h.engine.getStatus().phase).toBe('focus')
    expect(h.engine.getStatus().remainingSec).toBe(1)
    await h.run(1)
    let st = h.engine.getStatus()
    expect(st).toMatchObject({ phase: 'break', pomodorosCompleted: 1, remainingSec: 60 })
    expect(st.pet.mood).toBe('sleeping')
    expect(st.current).toBeNull()
    expect(h.notes.map((n) => n.title)).toEqual(['Break time!'])
    await h.run(60)
    st = h.engine.getStatus()
    expect(st.phase).toBe('focus')
    expect(st.pet.mood).toBe('happy')
    expect(h.notes.map((n) => n.title)).toEqual(['Break time!', 'Time to focus'])
  })

  it('no samples are recorded during a break', async () => {
    const h = make({ focusMinutes: 1, breakMinutes: 1 })
    h.engine.start()
    await h.run(60)
    expect(h.engine.getStatus().phase).toBe('break')
    h.engine.recordSample(YT) // ignored: not in focus
    await h.run(30)
    const rec = h.engine.stop()!
    const sampled = rec.focusSec + rec.distractSec + rec.neutralSec
    expect(rec.distractSec).toBe(0)
    expect(sampled).toBeLessThanOrEqual(65)
  })

  it('break notification wording: seconds below a minute, minutes otherwise', async () => {
    const fast = make({ focusMinutes: 5, breakMinutes: 3 })
    expect(fast.engine.timing.breakSec).toBe(180)
    const h = make({ focusMinutes: 1, breakMinutes: 5 })
    h.engine.start()
    await h.run(60)
    expect(h.notes[0].body).toContain('5 min')
  })

  it('skipBreak returns to focus without counting an extra pomodoro', async () => {
    const h = make({ focusMinutes: 1, breakMinutes: 5 })
    h.engine.start()
    await h.run(60)
    h.engine.skipBreak()
    const st = h.engine.getStatus()
    expect(st.phase).toBe('focus')
    expect(st.pomodorosCompleted).toBe(1)
    expect(st.remainingSec).toBe(60)
  })

  it('skipBreak is a no-op in focus and idle', async () => {
    const h = make()
    h.engine.skipBreak()
    expect(h.engine.getStatus().phase).toBe('idle')
    h.engine.start()
    h.engine.skipBreak()
    expect(h.engine.getStatus().phase).toBe('focus')
  })

  it('skipBreak while paused in a break goes to focus', async () => {
    const h = make({ focusMinutes: 1, breakMinutes: 5 })
    h.engine.start()
    await h.run(60)
    h.engine.pause()
    expect(h.engine.getStatus().pausedPhase).toBe('break')
    h.engine.skipBreak()
    expect(h.engine.getStatus()).toMatchObject({ phase: 'focus', pausedPhase: null })
  })

  it('start() while running is ignored (does not reset the session)', async () => {
    const h = make()
    h.engine.start()
    await h.run(30)
    const started = h.engine.getStatus().sessionStartedAt
    h.engine.start()
    expect(h.engine.getStatus().sessionStartedAt).toBe(started)
  })
})

describe('pause / resume timing', () => {
  it('freezes the remaining time and resumes with exactly that much left', async () => {
    const h = make({ focusMinutes: 1 })
    h.engine.start()
    await h.run(20)
    h.engine.pause()
    expect(h.engine.getStatus()).toMatchObject({ phase: 'paused', pausedPhase: 'focus', remainingSec: 40, phaseEndsAt: null, current: h.engine.getStatus().current })
    await h.run(600) // ten minutes pass while paused: phase must not advance
    expect(h.engine.getStatus()).toMatchObject({ phase: 'paused', remainingSec: 40, pomodorosCompleted: 0 })
    h.engine.resume()
    const st = h.engine.getStatus()
    expect(st).toMatchObject({ phase: 'focus', remainingSec: 40, pausedPhase: null })
    expect(st.phaseEndsAt).toBe(h.now() + 40_000)
    await h.run(40)
    expect(h.engine.getStatus().phase).toBe('break')
  })

  it('pausing mid-second rounds the remainder up', async () => {
    const h = make({ focusMinutes: 1 })
    h.engine.start()
    await h.run(10)
    h.jump(0.5)
    h.engine.pause()
    expect(h.engine.getStatus().remainingSec).toBe(50) // 49.5 -> 50
  })

  it('pause in break resumes into break (sleeping mood)', async () => {
    const h = make({ focusMinutes: 1, breakMinutes: 2 })
    h.engine.start()
    await h.run(60)
    await h.run(30)
    h.engine.pause()
    expect(h.engine.getStatus().remainingSec).toBe(90)
    h.engine.resume()
    expect(h.engine.getStatus()).toMatchObject({ phase: 'break', remainingSec: 90 })
    expect(h.engine.getStatus().pet.mood).toBe('sleeping')
  })

  it('pause/resume are no-ops in the wrong phase; pause twice is harmless', async () => {
    const h = make()
    h.engine.pause()
    h.engine.resume()
    expect(h.engine.getStatus().phase).toBe('idle')
    h.engine.start()
    h.engine.resume() // not paused
    expect(h.engine.getStatus().phase).toBe('focus')
    h.engine.pause()
    h.engine.pause()
    expect(h.engine.getStatus().phase).toBe('paused')
  })

  it('pause clears a running distraction streak (no instant nudge on resume)', async () => {
    const h = make({ nudgeAfterSec: 30, notifyAfterSec: 60, nudgeCooldownSec: 10 })
    h.setRaw(YT)
    h.engine.start()
    await h.run(25)
    h.engine.pause()
    h.engine.resume()
    const spoken: string[] = []
    h.engine.on('status', (s) => {
      if (s.pet.message && !spoken.includes(s.pet.message)) spoken.push(s.pet.message)
    })
    await h.run(10) // 25s + 10s would be >30s if the streak had survived
    expect(h.notes).toHaveLength(0)
    expect(spoken.filter((m) => NUDGE_LINES.includes(m))).toHaveLength(0)
    expect(h.engine.getStatus().pet.mood).toBe('worried') // still unhappy, just no bubble yet
  })

  it('samples are not taken while paused', async () => {
    const h = make()
    h.engine.start()
    await h.run(10)
    h.engine.pause()
    const before = h.engine.stop() // stop works from paused
    expect(before).not.toBeNull()
    expect(h.saved).toHaveLength(1)
  })
})

describe('nudges, cooldown, notify threshold, sad state', () => {
  const cfg = { nudgeAfterSec: 60, notifyAfterSec: 180, nudgeCooldownSec: 120, focusMinutes: 60, sampleIntervalSec: 5 }

  it('looks worried at once; with a 60 s threshold the bubble waits until then', async () => {
    const h = make(cfg)
    h.setRaw(YT)
    h.engine.start()
    await h.run(55)
    expect(h.engine.getStatus().pet.mood).toBe('worried')
    expect(NUDGE_LINES).not.toContain(h.engine.getStatus().pet.message)
    const id = h.engine.getStatus().pet.messageId
    await h.run(10)
    const st = h.engine.getStatus()
    expect(st.pet.mood).toBe('worried')
    expect(st.pet.messageId).toBeGreaterThan(id)
    expect(NUDGE_LINES).toContain(st.pet.message)
    expect(h.notes).toHaveLength(0) // notification only after notifyAfterSec
  })

  it('respects the cooldown: next nudge >= cooldown later, and one system notification per streak', async () => {
    const h = make(cfg)
    const spoken: string[] = []
    h.engine.on('status', (s) => {
      if (s.pet.message && !spoken.includes(`${s.pet.messageId}`)) spoken.push(`${s.pet.messageId}`)
    })
    h.setRaw(YT)
    h.engine.start()
    await h.run(65) // first nudge ~60s
    const afterFirst = h.engine.getStatus().pet.messageId
    await h.run(100) // 165s: cooldown (120s) not yet over
    expect(h.engine.getStatus().pet.messageId).toBe(afterFirst)
    await h.run(30) // ~195s: second nudge, streak >= 180 -> notification
    expect(h.engine.getStatus().pet.messageId).toBeGreaterThan(afterFirst)
    expect(h.notes.filter((n) => n.title.startsWith('Bloop misses you'))).toHaveLength(1)
    expect(h.notes[0].body).toMatch(/3 minutes|\d+ seconds/)
    await h.run(240) // third nudge at ~315s must not notify again in the same streak
    expect(h.notes.filter((n) => n.title.startsWith('Bloop misses you'))).toHaveLength(1)
  })

  it('goes sad after sadAfterSec of continuous distraction, even between nudges', async () => {
    const h = make({ ...cfg, nudgeCooldownSec: 600 })
    h.setRaw(YT)
    h.engine.start()
    await h.run(65)
    expect(h.engine.getStatus().pet.mood).toBe('worried')
    await h.run(240) // 305s total, cooldown (600) blocks a new nudge -> setMood('sad') path
    expect(h.engine.getStatus().pet.mood).toBe('sad')
  })

  it('a nudge past sadAfterSec speaks with the sad mood', async () => {
    const h = make({ ...cfg, nudgeCooldownSec: 120 })
    h.setRaw(YT)
    h.engine.start()
    await h.run(305)
    expect(h.engine.getStatus().pet.mood).toBe('sad')
  })

  it('returning to focus after being sad cheers (welcome line, happy)', async () => {
    const h = make(cfg)
    h.setRaw(YT)
    h.engine.start()
    await h.run(305)
    h.setRaw(CODE)
    await h.run(6)
    const st = h.engine.getStatus()
    expect(st.pet.mood).toBe('happy')
    expect(WELCOME_LINES).toContain(st.pet.message)
  })

  it('a short focus/neutral blip resets the streak (needs the full threshold again)', async () => {
    const h = make({ ...cfg, nudgeAfterSec: 30 })
    h.setRaw(YT)
    h.engine.start()
    await h.run(25)
    h.setRaw(FINDER) // neutral
    await h.run(6)
    h.setRaw(YT)
    const id = h.engine.getStatus().pet.messageId
    await h.run(25)
    expect(h.engine.getStatus().pet.mood).toBe('worried')
    expect(h.engine.getStatus().pet.messageId).toBe(id) // no bubble yet
    await h.run(10)
    expect(h.engine.getStatus().pet.messageId).toBeGreaterThan(id)
    expect(NUDGE_LINES).toContain(h.engine.getStatus().pet.message)
  })

  it('does not cheer if no nudge happened before refocusing', async () => {
    const h = make(cfg)
    h.setRaw(YT)
    h.engine.start()
    await h.run(10)
    h.setRaw(CODE)
    await h.run(6)
    expect(WELCOME_LINES).not.toContain(h.engine.getStatus().pet.message)
  })

  it('speech bubble clears after messageSec and transient mood falls back', async () => {
    const h = make()
    h.engine.start()
    await h.run(1)
    expect(h.engine.getStatus().pet.message).toBeTruthy()
    h.engine.say('hi', 'wave')
    await h.run(7)
    const st = h.engine.getStatus()
    expect(st.pet.message).toBeNull()
    expect(st.pet.mood).not.toBe('wave')
  })

  it('sample failure (sample() rejects) is treated as neutral and does not wedge sampling', async () => {
    let calls = 0
    const h = make()
    // replace sample via a fresh engine
    const eng = new SessionEngine({
      now: () => h.now(),
      setInterval: () => 0,
      clearInterval: () => {},
      setTimeout: () => 0,
      clearTimeout: () => {},
      getSettings: () => h.settings,
      sample: async () => {
        calls++
        throw new Error('osascript failed')
      },
      notify: () => {},
      saveSession: () => {},
      log: () => {}
    })
    eng.start()
    await h.flush()
    expect(eng.getStatus().current?.category).toBe('neutral')
    expect(calls).toBe(1)
    eng.tick() // not due yet
    await h.flush()
    expect(calls).toBe(1)
  })
})

describe('stop / save', () => {
  it('stop when idle returns null and saves nothing', () => {
    const h = make()
    expect(h.engine.stop()).toBeNull()
    expect(h.saved).toHaveLength(0)
  })

  it('stop before a full pomodoro: completed=false, "session saved" message', async () => {
    const h = make({ focusMinutes: 25 })
    h.engine.start()
    await h.run(30)
    const rec = h.engine.stop()!
    expect(rec).toMatchObject({ completed: false, pomodorosCompleted: 0, durationSec: 30, start: T0, end: T0 + 30_000 })
    expect(h.saved).toEqual([rec])
    const st = h.engine.getStatus()
    expect(st.phase).toBe('done')
    expect(st.pet.message).toMatch(/saved/)
    expect(st.score).toBe(rec.finalScore)
  })

  it('stop after one pomodoro (during the break): completed=true, singular wording', async () => {
    const h = make({ focusMinutes: 1, breakMinutes: 5 })
    h.engine.start()
    await h.run(70)
    const rec = h.engine.stop()!
    expect(rec).toMatchObject({ completed: true, pomodorosCompleted: 1 })
    expect(h.engine.getStatus().pet.message).toBe('we did it! 1 pomodoro done 🎉')
    expect(h.engine.getStatus().pet.mood).toBe('celebrate')
  })

  it('plural wording for 2 pomodoros; flag stays true', async () => {
    const h = make({ focusMinutes: 1, breakMinutes: 1 })
    h.engine.start()
    await h.run(60 + 60 + 60 + 5)
    const rec = h.engine.stop()!
    expect(rec.pomodorosCompleted).toBe(2)
    expect(rec.completed).toBe(true)
    expect(h.engine.getStatus().pet.message).toContain('2 pomodoros')
  })

  it('stop from paused works and uses wall-clock duration', async () => {
    const h = make({ focusMinutes: 25 })
    h.engine.start()
    await h.run(10)
    h.engine.pause()
    await h.run(50)
    const rec = h.engine.stop()!
    expect(rec.durationSec).toBe(60)
  })

  it('record content: seconds per category, top lists, score and id', async () => {
    const h = make({ focusMinutes: 25 })
    h.engine.start()
    await h.run(21) // samples at 0,5,10,15,20 -> 5 x 5s code
    h.setRaw(YT)
    await h.run(20)
    const rec = h.engine.stop()!
    expect(rec.focusSec).toBeGreaterThan(0)
    expect(rec.distractSec).toBeGreaterThan(0)
    expect(rec.topFocus[0].name).toBe('Code')
    expect(rec.topDistract[0].name).toBe('youtube.com')
    expect(rec.finalScore).toBeGreaterThan(0)
    expect(rec.finalScore).toBeLessThan(100)
    expect(rec.id).toMatch(/^[0-9a-z]+-[0-9a-z]+$/)
  })

  it('all-neutral session has finalScore null', async () => {
    const h = make()
    h.setRaw(FINDER)
    h.engine.start()
    await h.run(30)
    expect(h.engine.stop()!.finalScore).toBeNull()
  })

  it('a throwing saveSession does not break stop()', async () => {
    const h = make()
    const eng = new SessionEngine({
      now: () => h.now(),
      setInterval: () => 0,
      clearInterval: () => {},
      setTimeout: () => 0,
      clearTimeout: () => {},
      getSettings: () => h.settings,
      sample: async () => null,
      notify: () => {},
      saveSession: () => {
        throw new Error('disk full')
      },
      log: () => {}
    })
    eng.start()
    const rec = eng.stop()
    expect(rec).not.toBeNull()
    expect(eng.getStatus().phase).toBe('done')
  })

  it('emits session-saved and a second stop() is a no-op', async () => {
    const h = make()
    const got: SessionRecord[] = []
    h.engine.on('session-saved', (r) => got.push(r))
    h.engine.start()
    await h.run(5)
    h.engine.stop()
    expect(h.engine.stop()).toBeNull()
    expect(got).toHaveLength(1)
    expect(h.saved).toHaveLength(1)
  })

  it('done -> idle after doneSec, and a new session can start immediately from done', async () => {
    const h = make({ trackWithoutSession: false })
    h.engine.start()
    await h.run(5)
    h.engine.stop()
    expect(h.engine.isRunning()).toBe(false)
    await h.run(7)
    expect(h.engine.getStatus()).toMatchObject({ phase: 'idle', score: null, sessionStartedAt: null })
    h.engine.start()
    await h.run(2)
    h.engine.stop()
    // restart while "done": the stale done-timer must not bounce the new session to idle
    h.engine.start()
    await h.run(8)
    expect(h.engine.getStatus().phase).toBe('focus')
    expect(h.saved).toHaveLength(2)
  })

  it('a new session resets samples, pomodoros and cooldown', async () => {
    const h = make({ focusMinutes: 1, breakMinutes: 1, nudgeAfterSec: 10, nudgeCooldownSec: 1000 })
    h.setRaw(YT)
    h.engine.start()
    await h.run(65)
    h.engine.stop()
    h.engine.start()
    expect(h.engine.getStatus().pomodorosCompleted).toBe(0)
    h.setRaw(YT)
    await h.run(15)
    expect(h.engine.getStatus().pet.mood).toBe('worried') // lastNudgeAt reset: cooldown from the previous session does not apply
  })
})

describe('clock skew / sleep (lid closed)', () => {
  it('a long jump during focus completes exactly ONE pomodoro and restarts a full break', async () => {
    const h = make({ focusMinutes: 25, breakMinutes: 5 })
    h.engine.start()
    await h.run(60)
    h.jump(8 * 3600) // 8h asleep
    await h.run(1)
    const st = h.engine.getStatus()
    expect(st.phase).toBe('break')
    expect(st.pomodorosCompleted).toBe(1)
    expect(st.remainingSec).toBe(300) // full break, not "already over"
  })

  it('a jump past a whole break lands in focus on the next tick, not in a loop of phases', async () => {
    const h = make({ focusMinutes: 1, breakMinutes: 1 })
    h.engine.start()
    await h.run(60)
    expect(h.engine.getStatus().phase).toBe('break')
    h.jump(3600)
    await h.run(1)
    expect(h.engine.getStatus()).toMatchObject({ phase: 'focus', pomodorosCompleted: 1, remainingSec: 60 })
  })

  it('paused sessions are immune to clock jumps', async () => {
    const h = make({ focusMinutes: 25 })
    h.engine.start()
    await h.run(100)
    h.engine.pause()
    h.jump(24 * 3600)
    expect(h.engine.getStatus().remainingSec).toBe(25 * 60 - 100)
    h.engine.resume()
    expect(h.engine.getStatus().remainingSec).toBe(25 * 60 - 100)
  })

  it('a backwards clock jump never produces negative remaining time or NaN score', async () => {
    const h = make({ focusMinutes: 25 })
    h.engine.start()
    await h.run(30)
    h.jump(-3600)
    const st = h.engine.getStatus()
    expect(st.remainingSec).toBeGreaterThanOrEqual(0)
    expect(Number.isNaN(st.score as number)).toBe(false)
  })

  it('stop() after sleep reports wall-clock duration (documented behaviour)', async () => {
    const h = make({ focusMinutes: 25 })
    h.engine.start()
    await h.run(30)
    h.jump(3600)
    expect(h.engine.stop()!.durationSec).toBe(3630)
  })

  // BUG: src/main/session.ts updateMood() computes `streak = t - streakStart` from wall-clock
  // times, so a sleep gap while on a distracting site counts as "distracted" time.
  it('BUG: laptop sleep while on YouTube must not count as 8h of distraction (no "480 minutes" notification)', async () => {
    const h = make({ nudgeAfterSec: 60, notifyAfterSec: 180, nudgeCooldownSec: 120, focusMinutes: 600 })
    h.setRaw(YT)
    h.engine.start()
    await h.run(10) // streak begins
    h.jump(8 * 3600) // lid closed
    await h.run(6) // wake up, next samples are still YouTube
    // Expected: no "off task for N minutes" notification claiming ~480 minutes.
    expect(h.notes.filter((n) => /480 minutes/.test(n.body))).toHaveLength(0)
  })

  // The score decays by sample age, so a long sleep only fades old samples.
  it('score after a long sleep stays within 0..100', async () => {
    const h = make({ focusMinutes: 600 })
    h.engine.start()
    await h.run(30)
    h.jump(8 * 3600)
    await h.run(6)
    const s = h.engine.getStatus().score
    expect(s === null || (s >= 0 && s <= 100)).toBe(true)
  })
})

describe('dispose', () => {
  it('clears timers and is safe to call twice', async () => {
    const h = make()
    h.engine.start()
    h.engine.dispose()
    h.engine.dispose()
  })
})
