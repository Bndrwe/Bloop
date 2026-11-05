// Rule checks for model output: a TypeScript port of ml/train/scoring.py (plans and nudges) plus the
// nudge emoji rule from ml/data/validate.py. Pure (no electron), unit-tested in tests/ai-scoring.test.ts
// with the same cases as ml/train/test_scoring.py. Keep the two in step.

export const NUDGE_MAX_CHARS = 60
const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
const MONTHS: Record<string, number> = { Jan: 1, Feb: 2, Mar: 3, Apr: 4, May: 5, Jun: 6, Jul: 7, Aug: 8, Sep: 9, Oct: 10, Nov: 11, Dec: 12 }

/** A calendar date (no time zone): what the prompt text says. */
export interface YMD {
  y: number
  m: number
  d: number
}

// --------------------------------------------------------------------------- JSON extraction

/** Mirror of extractJson() in src/main/plan.ts: strip a code fence, take first '{' .. last '}'. */
export function extractJson(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/)
  const body = fenced ? fenced[1]! : text
  const start = body.indexOf('{')
  const end = body.lastIndexOf('}')
  if (start === -1 || end <= start) throw new Error('no JSON object in response')
  return JSON.parse(body.slice(start, end + 1))
}

export function tryExtractJson(text: string): unknown | null {
  try {
    return extractJson(text)
  } catch {
    return null
  }
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

/** True when the whole reply is exactly one JSON object (no fences, no prose). */
export function isCleanJson(text: string): boolean {
  try {
    return isObj(JSON.parse(text.trim()))
  } catch {
    return false
  }
}

// --------------------------------------------------------------------------- schema

const isInt = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v)
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)

/** 'HH:MM' -> minutes since midnight, or null if malformed. */
export function parseHhmm(s: unknown): number | null {
  if (typeof s !== 'string') return null
  const m = s.trim().match(/^(\d{1,2}):(\d{2})$/)
  if (!m) return null
  const h = Number(m[1])
  const mm = Number(m[2])
  if (h > 23 || mm > 59) return null
  return h * 60 + mm
}

/** Structural validation matching what parsePlan() in plan.ts needs. Empty list == valid. */
export function schemaErrors(plan: unknown): string[] {
  const errs: string[] = []
  if (!isObj(plan)) return ['top level is not an object']
  if (typeof plan.summary !== 'string' || !plan.summary.trim()) errs.push('summary missing or not a non-empty string')
  const blocks = plan.blocks
  if (!Array.isArray(blocks) || !blocks.length) {
    errs.push('blocks missing or empty')
    return errs
  }
  blocks.forEach((b: unknown, i) => {
    if (!isObj(b)) {
      errs.push(`blocks[${i}] not an object`)
      return
    }
    if (!isInt(b.day) || b.day < 0 || b.day > 6) errs.push(`blocks[${i}].day must be an integer 0-6`)
    if (parseHhmm(b.time) == null) errs.push(`blocks[${i}].time must be HH:MM`)
    if (!isNum(b.minutes) || b.minutes <= 0) errs.push(`blocks[${i}].minutes must be a positive number`)
    if (typeof b.label !== 'string' || !b.label.trim()) errs.push(`blocks[${i}].label must be a non-empty string`)
  })
  return errs
}

export function isSchemaValid(plan: unknown): boolean {
  return schemaErrors(plan).length === 0
}

// --------------------------------------------------------------------------- prompt context

export function isPlanPrompt(prompt: string): boolean {
  const p = prompt.toLowerCase()
  return p.includes('study plan') && (p.includes('json') || p.includes('"blocks"'))
}

const DATE_JS = /\b(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun)[a-z]*,? (Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]* (\d{1,2}),? (\d{4})/
const DATE_ISO = /(?<!\d)(\d{4})-(\d{2})-(\d{2})(?!\d)/

function validYmd(y: number, m: number, d: number): YMD | null {
  const t = new Date(Date.UTC(y, m - 1, d))
  return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d ? { y, m, d } : null
}

/** First date in a line: JS Date.toString() style ('Tue Nov 10 2026 ...') or ISO ('2026-11-10'). */
export function findDate(line: string): YMD | null {
  const js = line.match(DATE_JS)
  if (js) return validYmd(Number(js[3]), MONTHS[js[1]!]!, Number(js[2]))
  const iso = line.match(DATE_ISO)
  if (iso) return validYmd(Number(iso[1]), Number(iso[2]), Number(iso[3]))
  return null
}

const dayNumber = (d: YMD): number => Math.round(Date.UTC(d.y, d.m - 1, d.d) / 86_400_000)

export interface PlanContext {
  today: YMD | null
  todayDow: number | null
  pomodoro: number
  break: number
  deadlines: { line: string; date: YMD; exam: boolean }[]
}

/** Pull today's date/weekday, pomodoro/break minutes and deadlines out of a plan prompt. */
export function parseContext(prompt: string): PlanContext {
  const ctx: PlanContext = { today: null, todayDow: null, pomodoro: 25, break: 5, deadlines: [] }
  let m = prompt.match(/Today is (Sunday|Monday|Tuesday|Wednesday|Thursday|Friday|Saturday)([^\n]*)/)
  if (m) {
    ctx.todayDow = DAY_NAMES.indexOf(m[1]!)
    ctx.today = findDate(m[2]!)
  }
  m = prompt.match(/uses (?:a )?(\d+)[- ]minute pomodoro/)
  if (m) ctx.pomodoro = Number(m[1])
  m = prompt.match(/(\d+)[- ]minute breaks/)
  if (m) ctx.break = Number(m[1])
  const sec = prompt.match(/Upcoming deadlines:\n([\s\S]*?)\n\s*\n/)
  if (sec) {
    for (const raw of sec[1]!.split(/\r?\n/)) {
      const line = raw.trim()
      if (!line.startsWith('-') || line.includes('no upcoming deadlines')) continue
      const d = findDate(line)
      if (d) ctx.deadlines.push({ line, date: d, exam: line.includes('(EXAM)') })
    }
  }
  return ctx
}

// --------------------------------------------------------------------------- rule checks

type Plan = { summary?: unknown; blocks?: unknown }
const blocksOf = (plan: unknown): Record<string, unknown>[] =>
  isObj(plan) && Array.isArray((plan as Plan).blocks) ? ((plan as Plan).blocks as Record<string, unknown>[]) : []

export function checkBlockCount(plan: unknown): boolean {
  const b = isObj(plan) ? plan.blocks : null
  return Array.isArray(b) && b.length >= 3 && b.length <= 10
}

/** Every block starts at/after 08:00 and ends at/before 22:00. */
export function checkHours(plan: unknown, lo = 8 * 60, hi = 22 * 60): boolean {
  for (const b of blocksOf(plan)) {
    const start = parseHhmm(b?.time)
    const mins = b?.minutes
    if (start == null || !isNum(mins)) return false
    if (start < lo || start + mins > hi) return false
  }
  return true
}

/** Days from today (0-6) for deadlines that fall inside the 7-day planning window. */
export function deadlineOffsets(ctx: PlanContext): number[] {
  if (!ctx.today) return []
  const t = dayNumber(ctx.today)
  return ctx.deadlines.map((d) => dayNumber(d.date) - t).filter((o) => o >= 0 && o <= 6)
}

/** No block lies after the last in-window deadline's weekday. null when not applicable. */
export function checkBeforeDeadline(plan: unknown, ctx: PlanContext): boolean | null {
  const offs = deadlineOffsets(ctx)
  if (!offs.length || ctx.todayDow == null) return null
  const last = Math.max(...offs)
  for (const b of blocksOf(plan)) {
    const day = b?.day
    if (!isInt(day)) return false
    if ((((day - ctx.todayDow) % 7) + 7) % 7 > last) return false
  }
  return true
}

/** Python's round(): halves go to the even neighbour. */
function roundHalfEven(x: number): number {
  const f = Math.floor(x)
  const diff = x - f
  if (diff > 0.5) return f + 1
  if (diff < 0.5) return f
  return f % 2 === 0 ? f : f + 1
}

/** Roughly a multiple of the pomodoro length (or of focus+break): within max(5, 20% of the unit). */
export function minutesOk(minutes: unknown, pomodoro: number, brk = 5): boolean {
  if (!isNum(minutes) || minutes <= 0 || pomodoro <= 0) return false
  for (const unit of new Set([pomodoro, pomodoro + brk])) {
    const k = roundHalfEven(minutes / unit)
    if (k >= 1 && Math.abs(minutes - k * unit) <= Math.max(5, 0.2 * unit)) return true
  }
  return false
}

export function checkPomodoro(plan: unknown, ctx: PlanContext): boolean {
  return blocksOf(plan).every((b) => minutesOk(b?.minutes, ctx.pomodoro, ctx.break))
}

export interface PlanScore {
  parsed: boolean
  cleanJson: boolean
  schemaValid: boolean
  blocks3to10: boolean | null
  hoursOk: boolean | null
  beforeDeadline: boolean | null
  pomodoroOk: boolean | null
  allRules: boolean | null
  errors: string[]
  plan: unknown
}

/** Score one reply to a plan prompt. Rule fields are null when the plan could not be checked. */
export function scorePlan(text: string, prompt: string): PlanScore {
  const ctx = parseContext(prompt)
  const obj = tryExtractJson(text)
  const res: PlanScore = {
    parsed: obj != null,
    cleanJson: isCleanJson(text),
    schemaValid: false,
    blocks3to10: null,
    hoursOk: null,
    beforeDeadline: null,
    pomodoroOk: null,
    allRules: null,
    errors: [],
    plan: obj
  }
  if (obj == null) return res
  res.errors = schemaErrors(obj)
  res.schemaValid = res.errors.length === 0
  if (!res.schemaValid) return res
  res.blocks3to10 = checkBlockCount(obj)
  res.hoursOk = checkHours(obj)
  res.beforeDeadline = checkBeforeDeadline(obj, ctx)
  res.pomodoroOk = checkPomodoro(obj, ctx)
  res.allRules = [res.blocks3to10, res.hoursOk, res.beforeDeadline, res.pomodoroOk].every((v) => v !== false)
  return res
}

// --------------------------------------------------------------------------- nudges

/** Same ranges as emoji_count() in ml/data/validate.py. */
export function emojiCount(s: string): number {
  let n = 0
  for (const ch of s) {
    const c = ch.codePointAt(0)!
    if (c >= 0x1f000 || (c >= 0x2600 && c <= 0x27bf) || (c >= 0x2b00 && c <= 0x2bff)) n++
  }
  return n
}

export interface NudgeScore {
  nonempty: boolean
  singleLine: boolean
  len: number
  le60: boolean
  emojiOk: boolean
}

export function scoreNudge(text: string): NudgeScore {
  const t = text.trim()
  // Length in code points, like Python's len().
  const len = [...t].length
  return { nonempty: Boolean(t), singleLine: !t.includes('\n'), len, le60: Boolean(t) && len <= NUDGE_MAX_CHARS, emojiOk: emojiCount(t) <= 1 }
}

/** The system prompt asks for no em dashes in user-facing text. */
export function hasEmDash(s: string): boolean {
  return s.includes('—')
}
