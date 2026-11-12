// QA: iCal parsing edge cases (real node-ical), URL normalisation and refreshDeadlines with a fake fetch.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mem = vi.hoisted(() => ({ cache: null as null | { fetchedAt: number; url: string; items: Array<{ start: number }> } }))
vi.mock('../src/main/store', () => ({
  getDeadlinesCache: () => mem.cache,
  setDeadlinesCache: (c: typeof mem.cache) => {
    mem.cache = c
  }
}))

import ical from 'node-ical'
import { getDeadlines, normalizeIcalUrl, parseDeadlines, refreshDeadlines } from '../src/main/deadlines'

const ORIGINAL_TZ = process.env.TZ
const NOW = Date.UTC(2099, 0, 1)
const cal = (...events: string[]): string => `BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//t//EN\r\n${events.join('\r\n')}\r\nEND:VCALENDAR\r\n`
const ev = (...lines: string[]): string => ['BEGIN:VEVENT', ...lines, 'END:VEVENT'].join('\r\n')
const parse = (body: string, now = NOW, limit?: number) =>
  parseDeadlines(ical.sync.parseICS(body) as Record<string, unknown>, now, limit)

beforeEach(() => {
  mem.cache = null
  vi.spyOn(console, 'log').mockImplementation(() => {})
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  if (ORIGINAL_TZ === undefined) delete process.env.TZ
  else process.env.TZ = ORIGINAL_TZ
})

describe('normalizeIcalUrl', () => {
  it.each([
    ['webcal://example.com/cal.ics', 'https://example.com/cal.ics'],
    ['WEBCAL://example.com/cal.ics', 'https://example.com/cal.ics'],
    ['webcals://example.com/cal.ics', 'https://example.com/cal.ics'],
    ['  webcal://example.com/cal.ics?x=1  ', 'https://example.com/cal.ics?x=1'],
    ['https://example.com/cal.ics', 'https://example.com/cal.ics'],
    ['http://example.com/cal.ics', 'http://example.com/cal.ics'],
    ['example.com/cal.ics', 'example.com/cal.ics']
  ])('%s -> %s', (input, out) => {
    expect(normalizeIcalUrl(input)).toBe(out)
  })
  it('only rewrites the scheme, not a webcal:// inside the query', () => {
    expect(normalizeIcalUrl('https://a.com/c?u=webcal://b.com')).toBe('https://a.com/c?u=webcal://b.com')
  })
})

describe('parseDeadlines', () => {
  it('returns an empty list for an empty calendar or empty object', () => {
    expect(parse(cal())).toEqual([])
    expect(parseDeadlines({})).toEqual([])
  })

  it('flags exam-like summaries (whole words, plural, any case)', () => {
    const body = cal(
      ev('UID:1', 'DTSTART:20990110T100000Z', 'SUMMARY:CS101 MIDTERM'),
      ev('UID:2', 'DTSTART:20990111T100000Z', 'SUMMARY:Final exams week'),
      ev('UID:3', 'DTSTART:20990112T100000Z', 'SUMMARY:Pop quiz'),
      ev('UID:4', 'DTSTART:20990113T100000Z', 'SUMMARY:Finalize project report'),
      ev('UID:5', 'DTSTART:20990114T100000Z', 'SUMMARY:Contest night'),
      ev('UID:6', 'DTSTART:20990115T100000Z', 'SUMMARY:Lab test'),
      ev('UID:7', 'DTSTART:20990116T100000Z', 'SUMMARY:Homework 3 due')
    )
    expect(parse(body, NOW, 10).map((d) => [d.uid, d.isExam])).toEqual([
      ['1', true], ['2', true], ['3', true], ['4', false], ['5', false], ['6', true], ['7', false]
    ])
  })

  it('sorts by start, drops past events, honours the limit', () => {
    const body = cal(
      ev('UID:late', 'DTSTART:20990301T100000Z', 'SUMMARY:C'),
      ev('UID:past', 'DTSTART:20981201T100000Z', 'SUMMARY:P'),
      ev('UID:early', 'DTSTART:20990201T100000Z', 'SUMMARY:A'),
      ev('UID:mid', 'DTSTART:20990215T100000Z', 'SUMMARY:B')
    )
    expect(parse(body).map((d) => d.uid)).toEqual(['early', 'mid', 'late'])
    expect(parse(body, NOW, 2).map((d) => d.uid)).toEqual(['early', 'mid'])
  })

  it('an event starting exactly now is kept; one millisecond earlier is dropped', () => {
    const start = Date.UTC(2099, 5, 1, 10)
    const body = cal(ev('UID:a', 'DTSTART:20990601T100000Z', 'SUMMARY:x'))
    expect(parse(body, start)).toHaveLength(1)
    expect(parse(body, start + 1)).toHaveLength(0)
  })

  it('missing/blank summary becomes "Untitled event"; whitespace is trimmed; location kept only if present', () => {
    const body = cal(
      ev('UID:a', 'DTSTART:20990110T100000Z', 'SUMMARY:   '),
      ev('UID:b', 'DTSTART:20990111T100000Z'),
      ev('UID:c', 'DTSTART:20990112T100000Z', 'SUMMARY: Seminar ', 'LOCATION: Room 4 ')
    )
    const r = parse(body)
    expect(r[0]).toEqual({ uid: 'a', summary: 'Untitled event', start: Date.UTC(2099, 0, 10, 10), isExam: false })
    expect(r[1].summary).toBe('Untitled event')
    expect('location' in r[1]).toBe(false)
    expect(r[2]).toMatchObject({ summary: 'Seminar', location: 'Room 4' })
  })

  it('unescapes iCal text (commas, newlines, unicode)', () => {
    const body = cal(ev('UID:a', 'DTSTART:20990110T100000Z', 'SUMMARY:Exam\\, part 1 – Ünïcode ✓'))
    expect(parse(body)[0].summary).toBe('Exam, part 1 – Ünïcode ✓')
  })

  it('summary with parameters (SUMMARY;LANGUAGE=en:...) is parsed as text', () => {
    const body = cal(ev('UID:a', 'DTSTART:20990110T100000Z', 'SUMMARY;LANGUAGE=en:Quiz 2'))
    const r = parse(body)
    expect(r[0].summary).toBe('Quiz 2')
    expect(r[0].isExam).toBe(true)
  })

  it('falls back to the object key when UID is missing', () => {
    const r = parseDeadlines({ somekey: { type: 'VEVENT', start: new Date(NOW + 1000), summary: 'x' } }, NOW)
    expect(r[0].uid).toBe('somekey')
  })

  it('skips non-events, events without a Date start and invalid dates', () => {
    const r = parseDeadlines(
      {
        a: { type: 'VTODO', start: new Date(NOW + 1000), summary: 'todo' },
        b: { type: 'VEVENT', summary: 'no start' },
        c: { type: 'VEVENT', start: new Date('nope'), summary: 'invalid' },
        d: { type: 'VEVENT', start: '2099-01-02', summary: 'string date' },
        e: null,
        f: { type: 'VEVENT', start: new Date(NOW + 5), summary: 'ok' }
      } as never,
      NOW
    )
    expect(r.map((d) => d.summary)).toEqual(['ok'])
  })

  describe('timezones', () => {
    const body = cal(
      ev('UID:tz', 'DTSTART;TZID=America/New_York:20991201T090000', 'SUMMARY:Quiz'),
      ev('UID:utc', 'DTSTART:20991201T090000Z', 'SUMMARY:Lecture'),
      ev('UID:float', 'DTSTART:20991201T090000', 'SUMMARY:Floating')
    )
    it('TZID events resolve to the right instant regardless of the machine timezone', () => {
      for (const tz of ['UTC', 'Asia/Tokyo', 'America/Los_Angeles']) {
        process.env.TZ = tz
        const r = parse(body)
        expect(r.find((d) => d.uid === 'tz')!.start).toBe(Date.UTC(2099, 11, 1, 14)) // 09:00 EST = 14:00Z
        expect(r.find((d) => d.uid === 'utc')!.start).toBe(Date.UTC(2099, 11, 1, 9))
      }
    })
    it('floating times follow the machine timezone', () => {
      process.env.TZ = 'Asia/Tokyo'
      expect(parse(body).find((d) => d.uid === 'float')!.start).toBe(Date.UTC(2099, 11, 1, 0))
    })
    it('TZID across DST: summer vs winter offsets differ by one hour', () => {
      const b = cal(
        ev('UID:s', 'DTSTART;TZID=America/New_York:20990715T090000', 'SUMMARY:s'),
        ev('UID:w', 'DTSTART;TZID=America/New_York:20990115T090000', 'SUMMARY:w')
      )
      const r = parse(b)
      expect(r.find((d) => d.uid === 's')!.start).toBe(Date.UTC(2099, 6, 15, 13))
      expect(r.find((d) => d.uid === 'w')!.start).toBe(Date.UTC(2099, 0, 15, 14))
    })
  })

  describe('all-day events', () => {
    const body = cal(ev('UID:ad', 'DTSTART;VALUE=DATE:20991201', 'DTEND;VALUE=DATE:20991202', 'SUMMARY:Final Exam'))
    it('start at local midnight of that date', () => {
      process.env.TZ = 'America/Los_Angeles'
      const r = parse(body)
      expect(r[0].start).toBe(new Date(2099, 11, 1).getTime())
      expect(r[0].isExam).toBe(true)
    })
    it('an all-day event stays visible while "now" is before its local midnight', () => {
      process.env.TZ = 'Pacific/Auckland'
      expect(parse(body, new Date(2099, 11, 1).getTime() - 1)).toHaveLength(1)
    })
    // BUG: deadlines.ts parseDeadlines() filters `start < now`; an all-day event TODAY has
    // start = local 00:00 which is already < now, so an all-day exam happening today vanishes
    // from the list (and from the exam reminders) as soon as the day begins.
    it('BUG: an all-day exam happening today is still listed during that day', () => {
      process.env.TZ = 'America/New_York'
      const noonOnTheDay = new Date(2099, 11, 1, 12).getTime()
      expect(parse(body, noonOnTheDay)).toHaveLength(1)
    })
  })

  describe('recurring events', () => {
    const weekly = cal(ev('UID:rec', 'DTSTART:20200105T100000Z', 'RRULE:FREQ=WEEKLY;COUNT=5000', 'SUMMARY:Weekly quiz'))
    // BUG: deadlines.ts parseDeadlines() only looks at the master event's DTSTART and ignores RRULE
    // (node-ical exposes `rrule`). A recurring event whose first occurrence is in the past (e.g. a
    // weekly quiz that started last semester) is dropped entirely although future occurrences exist.
    it('BUG: a recurring event whose DTSTART is in the past still yields its next occurrence', () => {
      const r = parse(weekly, NOW)
      expect(r.length).toBeGreaterThan(0)
      expect(r[0].start).toBeGreaterThanOrEqual(NOW)
    }, 30_000) // 5,000 weekly repeats: under 1 s locally, slower on shared CI machines
    it('a recurring event whose DTSTART is in the future is listed once (master occurrence only)', () => {
      const b = cal(ev('UID:rec', 'DTSTART:20990105T100000Z', 'RRULE:FREQ=WEEKLY;COUNT=10', 'SUMMARY:Weekly quiz'))
      expect(parse(b, NOW, 10)).toHaveLength(1)
    })
  })

  // BUG: deadlines.ts parseDeadlines() ignores STATUS:CANCELLED, so a cancelled exam keeps being listed
  // and still triggers the "in 3 days / 1 day" reminders.
  it('BUG: STATUS:CANCELLED events are not listed', () => {
    const b = cal(ev('UID:c', 'DTSTART:20990201T100000Z', 'STATUS:CANCELLED', 'SUMMARY:Midterm Exam'))
    expect(parse(b)).toHaveLength(0)
  })

  it('survives a large calendar quickly', () => {
    const events: string[] = []
    for (let i = 0; i < 2000; i++) {
      events.push(ev(`UID:e${i}`, `DTSTART:2099${String((i % 12) + 1).padStart(2, '0')}15T100000Z`, `SUMMARY:Event ${i}`))
    }
    const t0 = Date.now()
    const r = parse(cal(...events), NOW, 5)
    expect(r).toHaveLength(5)
    expect(Date.now() - t0).toBeLessThan(5000)
  })
})

describe('getDeadlines (cache)', () => {
  it('empty without a cache; filters out past items using the real clock', () => {
    expect(getDeadlines()).toEqual({ ok: true, value: [] })
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2099, 5, 1))
    mem.cache = { fetchedAt: 0, url: 'u', items: [{ start: Date.now() - 1 }, { start: Date.now() }, { start: Date.now() + 1 }] }
    expect(getDeadlines()).toEqual({ ok: true, value: [{ start: Date.now() }, { start: Date.now() + 1 }] })
    vi.useRealTimers()
  })
})

describe('refreshDeadlines', () => {
  const okRes = (body: string, status = 200) => ({ ok: status < 400, status, text: async () => body }) as unknown as Response

  it('rejects a blank URL without fetching', async () => {
    const f = vi.fn()
    vi.stubGlobal('fetch', f)
    const r = await refreshDeadlines('   ')
    expect(r.ok).toBe(false)
    expect(f).not.toHaveBeenCalled()
  })

  it('converts webcal:// to https:// for the request and the cache, parses, and caches', async () => {
    const f = vi.fn().mockResolvedValue(okRes(cal(ev('UID:a', 'DTSTART:20991201T090000Z', 'SUMMARY:Final Exam'))))
    vi.stubGlobal('fetch', f)
    const r = await refreshDeadlines('webcal://brightspace.example.edu/d2l/le/calendar/feed.ics?token=abc')
    expect(f.mock.calls[0][0]).toBe('https://brightspace.example.edu/d2l/le/calendar/feed.ics?token=abc')
    expect(r).toMatchObject({ ok: true })
    expect(r.ok && r.value[0]).toMatchObject({ uid: 'a', isExam: true })
    expect(mem.cache?.url).toBe('https://brightspace.example.edu/d2l/le/calendar/feed.ics?token=abc')
    expect(mem.cache?.items).toHaveLength(1)
  })

  it('HTTP errors are reported with the status and do not touch the cache', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(okRes('nope', 403)))
    const r = await refreshDeadlines('https://x/cal.ics')
    expect(r).toEqual({ ok: false, error: 'Calendar request failed (HTTP 403)' })
    expect(mem.cache).toBeNull()
  })

  it('an HTML login page is rejected as "not an iCal calendar"', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(okRes('<html>Please sign in</html>')))
    const r = await refreshDeadlines('https://x/cal.ics')
    expect(r.ok).toBe(false)
    expect(!r.ok && r.error).toMatch(/iCal/)
  })

  it('network failures and timeouts become friendly errors', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('getaddrinfo ENOTFOUND')))
    const r = await refreshDeadlines('https://x/cal.ics')
    expect(r).toEqual({ ok: false, error: "Couldn't load calendar: getaddrinfo ENOTFOUND" })
  })

  it('a calendar with zero upcoming events succeeds with an empty list', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(okRes(cal(ev('UID:a', 'DTSTART:20000101T090000Z', 'SUMMARY:old')))))
    expect(await refreshDeadlines('https://x/cal.ics')).toEqual({ ok: true, value: [] })
  })

  it('accepts lower-case begin:vcalendar and CRLF/LF mixes', async () => {
    const body = 'begin:vcalendar\nVERSION:2.0\nBEGIN:VEVENT\nUID:a\nDTSTART:20991201T090000Z\nSUMMARY:Quiz\nEND:VEVENT\nEND:VCALENDAR\n'
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(okRes(body)))
    const r = await refreshDeadlines('https://x/cal.ics')
    expect(r.ok).toBe(true)
  })

  // BUG: deadlines.ts refreshDeadlines(): `icalUrl.trim()` is evaluated OUTSIDE the try/catch, so a
  // non-string icalUrl coming from a corrupted settings file (mergeSettings does not coerce it)
  // makes the promise reject with a TypeError instead of returning { ok:false, error }.
  it('BUG: a non-string icalUrl resolves to an error result instead of rejecting', async () => {
    const r = await refreshDeadlines(42 as never)
    expect(r.ok).toBe(false)
  })
})
