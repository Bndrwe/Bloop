// Brightspace (D2L) deadlines through the Valence REST API, using the student's own logged-in
// session (cookies in the `persist:brightspace` partition). This file is pure: no electron, no
// store. The Electron side (login window, session, scheduling, IPC) is in brightspaceApp.ts.
//
// API reference: https://docs.valence.desire2learn.com/reference.html
//   GET /d2l/api/versions/                                        (ProductVersions[])
//   GET /d2l/api/lp/{lp}/users/whoami                             (WhoAmIUser)
//   GET /d2l/api/lp/{lp}/enrollments/myenrollments/?…             (PagedResultSet of MyOrgUnitInfo)
//   GET /d2l/api/le/{le}/{orgUnitId}/dropbox/folders/             (DropboxFolder[])
//   GET /d2l/api/le/{le}/{orgUnitId}/quizzes/                     (ObjectListPage of QuizReadData)
//   GET /d2l/api/le/{le}/{orgUnitId}/calendar/events/myEvents/?…  (ObjectListPage of EventDataInfo)
import type { Deadline } from '@shared/types'
import { isTrustedRendererUrl, type TrustedOrigins } from './ai/guard'

export const BRIGHTSPACE_PARTITION = 'persist:brightspace'

/** Exam-like titles: whole words, optional plural, any case. Shared with the iCal parser. */
export const EXAM_RE = /\b(exam|midterm|final|quiz|test)s?\b/i

const DAY_MS = 86_400_000

// ------------------------------------------------------------------ host

export interface HostOptions {
  /** Tests (and a dev-only env flag) may use https://localhost or an IP. Never in a normal run. */
  allowLocal?: boolean
}

export type HostResult = { ok: true; origin: string; host: string } | { ok: false; error: string }

const IPV4 = /^\d{1,3}(\.\d{1,3}){3}$/
const LABEL = /^(?!-)[a-z0-9-]{1,63}(?<!-)$/

/**
 * "purdue.brightspace.com", "https://purdue.brightspace.com/d2l/home" → "https://purdue.brightspace.com".
 * Requires https and a real DNS name (no IP address, localhost, single label or credentials).
 */
export function normalizeBrightspaceHost(raw: unknown, opts: HostOptions = {}): HostResult {
  if (typeof raw !== 'string') return { ok: false, error: "Enter your school's Brightspace address." }
  const t = raw.trim()
  if (!t) return { ok: false, error: "Enter your school's Brightspace address." }
  if (t.length > 300) return { ok: false, error: 'That address is too long.' }
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(t) ? t : `https://${t}`
  let u: URL
  try {
    u = new URL(withScheme)
  } catch {
    return { ok: false, error: "That doesn't look like a web address. Try something like purdue.brightspace.com." }
  }
  if (u.protocol !== 'https:') return { ok: false, error: 'Brightspace must use https://.' }
  if (u.username || u.password) return { ok: false, error: "Don't put a username or password in the address." }
  const host = u.hostname.toLowerCase().replace(/\.$/, '')
  const isIp = IPV4.test(host) || host.startsWith('[')
  const isLocal = host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local')
  if ((isIp || isLocal) && !opts.allowLocal) {
    return { ok: false, error: "Use your school's Brightspace address, like purdue.brightspace.com." }
  }
  if (!isIp && !isLocal) {
    const labels = host.split('.')
    if (labels.length < 2 || !labels.every((l) => LABEL.test(l)) || !/^[a-z]{2,63}$/.test(labels[labels.length - 1]!)) {
      return { ok: false, error: "That doesn't look like a web address. Try something like purdue.brightspace.com." }
    }
  }
  const origin = `https://${u.port ? `${host}:${u.port}` : host}`
  return { ok: true, origin, host: u.port ? `${host}:${u.port}` : host }
}

/** For settings validation: the normalized origin, or '' when invalid/empty. */
export function cleanBrightspaceHost(raw: unknown, opts: HostOptions = {}): string {
  const r = normalizeBrightspaceHost(raw, opts)
  return r.ok ? r.origin : ''
}

/** Only for local testing against a mock server; ignored unless set explicitly. */
export function allowLocalBrightspace(env: NodeJS.ProcessEnv = process.env): boolean {
  return env['BLOOP_BRIGHTSPACE_ALLOW_LOCAL'] === '1'
}

// ------------------------------------------------------------------ login window policy

export type WindowKind = 'bloop' | 'brightspace-login'

/**
 * May a webContents of this kind navigate (or open a popup) to `url`?
 * - Bloop's own windows: only our renderer (the global guard in ai/guard.ts).
 * - The Brightspace login window (and its SSO popups): any https page, because single sign-on
 *   goes through Microsoft, Okta, Duo, Shibboleth and so on. Never http, file, data, javascript or
 *   custom app schemes, and never a URL with embedded credentials. about:blank is allowed so SSO
 *   popups can start empty.
 */
export function navigationDecision(
  url: string,
  kind: WindowKind,
  opts: { origins?: TrustedOrigins; allowLocal?: boolean } = {}
): 'allow' | 'deny' {
  if (kind === 'bloop') return opts.origins && isTrustedRendererUrl(url, opts.origins) ? 'allow' : 'deny'
  if (typeof url !== 'string' || url.length > 8192) return 'deny'
  if (url === 'about:blank') return 'allow'
  let u: URL
  try {
    u = new URL(url)
  } catch {
    return 'deny'
  }
  if (u.username || u.password) return 'deny'
  if (u.protocol === 'https:') return u.hostname ? 'allow' : 'deny'
  return 'deny'
}

/** The login is done once Brightspace itself shows its home page or a course page. */
export function isLoginSuccessUrl(url: string, origin: string): boolean {
  try {
    const u = new URL(url)
    if (u.origin !== origin) return false
    const p = u.pathname.toLowerCase()
    return p === '/d2l/home' || p.startsWith('/d2l/home/') || p.startsWith('/d2l/le/')
  } catch {
    return false
  }
}

/** Web permissions the login partition may use. Everything else (camera, mic, location, notifications…) is denied. */
export const LOGIN_ALLOWED_PERMISSIONS: ReadonlySet<string> = new Set([
  // copy a one-time code
  'clipboard-sanitized-write',
  // SSO pages embedded in an iframe reading their own cookies (stays inside the partition)
  'storage-access',
  'top-level-storage-access'
])

// ------------------------------------------------------------------ versions

export interface ProductVersions {
  ProductCode?: unknown
  LatestVersion?: unknown
  SupportedVersions?: unknown
}

function parseVer(v: unknown): [number, number] | null {
  if (typeof v !== 'string') return null
  const m = /^(\d+)\.(\d+)$/.exec(v.trim())
  return m ? [Number(m[1]), Number(m[2])] : null
}

/** Newest supported 1.x version of `product` ('lp' or 'le'), or null. */
export function pickVersion(list: unknown, product: 'lp' | 'le'): string | null {
  if (!Array.isArray(list)) return null
  const p = list.find((x) => x && typeof x === 'object' && String((x as ProductVersions).ProductCode).toLowerCase() === product) as
    | ProductVersions
    | undefined
  if (!p) return null
  const all = [...(Array.isArray(p.SupportedVersions) ? p.SupportedVersions : []), p.LatestVersion]
  let best: [number, number] | null = null
  for (const v of all) {
    const pv = parseVer(v)
    if (!pv || pv[0] !== 1) continue
    if (!best || pv[1] > best[1]) best = pv
  }
  return best ? `${best[0]}.${best[1]}` : null
}

// ------------------------------------------------------------------ dates

/** Valence UTCDateTime ("2026-11-10T04:59:00.000Z"). A string without a zone is read as UTC too. */
export function parseUtc(v: unknown): number | null {
  if (typeof v !== 'string' || !v.trim()) return null
  let s = v.trim()
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?$/.test(s)) s += 'Z'
  const t = Date.parse(s)
  return Number.isFinite(t) ? t : null
}

/** Local midnight of the date part of a Valence LocalDateTime ("2026-11-12T00:00:00.000"). */
export function localDay(v: unknown): number | null {
  if (typeof v !== 'string') return null
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(v.trim())
  if (!m) return null
  const t = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])).getTime()
  return Number.isFinite(t) ? t : null
}

// ------------------------------------------------------------------ mapping

export interface Course {
  id: number
  code: string
  name: string
  /** Short label used as the title prefix, e.g. "CHEM 201". */
  label: string
}

const COURSE_CODE = /\b([A-Z]{2,5})[\s_.-]?(\d{2,4}[A-Z]?)\b/

function clean(s: unknown, max = 160): string {
  // eslint-disable-next-line no-control-regex
  return typeof s === 'string' ? s.replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max) : ''
}

/** "CHEM 201" from "CHEM 201 - General Chemistry" or "202610.CHEM.201.001"; else the course name. */
export function courseLabel(code: unknown, name: unknown): string {
  const n = clean(name, 120)
  const c = clean(code, 120)
  const fromName = COURSE_CODE.exec(n)
  if (fromName && n.indexOf(fromName[0]) === 0) return `${fromName[1]} ${fromName[2]}`
  const fromCode = COURSE_CODE.exec(c.toUpperCase())
  if (fromCode) return `${fromCode[1]} ${fromCode[2]}`
  if (fromName) return `${fromName[1]} ${fromName[2]}`
  return (n || c || 'Course').slice(0, 40)
}

function title(course: Course, name: string): string {
  return `${course.label}: ${name}`.slice(0, 200)
}

function future(end: number, now: number): boolean {
  return end >= now
}

export interface DropboxFolder {
  Id?: unknown
  Name?: unknown
  DueDate?: unknown
  IsHidden?: unknown
}

export function mapDropbox(folders: unknown, course: Course, now: number): Deadline[] {
  if (!Array.isArray(folders)) return []
  const out: Deadline[] = []
  for (const f of folders as DropboxFolder[]) {
    if (!f || typeof f !== 'object' || f.IsHidden === true) continue
    const due = parseUtc(f.DueDate)
    const name = clean(f.Name)
    if (due == null || !name || !future(due, now)) continue
    out.push({
      uid: `bs:${course.id}:dropbox:${String(f.Id ?? name)}`,
      summary: title(course, name),
      start: due,
      isExam: EXAM_RE.test(name),
      source: 'brightspace',
      kind: 'assignment'
    })
  }
  return out
}

export interface QuizReadData {
  QuizId?: unknown
  Name?: unknown
  IsActive?: unknown
  DueDate?: unknown
  EndDate?: unknown
}

export function mapQuizzes(quizzes: unknown, course: Course, now: number): Deadline[] {
  if (!Array.isArray(quizzes)) return []
  const out: Deadline[] = []
  for (const q of quizzes as QuizReadData[]) {
    if (!q || typeof q !== 'object' || q.IsActive === false) continue
    const due = parseUtc(q.DueDate) ?? parseUtc(q.EndDate)
    const name = clean(q.Name)
    if (due == null || !name || !future(due, now)) continue
    out.push({
      uid: `bs:${course.id}:quiz:${String(q.QuizId ?? name)}`,
      summary: title(course, name),
      start: due,
      isExam: EXAM_RE.test(name),
      source: 'brightspace',
      kind: 'quiz'
    })
  }
  return out
}

export interface EventDataInfo {
  CalendarEventId?: unknown
  Title?: unknown
  StartDateTime?: unknown
  EndDateTime?: unknown
  IsAllDayEvent?: unknown
  StartDay?: unknown
  EndDay?: unknown
  LocationName?: unknown
  EventType?: unknown
  AssociatedEntity?: { AssociatedEntityType?: unknown; AssociatedEntityId?: unknown } | null
}

/** "Quiz 1 - Availability Starts" style events are noise for a deadline list. */
const START_EVENT = /\b(availability|unlock)\s+(starts|begins)\b/i

export function mapCalendar(events: unknown, course: Course, now: number): Deadline[] {
  if (!Array.isArray(events)) return []
  const out: Deadline[] = []
  for (const e of events as EventDataInfo[]) {
    if (!e || typeof e !== 'object') continue
    const name = clean(e.Title)
    if (!name || START_EVENT.test(name)) continue
    const type = typeof e.EventType === 'string' ? e.EventType : String(e.EventType ?? '')
    if (/^(AvailabilityStarts|UnlockStarts)$/i.test(type)) continue
    let start: number | null
    let end: number | null
    const allDay = e.IsAllDayEvent === true
    if (allDay) {
      // all-day events carry local calendar days: they count until the end of their last day
      start = localDay(e.StartDay) ?? localDay(e.StartDateTime)
      const last = localDay(e.EndDay) ?? start
      end = last != null ? new Date(new Date(last).getFullYear(), new Date(last).getMonth(), new Date(last).getDate() + 1).getTime() - 1 : null
    } else {
      start = parseUtc(e.StartDateTime)
      end = start
    }
    if (start == null || end == null || !future(end, now)) continue
    const location = clean(e.LocationName, 120)
    out.push({
      uid: `bs:${course.id}:event:${String(e.CalendarEventId ?? `${name}@${start}`)}`,
      summary: title(course, name),
      start,
      isExam: EXAM_RE.test(name),
      source: 'brightspace',
      kind: 'event',
      ...(allDay ? { allDay: true, end } : {}),
      ...(location ? { location } : {})
    })
  }
  return out
}

// ------------------------------------------------------------------ de-duplication

/** The part of a title that identifies the item: no course prefix, no "- Due", no punctuation. */
export function titleCore(s: string): string {
  return s
    .toLowerCase()
    .replace(/^[^:]{1,60}:\s+/, '') // "CHEM 201: "
    .replace(/\s*[-–—]\s*(due|due date|availability ends|ends|end)\s*$/i, '')
    .replace(/\b(is )?due\b/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
}

/** Is this item still upcoming (all-day items count until the end of their day)? */
export function isUpcoming(d: Deadline, now: number): boolean {
  return (d.end ?? d.start) >= now
}

/**
 * Merge deadline lists from several sources: drop past items, de-duplicate (same title core within
 * a minute of each other; the first source wins, so pass Brightspace first), sort, keep `limit`.
 */
export function mergeDeadlines(lists: Deadline[][], now: number, limit = 10): Deadline[] {
  const kept: Deadline[] = []
  const uids = new Set<string>()
  for (const list of lists) {
    for (const d of list) {
      if (!d || typeof d.start !== 'number' || !isUpcoming(d, now) || uids.has(d.uid)) continue
      const core = titleCore(d.summary)
      const dup = kept.some((k) => {
        if (Math.abs(k.start - d.start) > 60_000 && !(k.allDay && d.allDay && sameLocalDay(k.start, d.start))) return false
        const kc = titleCore(k.summary)
        return kc === core || (kc.length >= 4 && core.length >= 4 && (kc.includes(core) || core.includes(kc)))
      })
      if (dup) continue
      uids.add(d.uid)
      kept.push(d)
    }
  }
  return kept.sort((a, b) => a.start - b.start).slice(0, limit)
}

function sameLocalDay(a: number, b: number): boolean {
  const x = new Date(a)
  const y = new Date(b)
  return x.getFullYear() === y.getFullYear() && x.getMonth() === y.getMonth() && x.getDate() === y.getDate()
}

// ------------------------------------------------------------------ API client

export type BrightspaceErrorKind = 'expired' | 'forbidden' | 'not-found' | 'http' | 'network' | 'bad-response' | 'too-large' | 'limit'

export class BrightspaceError extends Error {
  constructor(
    readonly kind: BrightspaceErrorKind,
    message: string,
    readonly status?: number
  ) {
    super(message)
    this.name = 'BrightspaceError'
  }
}

/** The subset of fetch the client needs; in the app it is the partition session's fetch. */
export type FetchLike = (url: string, init: RequestInit) => Promise<Response>

export interface ClientLimits {
  /** Requests in flight at once. */
  concurrency: number
  timeoutMs: number
  maxBytes: number
  maxCourses: number
  /** Hard cap on requests per sync (paging included). */
  maxRequests: number
  /** Pages followed per paged list. */
  maxPages: number
  /** Calendar window ahead of now. */
  calendarDays: number
  /** Deadlines kept after merging. */
  keep: number
}

export const DEFAULT_LIMITS: ClientLimits = {
  concurrency: 4,
  timeoutMs: 15_000,
  maxBytes: 5 * 1024 * 1024,
  maxCourses: 40,
  maxRequests: 400,
  maxPages: 20,
  calendarDays: 30,
  keep: 10
}

export interface SyncResult {
  user: { id: string; name: string }
  courseCount: number
  items: Deadline[]
  versions: { lp: string; le: string }
  /** Course endpoints that failed for a reason other than 403/404 (timeouts, 5xx…). */
  failures: number
}

/** Reads a body, giving up past `max` bytes (declared or streamed). */
async function readCapped(res: Response, max: number): Promise<string> {
  const declared = Number(res.headers?.get?.('content-length') ?? NaN)
  if (Number.isFinite(declared) && declared > max) throw new BrightspaceError('too-large', 'Brightspace sent too much data (over 5 MB).')
  const body = res.body as ReadableStream<Uint8Array> | null | undefined
  if (body && typeof body.getReader === 'function') {
    const reader = body.getReader()
    const chunks: Uint8Array[] = []
    let n = 0
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      n += value.byteLength
      if (n > max) {
        void reader.cancel().catch(() => undefined)
        throw new BrightspaceError('too-large', 'Brightspace sent too much data (over 5 MB).')
      }
      chunks.push(value)
    }
    return new TextDecoder().decode(Buffer.concat(chunks))
  }
  const text = await res.text()
  if (text.length > max) throw new BrightspaceError('too-large', 'Brightspace sent too much data (over 5 MB).')
  return text
}

class Limiter {
  private active = 0
  private queue: Array<() => void> = []
  constructor(private readonly max: number) {}
  async run<T>(fn: () => Promise<T>): Promise<T> {
    if (this.active >= this.max) await new Promise<void>((r) => this.queue.push(r))
    this.active++
    try {
      return await fn()
    } finally {
      this.active--
      this.queue.shift()?.()
    }
  }
}

interface MyOrgUnitInfo {
  OrgUnit?: { Id?: unknown; Type?: { Id?: unknown; Code?: unknown; Name?: unknown }; Name?: unknown; Code?: unknown }
  Access?: { IsActive?: unknown; CanAccess?: unknown; StartDate?: unknown; EndDate?: unknown }
}

export class BrightspaceClient {
  private readonly limits: ClientLimits
  private readonly limiter: Limiter
  private requests = 0

  constructor(
    readonly origin: string,
    private readonly fetchFn: FetchLike,
    limits: Partial<ClientLimits> = {},
    private readonly now: () => number = Date.now
  ) {
    this.limits = { ...DEFAULT_LIMITS, ...limits }
    this.limiter = new Limiter(Math.max(1, this.limits.concurrency))
  }

  /** Number of requests made so far. */
  get requestCount(): number {
    return this.requests
  }

  /** Resolves a path or an APIURL (paging `Next`) against the school's origin; refuses other origins. */
  private url(pathOrUrl: string): string {
    const u = new URL(pathOrUrl, this.origin)
    if (u.origin !== this.origin) throw new BrightspaceError('bad-response', 'Brightspace pointed to another site; ignored.')
    return u.toString()
  }

  /** GET JSON with the session's cookies. 401, 403 after login, and redirects to the login page are "expired". */
  async get<T = unknown>(pathOrUrl: string): Promise<T> {
    const url = this.url(pathOrUrl)
    if (this.requests >= this.limits.maxRequests) throw new BrightspaceError('limit', 'Too many Brightspace requests; stopped early.')
    this.requests++
    return this.limiter.run(async () => {
      let res: Response
      try {
        res = await this.fetchFn(url, {
          method: 'GET',
          headers: { Accept: 'application/json' },
          credentials: 'include',
          redirect: 'manual',
          signal: AbortSignal.timeout(this.limits.timeoutMs)
        })
      } catch (e) {
        const msg = (e as Error)?.name === 'TimeoutError' ? 'timed out' : ((e as Error)?.message ?? String(e))
        throw new BrightspaceError('network', `Couldn't reach Brightspace (${msg}).`)
      }
      const status = res.status
      // A redirect (to the login page) means the session is gone.
      if (res.type === 'opaqueredirect' || (status >= 300 && status < 400) || status === 0) {
        throw new BrightspaceError('expired', 'Your Brightspace login expired.', status || 302)
      }
      if (status === 401) throw new BrightspaceError('expired', 'Your Brightspace login expired.', 401)
      if (status === 403) throw new BrightspaceError('forbidden', 'Brightspace said no (HTTP 403).', 403)
      if (status === 404) throw new BrightspaceError('not-found', 'Not found (HTTP 404).', 404)
      if (status < 200 || status >= 300) throw new BrightspaceError('http', `Brightspace request failed (HTTP ${status}).`, status)
      const text = await readCapped(res, this.limits.maxBytes)
      try {
        return JSON.parse(text) as T
      } catch {
        // an HTML login page served with 200 also means the session is gone
        if (/^\s*</.test(text)) throw new BrightspaceError('expired', 'Your Brightspace login expired.', status)
        throw new BrightspaceError('bad-response', "Brightspace didn't send JSON.")
      }
    })
  }

  async versions(): Promise<{ lp: string; le: string }> {
    let list: unknown
    try {
      list = await this.get('/d2l/api/versions/')
    } catch (e) {
      if (e instanceof BrightspaceError && e.kind === 'forbidden') throw new BrightspaceError('forbidden', e.message, 403)
      throw e
    }
    const lp = pickVersion(list, 'lp')
    const le = pickVersion(list, 'le')
    if (!lp || !le) throw new BrightspaceError('bad-response', "Couldn't find the Brightspace API versions.")
    return { lp, le }
  }

  /** whoami: 401/403 here mean "not logged in". */
  async whoami(lp: string): Promise<{ id: string; name: string }> {
    let u: { Identifier?: unknown; FirstName?: unknown; LastName?: unknown; UniqueName?: unknown }
    try {
      u = await this.get(`/d2l/api/lp/${lp}/users/whoami`)
    } catch (e) {
      throw asExpired(e)
    }
    if (!u || typeof u !== 'object' || u.Identifier == null) throw new BrightspaceError('bad-response', 'Brightspace returned an unexpected user.')
    const name = clean([u.FirstName, u.LastName].filter((x) => typeof x === 'string' && x.trim()).join(' '), 80) || clean(u.UniqueName, 80) || 'you'
    return { id: String(u.Identifier), name }
  }

  /** Active course offerings, following PagingInfo.Bookmark while HasMoreItems. */
  async enrollments(lp: string): Promise<Course[]> {
    const page = async (typeFilter: boolean): Promise<MyOrgUnitInfo[]> => {
      const all: MyOrgUnitInfo[] = []
      let bookmark = ''
      for (let i = 0; i < this.limits.maxPages; i++) {
        const q = new URLSearchParams()
        if (typeFilter) q.set('orgUnitTypeId', '3')
        q.set('isActive', 'true')
        if (bookmark) q.set('bookmark', bookmark)
        let r: { PagingInfo?: { Bookmark?: unknown; HasMoreItems?: unknown }; Items?: unknown }
        try {
          r = await this.get(`/d2l/api/lp/${lp}/enrollments/myenrollments/?${q.toString()}`)
        } catch (e) {
          throw asExpired(e)
        }
        if (!r || typeof r !== 'object' || !Array.isArray(r.Items)) throw new BrightspaceError('bad-response', 'Brightspace returned unexpected enrollments.')
        all.push(...(r.Items as MyOrgUnitInfo[]))
        const next = r.PagingInfo?.Bookmark
        if (r.PagingInfo?.HasMoreItems !== true || typeof next !== 'string' || !next || next === bookmark) break
        bookmark = next
      }
      return all
    }
    let items = await page(true)
    // Course Offering is type 3 on standard installs; if a school renumbered it, filter by name.
    if (items.length === 0) {
      items = (await page(false)).filter((x) => /course offering/i.test(String(x.OrgUnit?.Type?.Name ?? x.OrgUnit?.Type?.Code ?? '')))
    }
    const now = this.now()
    const seen = new Set<number>()
    const courses: Array<Course & { startedAt: number }> = []
    for (const x of items) {
      const ou = x?.OrgUnit
      const id = Number(ou?.Id)
      if (!Number.isFinite(id) || seen.has(id)) continue
      if (x.Access?.IsActive === false || x.Access?.CanAccess === false) continue
      const ended = parseUtc(x.Access?.EndDate)
      if (ended != null && ended < now - 7 * DAY_MS) continue
      seen.add(id)
      courses.push({
        id,
        code: clean(ou?.Code, 120),
        name: clean(ou?.Name, 120),
        label: courseLabel(ou?.Code, ou?.Name),
        startedAt: parseUtc(x.Access?.StartDate) ?? 0
      })
    }
    // most recent first, then cap
    return courses
      .sort((a, b) => b.startedAt - a.startedAt || a.id - b.id)
      .slice(0, this.limits.maxCourses)
      .map(({ startedAt: _s, ...c }) => c)
  }

  /** Follows ObjectListPage.Next (same origin only). */
  private async objectList(path: string): Promise<unknown[]> {
    const out: unknown[] = []
    let next: string | null = path
    for (let i = 0; i < this.limits.maxPages && next; i++) {
      const r: unknown = await this.get(next)
      if (Array.isArray(r)) return out.concat(r) // tolerate a plain array
      if (!r || typeof r !== 'object') break
      const o = r as { Objects?: unknown; Next?: unknown }
      if (Array.isArray(o.Objects)) out.push(...o.Objects)
      next = typeof o.Next === 'string' && o.Next ? o.Next : null
    }
    return out
  }

  /** Best effort per course: an endpoint that answers 403/404 (tool off, no permission) is skipped. */
  async courseDeadlines(le: string, course: Course): Promise<{ items: Deadline[]; failures: number }> {
    const now = this.now()
    const start = new Date(now - DAY_MS).toISOString()
    const end = new Date(now + this.limits.calendarDays * DAY_MS).toISOString()
    const q = new URLSearchParams({ startDateTime: start, endDateTime: end })
    const ou = course.id
    let failures = 0
    const safe = async (fn: () => Promise<Deadline[]>): Promise<Deadline[]> => {
      try {
        return await fn()
      } catch (e) {
        if (e instanceof BrightspaceError && (e.kind === 'forbidden' || e.kind === 'not-found')) return []
        if (e instanceof BrightspaceError && e.kind === 'expired') throw e
        failures++
        return []
      }
    }
    const [a, b, c] = await Promise.all([
      safe(async () => mapDropbox(await this.get(`/d2l/api/le/${le}/${ou}/dropbox/folders/`), course, now)),
      safe(async () => mapQuizzes(await this.objectList(`/d2l/api/le/${le}/${ou}/quizzes/`), course, now)),
      safe(async () => mapCalendar(await this.objectList(`/d2l/api/le/${le}/${ou}/calendar/events/myEvents/?${q.toString()}`), course, now))
    ])
    return { items: [...a, ...b, ...c], failures }
  }

  /** whoami → enrollments → per-course assignments, quizzes and calendar → merged deadlines. */
  async sync(): Promise<SyncResult> {
    const versions = await this.versions().catch((e: unknown) => {
      // versions is public; a 403 here means the school blocks the API
      throw e instanceof BrightspaceError && e.kind === 'forbidden' ? new BrightspaceError('forbidden', e.message, 403) : e
    })
    const user = await this.whoami(versions.lp)
    const courses = await this.enrollments(versions.lp)
    let failures = 0
    const lists = await Promise.all(
      courses.map(async (c) => {
        const r = await this.courseDeadlines(versions.le, c)
        failures += r.failures
        return r.items
      })
    )
    const items = mergeDeadlines([lists.flat()], this.now(), this.limits.keep)
    return { user, courseCount: courses.length, items, versions, failures }
  }
}

/** On whoami/enrollments, 403 means the session is not (or no longer) logged in. */
function asExpired(e: unknown): unknown {
  if (e instanceof BrightspaceError && (e.kind === 'forbidden' || e.kind === 'expired')) {
    return new BrightspaceError('expired', 'Your Brightspace login expired.', e.status)
  }
  return e
}

/** A message for the UI. API-blocked schools are pointed at the iCal link. */
export function friendlyError(e: unknown): string {
  if (e instanceof BrightspaceError) {
    switch (e.kind) {
      case 'expired':
        return 'Your Brightspace login expired. Log in again.'
      case 'forbidden':
        return "Brightspace didn't let Bloop read your courses (HTTP 403). Some schools turn off API access for students; the calendar link below still works."
      case 'too-large':
      case 'limit':
        return e.message
      case 'network':
        return e.message
      default:
        return `${e.message} If this keeps happening, your school may limit API access; the calendar link below still works.`
    }
  }
  return `Couldn't sync with Brightspace: ${(e as Error)?.message ?? String(e)}`
}
