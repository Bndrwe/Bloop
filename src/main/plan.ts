// AI study plan. Generation goes through the AI registry (src/main/ai/registry.ts), which picks
// the user's provider: the Bloop model, an Ollama model or a cloud provider. API keys (including
// the .env ANTHROPIC_API_KEY fallback, read by the cloud side) stay in the main process.
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import dotenv from 'dotenv'
import type { Deadline, PlanBlock, Reminder, Result, Settings, Stats, StudyPlan } from '@shared/types'
import type { CompleteOptions } from './ai/types'


let envLoaded = false
/** Load .env from the given directories (first match wins for each var; existing env vars are kept). */
export function loadEnv(dirs: string[]): void {
  if (envLoaded) return
  envLoaded = true
  for (const d of dirs) {
    const p = join(d, '.env')
    if (existsSync(p)) {
      dotenv.config({ path: p, quiet: true } as dotenv.DotenvConfigOptions)
      console.log(`[bloop] loaded env from ${p}`)
    }
  }
}

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

/** The plan prompt. The dataset in ml/ mirrors this exact text: don't change the wording casually. */
export function buildPrompt(deadlines: Deadline[], stats: Stats, settings: Settings, now: Date): string {
  const dl = deadlines.length
    ? deadlines
        .map((d) => `- ${d.summary}${d.isExam ? ' (EXAM)' : ''}: ${new Date(d.start).toString()}`)
        .join('\n')
    : '- (no upcoming deadlines found)'
  const days = stats.last7
    .map((d) => `- ${d.date}: ${d.sessions} sessions, ${Math.round(d.focusSec / 60)} focused min, avg score ${d.avgScore ?? 'n/a'}`)
    .join('\n')
  return `You are a friendly study coach inside a desktop "study pet" app for a university student.
Today is ${DAY_NAMES[now.getDay()]} ${now.toString()}.

Upcoming deadlines:
${dl}

Focus history for the last 7 days (score 0-100 = share of time on study apps/sites):
${days}

The student uses ${settings.focusMinutes}-minute pomodoros with ${settings.breakMinutes}-minute breaks.

Create a realistic study plan for the next 7 days that prioritises exams and the nearest deadlines,
and fits the student's recent habits (don't jump from 0 to 6 hours a day). Use 3-10 blocks.
Block lengths should be multiples of the pomodoro length (roughly). Prefer times between 08:00 and 22:00.

Reply with ONLY a JSON object, no markdown fences, in exactly this shape:
{"summary": "<2-3 encouraging sentences explaining the plan>",
 "blocks": [{"day": <0-6, 0 = Sunday>, "time": "HH:MM" (24h), "minutes": <number>, "label": "<what to study>"}]}`
}

function extractJson(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/)
  const body = fenced ? fenced[1] : text
  const start = body.indexOf('{')
  const end = body.lastIndexOf('}')
  if (start === -1 || end <= start) throw new Error('no JSON object in response')
  return JSON.parse(body.slice(start, end + 1))
}

export function parsePlan(text: string, now = Date.now()): StudyPlan {
  const raw = extractJson(text) as { summary?: unknown; blocks?: unknown }
  const blocks: PlanBlock[] = []
  if (Array.isArray(raw.blocks)) {
    for (const b of raw.blocks as Record<string, unknown>[]) {
      const day = Number(b?.day)
      const m = String(b?.time ?? '').match(/^(\d{1,2}):(\d{2})/)
      const minutes = Math.round(Number(b?.minutes))
      if (!Number.isInteger(day) || day < 0 || day > 6 || !m) continue
      const h = Number(m[1])
      const mm = Number(m[2])
      if (h > 23 || mm > 59) continue
      blocks.push({
        day,
        time: `${String(h).padStart(2, '0')}:${String(mm).padStart(2, '0')}`,
        minutes: Number.isFinite(minutes) && minutes > 0 ? Math.min(minutes, 600) : 25,
        label: String(b?.label ?? 'Study').slice(0, 120) || 'Study'
      })
    }
  }
  if (!blocks.length) throw new Error('plan had no valid blocks')
  return {
    generatedAt: now,
    summary: typeof raw.summary === 'string' ? raw.summary : 'Here is your study plan!',
    blocks
  }
}

/** JSON schema the plan must follow (local runtimes enforce it as a grammar / Ollama `format`). */
export const PLAN_JSON_SCHEMA: Record<string, unknown> = {
  type: 'object',
  properties: {
    summary: { type: 'string' },
    blocks: {
      type: 'array',
      minItems: 1,
      maxItems: 10,
      items: {
        type: 'object',
        properties: {
          day: { enum: [0, 1, 2, 3, 4, 5, 6] },
          time: { type: 'string', pattern: '^([01][0-9]|2[0-3]):[0-5][0-9]$' },
          minutes: { type: 'integer', minimum: 5, maximum: 600 },
          label: { type: 'string' }
        },
        required: ['day', 'time', 'minutes', 'label'],
        additionalProperties: false
      }
    }
  },
  required: ['summary', 'blocks'],
  additionalProperties: false
}

export type GenerateText = (prompt: string, opts?: CompleteOptions) => Promise<string>

async function defaultGenerateText(prompt: string, opts?: CompleteOptions): Promise<string> {
  const { generateText } = await import('./ai/registry')
  return generateText(prompt, opts)
}

export async function generatePlan(
  deadlines: Deadline[],
  stats: Stats,
  settings: Settings,
  generate: GenerateText = defaultGenerateText
): Promise<Result<StudyPlan>> {
  let text: string
  try {
    text = await generate(buildPrompt(deadlines, stats, settings, new Date()), {
      jsonSchema: PLAN_JSON_SCHEMA,
      maxTokens: 2048,
      timeoutMs: 180_000
    })
  } catch (e) {
    return { ok: false, error: (e as Error).message || String(e) }
  }
  try {
    const plan = parsePlan(text)
    console.log(`[bloop] plan generated: ${plan.blocks.length} blocks`)
    return { ok: true, value: plan }
  } catch (e) {
    return { ok: false, error: `The AI's answer wasn't a usable plan. Try again. (${(e as Error).message})` }
  }
}

/** Convert plan blocks to reminders (one per block, on that weekday). */
export function planToReminders(plan: StudyPlan): Reminder[] {
  return plan.blocks.map((b, i) => ({
    id: `plan-${plan.generatedAt.toString(36)}-${i}`,
    days: [b.day],
    time: b.time,
    label: `${b.label} (${b.minutes} min)`,
    enabled: true
  }))
}
