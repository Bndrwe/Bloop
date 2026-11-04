// Pomodoro session engine + focus nudges. No electron imports: everything platform-specific is
// injected via SessionDeps, so it can be driven with a fake clock in tests.
import { EventEmitter } from 'node:events'
import type { ActiveSample, AppStatus, PetMood, PetState, SessionPhase, SessionRecord, Settings } from '@shared/types'
import { classify, resolveDomain } from './classifier'
import { computeFocusScore, summarizeSession } from './score'
import type { RawActive } from './tracker'

export interface Timing {
  focusSec: number
  breakSec: number
  sampleSec: number
  nudgeAfterSec: number
  notifyAfterSec: number
  cooldownSec: number
  /** continuous distraction after which the pet turns sad */
  sadAfterSec: number
  /** speech bubbles auto-clear after this long */
  messageSec: number
  /** how long the "done" phase lasts before going back to idle */
  doneSec: number
}

/** Convert settings to concrete timings. FAST mode: minutes become seconds, thresholds /10, 1s samples. */
export function timingFrom(s: Settings, fast = false): Timing {
  if (fast) {
    return {
      focusSec: Math.max(5, s.focusMinutes),
      breakSec: Math.max(3, s.breakMinutes),
      sampleSec: 1,
      nudgeAfterSec: Math.max(3, Math.round(s.nudgeAfterSec / 10)),
      notifyAfterSec: Math.max(5, Math.round(s.notifyAfterSec / 10)),
      cooldownSec: Math.max(5, Math.round(s.nudgeCooldownSec / 10)),
      sadAfterSec: 30,
      messageSec: 6,
      doneSec: 6
    }
  }
  return {
    focusSec: s.focusMinutes * 60,
    breakSec: s.breakMinutes * 60,
    sampleSec: Math.max(1, s.sampleIntervalSec),
    nudgeAfterSec: s.nudgeAfterSec,
    notifyAfterSec: s.notifyAfterSec,
    cooldownSec: s.nudgeCooldownSec,
    sadAfterSec: 300,
    messageSec: 6,
    doneSec: 6
  }
}

export interface NotifyOptions {
  actionText?: string
  onAction?: () => void
}

export interface SessionDeps {
  now?: () => number
  setInterval?: (fn: () => void, ms: number) => unknown
  clearInterval?: (h: unknown) => void
  setTimeout?: (fn: () => void, ms: number) => unknown
  clearTimeout?: (h: unknown) => void
  getSettings: () => Settings
  sample: () => Promise<RawActive | null>
  notify: (title: string, body: string, opts?: NotifyOptions) => void
  saveSession: (rec: SessionRecord) => void
  fast?: boolean
  log?: (msg: string) => void
  random?: () => number
}

export const NUDGE_LINES = [
  'hey, we were doing so well!',
  'psst… is this homework? 👀',
  "let's get back to it together!",
  "I believe in you! back to work? 📚",
  'just a few more minutes of focus, okay?',
  'ooh, shiny… but our work misses us!',
  "future you will say thanks. let's go!",
  "I'll be right here when you're back on task 🐾"
]

export const WELCOME_LINES = [
  'yay, welcome back!',
  "that's the spirit! 💪",
  "back on track — I'm so proud!",
  "there you are! let's keep going ✨",
  'woohoo, focus mode on!'
]

type StoredSample = ActiveSample & { durationSec: number }

export class SessionEngine extends EventEmitter {
  private readonly d: Required<Omit<SessionDeps, 'log'>> & { log: (m: string) => void }

  private phase: SessionPhase = 'idle'
  private pausedPhase: 'focus' | 'break' | null = null
  private phaseEndsAt: number | null = null
  private pausedRemainingSec = 0
  private phaseTotalSec = 0
  private pomodoros = 0
  private sessionStartedAt: number | null = null
  private samples: StoredSample[] = []
  private current: AppStatus['current'] = null
  private finalScore: number | null = null

  private lastSampleAt = 0
  private sampling = false
  private streakStart: number | null = null
  private lastNudgeAt = -Infinity
  private nudgedThisStreak = false
  private notifiedThisStreak = false
  private pendingWelcome = false

  private pet: PetState = { mood: 'idle', message: null, messageId: 0 }
  private ticker: unknown = null
  private messageTimer: unknown = null
  private doneTimer: unknown = null
  private lastLine = -1

  constructor(deps: SessionDeps) {
    super()
    this.d = {
      now: () => Date.now(),
      setInterval: (fn, ms) => setInterval(fn, ms),
      clearInterval: (h) => clearInterval(h as ReturnType<typeof setInterval>),
      setTimeout: (fn, ms) => setTimeout(fn, ms),
      clearTimeout: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
      fast: false,
      random: Math.random,
      log: (m) => console.log(`[studypet] ${m}`),
      ...deps
    } as SessionEngine['d']
  }

  get timing(): Timing {
    return timingFrom(this.d.getSettings(), this.d.fast)
  }

  isRunning(): boolean {
    return this.phase === 'focus' || this.phase === 'break' || this.phase === 'paused'
  }

  getStatus(): AppStatus {
    const now = this.d.now()
    const running = this.phase === 'focus' || this.phase === 'break'
    const remainingSec =
      running && this.phaseEndsAt !== null
        ? Math.max(0, Math.ceil((this.phaseEndsAt - now) / 1000))
        : this.phase === 'paused'
          ? this.pausedRemainingSec
          : 0
    let score: number | null = null
    if (this.isRunning()) score = computeFocusScore(this.samples, now)
    else if (this.phase === 'done') score = this.finalScore
    return {
      phase: this.phase,
      score,
      phaseEndsAt: running ? this.phaseEndsAt : null,
      remainingSec,
      phaseTotalSec: this.phase === 'idle' ? 0 : this.phaseTotalSec,
      pausedPhase: this.phase === 'paused' ? this.pausedPhase : null,
      pomodorosCompleted: this.pomodoros,
      sessionStartedAt: this.sessionStartedAt,
      current: this.isRunning() ? this.current : null,
      pet: { ...this.pet }
    }
  }

  // ---------------------------------------------------------------- pet

  private emitStatus(): void {
    this.emit('status', this.getStatus())
  }

  setMood(mood: PetMood): void {
    if (this.pet.mood === mood) return
    this.d.log(`mood ${this.pet.mood} -> ${mood}`)
    this.pet = { ...this.pet, mood }
    this.emitStatus()
  }

  /** Show a speech bubble (and optionally change mood). Auto-clears after timing.messageSec. */
  say(message: string, mood?: PetMood): void {
    if (mood) this.setMood(mood)
    this.pet = { ...this.pet, message, messageId: this.pet.messageId + 1 }
    this.d.log(`pet says: "${message}"`)
    if (this.messageTimer) this.d.clearTimeout(this.messageTimer)
    this.messageTimer = this.d.setTimeout(() => {
      this.messageTimer = null
      this.pet = { ...this.pet, message: null }
      // transient moods fall back once the bubble disappears
      if (this.pet.mood === 'wave' || (this.pet.mood === 'celebrate' && this.phase !== 'done')) {
        this.pet = { ...this.pet, mood: this.baseMood() }
      }
      this.emitStatus()
    }, this.timing.messageSec * 1000)
    this.emitStatus()
  }

  private baseMood(): PetMood {
    if (this.phase === 'break') return 'sleeping'
    if (this.phase === 'focus') return this.current?.category === 'focus' ? 'happy' : 'idle'
    return 'idle'
  }

  private pick(lines: string[]): string {
    let i = Math.floor(this.d.random() * lines.length) % lines.length
    if (i === this.lastLine && lines.length > 1) i = (i + 1) % lines.length
    this.lastLine = i
    return lines[i]
  }

  // ---------------------------------------------------------------- control

  start(): void {
    if (this.isRunning()) return
    if (this.doneTimer) {
      this.d.clearTimeout(this.doneTimer)
      this.doneTimer = null
    }
    const now = this.d.now()
    this.sessionStartedAt = now
    this.samples = []
    this.pomodoros = 0
    this.current = null
    this.finalScore = null
    this.resetStreak()
    this.lastNudgeAt = -Infinity
    this.d.log('session start')
    this.enterPhase('focus')
    this.say("let's do this! I'll keep you company 📚", 'happy')
    if (!this.ticker) this.ticker = this.d.setInterval(() => this.tick(), 1000)
    void this.doSample()
  }

  pause(): void {
    if (this.phase !== 'focus' && this.phase !== 'break') return
    const now = this.d.now()
    this.pausedPhase = this.phase
    this.pausedRemainingSec = Math.max(0, Math.ceil(((this.phaseEndsAt ?? now) - now) / 1000))
    this.phaseEndsAt = null
    this.phase = 'paused'
    this.resetStreak()
    this.d.log(`paused (${this.pausedRemainingSec}s left in ${this.pausedPhase})`)
    this.say("paused — I'll wait right here", 'idle')
  }

  resume(): void {
    if (this.phase !== 'paused' || !this.pausedPhase) return
    this.phase = this.pausedPhase
    this.phaseEndsAt = this.d.now() + this.pausedRemainingSec * 1000
    this.pausedPhase = null
    this.d.log(`resumed ${this.phase}`)
    if (this.phase === 'focus') {
      this.say("back at it! let's go", 'happy')
      void this.doSample()
    } else this.setMood('sleeping')
  }

  skipBreak(): void {
    const inBreak = this.phase === 'break' || (this.phase === 'paused' && this.pausedPhase === 'break')
    if (!inBreak) return
    this.d.log('break skipped')
    this.pausedPhase = null
    this.enterPhase('focus')
    this.say("no break? you're on fire! 🔥", 'happy')
    void this.doSample()
  }

  stop(): SessionRecord | null {
    if (!this.isRunning() || this.sessionStartedAt === null) return null
    const now = this.d.now()
    if (this.ticker) {
      this.d.clearInterval(this.ticker)
      this.ticker = null
    }
    const summary = summarizeSession(this.samples)
    this.finalScore = computeFocusScore(this.samples, now)
    const rec: SessionRecord = {
      id: `${this.sessionStartedAt.toString(36)}-${Math.floor(this.d.random() * 1e6).toString(36)}`,
      start: this.sessionStartedAt,
      end: now,
      durationSec: Math.round((now - this.sessionStartedAt) / 1000),
      ...summary,
      finalScore: this.finalScore,
      pomodorosCompleted: this.pomodoros,
      completed: this.pomodoros >= 1
    }
    try {
      this.d.saveSession(rec)
    } catch (e) {
      this.d.log(`failed to save session: ${(e as Error).message}`)
    }
    this.d.log(
      `session stop: ${rec.durationSec}s, score=${rec.finalScore}, pomodoros=${rec.pomodorosCompleted}, completed=${rec.completed}`
    )
    this.phase = 'done'
    this.phaseEndsAt = null
    this.pausedPhase = null
    this.resetStreak()
    if (rec.completed) {
      const n = rec.pomodorosCompleted
      this.say(`we did it! ${n} pomodoro${n === 1 ? '' : 's'} done 🎉`, 'celebrate')
    } else {
      this.say('session saved — every bit counts!', 'idle')
    }
    this.doneTimer = this.d.setTimeout(() => {
      this.doneTimer = null
      this.phase = 'idle'
      this.sessionStartedAt = null
      this.samples = []
      this.current = null
      this.pet = { ...this.pet, mood: 'idle' }
      this.d.log('back to idle')
      this.emitStatus()
    }, this.timing.doneSec * 1000)
    this.emitStatus()
    this.emit('session-saved', rec)
    return rec
  }

  dispose(): void {
    for (const t of [this.messageTimer, this.doneTimer]) if (t) this.d.clearTimeout(t)
    if (this.ticker) this.d.clearInterval(this.ticker)
    this.ticker = this.messageTimer = this.doneTimer = null
  }

  // ---------------------------------------------------------------- internals

  private enterPhase(phase: 'focus' | 'break'): void {
    const t = this.timing
    this.phase = phase
    this.phaseTotalSec = phase === 'focus' ? t.focusSec : t.breakSec
    this.phaseEndsAt = this.d.now() + this.phaseTotalSec * 1000
    this.resetStreak()
    this.pendingWelcome = false
    this.d.log(`phase -> ${phase} (${this.phaseTotalSec}s)`)
  }

  private resetStreak(): void {
    this.streakStart = null
    this.nudgedThisStreak = false
    this.notifiedThisStreak = false
  }

  /** Called every second while a session is active. Public so tests can drive it. */
  tick(): void {
    const now = this.d.now()
    if (this.phase === 'focus' && this.phaseEndsAt !== null && now >= this.phaseEndsAt) {
      this.pomodoros++
      this.d.log(`pomodoro #${this.pomodoros} complete`)
      this.d.notify('Break time!', `Nice work — ${this.timing.breakSec >= 60 ? Math.round(this.timing.breakSec / 60) + ' min' : this.timing.breakSec + 's'} break. Stretch, drink some water 💧`)
      this.enterPhase('break')
      this.current = null
      this.say('break time! nap time for me 💤', 'sleeping')
    } else if (this.phase === 'break' && this.phaseEndsAt !== null && now >= this.phaseEndsAt) {
      this.d.notify('Time to focus', "Break's over — let's start the next pomodoro!")
      this.enterPhase('focus')
      this.say("I'm awake! let's focus 💪", 'happy')
      void this.doSample()
    } else if (this.phase === 'focus' && now - this.lastSampleAt >= this.timing.sampleSec * 1000 - 50) {
      void this.doSample()
    }
    this.emitStatus()
  }

  private async doSample(): Promise<void> {
    if (this.phase !== 'focus' || this.sampling) return
    this.sampling = true
    this.lastSampleAt = this.d.now()
    let raw: RawActive | null = null
    try {
      raw = await this.d.sample()
    } catch {
      raw = null
    } finally {
      this.sampling = false
    }
    if (this.phase !== 'focus') return // phase changed while sampling
    this.recordSample(raw)
  }

  /** Classify + store one sample and update mood/nudges. Public for tests. */
  recordSample(raw: RawActive | null): void {
    if (this.phase !== 'focus') return
    const settings = this.d.getSettings()
    const t = this.d.now()
    const app = raw?.app || 'Unknown'
    const category = raw ? classify(raw, settings) : 'neutral'
    const domain = raw ? resolveDomain(raw) : undefined
    const s: StoredSample = {
      t,
      app,
      title: raw?.title ?? '',
      url: raw?.url,
      domain,
      category,
      durationSec: this.timing.sampleSec
    }
    this.samples.push(s)
    this.current = { app, domain, category }
    const score = computeFocusScore(this.samples, t)
    this.d.log(`sample app="${app}"${domain ? ` domain=${domain}` : ''} category=${category} score=${score}`)
    this.updateMood(category, t)
    this.emitStatus()
  }

  private updateMood(category: ActiveSample['category'], t: number): void {
    const tm = this.timing
    if (category === 'distract') {
      if (this.streakStart === null) this.streakStart = t
      const streak = (t - this.streakStart) / 1000
      const cooldownOk = t - this.lastNudgeAt >= tm.cooldownSec * 1000
      if (streak >= tm.nudgeAfterSec && cooldownOk) {
        this.lastNudgeAt = t
        this.nudgedThisStreak = true
        this.pendingWelcome = true
        const mood: PetMood = streak >= tm.sadAfterSec ? 'sad' : 'worried'
        this.d.log(`nudge (distracted ${Math.round(streak)}s)`)
        this.say(this.pick(NUDGE_LINES), mood)
        if (streak >= tm.notifyAfterSec && !this.notifiedThisStreak) {
          this.notifiedThisStreak = true
          this.d.log('nudge notification')
          this.d.notify('Study Pet misses you 🐾', `You've been off task for ${formatDur(streak)}. Let's get back to it together!`)
        }
      } else if (streak >= tm.sadAfterSec) {
        this.setMood('sad')
      } else if (!this.nudgedThisStreak && this.pet.mood === 'happy') {
        this.setMood('idle')
      }
      return
    }
    // focus or neutral ends a distraction streak
    this.resetStreak()
    if (category === 'focus') {
      if (this.pendingWelcome) {
        this.pendingWelcome = false
        this.say(this.pick(WELCOME_LINES), 'happy')
      } else if (this.pet.mood !== 'wave' && this.pet.mood !== 'celebrate') this.setMood('happy')
    } else if (this.pet.mood !== 'wave' && this.pet.mood !== 'celebrate') {
      this.setMood('idle')
    }
  }
}

function formatDur(sec: number): string {
  if (sec < 90) return `${Math.round(sec)} seconds`
  return `${Math.round(sec / 60)} minutes`
}
