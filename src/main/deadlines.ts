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

export function parseDeadlines(data: Record<string, unknown>, now = Date.now(), limit = 5): Deadline[] {
  const out: Deadline[] = []
  for (const [key, comp] of Object.entries(data)) {
    const ev = comp as { type?: string; start?: Date; uid?: string; summary?: unknown; location?: unknown }
    if (!ev || ev.type !== 'VEVENT' || !(ev.start instanceof Date)) continue
    const start = ev.start.getTime()
    if (!Number.isFinite(start) || start < now) continue
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

export async function refreshDeadlines(icalUrl: string): Promise<Result<Deadline[]>> {
  if (!icalUrl.trim()) return { ok: false, error: 'Add your Brightspace calendar (iCal) URL in Settings first.' }
  const url = normalizeIcalUrl(icalUrl)
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(15000) })
    if (!res.ok) return { ok: false, error: `Calendar request failed (HTTP ${res.status})` }
    const body = await res.text()
    if (!/BEGIN:VCALENDAR/i.test(body)) return { ok: false, error: "That URL didn't return an iCal calendar." }
    const items = parseDeadlines(ical.sync.parseICS(body) as Record<string, unknown>)
    setDeadlinesCache({ fetchedAt: Date.now(), url, items })
    console.log(`[studypet] deadlines refreshed: ${items.length} upcoming`)
    return { ok: true, value: items }
  } catch (e) {
    return { ok: false, error: `Couldn't load calendar: ${(e as Error).message}` }
  }
}
