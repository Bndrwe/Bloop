// The TypeScript port of ml/train/scoring.py, checked with the same cases as ml/train/test_scoring.py.
import { describe, expect, it } from 'vitest'
import * as S from '../src/main/ai/scoring'

const PROMPT = `You are a friendly study coach inside a desktop "study pet" app for a university student.
Today is Wednesday Wed Nov 04 2026 10:00:00 GMT+0100 (CET).

Upcoming deadlines:
- Calculus midterm (EXAM): Mon Nov 09 2026 09:00:00 GMT+0100 (CET)
- Essay draft: Fri Nov 20 2026 23:59:00 GMT+0100 (CET)

Focus history for the last 7 days (score 0-100 = share of time on study apps/sites):
- 2026-11-03: 2 sessions, 50 focused min, avg score 80

The student uses 25-minute pomodoros with 5-minute breaks.

Create a realistic study plan for the next 7 days ... Use 3-10 blocks.
Reply with ONLY a JSON object, no markdown fences, in exactly this shape:
{"summary": "...", "blocks": [{"day": 0, "time": "HH:MM", "minutes": 25, "label": "x"}]}`

const GOOD = {
  summary: 'You got this!',
  blocks: [
    { day: 3, time: '09:00', minutes: 50, label: 'Limits' },
    { day: 4, time: '10:00', minutes: 75, label: 'Derivatives' },
    { day: 5, time: '14:00', minutes: 25, label: 'Practice' },
    { day: 6, time: '09:30', minutes: 100, label: 'Integrals' },
    { day: 0, time: '15:00', minutes: 50, label: 'Past paper' }
  ]
}
const plan = (blocks: unknown[], summary = 'ok') => ({ summary, blocks })

describe('JSON', () => {
  it('extracts from fences and prose', () => {
    expect(S.extractJson('Sure!\n```json\n{"a": 1}\n```')).toEqual({ a: 1 })
    expect(S.extractJson('blah {"a": {"b": 2}} trailing')).toEqual({ a: { b: 2 } })
  })
  it('fails cleanly', () => {
    expect(S.tryExtractJson('no json here')).toBeNull()
    expect(S.tryExtractJson('{"a": ')).toBeNull()
  })
  it('clean JSON = exactly one object', () => {
    expect(S.isCleanJson(' {"a": 1}\n')).toBe(true)
    expect(S.isCleanJson('```json\n{"a": 1}\n```')).toBe(false)
    expect(S.isCleanJson('[1]')).toBe(false)
  })
})

describe('schema', () => {
  it('valid', () => expect(S.isSchemaValid(GOOD)).toBe(true))
  it('invalid', () => {
    expect(S.isSchemaValid([])).toBe(false)
    expect(S.isSchemaValid({ summary: 'x' })).toBe(false)
    expect(S.isSchemaValid(plan([{ day: 7, time: '09:00', minutes: 25, label: 'a' }]))).toBe(false)
    expect(S.isSchemaValid(plan([{ day: 1, time: '9am', minutes: 25, label: 'a' }]))).toBe(false)
    expect(S.isSchemaValid(plan([{ day: true, time: '09:00', minutes: 25, label: 'a' }]))).toBe(false)
    expect(S.isSchemaValid(plan([{ day: 1, time: '09:00', minutes: 0, label: 'a' }]))).toBe(false)
    expect(S.isSchemaValid(plan([{ day: 1, time: '09:00', minutes: 25, label: '' }]))).toBe(false)
    expect(S.isSchemaValid(plan([], 'x'))).toBe(false)
  })
  it('HH:MM', () => {
    expect(S.parseHhmm('08:30')).toBe(510)
    expect(S.parseHhmm('8:05')).toBe(485)
    expect(S.parseHhmm('24:00')).toBeNull()
    expect(S.parseHhmm(900)).toBeNull()
  })
})

describe('prompt context', () => {
  it('detects plan prompts', () => {
    expect(S.isPlanPrompt(PROMPT)).toBe(true)
    expect(S.isPlanPrompt('The student drifted to YouTube for 3 minutes. Write one short nudge.')).toBe(false)
  })
  it('parses today, pomodoro and deadlines', () => {
    const c = S.parseContext(PROMPT)
    expect(c.today).toEqual({ y: 2026, m: 11, d: 4 })
    expect(c.todayDow).toBe(3)
    expect([c.pomodoro, c.break]).toEqual([25, 5])
    expect(c.deadlines.map((d) => d.date)).toEqual([
      { y: 2026, m: 11, d: 9 },
      { y: 2026, m: 11, d: 20 }
    ])
    expect(c.deadlines[0]!.exam).toBe(true)
    expect(S.deadlineOffsets(c)).toEqual([5]) // only the exam is inside the 7-day window
  })
  it('no deadlines', () => {
    const c = S.parseContext(
      PROMPT.replace(
        '- Calculus midterm (EXAM): Mon Nov 09 2026 09:00:00 GMT+0100 (CET)\n- Essay draft: Fri Nov 20 2026 23:59:00 GMT+0100 (CET)',
        '- (no upcoming deadlines found)'
      )
    )
    expect(c.deadlines).toEqual([])
  })
  it('ISO dates', () => expect(S.findDate('- Quiz: 2026-11-06T09:00')).toEqual({ y: 2026, m: 11, d: 6 }))
})

describe('rules', () => {
  it('block count', () => {
    expect(S.checkBlockCount(GOOD)).toBe(true)
    expect(S.checkBlockCount(plan(GOOD.blocks.slice(0, 2)))).toBe(false)
    expect(S.checkBlockCount(plan([...GOOD.blocks, ...GOOD.blocks, ...GOOD.blocks]))).toBe(false)
  })
  it('hours', () => {
    expect(S.checkHours(GOOD)).toBe(true)
    expect(S.checkHours(plan([{ day: 1, time: '07:30', minutes: 25, label: 'a' }]))).toBe(false)
    expect(S.checkHours(plan([{ day: 1, time: '21:30', minutes: 50, label: 'a' }]))).toBe(false)
    expect(S.checkHours(plan([{ day: 1, time: '21:00', minutes: 60, label: 'a' }]))).toBe(true) // ends 22:00 exactly
  })
  it('before deadline', () => {
    const c = S.parseContext(PROMPT) // today Wed(3), exam Mon(1) offset 5
    expect(S.checkBeforeDeadline(GOOD, c)).toBe(true)
    expect(S.checkBeforeDeadline(plan([{ day: 2, time: '09:00', minutes: 25, label: 'a' }]), c)).toBe(false) // Tue = offset 6
    expect(S.checkBeforeDeadline(plan([{ day: 1, time: '09:00', minutes: 25, label: 'a' }]), c)).toBe(true) // Mon = offset 5
    const none = S.parseContext('Today is Wednesday Wed Nov 04 2026\n\nUpcoming deadlines:\n- (no upcoming deadlines found)\n\nx')
    expect(S.checkBeforeDeadline(GOOD, none)).toBeNull()
  })
  it('pomodoro multiples, same tolerance as scoring.py', () => {
    for (const m of [25, 50, 75, 100, 52, 30, 60]) expect(S.minutesOk(m, 25, 5), String(m)).toBe(true)
    for (const m of [10, 40, 0, -5, '25']) expect(S.minutesOk(m, 25, 5), String(m)).toBe(false)
    expect(S.minutesOk(90, 45, 10)).toBe(true)
  })
  it('nudges: length, one line, emoji', () => {
    expect(S.scoreNudge('Hey, tiny step back to your notes?').le60).toBe(true)
    expect(S.scoreNudge('x'.repeat(61)).le60).toBe(false)
    expect(S.scoreNudge('x'.repeat(60)).le60).toBe(true)
    expect(S.scoreNudge('   ').le60).toBe(false)
    expect(S.scoreNudge('a\nb').singleLine).toBe(false)
    expect(S.scoreNudge('back to it 📚').emojiOk).toBe(true)
    expect(S.scoreNudge('back to it 📚✨').emojiOk).toBe(false)
    // an emoji counts as one character, like Python's len()
    expect(S.scoreNudge('x'.repeat(59) + '🌱').le60).toBe(true)
  })
})

describe('end to end', () => {
  it('good plan', () => {
    const r = S.scorePlan(JSON.stringify(GOOD), PROMPT)
    expect(r.parsed && r.cleanJson && r.schemaValid).toBe(true)
    expect(r.allRules).toBe(true)
  })
  it('fenced plan parses but is not clean', () => {
    const r = S.scorePlan('```json\n' + JSON.stringify(GOOD) + '\n```', PROMPT)
    expect(r.parsed).toBe(true)
    expect(r.cleanJson).toBe(false)
    expect(r.schemaValid).toBe(true)
  })
  it('garbage', () => {
    const r = S.scorePlan('I cannot help', PROMPT)
    expect(r.parsed).toBe(false)
    expect(r.allRules ?? false).toBe(false)
  })
  it('bad plan fails hours and pomodoro', () => {
    const r = S.scorePlan(JSON.stringify(plan(Array(3).fill({ day: 1, time: '06:00', minutes: 13, label: 'a' }))), PROMPT)
    expect(r.schemaValid).toBe(true)
    expect(r.hoursOk).toBe(false)
    expect(r.pomodoroOk).toBe(false)
    expect(r.allRules).toBe(false)
  })
})
