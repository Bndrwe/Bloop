// Brightspace (Valence API) login sync: host validation, versions, paging, mapping, de-dup,
// expired sessions, limits and the login-window navigation policy. No network: fetch is faked.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Deadline } from '../src/shared/types'

const mem = vi.hoisted(() => ({ cache: null as null | { fetchedAt: number; url: string; items: Deadline[]; sources?: Record<string, Deadline[]> } }))
vi.mock('../src/main/store', () => ({
  getDeadlinesCache: () => mem.cache,
  setDeadlinesCache: (c: typeof mem.cache) => {
    mem.cache = c
  }
}))

import {
  BrightspaceClient,
  BrightspaceError,
  DEFAULT_LIMITS,
  EXAM_RE,
  LOGIN_ALLOWED_PERMISSIONS,
  courseLabel,
  friendlyError,
  isLoginSuccessUrl,
  mapCalendar,
  mapDropbox,
  mapQuizzes,
  mergeDeadlines,
  navigationDecision,
  normalizeBrightspaceHost,
  parseUtc,
  pickVersion,
  type Course
} from '../src/main/brightspace'
import { DEFAULT_SETTINGS, mergeSettings } from '../src/main/defaults'
import { getDeadlines, setSourceDeadlines } from '../src/main/deadlines'

const ORIGIN = 'https://school.brightspace.com'
const NOW = Date.UTC(2026, 10, 5, 15, 0, 0) // 2026-11-05 15:00Z
const CHEM: Course = { id: 6606, code: '202610.CHEM.201.001', name: 'CHEM 201 - General Chemistry II', label: 'CHEM 201' }
const ORIGINAL_TZ = process.env.TZ

beforeEach(() => {
  mem.cache = null
  vi.spyOn(console, 'log').mockImplementation(() => {})
})
afterEach(() => {
  vi.restoreAllMocks()
  vi.useRealTimers()
  if (ORIGINAL_TZ === undefined) delete process.env.TZ
  else process.env.TZ = ORIGINAL_TZ
})

// ---------------------------------------------------------------- fixtures (Valence-shaped)

const VERSIONS = [
  { ProductCode: 'lp', LatestVersion: '1.51', SupportedVersions: ['1.46', '1.49', '1.50', '1.51'] },
  { ProductCode: 'le', LatestVersion: '1.88', SupportedVersions: ['1.75', '1.82', '1.9', '1.88'] },
  { ProductCode: 'ep', LatestVersion: '2.5', SupportedVersions: ['2.5'] }
]
const WHOAMI = { Identifier: '1234', FirstName: 'Ana', LastName: 'Lee', UniqueName: 'alee', ProfileIdentifier: 'x', Pronouns: '' }

const enrollment = (id: number, code: string, name: string, extra: Record<string, unknown> = {}) => ({
  OrgUnit: { Id: id, Type: { Id: 3, Code: 'Course Offering', Name: 'Course Offering' }, Name: name, Code: code, HomeUrl: null, ImageUrl: null },
  Access: { IsActive: true, StartDate: '2026-08-24T04:00:00.000Z', EndDate: '2026-12-20T04:59:00.000Z', CanAccess: true, ClasslistRoleName: 'Student', LISRoles: [], LastAccessed: null, ...extra },
  PinDate: null
})

const DROPBOX = [
  { Id: 11, CategoryId: null, Name: 'Lab Report 4', CustomInstructions: { Text: '', Html: '' }, Attachments: [], TotalFiles: 0, UnreadFiles: 0, FlaggedFiles: 0, TotalUsers: 0, TotalUsersWithSubmissions: 0, TotalUsersWithFeedback: 0, Availability: null, GroupTypeId: null, DueDate: '2026-11-08T04:59:00.000Z', DisplayInCalendar: true, AssessmentDate: null, NotificationEmail: null, IsHidden: false, LinkAttachments: [], ActivityId: null, IsAnonymous: false, DropboxType: 1, SubmissionType: 0, CompletionType: 0, GradeItemId: null, AllowOnlyUsersWithSpecialAccess: null },
  { Id: 12, Name: 'Old essay', DueDate: '2026-10-01T04:59:00.000Z', IsHidden: false },
  { Id: 13, Name: 'Hidden draft', DueDate: '2026-11-20T04:59:00.000Z', IsHidden: true },
  { Id: 14, Name: 'No due date', DueDate: null, IsHidden: false },
  { Id: 15, Name: 'Final project', DueDate: '2026-12-10T05:00:00.000Z', IsHidden: false }
]

const QUIZ_PAGE_1 = {
  Objects: [
    { QuizId: 21, Name: 'Quiz 7: Kinetics', IsActive: true, SortOrder: 1, AutoExportToGrades: null, GradeItemId: null, IsAutoSetGraded: true, Instructions: {}, Description: {}, StartDate: '2026-11-01T12:00:00.000Z', EndDate: '2026-11-12T04:59:00.000Z', DueDate: '2026-11-11T04:59:00.000Z', DisplayInCalendar: true },
    { QuizId: 22, Name: 'Practice set', IsActive: true, DueDate: null, EndDate: '2026-11-14T04:59:00.000Z' }
  ],
  Next: `${ORIGIN}/d2l/api/le/1.88/6606/quizzes/?bookmark=22`
}
const QUIZ_PAGE_2 = { Objects: [{ QuizId: 23, Name: 'Midterm 2', IsActive: true, DueDate: '2026-11-18T19:00:00.000Z' }, { QuizId: 24, Name: 'Inactive', IsActive: false, DueDate: '2026-11-18T19:00:00.000Z' }], Next: null }

const CALENDAR = {
  Objects: [
    { CalendarEventId: 31, OrgUnitId: 6606, Title: 'Lab Report 4 - Due', Description: '', StartDateTime: '2026-11-08T04:59:00.000Z', EndDateTime: '2026-11-08T04:59:00.000Z', IsAllDayEvent: false, StartDay: null, EndDay: null, GroupId: null, IsRecurring: false, RecurrenceInfo: null, LocationId: null, LocationName: '', OrgUnitName: 'CHEM 201 - General Chemistry II', OrgUnitCode: '202610.CHEM.201.001', IsAssociatedWithEntity: true, AssociatedEntity: { AssociatedEntityType: 'D2L.LE.Dropbox.Dropbox', AssociatedEntityId: 11, Link: '' } },
    { CalendarEventId: 32, Title: 'Review session', StartDateTime: '2026-11-16T22:00:00.000Z', EndDateTime: '2026-11-16T23:00:00.000Z', IsAllDayEvent: false, LocationName: 'WTHR 104' },
    { CalendarEventId: 33, Title: 'Reading day (no class)', StartDateTime: null, EndDateTime: null, IsAllDayEvent: true, StartDay: '2026-11-05T00:00:00.000', EndDay: '2026-11-05T00:00:00.000' },
    { CalendarEventId: 34, Title: 'Quiz 7: Kinetics - Availability Starts', StartDateTime: '2026-11-07T12:00:00.000Z', IsAllDayEvent: false },
    { CalendarEventId: 35, Title: 'Past lecture', StartDateTime: '2026-11-04T15:00:00.000Z', IsAllDayEvent: false }
  ],
  Next: null
}

// ---------------------------------------------------------------- fake fetch

type Route = (url: URL) => { status?: number; body?: unknown; raw?: string; headers?: Record<string, string>; type?: string } | undefined

function fakeFetch(route: Route) {
  const calls: string[] = []
  let inFlight = 0
  let maxInFlight = 0
  const fn = vi.fn(async (url: string, init: RequestInit) => {
    calls.push(url)
    expect(init.credentials).toBe('include')
    expect(init.redirect).toBe('manual')
    inFlight++
    maxInFlight = Math.max(maxInFlight, inFlight)
    await new Promise((r) => setTimeout(r, 1))
    inFlight--
    const r = route(new URL(url)) ?? { status: 404, body: { Errors: [] } }
    const status = r.status ?? 200
    const text = r.raw ?? JSON.stringify(r.body ?? null)
    const headers = new Headers(r.headers ?? {})
    return { status, ok: status >= 200 && status < 300, type: r.type ?? 'basic', headers, body: null, text: async () => text } as unknown as Response
  })
  return { fn, calls, maxInFlight: () => maxInFlight }
}

function schoolRoute(over: Partial<Record<string, Route>> = {}): Route {
  return (u) => {
    const p = u.pathname
    for (const [k, r] of Object.entries(over)) if (p.includes(k)) return r!(u)
    if (p === '/d2l/api/versions/') return { body: VERSIONS }
    if (p === '/d2l/api/lp/1.51/users/whoami') return { body: WHOAMI }
    if (p === '/d2l/api/lp/1.51/enrollments/myenrollments/') {
      const bm = u.searchParams.get('bookmark')
      if (!bm) return { body: { PagingInfo: { Bookmark: '6606', HasMoreItems: true }, Items: [enrollment(6606, '202610.CHEM.201.001', 'CHEM 201 - General Chemistry II')] } }
      if (bm === '6606') return { body: { PagingInfo: { Bookmark: '7001', HasMoreItems: false }, Items: [enrollment(7001, 'HIST-110-002', 'World History'), enrollment(7002, 'X', 'Ended course', { IsActive: false })] } }
    }
    if (p === '/d2l/api/le/1.88/6606/dropbox/folders/') return { body: DROPBOX }
    if (p === '/d2l/api/le/1.88/6606/quizzes/') return { body: u.searchParams.get('bookmark') ? QUIZ_PAGE_2 : QUIZ_PAGE_1 }
    if (p === '/d2l/api/le/1.88/6606/calendar/events/myEvents/') return { body: CALENDAR }
    if (p === '/d2l/api/le/1.88/7001/dropbox/folders/') return { status: 403, body: null } // tool off
    if (p === '/d2l/api/le/1.88/7001/quizzes/') return { body: { Objects: [], Next: null } }
    if (p === '/d2l/api/le/1.88/7001/calendar/events/myEvents/') return { body: { Objects: [{ CalendarEventId: 41, Title: 'Essay 2 due', StartDateTime: '2026-11-09T17:00:00.000Z', IsAllDayEvent: false }], Next: null } }
    return undefined
  }
}

// ---------------------------------------------------------------- host

describe('normalizeBrightspaceHost', () => {
  it.each([
    ['purdue.brightspace.com', 'https://purdue.brightspace.com'],
    ['  Purdue.Brightspace.com  ', 'https://purdue.brightspace.com'],
    ['https://purdue.brightspace.com', 'https://purdue.brightspace.com'],
    ['https://purdue.brightspace.com/d2l/home/6606?x=1#y', 'https://purdue.brightspace.com'],
    ['learn.school.edu/', 'https://learn.school.edu'],
    ['https://elearn.school.ac.uk:8443/d2l', 'https://elearn.school.ac.uk:8443'],
    ['purdue.brightspace.com.', 'https://purdue.brightspace.com']
  ])('%s -> %s', (raw, origin) => {
    const r = normalizeBrightspaceHost(raw)
    expect(r).toMatchObject({ ok: true, origin })
  })

  it.each([
    '',
    '   ',
    'http://purdue.brightspace.com',
    'ftp://purdue.brightspace.com',
    'javascript:alert(1)',
    'brightspace',
    'localhost',
    'https://localhost:8443',
    'foo.localhost',
    'printer.local',
    '127.0.0.1',
    'https://10.0.0.5',
    'https://[::1]/',
    'https://user:pw@purdue.brightspace.com',
    'purdue..brightspace.com',
    '-bad.brightspace.com',
    'purdue.brightspace.123',
    'a'.repeat(400) + '.com'
  ])('rejects %j', (raw) => {
    expect(normalizeBrightspaceHost(raw).ok).toBe(false)
  })

  it('rejects non-strings', () => {
    for (const v of [null, undefined, 42, {}, ['x.com']]) expect(normalizeBrightspaceHost(v).ok).toBe(false)
  })

  it('allows localhost and IPs only when explicitly enabled (tests)', () => {
    expect(normalizeBrightspaceHost('https://localhost:8443', { allowLocal: true })).toMatchObject({ ok: true, origin: 'https://localhost:8443' })
    expect(normalizeBrightspaceHost('127.0.0.1:9443', { allowLocal: true })).toMatchObject({ ok: true, origin: 'https://127.0.0.1:9443' })
    expect(normalizeBrightspaceHost('http://localhost:8443', { allowLocal: true }).ok).toBe(false) // still https only
  })
})

describe('settings validation (mergeSettings.brightspaceHost)', () => {
  it("defaults to ''", () => {
    expect(DEFAULT_SETTINGS.brightspaceHost).toBe('')
    expect(mergeSettings({}).brightspaceHost).toBe('')
  })
  it('normalizes to an https origin and drops invalid values', () => {
    expect(mergeSettings({ brightspaceHost: 'purdue.brightspace.com/d2l/home' }).brightspaceHost).toBe('https://purdue.brightspace.com')
    for (const bad of ['http://x.brightspace.com', 'localhost', '127.0.0.1', 42, null, { a: 1 }]) {
      expect(mergeSettings({ brightspaceHost: bad as never }).brightspaceHost).toBe('')
    }
  })
})

// ---------------------------------------------------------------- versions

describe('pickVersion', () => {
  it('picks the newest supported lp and le (numeric, not string, order)', () => {
    expect(pickVersion(VERSIONS, 'lp')).toBe('1.51')
    expect(pickVersion(VERSIONS, 'le')).toBe('1.88') // 1.88 > 1.9
  })
  it('includes LatestVersion and ignores junk and non-1.x versions', () => {
    expect(pickVersion([{ ProductCode: 'LE', LatestVersion: '1.90', SupportedVersions: ['x', 2, null, '2.0', '1.80'] }], 'le')).toBe('1.90')
  })
  it('returns null when the product is missing or the input is not a list', () => {
    expect(pickVersion([{ ProductCode: 'ep', SupportedVersions: ['2.5'] }], 'le')).toBeNull()
    expect(pickVersion({}, 'lp')).toBeNull()
    expect(pickVersion([{ ProductCode: 'lp', SupportedVersions: [] }], 'lp')).toBeNull()
  })
})

// ---------------------------------------------------------------- mapping

describe('mapping Valence JSON to Deadline', () => {
  it('course label: "CHEM 201" from name or code; falls back to the name', () => {
    expect(courseLabel('202610.CHEM.201.001', 'CHEM 201 - General Chemistry II')).toBe('CHEM 201')
    expect(courseLabel('HIST-110-002', 'World History')).toBe('HIST 110')
    expect(courseLabel(null, 'Intro to Philosophy')).toBe('Intro to Philosophy')
    expect(courseLabel('', '')).toBe('Course')
  })

  it('dropbox folders: future DueDate only, hidden and undated skipped, UTC parsed', () => {
    const d = mapDropbox(DROPBOX, CHEM, NOW)
    expect(d.map((x) => x.summary)).toEqual(['CHEM 201: Lab Report 4', 'CHEM 201: Final project'])
    expect(d[0]).toEqual({
      uid: 'bs:6606:dropbox:11',
      summary: 'CHEM 201: Lab Report 4',
      start: Date.UTC(2026, 10, 8, 4, 59),
      isExam: false,
      source: 'brightspace',
      kind: 'assignment'
    })
    expect(mapDropbox(null, CHEM, NOW)).toEqual([])
    expect(mapDropbox([null, 1, 'x'], CHEM, NOW)).toEqual([])
  })

  it('quizzes: DueDate, else EndDate; inactive skipped; exam detection on the name', () => {
    const q = mapQuizzes([...QUIZ_PAGE_1.Objects, ...QUIZ_PAGE_2.Objects], CHEM, NOW)
    expect(q.map((x) => [x.summary, x.start, x.isExam])).toEqual([
      ['CHEM 201: Quiz 7: Kinetics', Date.UTC(2026, 10, 11, 4, 59), true],
      ['CHEM 201: Practice set', Date.UTC(2026, 10, 14, 4, 59), false],
      ['CHEM 201: Midterm 2', Date.UTC(2026, 10, 18, 19, 0), true]
    ])
  })

  it('calendar: timed events in UTC, all-day events last until the end of their local day, start-of-availability noise dropped', () => {
    process.env.TZ = 'America/Indiana/Indianapolis'
    const c = mapCalendar(CALENDAR.Objects, CHEM, NOW)
    expect(c.map((x) => x.summary)).toEqual(['CHEM 201: Lab Report 4 - Due', 'CHEM 201: Review session', 'CHEM 201: Reading day (no class)'])
    const review = c[1]!
    expect(review.start).toBe(Date.UTC(2026, 10, 16, 22, 0))
    expect(review.location).toBe('WTHR 104')
    const allDay = c[2]!
    expect(allDay.allDay).toBe(true)
    expect(allDay.start).toBe(new Date(2026, 10, 5).getTime()) // local midnight, before NOW
    expect(allDay.end).toBe(new Date(2026, 10, 6).getTime() - 1) // still upcoming today
    // the next day it's gone
    expect(mapCalendar(CALENDAR.Objects, CHEM, new Date(2026, 10, 6, 0, 0, 1).getTime()).some((x) => x.allDay)).toBe(false)
  })

  it('parseUtc reads Valence UTCDateTime; a zone-less timestamp is UTC too', () => {
    expect(parseUtc('2026-11-08T04:59:00.000Z')).toBe(Date.UTC(2026, 10, 8, 4, 59))
    expect(parseUtc('2026-11-08T04:59:00.000')).toBe(Date.UTC(2026, 10, 8, 4, 59))
    expect(parseUtc('')).toBeNull()
    expect(parseUtc('soon')).toBeNull()
    expect(parseUtc(null)).toBeNull()
  })

  it('strips control characters and caps title length', () => {
    const [d] = mapDropbox([{ Id: 1, Name: 'Lab\u0000\n  5\t' + 'x'.repeat(500), DueDate: '2026-12-01T00:00:00.000Z' }], CHEM, NOW)
    expect(d!.summary.startsWith('CHEM 201: Lab 5 x')).toBe(true)
    expect(d!.summary.length).toBeLessThanOrEqual(200)
  })
})

describe('exam detection', () => {
  it.each([
    ['Midterm 2', true],
    ['Final Exam', true],
    ['Quiz 7', true],
    ['Unit tests', true],
    ['Pop QUIZZES', false], // whole words only (the iCal parser uses the same rule)
    ['Testing lab', false],
    ['Finalize essay', false],
    ['Lab Report 4', false]
  ])('%s -> %s', (name, exam) => {
    expect(EXAM_RE.test(name)).toBe(exam)
  })
})

// ---------------------------------------------------------------- merge / de-dup

describe('mergeDeadlines + setSourceDeadlines', () => {
  const bs = (uid: string, summary: string, start: number, extra: Partial<Deadline> = {}): Deadline => ({ uid, summary, start, isExam: false, source: 'brightspace', ...extra })
  const cal = (uid: string, summary: string, start: number): Deadline => ({ uid, summary, start, isExam: false })

  it('drops the iCal copy of a Brightspace item (same time, same title core) and keeps the Brightspace one', () => {
    const t = NOW + 3 * 864e5
    const out = mergeDeadlines([[bs('b1', 'CHEM 201: Lab Report 4', t)], [cal('c1', 'Lab Report 4 - Due', t), cal('c2', 'Club meeting', t + 1)]], NOW)
    expect(out.map((d) => d.uid)).toEqual(['b1', 'c2'])
  })

  it('keeps same-title items at different times and different items at the same time', () => {
    const t = NOW + 864e5
    const out = mergeDeadlines([[bs('a', 'CHEM 201: Quiz 7', t), bs('b', 'CHEM 201: Quiz 7', t + 7 * 864e5), bs('c', 'HIST 110: Essay', t)]], NOW)
    expect(out).toHaveLength(3)
  })

  it('dedupes the dropbox folder and its calendar "- Due" event within Brightspace', () => {
    const items = [...mapDropbox(DROPBOX, CHEM, NOW), ...mapCalendar(CALENDAR.Objects, CHEM, NOW)]
    const out = mergeDeadlines([items], NOW)
    expect(out.filter((d) => /Lab Report 4/.test(d.summary))).toHaveLength(1)
    expect(out.find((d) => /Lab Report 4/.test(d.summary))!.kind).toBe('assignment')
  })

  it('sorts, drops past items and keeps the limit', () => {
    const list = Array.from({ length: 30 }, (_, i) => bs(`x${i}`, `Item ${i}`, NOW + (30 - i) * 3600e3))
    list.push(bs('old', 'Old', NOW - 1))
    const out = mergeDeadlines([list], NOW, 10)
    expect(out).toHaveLength(10)
    expect(out[0]!.uid).toBe('x29')
    expect(out.every((d, i, a) => i === 0 || a[i - 1]!.start <= d.start)).toBe(true)
  })

  it('setSourceDeadlines merges both sources into the cache that reminders and the plan read', () => {
    vi.useFakeTimers()
    vi.setSystemTime(NOW)
    const t = NOW + 2 * 864e5
    // an old cache (before Brightspace login) holds only calendar items
    mem.cache = { fetchedAt: 0, url: 'https://x/cal.ics', items: [cal('c1', 'Lab Report 4 - Due', t), cal('c2', 'Club', t + 5)] }
    setSourceDeadlines('brightspace', [bs('b1', 'CHEM 201: Lab Report 4', t, { isExam: false })])
    expect(mem.cache!.items.map((d) => d.uid)).toEqual(['b1', 'c2'])
    expect(mem.cache!.items[1]!.source).toBe('calendar')
    expect(mem.cache!.url).toBe('https://x/cal.ics')
    expect(getDeadlines()).toMatchObject({ ok: true, value: [{ uid: 'b1' }, { uid: 'c2' }] })
    // log out: Brightspace items disappear, calendar ones come back
    setSourceDeadlines('brightspace', null)
    expect(mem.cache!.items.map((d) => d.uid)).toEqual(['c1', 'c2'])
  })

  it('getDeadlines keeps an all-day item until the end of its day', () => {
    vi.useFakeTimers()
    vi.setSystemTime(NOW)
    mem.cache = { fetchedAt: 0, url: '', items: [{ uid: 'a', summary: 'Reading day', start: NOW - 3600e3, end: NOW + 3600e3, allDay: true, isExam: false }] }
    expect(getDeadlines()).toMatchObject({ ok: true, value: [{ uid: 'a' }] })
  })
})

// ---------------------------------------------------------------- client

describe('BrightspaceClient.sync', () => {
  it('discovers versions, pages enrollments, reads every course and maps the result', async () => {
    const f = fakeFetch(schoolRoute())
    const c = new BrightspaceClient(ORIGIN, f.fn, {}, () => NOW)
    const r = await c.sync()
    expect(r.versions).toEqual({ lp: '1.51', le: '1.88' })
    expect(r.user).toEqual({ id: '1234', name: 'Ana Lee' })
    expect(r.courseCount).toBe(2) // the inactive course is dropped
    expect(r.failures).toBe(0) // 403 on a course tool is skipped, not a failure
    expect(r.items.map((d) => d.summary)).toEqual([
      'CHEM 201: Reading day (no class)',
      'CHEM 201: Lab Report 4',
      'HIST 110: Essay 2 due',
      'CHEM 201: Quiz 7: Kinetics',
      'CHEM 201: Practice set',
      'CHEM 201: Review session',
      'CHEM 201: Midterm 2',
      'CHEM 201: Final project'
    ])
    expect(r.items.find((d) => d.summary.endsWith('Midterm 2'))!.isExam).toBe(true)
    // enrollments: first page, then the bookmark
    const enr = f.calls.filter((u) => u.includes('myenrollments'))
    expect(enr).toHaveLength(2)
    expect(new URL(enr[0]!).searchParams.get('orgUnitTypeId')).toBe('3')
    expect(new URL(enr[0]!).searchParams.get('isActive')).toBe('true')
    expect(new URL(enr[1]!).searchParams.get('bookmark')).toBe('6606')
    // quizzes: followed Next
    expect(f.calls.filter((u) => u.includes('/6606/quizzes/'))).toHaveLength(2)
    // calendar window: from yesterday to +30 days, in UTC
    const cal = new URL(f.calls.find((u) => u.includes('/6606/calendar/'))!)
    expect(cal.searchParams.get('startDateTime')).toBe(new Date(NOW - 864e5).toISOString())
    expect(cal.searchParams.get('endDateTime')).toBe(new Date(NOW + 30 * 864e5).toISOString())
    // every request went to the school only
    expect(f.calls.every((u) => u.startsWith(`${ORIGIN}/d2l/api/`))).toBe(true)
  })

  it('falls back to filtering by type name when no type-3 enrollments exist', async () => {
    const f = fakeFetch(
      schoolRoute({
        myenrollments: (u) =>
          u.searchParams.get('orgUnitTypeId')
            ? { body: { PagingInfo: { Bookmark: '', HasMoreItems: false }, Items: [] } }
            : {
                body: {
                  PagingInfo: { Bookmark: '', HasMoreItems: false },
                  Items: [
                    { ...enrollment(6606, 'CHEM201', 'CHEM 201'), OrgUnit: { ...enrollment(6606, 'CHEM201', 'CHEM 201').OrgUnit, Type: { Id: 9, Code: 'CO', Name: 'Course Offering' } } },
                    { ...enrollment(1, 'ORG', 'University'), OrgUnit: { Id: 1, Type: { Id: 1, Code: 'Organization', Name: 'Organization' }, Name: 'U', Code: 'U' } }
                  ]
                }
              }
      })
    )
    const r = await new BrightspaceClient(ORIGIN, f.fn, {}, () => NOW).sync()
    expect(r.courseCount).toBe(1)
  })

  it.each([401, 403])('whoami %i → expired', async (status) => {
    const f = fakeFetch(schoolRoute({ whoami: () => ({ status }) }))
    const err = await new BrightspaceClient(ORIGIN, f.fn, {}, () => NOW).sync().catch((e) => e)
    expect(err).toBeInstanceOf(BrightspaceError)
    expect(err.kind).toBe('expired')
    expect(friendlyError(err)).toMatch(/Log in again/)
    expect(f.calls.some((u) => u.includes('myenrollments'))).toBe(false)
  })

  it('enrollments 403 → expired', async () => {
    const f = fakeFetch(schoolRoute({ myenrollments: () => ({ status: 403 }) }))
    const err = await new BrightspaceClient(ORIGIN, f.fn, {}, () => NOW).sync().catch((e) => e)
    expect(err.kind).toBe('expired')
  })

  it('a redirect to the login page (opaque redirect) or an HTML page means expired', async () => {
    let f = fakeFetch(schoolRoute({ whoami: () => ({ status: 0, type: 'opaqueredirect' }) }))
    expect((await new BrightspaceClient(ORIGIN, f.fn, {}, () => NOW).sync().catch((e) => e)).kind).toBe('expired')
    f = fakeFetch(schoolRoute({ whoami: () => ({ status: 302 }) }))
    expect((await new BrightspaceClient(ORIGIN, f.fn, {}, () => NOW).sync().catch((e) => e)).kind).toBe('expired')
    f = fakeFetch(schoolRoute({ whoami: () => ({ raw: '<!DOCTYPE html><html>Login</html>' }) }))
    expect((await new BrightspaceClient(ORIGIN, f.fn, {}, () => NOW).sync().catch((e) => e)).kind).toBe('expired')
  })

  it('versions 403 (API blocked) gives the "use the calendar link" hint', async () => {
    const f = fakeFetch(schoolRoute({ '/d2l/api/versions/': () => ({ status: 403 }) }))
    const err = await new BrightspaceClient(ORIGIN, f.fn, {}, () => NOW).sync().catch((e) => e)
    expect(err.kind).toBe('forbidden')
    expect(friendlyError(err)).toMatch(/calendar link/)
  })

  it('a 500 or timeout on one course endpoint is skipped and counted, not fatal', async () => {
    const f = fakeFetch(schoolRoute({ '/7001/calendar/': () => ({ status: 500 }) }))
    const r = await new BrightspaceClient(ORIGIN, f.fn, {}, () => NOW).sync()
    expect(r.failures).toBe(1)
    expect(r.items.some((d) => d.summary.startsWith('CHEM 201'))).toBe(true)
  })

  it('network errors become a friendly network error', async () => {
    const fn = vi.fn().mockRejectedValue(new Error('getaddrinfo ENOTFOUND'))
    const err = await new BrightspaceClient(ORIGIN, fn).sync().catch((e) => e)
    expect(err.kind).toBe('network')
    expect(err.message).toMatch(/ENOTFOUND/)
  })
})

describe('limits', () => {
  it('never runs more than 4 requests at once', async () => {
    const many = Array.from({ length: 12 }, (_, i) => enrollment(100 + i, `C${i}`, `ABC ${100 + i}`))
    const f = fakeFetch(
      schoolRoute({
        myenrollments: () => ({ body: { PagingInfo: { Bookmark: '', HasMoreItems: false }, Items: many } }),
        '/d2l/api/le/1.88/1': () => ({ body: { Objects: [], Next: null } })
      })
    )
    await new BrightspaceClient(ORIGIN, f.fn, {}, () => NOW).sync()
    expect(DEFAULT_LIMITS.concurrency).toBe(4)
    expect(f.maxInFlight()).toBeLessThanOrEqual(4)
    expect(f.maxInFlight()).toBeGreaterThan(1)
  })

  it('caps the number of courses (40 by default)', async () => {
    const many = Array.from({ length: 60 }, (_, i) => enrollment(1000 + i, `C${i}`, `ABC ${100 + i}`))
    const f = fakeFetch(
      schoolRoute({
        myenrollments: () => ({ body: { PagingInfo: { Bookmark: '', HasMoreItems: false }, Items: many } }),
        '/d2l/api/le/1.88/1': () => ({ body: [] })
      })
    )
    const r = await new BrightspaceClient(ORIGIN, f.fn, {}, () => NOW).sync()
    expect(r.courseCount).toBe(40)
    expect(new Set(f.calls.filter((u) => u.includes('/dropbox/')).map((u) => u.split('/')[7])).size).toBe(40)
  })

  it('stops paging after maxPages and refuses endless bookmarks', async () => {
    let n = 0
    const f = fakeFetch(
      schoolRoute({
        myenrollments: () => ({ body: { PagingInfo: { Bookmark: `b${++n}`, HasMoreItems: true }, Items: [] } })
      })
    )
    await new BrightspaceClient(ORIGIN, f.fn, { maxPages: 5 }, () => NOW).sync()
    // 5 pages with the type filter + 5 for the fallback
    expect(f.calls.filter((u) => u.includes('myenrollments'))).toHaveLength(10)
  })

  it('caps the total number of requests', async () => {
    const many = Array.from({ length: 30 }, (_, i) => enrollment(1000 + i, `C${i}`, `ABC ${100 + i}`))
    const f = fakeFetch(
      schoolRoute({
        myenrollments: () => ({ body: { PagingInfo: { Bookmark: '', HasMoreItems: false }, Items: many } }),
        '/d2l/api/le/1.88/1': () => ({ body: [] })
      })
    )
    const c = new BrightspaceClient(ORIGIN, f.fn, { maxRequests: 20 }, () => NOW)
    const r = await c.sync()
    expect(f.calls.length).toBeLessThanOrEqual(20)
    expect(r.failures).toBeGreaterThan(0)
  })

  it('rejects responses over 5 MB (declared or actual)', async () => {
    let f = fakeFetch(schoolRoute({ whoami: () => ({ body: WHOAMI, headers: { 'content-length': String(6 * 1024 * 1024) } }) }))
    expect((await new BrightspaceClient(ORIGIN, f.fn, {}, () => NOW).sync().catch((e) => e)).kind).toBe('too-large')
    f = fakeFetch(schoolRoute({ '/d2l/api/versions/': () => ({ raw: 'x'.repeat(5 * 1024 * 1024 + 1) }) }))
    expect((await new BrightspaceClient(ORIGIN, f.fn, {}, () => NOW).sync().catch((e) => e)).kind).toBe('too-large')
  })

  it('reads streamed bodies with the same cap', async () => {
    const big = new Uint8Array(1024 * 1024)
    const stream = new ReadableStream<Uint8Array>({
      start(ctl) {
        for (let i = 0; i < 6; i++) ctl.enqueue(big)
        ctl.close()
      }
    })
    const fn = vi.fn(async () => ({ status: 200, ok: true, type: 'basic', headers: new Headers(), body: stream }) as unknown as Response)
    const err = await new BrightspaceClient(ORIGIN, fn).get('/d2l/api/versions/').catch((e: BrightspaceError) => e) as BrightspaceError
    expect(err.kind).toBe('too-large')
  })

  it('passes a timeout signal and never follows Next to another site', async () => {
    const f = fakeFetch(
      schoolRoute({
        '/6606/quizzes/': () => ({ body: { Objects: [{ QuizId: 1, Name: 'Q', DueDate: '2026-12-01T00:00:00.000Z' }], Next: 'https://evil.example.com/steal' } })
      })
    )
    const r = await new BrightspaceClient(ORIGIN, f.fn, {}, () => NOW).sync()
    expect(f.calls.some((u) => u.includes('evil'))).toBe(false)
    expect(r.failures).toBe(1)
    expect((f.fn.mock.calls[0]![1] as RequestInit).signal).toBeInstanceOf(AbortSignal)
  })
})

// ---------------------------------------------------------------- login window policy

describe('navigationDecision (login window vs Bloop windows)', () => {
  const origins = { rendererIndex: '/app/out/renderer/index.html', packaged: true, platform: 'linux' as const }

  it('login window: any https page (SSO providers), nothing else', () => {
    for (const ok of [
      'https://school.brightspace.com/d2l/login',
      'https://login.microsoftonline.com/common/oauth2/authorize?x=1',
      'https://school.okta.com/app/sso/saml',
      'https://api-1234.duosecurity.com/frame/v4/auth',
      'https://idp.school.edu/idp/profile/SAML2/Redirect/SSO',
      'about:blank'
    ]) {
      expect(navigationDecision(ok, 'brightspace-login'), ok).toBe('allow')
    }
    for (const bad of [
      'http://school.brightspace.com/d2l/login',
      'file:///etc/passwd',
      'javascript:alert(1)',
      'data:text/html,<script>1</script>',
      'msauth://callback',
      'duo://push',
      'chrome://settings',
      'https://user:pw@evil.example.com/',
      'not a url',
      'https://' + 'a'.repeat(9000) + '.com'
    ]) {
      expect(navigationDecision(bad, 'brightspace-login'), bad).toBe('deny')
    }
  })

  it("Bloop's own windows: only the renderer, never SSO pages (the exemption is login-only)", () => {
    expect(navigationDecision('file:///app/out/renderer/index.html#/settings', 'bloop', { origins })).toBe('allow')
    expect(navigationDecision('https://login.microsoftonline.com/', 'bloop', { origins })).toBe('deny')
    expect(navigationDecision('https://school.brightspace.com/d2l/home', 'bloop', { origins })).toBe('deny')
    expect(navigationDecision('https://school.brightspace.com/d2l/home', 'bloop')).toBe('deny')
  })

  it('login success = the school origin on /d2l/home or a course page', () => {
    expect(isLoginSuccessUrl('https://school.brightspace.com/d2l/home', ORIGIN)).toBe(true)
    expect(isLoginSuccessUrl('https://school.brightspace.com/d2l/home/6606', ORIGIN)).toBe(true)
    expect(isLoginSuccessUrl('https://school.brightspace.com/d2l/le/content/6606/home', ORIGIN)).toBe(true)
    expect(isLoginSuccessUrl('https://school.brightspace.com/d2l/login', ORIGIN)).toBe(false)
    expect(isLoginSuccessUrl('https://evil.example.com/d2l/home', ORIGIN)).toBe(false)
    expect(isLoginSuccessUrl('https://school.brightspace.com.evil.com/d2l/home', ORIGIN)).toBe(false)
    expect(isLoginSuccessUrl('http://school.brightspace.com/d2l/home', ORIGIN)).toBe(false)
    expect(isLoginSuccessUrl('garbage', ORIGIN)).toBe(false)
  })

  it('the login partition denies camera, mic, location and notifications', () => {
    for (const p of ['media', 'geolocation', 'notifications', 'midi', 'hid', 'usb', 'serial', 'openExternal', 'pointerLock', 'display-capture']) {
      expect(LOGIN_ALLOWED_PERMISSIONS.has(p), p).toBe(false)
    }
    expect(LOGIN_ALLOWED_PERMISSIONS.has('clipboard-sanitized-write')).toBe(true)
  })
})
