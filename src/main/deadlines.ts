import ical from 'node-ical'
import type { Deadline, Result } from '@shared/types'
import { getDeadlinesCache, setDeadlinesCache } from './store'

const EXAM_RE = /\b(exam|midterm|final|quiz|test)s?\b/i

function text(v: unknown): string {
  if (typeof v === 'string') return v
  if (v && typeof v === 'object' && 'val' in v) return String((v as { val: unknown }).val ?? '')
  return v == null ? '' : String(v)
}

export function normalizeIcalUrl(url: string): string {
  return url.trim().replace(/^webcals?:\/\//i, 'https://')
}

interface IcalEvent {
  type?: string
  start?: Date & { dateOnly?: boolean }
  end?: Date
  datetype?: string
  uid?: string
  summary?: unknown
  location?: unknown
  status?: string
  rrule?: { after(d: Date, inc?: boolean): Date | null }
  exdate?: Record<string, unknown>
}

const DAY_MS = 86_400_000

function isAllDay(ev: IcalEvent): boolean {
  return ev.datetype === 'date' || ev.start?.dateOnly === true
}

/** When an occurrence starting at `start` is over: all-day events last until the end of their day(s). */
function occurrenceEnd(ev: IcalEvent, start: number): number {
  if (!isAllDay(ev)) return start
  const master = ev.start?.getTime() ?? start
  const endMs = ev.end instanceof Date ? ev.end.getTime() : NaN
  const len = Number.isFinite(endMs) && endMs > master ? endMs - master : 0
  if (len) return start + len
  const d = new Date(start)
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1).getTime()
}

function isExcluded(ev: IcalEvent, d: Date): boolean {
  const ex = ev.exdate
  if (!ex || typeof ex !== 'object') return false
  const iso = d.toISOString()
  return iso in ex || iso.slice(0, 10) in ex || Object.values(ex).some((v) => v instanceof Date && v.getTime() === d.getTime())
}

/**
 * The next occurrence of an event that is not over yet (start epoch ms), or null.
 * Recurring events (RRULE) yield their next occurrence; EXDATEs are skipped.
 */
function nextOccurrence(ev: IcalEvent, now: number): number | null {
  const start = ev.start!.getTime()
  if (!Number.isFinite(start)) return null
  if (!ev.rrule) return occurrenceEnd(ev, start) >= now ? start : null
  try {
    // an all-day occurrence that began earlier today still counts, so look back one day
    let from = new Date(isAllDay(ev) ? now - DAY_MS : now)
    for (let i = 0; i < 100; i++) {
      const occ = ev.rrule.after(from, i === 0)
      if (!occ) return null
      const t = occ.getTime()
      if (occurrenceEnd(ev, t) >= now && !isExcluded(ev, occ)) return t
      from = occ // after(.., false) moves strictly past it next time
    }
  } catch {
    return occurrenceEnd(ev, start) >= now ? start : null
  }
  return null
}

export function parseDeadlines(data: Record<string, unknown>, now = Date.now(), limit = 5): Deadline[] {
  const out: Deadline[] = []
  for (const [key, comp] of Object.entries(data)) {
    const ev = comp as IcalEvent
    if (!ev || ev.type !== 'VEVENT' || !(ev.start instanceof Date)) continue
    if (typeof ev.status === 'string' && ev.status.toUpperCase() === 'CANCELLED') continue
    const start = nextOccurrence(ev, now)
    if (start === null) continue
    const summary = text(ev.summary).trim() || 'Untitled event'
    const location = text(ev.location).trim()
    out.push({
      uid: ev.uid || key,
      summary,
      start,
      isExam: EXAM_RE.test(summary),
      ...(location ? { location } : {})
    })
  }
  return out.sort((a, b) => a.start - b.start).slice(0, limit)
}

export function getDeadlines(): Result<Deadline[]> {
  const c = getDeadlinesCache()
  if (!c) return { ok: true, value: [] }
  const now = Date.now()
  return { ok: true, value: c.items.filter((d) => d.start >= now) }
}

const MAX_ICAL_BYTES = 5 * 1024 * 1024
const TOO_BIG = 'That calendar is too large (over 5 MB).'

export async function refreshDeadlines(icalUrl: string): Promise<Result<Deadline[]>> {
  if (typeof icalUrl !== 'string' || !icalUrl.trim()) {
    return { ok: false, error: 'Add your Brightspace calendar (iCal) URL in Settings first.' }
  }
  const url = normalizeIcalUrl(icalUrl)
  try {
    const u = new URL(url)
    const local = u.hostname === 'localhost' || u.hostname === '127.0.0.1' || u.hostname === '[::1]'
    if (u.protocol !== 'https:' && !(u.protocol === 'http:' && local)) {
      return { ok: false, error: 'Use the https:// calendar link (Brightspace gives you one).' }
    }
    const res = await fetch(url, { signal: AbortSignal.timeout(15000) })
    if (!res.ok) return { ok: false, error: `Calendar request failed (HTTP ${res.status})` }
    const declared = Number(res.headers?.get?.('content-length') ?? NaN)
    if (Number.isFinite(declared) && declared > MAX_ICAL_BYTES) return { ok: false, error: TOO_BIG }
    const body = await res.text()
    if (body.length > MAX_ICAL_BYTES) return { ok: false, error: TOO_BIG }
    if (!/BEGIN:VCALENDAR/i.test(body)) return { ok: false, error: "That URL didn't return an iCal calendar." }
    const items = parseDeadlines(ical.sync.parseICS(body) as Record<string, unknown>)
    setDeadlinesCache({ fetchedAt: Date.now(), url, items })
    console.log(`[bloop] deadlines refreshed: ${items.length} upcoming`)
    return { ok: true, value: items }
  } catch (e) {
    return { ok: false, error: `Couldn't load calendar: ${(e as Error).message}` }
  }
}
