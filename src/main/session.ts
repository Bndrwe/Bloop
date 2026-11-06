// Pomodoro session engine + focus nudges. No electron imports: everything platform-specific is
// injected via SessionDeps, so it can be driven with a fake clock in tests.
import { EventEmitter } from 'node:events'
import type { ActiveSample, AppStatus, ContentJudgement, CurrentActivity, PetMood, PetState, SessionPhase, SessionRecord, Settings } from '@shared/types'
import { classify, isBrowser, resolveDomain } from './classifier'
import { computeFocusScore, SCORE_HALF_LIFE_SEC, summarizeSession } from './score'
import { localDateKey } from './stats'
import { stripBrowserSuffix } from './titleDomain'
import type { RawActive } from './tracker'
import { NotificationPicker, type NotifyKind } from './notifications'

export interface Timing {
  focusSec: number
  breakSec: number
  sampleSec: number
  nudgeAfterSec: number
  notifyAfterSec: number
  /** After the first notification, the bubble + notification repeat this often while still distracted. */
  remindEverySec: number
  /** A new distraction streak's instant bubble waits at least this long after the previous bubble. */
  rebubbleSec: number
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
      nudgeAfterSec: Math.max(0, Math.round(s.nudgeAfterSec / 10)),
      notifyAfterSec: Math.max(5, Math.round(s.notifyAfterSec / 10)),
      remindEverySec: Math.max(5, Math.round(s.nudgeCooldownSec / 10)),
      rebubbleSec: 3,
      sadAfterSec: 30,
      messageSec: 6,
      doneSec: 6
    }
  }
  return {
    focusSec: s.focusMinutes * 60,
    breakSec: s.breakMinutes * 60,
    sampleSec: Math.max(1, s.sampleIntervalSec),
    nudgeAfterSec: Math.max(0, s.nudgeAfterSec),
    notifyAfterSec: s.notifyAfterSec,
    remindEverySec: Math.max(1, s.nudgeCooldownSec),
    rebubbleSec: 30,
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
  /** Front-app names that are Bloop itself (default ["Bloop"]; dev adds "Electron"). */
  selfNames?: string[]
  /**
   * "Depends on what's open" sites: the verdict for the page (null = not such a site). Study counts
   * as focus, not study as distracting, unsure keeps the list category. Must not block.
   */
  judge?: (raw: RawActive) => ContentJudgement | null
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

/**
 * Always-on watching (no session running). Its samples only feed the live score and the pet:
 * they are never saved to history and never leave this process.
 */
interface WatchState {
  /** epoch ms watching (re)started: the score's fresh-start prior is dated here */
  startedAt: number
  /** local YYYY-MM-DD it started; a new day starts a fresh score */
  day: string
  samples: StoredSample[]
  current: CurrentActivity | null
  /** last sample where someone was at the computer (not locked / asleep / unknown) */
  lastPresentAt: number
}

/** After this long away (locked, asleep, no window), always-on watching starts a fresh score. */
export const WATCH_RESET_AFTER_MS = 30 * 60_000
/** Watch samples older than this weigh < 1/2^18 in the score and are dropped. */
const WATCH_KEEP_MS = 3 * 3600_000
/** Front "apps" that mean nobody is at the computer (macOS lock screen / screen saver, Windows lock). */
const AWAY_APPS = /^(loginwindow|screensaverengine|lockapp|windows default lock screen)$/i

/** A browser is in front but neither its URL nor a usable title could be read. */
export function isSiteHidden(raw: RawActive | null): boolean {
  if (!raw || !isBrowser(raw.app) || raw.url) return false
  return !stripBrowserSuffix(raw.title ?? '')
}

export class SessionEngine extends EventEmitter {
  private readonly d: Required<Omit<SessionDeps, 'log' | 'judge'>> & { log: (m: string) => void; judge?: SessionDeps['judge'] }

  private phase: SessionPhase = 'idle'
  private pausedPhase: 'focus' | 'break' | null = null
  private phaseEndsAt: number | null = null
  private pausedRemainingSec = 0
  private phaseTotalSec = 0
  private pomodoros = 0
  private sessionStartedAt: number | null = null
  private samples: StoredSample[] = []
  private current: CurrentActivity | null = null
  private finalScore: number | null = null
  private watch: WatchState | null = null
  private loggedSiteHidden = false

  private lastSampleAt = 0
  private sampling = false
  private streakStart: number | null = null
  private lastNudgeAt = -Infinity
  /** the streak's instant bubble has been shown (or skipped) */
  private bubbledThisStreak = false
  /** reminders (bubble + notification) sent in this streak */
  private remindersThisStreak = 0
  /** time of the last sample of the current mode, Bloop's own windows included (gap detection) */
  private lastSeenAt: number | null = null
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
      selfNames: ['Bloop'],
      log: (m) => console.log(`[bloop] ${m}`),
      ...deps
    } as SessionEngine['d']
  }

  get timing(): Timing {
    return timingFrom(this.d.getSettings(), this.d.fast)
  }

  isRunning(): boolean {
    return this.phase === 'focus' || this.phase === 'break' || this.phase === 'paused'
  }

  /** Always-on watching: no session (idle or the short "done" screen) and the setting is on. */
  isWatching(): boolean {
    return (this.phase === 'idle' || this.phase === 'done') && this.d.getSettings().trackWithoutSession !== false
  }

  /** Start the 1 s ticker (always-on watching needs it without a session). Safe to call twice. */
  startTicker(): void {
    if (!this.ticker) this.ticker = this.d.setInterval(() => this.tick(), 1000)
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
    const watching = this.isWatching()
    let score: number | null = null
    if (this.isRunning()) score = this.sessionScore(now)
    else if (this.phase === 'done') score = this.finalScore
    else if (watching) score = this.watch ? this.watchScore(now) : 100
    let current: CurrentActivity | null = null
    if (this.isRunning()) current = this.current
    else if (watching) current = this.watch?.current ?? null
    return {
      phase: this.phase,
      score,
      watching,
      phaseEndsAt: running ? this.phaseEndsAt : null,
      remainingSec,
      phaseTotalSec: this.phase === 'idle' ? 0 : this.phaseTotalSec,
      pausedPhase: this.phase === 'paused' ? this.pausedPhase : null,
      pomodorosCompleted: this.pomodoros,
      sessionStartedAt: this.sessionStartedAt,
      current: current ? { ...current } : null,
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
    if (trace()) this.d.log(`pet says: "${message}"`)
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
    if (this.isWatching()) return this.watch?.current?.category === 'focus' ? 'happy' : 'idle'
    return 'idle'
  }

  /** Live session score: starts at 100 (fresh-start prior at the session start). */
  private sessionScore(now: number): number | null {
    return computeFocusScore(this.samples, now, SCORE_HALF_LIFE_SEC, this.sessionStartedAt === null ? null : { t: this.sessionStartedAt })
  }

  private watchScore(now: number): number | null {
    if (!this.watch) return null
    return computeFocusScore(this.watch.samples, now, SCORE_HALF_LIFE_SEC, { t: this.watch.startedAt })
  }

  /** Stop always-on watching (setting turned off, or a session starts). */
  private endWatch(): void {
    if (!this.watch) return
    this.watch = null
    this.resetStreak()
    this.pendingWelcome = false
    this.d.log('watching stopped')
  }

  private readonly notes = new NotificationPicker(() => this.d.random())

  /** Sends a system notification with the next message for this event (see notifications.ts). */
  private notifyFrom(kind: NotifyKind, vars: Record<string, string> = {}): void {
    const n = this.notes.next(kind, vars)
    this.d.notify(n.title, n.body)
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
    this.watch = null // starting a session switches from always-on watching to the session
    this.resetStreak()
    this.lastNudgeAt = -Infinity
    this.lastSeenAt = null
    this.d.log('session start')
    this.enterPhase('focus')
    this.say("let's do this! I'll keep you company 📚", 'happy')
    this.startTicker()
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
    this.say("paused, I'll nap until you're back", 'sleeping')
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
    // The ticker keeps running: always-on watching takes over after the session (if enabled).
    const summary = summarizeSession(this.samples)
    // The score the student saw (with the fresh-start prior); null if nothing was measured.
    this.finalScore = summary.focusSec + summary.distractSec > 0 ? this.sessionScore(now) : null
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
    this.pendingWelcome = false
    this.watch = null // watching (if on) starts a fresh score after the session
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
    this.bubbledThisStreak = false
    this.remindersThisStreak = 0
  }

  /** Called every second while a session is active. Public so tests can drive it. */
  tick(): void {
    const now = this.d.now()
    const watching = this.isWatching()
    if (!watching && this.watch && !this.isRunning()) {
      // trackWithoutSession was turned off
      this.endWatch()
      if (this.phase === 'idle') this.setMood('idle')
    }
    const sampleDue = now - this.lastSampleAt >= this.timing.sampleSec * 1000 - 50
    if (this.phase === 'focus' && this.phaseEndsAt !== null && now >= this.phaseEndsAt) {
      this.pomodoros++
      this.d.log(`pomodoro #${this.pomodoros} complete`)
      this.notifyFrom('breakStart', { break: this.timing.breakSec >= 60 ? Math.round(this.timing.breakSec / 60) + ' min' : this.timing.breakSec + 's' })
      this.enterPhase('break')
      this.current = null
      this.say('break time! nap time for me 💤', 'sleeping')
    } else if (this.phase === 'break' && this.phaseEndsAt !== null && now >= this.phaseEndsAt) {
      this.notifyFrom('focusStart')
      this.enterPhase('focus')
      this.say("I'm awake! let's focus 💪", 'happy')
      void this.doSample()
    } else if ((this.phase === 'focus' || watching) && sampleDue) {
      void this.doSample()
    }
    if (this.phase !== 'idle' || watching) this.emitStatus()
  }

  /** What samples are for right now: the running focus phase, always-on watching, or nothing. */
  private sampleMode(): 'session' | 'watch' | null {
    if (this.phase === 'focus') return 'session'
    return this.isWatching() ? 'watch' : null
  }

  private async doSample(): Promise<void> {
    const mode = this.sampleMode()
    if (!mode || this.sampling) return
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
    if (this.sampleMode() !== mode) return // phase changed while sampling
    this.recordSample(raw)
  }

  /** Classify + store one sample and update mood/nudges. Public for tests. */
  recordSample(raw: RawActive | null): void {
    const mode = this.sampleMode()
    if (!mode) return
    if (raw && this.isSelf(raw)) return this.recordSelfSample(mode)
    if (mode === 'watch') return this.recordWatchSample(raw)
    const settings = this.d.getSettings()
    const t = this.d.now()
    const app = raw?.app || 'Unknown'
    const { category, content } = raw ? this.categorize(raw, settings) : { category: 'neutral' as const, content: null }
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
    // A long gap since the previous sample (laptop asleep, lid closed, process suspended) is not
    // time spent distracted: start any distraction streak afresh instead of counting the gap.
    this.checkGap(t)
    this.samples.push(s)
    this.current = this.activity(raw, app, domain, category, content)
    const score = this.sessionScore(t)
    // Privacy: the persistent log must not record activity, so per-sample lines need BLOOP_TRACE=1.
    if (trace()) this.d.log(`sample app="${app}"${domain ? ` domain=${domain}` : ''} category=${category} score=${score}`)
    else if (this.samples.length === 1) this.d.log(`first sample: category=${category} score=${score}`)
    this.updateMood(category, t)
    this.emitStatus()
  }

  /** Bloop's own panel / settings / chat in front. */
  private isSelf(raw: RawActive): boolean {
    const a = raw.app.trim().toLowerCase()
    return !!a && this.d.selfNames.some((n) => n.toLowerCase() === a)
  }

  /**
   * Bloop's own window is in front (e.g. the panel was clicked). It is not a new activity: the
   * previous app keeps its category, the pet keeps its mood, a distraction streak keeps running,
   * and the time counts toward neither focus nor distraction in the score (the sample is skipped).
   */
  private recordSelfSample(mode: 'session' | 'watch'): void {
    const t = this.d.now()
    this.lastSeenAt = t
    if (mode === 'watch' && this.watch) this.watch.lastPresentAt = t
  }

  /**
   * A long gap since the previous sample (laptop asleep, lid closed, process suspended) is not
   * time spent distracted: start any distraction streak afresh instead of counting the gap.
   */
  private checkGap(t: number): void {
    if (this.lastSeenAt !== null && t - this.lastSeenAt > 3 * this.timing.sampleSec * 1000) this.resetStreak()
    this.lastSeenAt = t
  }

  /** The lists' category, adjusted by the page's content on "depends on what's open" sites. */
  private categorize(raw: RawActive, settings: Settings): { category: ActiveSample['category']; content: ContentJudgement | null } {
    const base = classify(raw, settings)
    let content: ContentJudgement | null = null
    if (this.d.judge) {
      try {
        content = this.d.judge(raw)
      } catch (e) {
        this.d.log(`content judge failed: ${(e as Error).message}`)
      }
    }
    if (!content) return { category: base, content: null }
    const category = content.verdict === 'study' ? 'focus' : content.verdict === 'not-study' ? 'distract' : base
    return { category, content }
  }

  /** Take a sample right away (e.g. after "This is study" so the panel and pet update at once). */
  sampleNow(): void {
    void this.doSample()
  }

  private activity(
    raw: RawActive | null,
    app: string,
    domain: string | undefined,
    category: ActiveSample['category'],
    content: ContentJudgement | null = null
  ): CurrentActivity {
    const a: CurrentActivity = { app, domain, category }
    if (content) a.content = { ...content }
    if (isSiteHidden(raw)) {
      a.siteHidden = true
      if (!this.loggedSiteHidden) {
        this.loggedSiteHidden = true
        this.d.log("a browser is in front but its URL and title can't be read (Screen Recording / Automation not allowed?)")
      }
    }
    return a
  }

  /**
   * Always-on watching: same reactions as a focus session (mood, bubble, notification), its own
   * live score with a fresh-start prior, and nothing is saved to history.
   */
  private recordWatchSample(raw: RawActive | null): void {
    const t = this.d.now()
    const tm = this.timing
    const away = !raw || AWAY_APPS.test(raw.app.trim())
    let w = this.watch
    const stale =
      !w || w.day !== localDateKey(t) || (!away && t - w.lastPresentAt > WATCH_RESET_AFTER_MS)
    if (stale) {
      if (w) this.d.log('watching: fresh start (new day or back after a long break)')
      else this.d.log('watching for distractions (no session)')
      w = this.watch = { startedAt: t, day: localDateKey(t), samples: [], current: null, lastPresentAt: t }
      this.lastSeenAt = null
      this.resetStreak()
      this.pendingWelcome = false
    }
    const ws = w as WatchState
    if (away) {
      // Locked, asleep or no window: not distracted, and nothing to show.
      this.lastSeenAt = t
      ws.current = null
      this.resetStreak()
      if (this.pet.mood === 'worried' || this.pet.mood === 'sad' || this.pet.mood === 'happy') this.setMood('idle')
      this.emitStatus()
      return
    }
    const r = raw as RawActive
    const settings = this.d.getSettings()
    const app = r.app || 'Unknown'
    const { category, content } = this.categorize(r, settings)
    const domain = resolveDomain(r)
    this.checkGap(t)
    ws.lastPresentAt = t
    ws.samples.push({ t, app, title: r.title ?? '', url: r.url, domain, category, durationSec: tm.sampleSec })
    while (ws.samples.length > 0 && t - (ws.samples[0] as StoredSample).t > WATCH_KEEP_MS) ws.samples.shift()
    ws.current = this.activity(r, app, domain, category, content)
    if (trace()) this.d.log(`watch sample app="${app}"${domain ? ` domain=${domain}` : ''} category=${category} score=${this.watchScore(t)}`)
    this.updateMood(category, t)
    this.emitStatus()
  }

  private updateMood(category: ActiveSample['category'], t: number): void {
    const tm = this.timing
    if (category === 'distract') {
      if (this.streakStart === null) this.streakStart = t
      const streak = (t - this.streakStart) / 1000
      // Unhappy right away; sad after a long streak.
      const mood: PetMood = streak >= tm.sadAfterSec ? 'sad' : 'worried'
      // Reminders: bubble + notification at notifyAfterSec, then every remindEverySec.
      const due = tm.notifyAfterSec + this.remindersThisStreak * tm.remindEverySec
      if (streak >= due) {
        // after a clock jump, skip the reminders that were missed instead of sending them all
        this.remindersThisStreak = Math.floor((streak - tm.notifyAfterSec) / tm.remindEverySec) + 1
        this.bubbledThisStreak = true
        this.lastNudgeAt = t
        this.pendingWelcome = true
        this.d.log(`nudge + notification (distracted ${Math.round(streak)}s)`)
        this.say(this.pick(NUDGE_LINES), mood)
        this.notifyFrom('drift', { dur: formatDur(streak) })
        return
      }
      // The instant bubble: once per streak, unless one was shown moments ago (quick tab flips).
      if (!this.bubbledThisStreak && streak >= tm.nudgeAfterSec) {
        this.bubbledThisStreak = true
        if (t - this.lastNudgeAt >= tm.rebubbleSec * 1000) {
          this.lastNudgeAt = t
          this.pendingWelcome = true
          this.d.log(`nudge (distracted ${Math.round(streak)}s)`)
          this.say(this.pick(NUDGE_LINES), mood)
          return
        }
      }
      this.setMood(mood)
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

/** Activity details (app names, domains, pet lines) are only logged when tracing. */
function trace(): boolean {
  return process.env['BLOOP_TRACE'] === '1'
}

function formatDur(sec: number): string {
  if (sec < 90) return `${Math.round(sec)} seconds`
  return `${Math.round(sec / 60)} minutes`
}
