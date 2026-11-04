import type { Settings } from '@shared/types'
import type { NotifyOptions, SessionEngine } from './session'
import { localDateKey } from './stats'
import { getDeadlinesCache, markReminderFired, wasReminderFired } from './store'

export interface ReminderDeps {
  engine: SessionEngine
  getSettings: () => Settings
  notify: (title: string, body: string, opts?: NotifyOptions) => void
  now?: () => number
}

function hhmm(d: Date): string {
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

/** Checks study reminders (and exam deadline reminders) every 30s. */
export class ReminderScheduler {
  private timer: ReturnType<typeof setInterval> | null = null
  constructor(private readonly deps: ReminderDeps) {}

  start(): void {
    if (this.timer) return
    this.timer = setInterval(() => this.check(), 30_000)
    setTimeout(() => this.check(), 2_000)
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
  }

  check(): void {
    try {
      this.checkStudyReminders()
      this.checkDeadlines()
    } catch (e) {
      console.log(`[studypet] reminder check failed: ${(e as Error).message}`)
    }
  }

  private checkStudyReminders(): void {
    const now = new Date(this.deps.now?.() ?? Date.now())
    const date = localDateKey(now)
    const time = hhmm(now)
    for (const r of this.deps.getSettings().reminders) {
      if (!r.enabled || !r.days.includes(now.getDay()) || r.time !== time) continue
      const key = `${date}|${r.id}`
      if (wasReminderFired(key)) continue
      markReminderFired(key)
      if (this.deps.engine.isRunning()) {
        console.log(`[studypet] reminder "${r.label}" skipped (session running)`)
        continue
      }
      console.log(`[studypet] reminder fired: "${r.label}"`)
      this.deps.engine.say('Time to study!', 'wave')
      this.deps.notify('Time to study! 📚', r.label || "Your study pet is ready when you are.", {
        actionText: 'Start session',
        onAction: () => this.deps.engine.start()
      })
    }
  }

  private checkDeadlines(): void {
    const cache = getDeadlinesCache()
    if (!cache) return
    const now = this.deps.now?.() ?? Date.now()
    for (const d of cache.items) {
      if (!d.isExam || d.start <= now) continue
      const days = (d.start - now) / 86400e3
      for (const n of [1, 3]) {
        if (days > n) continue
        // only the nearest threshold (don't fire "3 days" when it's already 1 day away)
        if (n === 3 && days <= 1) continue
        const key = `deadline|${d.uid}|${n}d`
        if (wasReminderFired(key)) continue
        markReminderFired(key, now)
        const when = new Date(d.start).toLocaleString(undefined, { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
        console.log(`[studypet] deadline reminder: ${d.summary} in ~${n}d`)
        this.deps.notify(`${d.summary} in ${n === 1 ? '1 day' : '3 days'}`, `${when} — want to start a study session?`, {
          actionText: 'Start session',
          onAction: () => this.deps.engine.start()
        })
        if (!this.deps.engine.isRunning()) this.deps.engine.say(`${d.summary} is coming up!`, 'wave')
      }
    }
  }
}
