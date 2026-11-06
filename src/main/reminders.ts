import type { Reminder, Settings } from '@shared/types'
import type { NotifyOptions, SessionEngine } from './session'
import { localDateKey } from './stats'
import { getDeadlinesCache, markReminderFired, wasReminderFired } from './store'
import { NotificationPicker } from './notifications'

export interface ReminderDeps {
  engine: SessionEngine
  getSettings: () => Settings
  notify: (title: string, body: string, opts?: NotifyOptions) => void
  now?: () => number
}

function hhmm(d: Date): string {
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

/**
 * Checks study reminders (and exam deadline reminders) every 30s.
 *
 * Windows: toasts need the AppUserModelId (index.ts sets APP_ID from src/shared/appId.ts = build.appId, which the
 * NSIS installer also stamps on the Start Menu shortcut). Clicking a toast fires the 'click' handler
 * that runs onAction (start session) while Bloop is running. Windows Focus Assist / Do Not Disturb
 * silently diverts toasts to the Action Center, so a reminder can go unseen; the pet's speech bubble
 * (engine.say) is the fallback. The portable .exe has no Start Menu shortcut, so its toasts may be
 * attributed to a generic name or dropped on some systems.
 */
export class ReminderScheduler {
  private readonly notes = new NotificationPicker()
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
    } catch (e) {
      console.log(`[bloop] reminder check failed: ${(e as Error).message}`)
    }
    try {
      this.checkDeadlines()
    } catch (e) {
      console.log(`[bloop] deadline check failed: ${(e as Error).message}`)
    }
  }

  private checkStudyReminders(): void {
    const now = new Date(this.deps.now?.() ?? Date.now())
    const date = localDateKey(now)
    const time = hhmm(now)
    const list = this.deps.getSettings()?.reminders
    if (!Array.isArray(list)) return
    for (const r of list) {
      try {
        this.fireReminder(r, now, date, time)
      } catch (e) {
        console.log(`[bloop] reminder skipped: ${(e as Error).message}`)
      }
    }
  }

  private fireReminder(r: Reminder | null | undefined, now: Date, date: string, time: string): void {
    {
      if (!r || typeof r !== 'object' || !r.enabled || !Array.isArray(r.days) || typeof r.time !== 'string') return
      if (!r.days.includes(now.getDay()) || r.time !== time) return
      const key = `${date}|${r.id}`
      if (wasReminderFired(key)) return
      markReminderFired(key)
      if (this.deps.engine.isRunning()) {
        console.log(`[bloop] reminder "${r.label}" skipped (session running)`)
        return
      }
      console.log(`[bloop] reminder fired: "${r.label}"`)
      this.deps.engine.say('Time to study!', 'wave')
      const note = this.notes.next('studyReminder')
      this.deps.notify(note.title, r.label || note.body, {
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
        console.log(`[bloop] deadline reminder: ${d.summary} in ~${n}d`)
        const note = this.notes.next('deadline', { title: d.summary, days: n === 1 ? '1 day' : '3 days', when })
        this.deps.notify(note.title, note.body, {
          actionText: 'Start session',
          onAction: () => this.deps.engine.start()
        })
        if (!this.deps.engine.isRunning()) this.deps.engine.say(`${d.summary} is coming up!`, 'wave')
      }
    }
  }
}
