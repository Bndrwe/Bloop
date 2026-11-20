import { describe, expect, it } from 'vitest'
import { buildClassifyPrompt, classifyItems, parseClassification, ruleClassify, STEP_MAX_MINUTES } from '../src/main/planner/classify'

const NOW = new Date(2026, 10, 20, 10).getTime()
const DAY = 86_400_000

describe('ruleClassify', () => {
  it('turns an essay due in a week into a project with steps', () => {
    const c = ruleClassify({ title: 'HIST 101: Final essay', due: NOW + 7 * DAY }, NOW)
    expect(c).not.toBe('skip')
    if (c === 'skip') return
    expect(c.kind).toBe('project')
    expect(c.steps.length).toBeGreaterThanOrEqual(3)
  })
  it('gives a quiz one block and a homework two', () => {
    const q = ruleClassify({ title: 'Quiz 3', due: NOW + DAY, kind: 'quiz' }, NOW)
    const hw = ruleClassify({ title: 'Problem set 4', due: NOW + 2 * DAY, kind: 'assignment' }, NOW)
    expect(q !== 'skip' && q.steps.length).toBe(1)
    expect(hw !== 'skip' && hw.steps.length).toBe(2)
  })
  it('skips lectures and plain events', () => {
    expect(ruleClassify({ title: 'CHEM 201 Lecture', due: NOW + DAY }, NOW)).toBe('skip')
    expect(ruleClassify({ title: 'Course social', due: NOW + DAY, kind: 'event' }, NOW)).toBe('skip')
  })
  it('keeps exams even when they are events', () => {
    const c = ruleClassify({ title: 'Midterm', due: NOW + 3 * DAY, kind: 'event', isExam: true }, NOW)
    expect(c !== 'skip' && c.kind).toBe('task')
  })
})

describe('parseClassification', () => {
  it('reads projects, tasks and skips by index, clamping minutes', () => {
    const text = JSON.stringify({
      items: [
        { index: 1, type: 'task', steps: [{ title: 'Do it', minutes: 50 }] },
        { index: 0, type: 'project', steps: [{ title: 'Outline', minutes: 999 }, { title: 'Draft', minutes: 5 }] },
        { index: 2, type: 'skip', steps: [] }
      ]
    })
    const out = parseClassification('```json\n' + text + '\n```', 3)
    expect(out[0]).toEqual({ kind: 'project', steps: [{ title: 'Outline', minutes: STEP_MAX_MINUTES }, { title: 'Draft', minutes: 15 }] })
    expect(out[1]).toEqual({ kind: 'task', steps: [{ title: 'Do it', minutes: 45 }] })
    expect(out[2]).toBe('skip')
  })
  it('caps a task at 2 blocks and demotes a one-step project', () => {
    const text = JSON.stringify({
      items: [
        { index: 0, type: 'task', steps: [1, 2, 3].map((n) => ({ title: `s${n}`, minutes: 30 })) },
        { index: 1, type: 'project', steps: [{ title: 'only', minutes: 60 }] }
      ]
    })
    const out = parseClassification(text, 2)
    expect(out[0] !== 'skip' && out[0]?.steps.length).toBe(2)
    expect(out[1] !== 'skip' && out[1]?.kind).toBe('task')
  })
  it('ignores bad indexes and empty steps', () => {
    const out = parseClassification(JSON.stringify({ items: [{ index: 7, type: 'task', steps: [] }, { index: 0, type: 'task', steps: [] }] }), 1)
    expect(out).toEqual([null])
  })
  it('throws on non-JSON', () => {
    expect(() => parseClassification('sorry', 1)).toThrow()
  })
})

describe('classifyItems', () => {
  const items = [
    { title: 'Research paper', due: NOW + 10 * DAY },
    { title: 'Quiz 2', due: NOW + DAY, kind: 'quiz' as const }
  ]
  it('uses the AI answer where it has one and the rules for the rest', async () => {
    const gen = async () => JSON.stringify({ items: [{ index: 0, type: 'project', steps: [{ title: 'A', minutes: 60 }, { title: 'B', minutes: 60 }] }] })
    const r = await classifyItems(items, gen, NOW)
    expect(r.results[0].by).toBe('ai')
    expect(r.results[1].by).toBe('rules')
    expect(r.aiError).toBeUndefined()
  })
  it('falls back to the rules when the AI throws', async () => {
    const r = await classifyItems(items, async () => {
      throw new Error('No AI ready')
    }, NOW)
    expect(r.aiError).toBe('No AI ready')
    expect(r.results.every((x) => x.by === 'rules')).toBe(true)
    expect(r.results[0].classification !== 'skip' && r.results[0].classification.kind).toBe('project')
  })
  it('puts every item and its due date in the prompt', () => {
    const p = buildClassifyPrompt(items, new Date(NOW))
    expect(p).toContain('0. "Research paper"')
    expect(p).toContain('1. "Quiz 2" (quiz)')
  })
})
