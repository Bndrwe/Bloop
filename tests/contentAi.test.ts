import { describe, expect, it, vi } from 'vitest'
import { AiJudge, buildJudgePrompt, JUDGE_JSON_SCHEMA, parseJudgeReply, pickJudgeProvider, type PersistedJudgeCache } from '../src/main/contentAi'
import type { AiProvider, CompleteOptions } from '../src/main/ai/types'
import { DEFAULT_SETTINGS } from '../src/main/defaults'

function mockProvider(kind: 'local' | 'cloud', reply: string | ((prompt: string) => string) = '{"study": true, "reason": "chemistry lecture"}') {
  const calls: { prompt: string; opts?: CompleteOptions }[] = []
  let release: (() => void) | null = null
  let hold = false
  const p: AiProvider = {
    label: kind === 'local' ? 'Ollama · qwen3.5:0.8b' : 'Claude CLI',
    kind,
    complete: vi.fn(async (prompt: string, opts?: CompleteOptions) => {
      calls.push({ prompt, opts })
      if (hold) await new Promise<void>((r) => (release = r))
      return typeof reply === 'function' ? reply(prompt) : reply
    })
  }
  return {
    p,
    calls,
    holdNext: () => (hold = true),
    release: () => {
      hold = false
      release?.()
    }
  }
}

const REQ = { domain: 'youtube.com', title: 'SN1 vs SN2 in 10 minutes', courses: ['CHEM 201 Organic Chemistry'] }

describe('buildJudgePrompt / parseJudgeReply', () => {
  it('contains only the site, the title and the course names', () => {
    const prompt = buildJudgePrompt({ domain: 'youtube.com', title: 'A "quoted"\ntitle', courses: ['CHEM 201 Organic Chemistry', 'HIST 110'] })
    expect(prompt).toContain('Site: youtube.com')
    expect(prompt).toContain('Page title: "A \\"quoted\\" title"')
    expect(prompt).toContain("Student's courses: CHEM 201 Organic Chemistry; HIST 110")
    expect(prompt).not.toMatch(/https?:|watch\?v=/)
  })
  it('the schema asks for study + a short reason', () => {
    expect(JUDGE_JSON_SCHEMA).toMatchObject({ required: ['study', 'reason'], properties: { reason: { maxLength: 60 } } })
  })
  it('parses JSON, also with extra text, and trims the reason to 60 chars', () => {
    expect(parseJudgeReply('{"study": false, "reason": "gameplay"}')).toEqual({ study: false, reason: 'gameplay' })
    expect(parseJudgeReply('Sure! ```json\n{"study": true, "reason": "lecture"}\n```')).toEqual({ study: true, reason: 'lecture' })
    expect(parseJudgeReply(`{"study": true, "reason": "${'x'.repeat(100)}"}`)?.reason).toHaveLength(60)
    expect(parseJudgeReply('{"study": "yes"}')).toBeNull()
    expect(parseJudgeReply('no idea')).toBeNull()
  })
})

describe('pickJudgeProvider (Option A / Option B)', () => {
  it('cloud judging is on by default; page text reading is off', () => {
    expect(DEFAULT_SETTINGS.cloudJudge).toBe(true)
    expect(DEFAULT_SETTINGS.readPageText).toBe(false)
  })
  it('Auto with a cloud provider and cloudJudge off: no provider, nothing resolved or sent', async () => {
    const cloud = mockProvider('cloud')
    const resolve = vi.fn(async () => cloud.p)
    expect(await pickJudgeProvider({ choice: { kind: 'auto' }, cloudJudge: false, resolve })).toBeNull()
    expect(resolve).not.toHaveBeenCalled()
    expect(cloud.p.complete).not.toHaveBeenCalled()
  })
  it('Auto with cloudJudge on uses the cloud provider', async () => {
    const cloud = mockProvider('cloud')
    expect(await pickJudgeProvider({ choice: { kind: 'auto' }, cloudJudge: true, resolve: async () => cloud.p })).toBe(cloud.p)
  })
  it('an Ollama pick is used without Option B (stays on the computer)', async () => {
    const local = mockProvider('local')
    const choice = { kind: 'local' as const, runtime: 'ollama' as const, model: 'qwen3.5:0.8b' }
    expect(await pickJudgeProvider({ choice, cloudJudge: false, resolve: async () => local.p })).toBe(local.p)
  })
  it('nothing ready: null', async () => {
    expect(await pickJudgeProvider({ choice: { kind: 'auto' }, cloudJudge: true, resolve: async () => new Error('no AI') })).toBeNull()
  })
})

describe('AiJudge', () => {
  function setup(opts: { provider?: AiProvider | null; load?: PersistedJudgeCache | null; max?: number } = {}) {
    let now = 1_000_000
    const saved: PersistedJudgeCache[] = []
    const judge = new AiJudge({
      provider: async () => (opts.provider === undefined ? null : opts.provider),
      now: () => now,
      load: () => opts.load ?? null,
      save: (c) => saved.push(JSON.parse(JSON.stringify(c))),
      max: opts.max
    })
    return { judge, saved, tick: (ms: number) => (now += ms), now: () => now }
  }

  it('asks once, caches the answer, and sends only the allowed fields', async () => {
    const m = mockProvider('local')
    const { judge } = setup({ provider: m.p })
    expect(judge.request('k1', REQ)).toBe('started')
    expect(judge.lookup('k1')).toBeUndefined() // never blocks: no answer yet
    await judge.whenIdle()
    expect(judge.lookup('k1')).toEqual({ study: true, reason: 'chemistry lecture' })
    expect(judge.request('k1', REQ)).toBe('cached')
    expect(m.calls).toHaveLength(1)
    expect(m.calls[0]?.prompt).toBe(buildJudgePrompt(REQ))
    expect(m.calls[0]?.opts?.jsonSchema).toBe(JUDGE_JSON_SCHEMA)
  })

  it('at most one call in flight', async () => {
    const m = mockProvider('local')
    m.holdNext()
    const { judge, tick } = setup({ provider: m.p })
    expect(judge.request('a', REQ)).toBe('started')
    tick(60_000)
    expect(judge.request('a', REQ)).toBe('pending')
    expect(judge.request('b', REQ)).toBe('busy')
    await Promise.resolve()
    await Promise.resolve()
    m.release()
    await judge.whenIdle()
    expect(m.calls).toHaveLength(1)
  })

  it('no more than one call every 10 s', async () => {
    const m = mockProvider('local')
    const { judge, tick } = setup({ provider: m.p })
    judge.request('a', REQ)
    await judge.whenIdle()
    tick(5_000)
    expect(judge.request('b', REQ)).toBe('wait')
    tick(5_000)
    expect(judge.request('b', REQ)).toBe('started')
    await judge.whenIdle()
    expect(m.calls).toHaveLength(2)
  })

  it('no provider: nothing is called, and it is not counted as a call', async () => {
    const { judge, tick } = setup({ provider: null })
    expect(judge.request('a', REQ)).toBe('started')
    await judge.whenIdle()
    expect(judge.lookup('a')).toBeUndefined()
    expect(judge.request('a', REQ)).toBe('wait') // backs off for 30 s
    tick(31_000)
    expect(judge.request('a', REQ)).toBe('started')
  })

  it('a failed or unusable answer backs off that page for 5 minutes', async () => {
    const m = mockProvider('local', 'I think so?')
    const { judge, tick } = setup({ provider: m.p })
    judge.request('a', REQ)
    await judge.whenIdle()
    expect(judge.lookup('a')).toBeUndefined()
    tick(11_000)
    expect(judge.request('a', REQ)).toBe('wait')
    tick(5 * 60_000)
    expect(judge.request('a', REQ)).toBe('started')
  })

  it('LRU: keeps the newest `max` answers', async () => {
    const m = mockProvider('local')
    const { judge, tick } = setup({ provider: m.p, max: 2 })
    for (const k of ['a', 'b', 'c']) {
      judge.request(k, REQ)
      await judge.whenIdle()
      tick(10_000)
    }
    expect(judge.size).toBe(2)
    expect(judge.lookup('a')).toBeUndefined()
    expect(judge.lookup('c')).toBeDefined()
  })

  it('persists hashed keys and reloads them, dropping entries older than 30 days', async () => {
    const m = mockProvider('local')
    const first = setup({ provider: m.p })
    first.judge.request('youtube.com|organic chemistry lecture', REQ)
    await first.judge.whenIdle()
    const persisted = first.saved.at(-1) as PersistedJudgeCache
    expect(JSON.stringify(persisted)).not.toContain('organic')
    const second = setup({ provider: null, load: persisted })
    expect(second.judge.lookup('youtube.com|organic chemistry lecture')).toEqual({ study: true, reason: 'chemistry lecture' })
    const stale: PersistedJudgeCache = { v: 1, entries: persisted.entries.map(([k, a, at]) => [k, a, at - 31 * 86_400_000]) }
    expect(setup({ load: stale }).judge.size).toBe(0)
  })
})
