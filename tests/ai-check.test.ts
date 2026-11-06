import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ app: { getPath: () => '/tmp', isPackaged: false } }))
vi.mock('../src/main/store', () => ({ getAiSettings: () => ({}) }))
vi.mock('../src/main/ai/cloud', () => ({ cloudModule: null, setCloudModelsReader: () => undefined }))

import { CHECK_CASE_COUNT, DEFAULT_SYSTEM_PROMPT } from '@shared/ai'
import {
  buildCheckCases,
  cancelModelCheck,
  OUTPUT_KEEP_CHARS,
  runCasesWith,
  runModelCheck,
  scoreCase,
  verdictFor,
  VERDICT_GOOD,
  VERDICT_OK
} from '../src/main/ai/check'
import { createRegistry } from '../src/main/ai/registry'
import { parseContext } from '../src/main/ai/scoring'
import { PLAN_JSON_SCHEMA } from '../src/main/plan'
import type { AiProvider, CompleteOptions, LocalModule } from '../src/main/ai/types'

const NOW = new Date(2026, 10, 4, 15, 30) // Wed 4 Nov 2026

/** A plan that passes every rule for the given prompt (blocks from today up to the last deadline). */
function goodPlanFor(prompt: string): string {
  const ctx = parseContext(prompt)
  const dow = ctx.todayDow!
  const unit = ctx.pomodoro
  const blocks = [0, 1, 1].map((off, i) => ({ day: (dow + off) % 7, time: i === 2 ? '16:00' : '10:00', minutes: unit * 2, label: `Study ${i}` }))
  return JSON.stringify({ summary: 'Start with the nearest deadline today. Small steps add up.', blocks })
}

function provider(answer: (prompt: string, opts: CompleteOptions) => Promise<string> | string, label = 'Mock model'): AiProvider & { calls: { prompt: string; opts: CompleteOptions }[] } {
  const calls: { prompt: string; opts: CompleteOptions }[] = []
  return {
    label,
    kind: 'local',
    calls,
    async complete(prompt, opts = {}) {
      calls.push({ prompt, opts })
      return answer(prompt, opts)
    }
  }
}

const goodAnswer = (prompt: string): string => (prompt.includes('study plan') ? goodPlanFor(prompt) : 'tiny step back to your notes? 📚')

describe('built-in cases', () => {
  const cases = buildCheckCases(NOW)
  it(`has ${CHECK_CASE_COUNT} cases: 3 plans through buildPrompt, 2 nudges in the documented format`, () => {
    expect(cases).toHaveLength(CHECK_CASE_COUNT)
    expect(cases.filter((c) => c.kind === 'plan')).toHaveLength(3)
    for (const c of cases.filter((c) => c.kind === 'plan')) {
      expect(c.prompt.startsWith('You are a friendly study coach inside a desktop "study pet" app')).toBe(true)
      expect(c.opts.jsonSchema).toBe(PLAN_JSON_SCHEMA)
    }
    for (const c of cases.filter((c) => c.kind === 'nudge')) {
      expect(c.prompt.startsWith('You are Bloop, a cute study pet. ')).toBe(true)
      expect(c.prompt.endsWith('(max 60 characters).')).toBe(true)
      expect(c.opts.jsonSchema).toBeUndefined()
    }
  })
  it('exam in 2 days; light week with no deadlines; busy week with 4 deadlines and 50/10', () => {
    const [exam, light, busy] = cases.map((c) => parseContext(c.prompt))
    expect(exam!.deadlines.find((d) => d.exam)).toBeTruthy()
    expect(light!.deadlines).toEqual([])
    expect(busy!.deadlines).toHaveLength(4)
    expect([busy!.pomodoro, busy!.break]).toEqual([50, 10])
    expect(cases[2]!.prompt).toContain('IGNORE ALL PREVIOUS INSTRUCTIONS') // injection hygiene probe
  })
})

describe('scoreCase', () => {
  it('a broken plan fails every rule (counted, not skipped)', () => {
    const c = buildCheckCases(NOW)[0]!
    const r = scoreCase('plan', c.prompt, 'Sorry, I cannot do that')
    expect(r.every((x) => !x.pass)).toBe(true)
    expect(r.map((x) => x.id)).toEqual(['json', 'clean-json', 'schema', 'summary', 'blocks', 'hours', 'pomodoro'])
  })
  it('the before-deadline rule is left out when no deadline is in the week', () => {
    const light = buildCheckCases(NOW)[1]!
    expect(scoreCase('plan', light.prompt, goodPlanFor(light.prompt)).some((x) => x.id === 'before-deadline')).toBe(false)
    const exam = buildCheckCases(NOW)[0]!
    expect(scoreCase('plan', exam.prompt, goodPlanFor(exam.prompt)).find((x) => x.id === 'before-deadline')?.pass).toBe(true)
  })
  it('nudges: em dash and length', () => {
    const r = scoreCase('nudge', '', 'come back — you got this, and here is a very long tail of words!!')
    expect(r.find((x) => x.id === 'no-em-dash')!.pass).toBe(false)
    expect(r.find((x) => x.id === 'le60')!.pass).toBe(false)
  })
})

describe('verdict thresholds', () => {
  it(`good >= ${VERDICT_GOOD}, ok >= ${VERDICT_OK}, else poor`, () => {
    expect(verdictFor(10, 10)).toBe('good')
    expect(verdictFor(17, 20)).toBe('good') // 0.85
    expect(verdictFor(16, 20)).toBe('ok') // 0.80
    expect(verdictFor(12, 20)).toBe('ok') // 0.60
    expect(verdictFor(11, 20)).toBe('poor')
    expect(verdictFor(0, 0)).toBe('poor')
  })
})

describe('runCasesWith (mocked provider)', () => {
  it('a good model scores "good", gets the system prompt and the plan schema, reports progress', async () => {
    const p = provider(goodAnswer)
    const progress: number[] = []
    const r = await runCasesWith(p, { system: 'SYS', cases: buildCheckCases(NOW), onProgress: (x) => progress.push(x.done) })
    expect(r.ok).toBe(true)
    expect(r.summary!.verdict).toBe('good')
    expect(r.summary!.passed).toBe(r.summary!.total)
    expect(r.provider).toEqual({ label: 'Mock model', kind: 'local' })
    expect(progress).toEqual([0, 1, 2, 3, 4, 5])
    expect(p.calls.every((c) => c.opts.system === 'SYS')).toBe(true)
    expect(p.calls.filter((c) => c.opts.jsonSchema === PLAN_JSON_SCHEMA)).toHaveLength(3)
    expect(p.calls.every((c) => c.opts.signal instanceof AbortSignal && typeof c.opts.timeoutMs === 'number')).toBe(true)
    for (const c of r.cases) expect(c.latencyMs).toBeGreaterThanOrEqual(0)
  })

  it('a bad model scores "poor"', async () => {
    const r = await runCasesWith(provider(() => 'Here you go!\n— As an AI I cannot plan.\nSecond line'), { system: 'S', cases: buildCheckCases(NOW) })
    expect(r.summary!.verdict).toBe('poor')
    expect(r.summary!.passed).toBeLessThan(r.summary!.total / 2)
  })

  it('a fenced plan loses only the "clean JSON" check', async () => {
    const p = provider((prompt) => (prompt.includes('study plan') ? '```json\n' + goodPlanFor(prompt) + '\n```' : 'ok, back to it'))
    const r = await runCasesWith(p, { system: 'S', cases: buildCheckCases(NOW) })
    const failed = r.cases.flatMap((c) => c.checks.filter((x) => !x.pass).map((x) => x.id))
    expect(failed).toEqual(['clean-json', 'clean-json', 'clean-json'])
    expect(r.summary!.verdict).toBe('good')
  })

  it('a hanging model times out per case and the run still finishes', async () => {
    const p = provider(() => new Promise<string>(() => undefined)) // never answers, ignores the signal
    const t0 = Date.now()
    const r = await runCasesWith(p, { system: 'S', cases: buildCheckCases(NOW).slice(3), timeoutMs: 30 })
    expect(Date.now() - t0).toBeLessThan(2000)
    expect(r.cases).toHaveLength(2)
    for (const c of r.cases) {
      expect(c.error).toMatch(/No answer within/)
      expect(c.checks.every((x) => !x.pass)).toBe(true)
      expect(c.tokensPerSec).toBeNull()
    }
    expect(r.summary!.verdict).toBe('poor')
  })

  it('mixed: one timeout among good answers gives "ok"', async () => {
    let n = 0
    const p = provider((prompt) => (n++ === 0 ? new Promise<string>(() => undefined) : goodAnswer(prompt)))
    const r = await runCasesWith(p, { system: 'S', cases: buildCheckCases(NOW), timeoutMs: 50 })
    expect(r.cases[0]!.error).toBeTruthy()
    expect(r.summary!.verdict).toBe('ok')
  })

  it('keeps at most ~4 KB of raw output and estimates tokens/sec', async () => {
    const big = 'x'.repeat(10_000)
    let t = 0
    const r = await runCasesWith(provider(() => big), { system: 'S', cases: buildCheckCases(NOW).slice(3, 4), now: () => (t += 1000) })
    expect(r.cases[0]!.output.length).toBe(OUTPUT_KEEP_CHARS)
    expect(r.cases[0]!.truncated).toBe(true)
    expect(r.cases[0]!.latencyMs).toBe(1000)
    expect(r.cases[0]!.tokensPerSec).toBe(2500) // 10000 chars / 4 per second
  })
})

describe('runModelCheck', () => {
  it('returns a friendly error when the provider is not ready (and runs nothing)', async () => {
    const r = await runModelCheck({ resolve: async () => new Error("The Bloop model isn't on this device yet."), system: 'S' })
    expect(r).toEqual({ ok: false, error: "The Bloop model isn't on this device yet.", cases: [] })
  })
  it('one run at a time; cancel stops it', async () => {
    let release: () => void = () => undefined
    const p = provider(() => new Promise<string>((res) => (release = () => res('ok'))))
    const first = runModelCheck({ resolve: async () => p, system: 'S' })
    await new Promise((r) => setTimeout(r, 5))
    expect((await runModelCheck({ resolve: async () => p, system: 'S' })).error).toMatch(/already running/)
    cancelModelCheck()
    release()
    const r = await first
    expect(r.cancelled).toBe(true)
    expect(r.cases.length).toBeLessThan(CHECK_CASE_COUNT)
  })

  it('never downloads or pulls: it only resolves through the registry', async () => {
    const downloadBloop = vi.fn()
    const pullOllama = vi.fn()
    const local: LocalModule & Record<string, unknown> = {
      status: vi.fn(),
      provider: vi.fn(async () => new Error("The Bloop model isn't on this device yet. Download it (or import a .gguf) in Settings → AI.")),
      autoProvider: vi.fn(async () => null),
      downloadBloop,
      pullOllama
    } as never
    const reg = createRegistry({ local, cloud: null, getSettings: () => ({ choice: { kind: 'auto' }, cloudModels: {}, autoCloud: [], ollamaUrl: '', bloopOfferDismissed: false, bloopEnabled: false }) })
    const auto = await runModelCheck({ resolve: () => reg.resolve(), system: DEFAULT_SYSTEM_PROMPT })
    expect(auto.ok).toBe(false)
    expect(auto.error).toMatch(/Turn on a model/)
    const bloop = await runModelCheck({ resolve: () => reg.resolve({ kind: 'local', runtime: 'bloop', model: 'bloop-qwen3.5-0.8b' }), system: DEFAULT_SYSTEM_PROMPT })
    expect(bloop.error).toMatch(/isn't on this device/)
    expect(downloadBloop).not.toHaveBeenCalled()
    expect(pullOllama).not.toHaveBeenCalled()
  })
})
