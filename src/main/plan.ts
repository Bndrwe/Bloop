// AI study plan. Generation goes through the AI registry (src/main/ai/registry.ts), which picks
// the user's provider: an Ollama model or a cloud provider. API keys (including
// the .env ANTHROPIC_API_KEY fallback, read by the cloud side) stay in the main process.
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import dotenv from 'dotenv'
import type { Deadline, PlanBlock, Reminder, Result, Settings, Stats, StudyPlan } from '@shared/types'
import { DEFAULT_SYSTEM_PROMPT } from '@shared/ai'
import type { CompleteOptions } from './ai/types'

export interface EnvDirsInput {
  packaged: boolean
  platform: NodeJS.Platform
  userData: string
  /** process.execPath */
  exePath: string
  /** dev only: the project root and the working directory */
  projectRoot?: string
  cwd?: string
  /** Linux AppImage: process.env.APPIMAGE (the .AppImage file itself, not the mount point) */
  appImage?: string
  /** Windows portable: process.env.PORTABLE_EXECUTABLE_FILE (the .exe, not the temp unpack dir) */
  portableExe?: string
}

/**
 * Where a `.env` may live, in priority order. A packaged app has no project folder (and its cwd is
 * `/` or wherever it was launched from), so it only looks in the user-data folder and in the
 * folder that holds the app: next to Bloop.app on macOS, next to Bloop.exe (or the portable .exe)
 * on Windows, next to the .AppImage (or the install dir) on Linux.
 */
export function envSearchDirs(i: EnvDirsInput): string[] {
  if (!i.packaged) return [...new Set([i.cwd, i.projectRoot, i.userData].filter((d): d is string => !!d))]
  let besideApp: string
  if (i.platform === 'darwin') {
    // .../Bloop.app/Contents/MacOS/Bloop -> folder containing Bloop.app
    const m = i.exePath.match(/^(.*?)[\\/][^\\/]+\.app[\\/]Contents[\\/]MacOS[\\/]/)
    besideApp = m?.[1] || dirname(i.exePath)
  } else if (i.platform === 'win32') besideApp = dirname(i.portableExe || i.exePath)
  else besideApp = dirname(i.appImage || i.exePath)
  return [...new Set([i.userData, besideApp])]
}

/** The only variable Bloop takes from a .env file (a .env next to the app may be untrusted). */
const ENV_KEYS = ['ANTHROPIC_API_KEY'] as const

let envLoaded = false
/**
 * Read ANTHROPIC_API_KEY from the first .env (in `dirs` order) that sets it, unless it is already
 * in the environment. Nothing else in the file is applied. Only the main process reads it: the
 * key never reaches a renderer.
 */
export function loadEnv(dirs: string[]): string[] {
  if (envLoaded) return []
  envLoaded = true
  const loaded: string[] = []
  for (const d of dirs) {
    const p = join(d, '.env')
    if (!existsSync(p)) continue
    let parsed: Record<string, string>
    try {
      parsed = dotenv.parse(readFileSync(p))
    } catch (e) {
      console.log(`[bloop] couldn't read ${p}: ${(e as Error).message}`)
      continue
    }
    for (const k of ENV_KEYS) {
      const v = parsed[k]?.trim()
      if (v && !process.env[k]) {
        process.env[k] = v
        loaded.push(p)
        console.log(`[bloop] ${k} loaded from ${p}`)
      }
    }
  }
  if (!loaded.length) console.log(`[bloop] no .env key loaded (looked in: ${dirs.join(', ')})`)
  return loaded
}

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

/** The plan prompt (the user message). Tests pin parts of this wording: don't change it casually. */
export function buildPrompt(deadlines: Deadline[], stats: Stats, settings: Settings, now: Date): string {
  const dl = deadlines.length
    ? deadlines
        .map((d) => `- ${String(d.summary).replace(/[\r\n]+/g, ' ').slice(0, 120)}${d.isExam ? ' (EXAM)' : ''}: ${new Date(d.start).toString()}`)
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

/** JSON schema the plan must follow (Ollama enforces it through its `format` option). */
export const PLAN_JSON_SCHEMA: Record<string, unknown> = {
  type: 'object',
  properties: {
    summary: { type: 'string' },
    blocks: {
      type: 'array',
      // The prompt asks for 3-10 blocks; the schema enforces it (small models otherwise stop after one).
      minItems: 3,
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
  generate: GenerateText = defaultGenerateText,
  /** The system prompt; default: DEFAULT_SYSTEM_PROMPT. */
  system?: string
): Promise<Result<StudyPlan>> {
  let text: string
  try {
    text = await generate(buildPrompt(deadlines, stats, settings, new Date()), {
      system: system ?? DEFAULT_SYSTEM_PROMPT,
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
