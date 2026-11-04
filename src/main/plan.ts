// AI study plan (stretch). The API key lives only in the main process (loaded from .env) and is
// never sent to the renderer.
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import Anthropic from '@anthropic-ai/sdk'
import dotenv from 'dotenv'
import type { Deadline, PlanBlock, Reminder, Result, Settings, Stats, StudyPlan } from '@shared/types'

/** Model used for plan generation — change here. */
export const PLAN_MODEL = 'claude-sonnet-5-5'

let envLoaded = false
/** Load .env from the given directories (first match wins for each var; existing env vars are kept). */
export function loadEnv(dirs: string[]): void {
  if (envLoaded) return
  envLoaded = true
  for (const d of dirs) {
    const p = join(d, '.env')
    if (existsSync(p)) {
      dotenv.config({ path: p, quiet: true } as dotenv.DotenvConfigOptions)
      console.log(`[studypet] loaded env from ${p}`)
    }
  }
}

export function hasApiKey(): boolean {
  return Boolean(process.env['ANTHROPIC_API_KEY']?.trim())
}

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

function buildPrompt(deadlines: Deadline[], stats: Stats, settings: Settings, now: Date): string {
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

export async function generatePlan(deadlines: Deadline[], stats: Stats, settings: Settings): Promise<Result<StudyPlan>> {
  if (!hasApiKey()) {
    return { ok: false, error: 'No ANTHROPIC_API_KEY set in .env — add one to the project folder (or app folder) and restart Study Pet.' }
  }
  try {
    const client = new Anthropic({ apiKey: process.env['ANTHROPIC_API_KEY'] })
    const res = await client.beta.messages.create({
      model: PLAN_MODEL,
      max_tokens: 16000,
      output_config: { effort: 'low' },
      // server-side refusal fallback (routes declined requests to another model automatically)
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      messages: [{ role: 'user', content: buildPrompt(deadlines, stats, settings, new Date()) }]
    })
    if (res.stop_reason === 'refusal') return { ok: false, error: 'The model declined to make a plan. Try again later.' }
    const text = res.content.map((b) => (b.type === 'text' ? b.text : '')).join('')
    const plan = parsePlan(text)
    console.log(`[studypet] plan generated: ${plan.blocks.length} blocks`)
    return { ok: true, value: plan }
  } catch (e) {
    if (e instanceof Anthropic.AuthenticationError) return { ok: false, error: 'Your ANTHROPIC_API_KEY was rejected. Check the key in .env.' }
    if (e instanceof Anthropic.RateLimitError) return { ok: false, error: 'Rate limited by the API — try again in a minute.' }
    if (e instanceof Anthropic.APIError) return { ok: false, error: `API error ${e.status ?? ''}: ${e.message}` }
    return { ok: false, error: `Couldn't generate a plan: ${(e as Error).message}` }
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
