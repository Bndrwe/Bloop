// Decides whether a task is a multi-day "project" (broken into concrete steps) or a small task
// (1-2 blocks), through the user's AI (src/main/ai/registry.ts: Claude API, CLI or Ollama). When no
// AI is ready or its answer is unusable, the built-in rules below decide, so the planner always
// works. Items that aren't work (a lecture, office hours) come back as 'skip'.
import type { PlannerKind } from '@shared/planner'
import type { CompleteOptions } from '../ai/types'

export interface ClassifyItem {
  title: string
  due: number
  /** Brightspace item type, when known. */
  kind?: 'assignment' | 'quiz' | 'event'
  isExam?: boolean
}

export interface StepDraft {
  title: string
  minutes: number
}

export type Classification = { kind: PlannerKind; steps: StepDraft[] } | 'skip'

export type GenerateText = (prompt: string, opts?: CompleteOptions) => Promise<string>

export const STEP_MIN_MINUTES = 15
export const STEP_MAX_MINUTES = 120
const PROJECT_MAX_STEPS = 8
const TASK_MAX_STEPS = 2
const MAX_ITEMS_PER_CALL = 12
const STEP_TITLE_MAX = 80

const PROJECT_RE = /\b(essay|project|paper|report|thesis|presentation|portfolio|proposal|capstone|research|dissertation|lab report|term paper)\b/i
const EXAM_RE = /\b(exam|midterm|final|test)\b/i
const QUIZ_RE = /\b(quiz|reading|discussion|post|reflection|worksheet)\b/i
const NOT_WORK_RE = /\b(lecture|class|office hours?|seminar|tutorial session|lab section|meeting)\b/i

const clampMinutes = (n: unknown): number => {
  const v = Math.round(Number(n))
  if (!Number.isFinite(v)) return 60
  const snapped = Math.round(v / 15) * 15
  return Math.min(STEP_MAX_MINUTES, Math.max(STEP_MIN_MINUTES, snapped))
}

const cleanTitle = (s: unknown, fallback: string): string => {
  const t = String(s ?? '').replace(/[\r\n]+/g, ' ').trim().slice(0, STEP_TITLE_MAX)
  return t || fallback
}

/** The built-in fallback: keyword rules on the title and Brightspace type. */
export function ruleClassify(item: ClassifyItem, now: number): Classification {
  const title = item.title
  const daysLeft = (item.due - now) / 86_400_000
  if (item.kind === 'event' && !item.isExam && !PROJECT_RE.test(title)) return 'skip'
  if (!item.isExam && NOT_WORK_RE.test(title) && !PROJECT_RE.test(title)) return 'skip'
  if (PROJECT_RE.test(title) && daysLeft >= 2) {
    return {
      kind: 'project',
      steps: [
        { title: 'Read the brief and gather sources', minutes: 60 },
        { title: 'Outline the main points', minutes: 60 },
        { title: 'Write the first draft', minutes: 120 },
        { title: 'Finish the draft', minutes: 90 },
        { title: 'Revise and proofread', minutes: 60 },
        { title: 'Final check and submit', minutes: 30 }
      ]
    }
  }
  if (item.isExam || EXAM_RE.test(title)) {
    return {
      kind: 'task',
      steps: [
        { title: 'Review notes and key topics', minutes: 90 },
        { title: 'Practice questions', minutes: 60 }
      ]
    }
  }
  if (item.kind === 'quiz' || QUIZ_RE.test(title)) return { kind: 'task', steps: [{ title: 'Prepare and complete', minutes: 45 }] }
  return {
    kind: 'task',
    steps: [
      { title: 'Work on it', minutes: 60 },
      { title: 'Finish and submit', minutes: 45 }
    ]
  }
}

/** The classification prompt (the user message). */
export function buildClassifyPrompt(items: ClassifyItem[], now: Date): string {
  const list = items
    .map((it, i) => {
      const tags = [it.kind, it.isExam ? 'exam' : ''].filter(Boolean).join(', ')
      const title = it.title.replace(/[\r\n]+/g, ' ').slice(0, 160)
      return `${i}. "${title}"${tags ? ` (${tags})` : ''}, due ${new Date(it.due).toString()}`
    })
    .join('\n')
  return `You help a university student plan their study time. Now is ${now.toString()}.

For each item below decide:
- "project": a big or multi-day piece of work (essays, papers, projects, presentations, anything needing several sittings).
  Break it into 3-${PROJECT_MAX_STEPS} small, concrete steps in the order they should be done (e.g. "Find 5 sources", "Outline intro and 3 arguments").
- "task": a small assignment, quiz or exam prep. Give 1-${TASK_MAX_STEPS} study blocks.
- "skip": not something to study for (a lecture, office hours, a class meeting).
Each step has "minutes" between ${STEP_MIN_MINUTES} and ${STEP_MAX_MINUTES} (multiples of 15). Be realistic about the time left before the due date.

Items:
${list}

Reply with ONLY a JSON object, no markdown fences, in exactly this shape:
{"items": [{"index": <number>, "type": "project" | "task" | "skip", "steps": [{"title": "<short step>", "minutes": <number>}]}]}`
}

export const CLASSIFY_JSON_SCHEMA: Record<string, unknown> = {
  type: 'object',
  properties: {
    items: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          index: { type: 'integer', minimum: 0 },
          type: { enum: ['project', 'task', 'skip'] },
          steps: {
            type: 'array',
            maxItems: PROJECT_MAX_STEPS,
            items: {
              type: 'object',
              properties: { title: { type: 'string' }, minutes: { type: 'integer', minimum: STEP_MIN_MINUTES, maximum: STEP_MAX_MINUTES } },
              required: ['title', 'minutes'],
              additionalProperties: false
            }
          }
        },
        required: ['index', 'type', 'steps'],
        additionalProperties: false
      }
    }
  },
  required: ['items'],
  additionalProperties: false
}

function extractJson(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/)
  const body = fenced ? fenced[1] : text
  const start = body.indexOf('{')
  const end = body.lastIndexOf('}')
  if (start === -1 || end <= start) throw new Error('no JSON object in response')
  return JSON.parse(body.slice(start, end + 1))
}

/**
 * Parse the AI's answer into one Classification per item (null where the AI gave nothing usable,
 * so the caller can fall back to the rules for just that item).
 */
export function parseClassification(text: string, count: number): (Classification | null)[] {
  const out: (Classification | null)[] = Array.from({ length: count }, () => null)
  const raw = extractJson(text) as { items?: unknown }
  if (!Array.isArray(raw.items)) throw new Error('no items array')
  for (const entry of raw.items as Record<string, unknown>[]) {
    const i = Number(entry?.index)
    if (!Number.isInteger(i) || i < 0 || i >= count || out[i] !== null) continue
    const type = entry?.type
    if (type === 'skip') {
      out[i] = 'skip'
      continue
    }
    if (type !== 'project' && type !== 'task') continue
    const max = type === 'project' ? PROJECT_MAX_STEPS : TASK_MAX_STEPS
    const steps = (Array.isArray(entry.steps) ? (entry.steps as Record<string, unknown>[]) : [])
      .slice(0, max)
      .map((s, n) => ({ title: cleanTitle(s?.title, `Step ${n + 1}`), minutes: clampMinutes(s?.minutes) }))
    if (steps.length === 0) continue
    // a "project" with a single step is really a task
    out[i] = { kind: type === 'project' && steps.length >= 2 ? 'project' : 'task', steps }
  }
  return out
}

export interface ClassifyResult {
  results: { classification: Classification; by: 'ai' | 'rules' }[]
  /** Set when the AI couldn't be used (shown as a note in the panel). */
  aiError?: string
}

/** Classify every item: the AI first (in batches), the rules for anything it couldn't answer. */
export async function classifyItems(items: ClassifyItem[], generate: GenerateText, now = Date.now()): Promise<ClassifyResult> {
  const answers: (Classification | null)[] = Array.from({ length: items.length }, () => null)
  let aiError: string | undefined
  for (let i = 0; i < items.length && !aiError; i += MAX_ITEMS_PER_CALL) {
    const batch = items.slice(i, i + MAX_ITEMS_PER_CALL)
    try {
      const text = await generate(buildClassifyPrompt(batch, new Date(now)), {
        jsonSchema: CLASSIFY_JSON_SCHEMA,
        maxTokens: 2048,
        timeoutMs: 120_000
      })
      parseClassification(text, batch.length).forEach((c, n) => (answers[i + n] = c))
    } catch (e) {
      aiError = (e as Error).message || String(e)
    }
  }
  return {
    results: items.map((it, i) => {
      const ai = answers[i]
      return ai ? { classification: ai, by: 'ai' as const } : { classification: ruleClassify(it, now), by: 'rules' as const }
    }),
    ...(aiError ? { aiError } : {})
  }
}
