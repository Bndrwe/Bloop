// Security review v2, checks 4-5: the pet context-menu request is only accepted from the pet window
// with a strict argument shape; Check model and Try a prompt enforce their caps in main and never
// download or pull anything.
import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ app: { getPath: () => '/tmp', isPackaged: false } }))
vi.mock('../src/main/store', () => ({ getAiSettings: () => ({}) }))
vi.mock('../src/main/ai/cloud', () => ({ cloudModule: null, setCloudModelsReader: () => undefined }))

import { DEFAULT_AI_SETTINGS, DEFAULT_SYSTEM_PROMPT, SYSTEM_PROMPT_MAX, TRY_PROMPT_MAX } from '../src/shared/ai'
import { parsePetContextMenu } from '../src/main/petVisibility'
import { OUTPUT_KEEP_CHARS, runModelCheck, tryPrompt } from '../src/main/ai/check'
import { createRegistry } from '../src/main/ai/registry'
import { validateSystemPrompt } from '../src/main/ai/settings'
import type { AiProvider, LocalModule } from '../src/main/ai/types'

const PET = true
const OTHER = false

describe('pet:context-menu accepts requests only from the pet window (check 4)', () => {
  it('rejects every request that is not from the pet window, even with a valid point', () => {
    expect(parsePetContextMenu(OTHER, [{ x: 10, y: 20 }])).toBeNull()
    expect(parsePetContextMenu(OTHER, [])).toBeNull()
    expect(parsePetContextMenu(OTHER, [null])).toBeNull()
  })

  it('accepts the pet window with no point, or a small finite point, rounding it to integers', () => {
    expect(parsePetContextMenu(PET, [])).toEqual({})
    expect(parsePetContextMenu(PET, [undefined])).toEqual({})
    expect(parsePetContextMenu(PET, [{ x: 10.4, y: 19.6 }])).toEqual({ x: 10, y: 20 })
    expect(parsePetContextMenu(PET, [{ x: -5, y: 0 }])).toEqual({ x: -5, y: 0 })
  })

  it.each([
    ['a string', ['10,20']],
    ['an array', [[10, 20]]],
    ['a number', [10]],
    ['extra keys', [{ x: 1, y: 2, evil: true }]],
    ['missing y', [{ x: 1 }]],
    ['a string coordinate', [{ x: '1', y: '2' }]],
    ['NaN', [{ x: Number.NaN, y: 1 }]],
    ['Infinity', [{ x: 1, y: Number.POSITIVE_INFINITY }]],
    ['out of range', [{ x: 10_001, y: 0 }]],
    ['far negative', [{ x: 0, y: -10_001 }]],
    ['two arguments', [{ x: 1, y: 2 }, { x: 3, y: 4 }]]
  ])('rejects %s from the pet window', (_name, args) => {
    expect(parsePetContextMenu(PET, args as unknown[])).toBeNull()
  })

  // Found in review: when the first argument is null/undefined the function returns {} before it
  // checks the argument count, so a second argument is silently accepted. Harmless (the extra value
  // is ignored and the menu has no inputs from it), but it is not the strict shape the rest enforces.
  it('rejects a trailing argument even when the first one is null (currently accepted as {})', () => {
    expect(parsePetContextMenu(PET, [null, 'extra'])).toBeNull()
  })
})

describe('Try a prompt caps are enforced in main (check 5)', () => {
  const provider = (complete: (p: string, o?: unknown) => Promise<string>): AiProvider => ({ label: 'Test', kind: 'local', complete })

  it('a prompt over TRY_PROMPT_MAX is refused before any model is resolved', async () => {
    const resolve = vi.fn(async () => provider(async () => 'x'))
    const r = await tryPrompt(resolve, 'a'.repeat(TRY_PROMPT_MAX + 1), undefined)
    expect(r.ok).toBe(false)
    expect(resolve).not.toHaveBeenCalled()
  })

  it('a prompt of exactly TRY_PROMPT_MAX characters goes through', async () => {
    const complete = vi.fn(async () => 'ok')
    const r = await tryPrompt(async () => provider(complete), 'a'.repeat(TRY_PROMPT_MAX), undefined)
    expect(r.ok).toBe(true)
    expect(complete).toHaveBeenCalledTimes(1)
  })

  it.each([undefined, null, 42, { text: 'hi' }, ['hi'], '   '])('refuses non-text or blank input (%j)', async (text) => {
    const resolve = vi.fn(async () => provider(async () => 'x'))
    const r = await tryPrompt(resolve, text, undefined)
    expect(r.ok).toBe(false)
    expect(resolve).not.toHaveBeenCalled()
  })

  it('a model reply is cut to OUTPUT_KEEP_CHARS and marked truncated', async () => {
    const r = await tryPrompt(async () => provider(async () => 'b'.repeat(OUTPUT_KEEP_CHARS + 500)), 'hi', undefined)
    expect(r.ok).toBe(true)
    expect(r.ok && r.text?.length).toBe(OUTPUT_KEEP_CHARS)
    expect(r.ok && r.truncated).toBe(true)
  })

  it('a custom system prompt over SYSTEM_PROMPT_MAX is dropped, one at the cap is kept', () => {
    expect(validateSystemPrompt('s'.repeat(SYSTEM_PROMPT_MAX + 1))).toBeUndefined()
    expect(validateSystemPrompt('s'.repeat(SYSTEM_PROMPT_MAX))).toBe('s'.repeat(SYSTEM_PROMPT_MAX))
    expect(validateSystemPrompt(DEFAULT_SYSTEM_PROMPT)).toBeUndefined()
  })

  it('Check model runs one at a time; a second click is refused while one is running', async () => {
    let release!: (e: Error) => void
    const pending = new Promise<Error>((r) => (release = r))
    const first = runModelCheck({ resolve: () => pending.then((e) => e as unknown as AiProvider), system: DEFAULT_SYSTEM_PROMPT })
    const second = await runModelCheck({ resolve: async () => new Error('not used'), system: DEFAULT_SYSTEM_PROMPT })
    expect(second.ok).toBe(false)
    expect(second.error).toMatch(/already running/)
    release(new Error('no model'))
    const done = await first
    expect(done.ok).toBe(false)
  })
})

describe('Check model and Try a prompt never download or pull (check 5)', () => {
  it('with nothing installed, both paths resolve to a friendly error and call no download or pull', async () => {
    const local = {
      status: vi.fn(async () => ({})),
      provider: vi.fn(async () => new Error('The Bloop model is not on this device yet.')),
      autoProvider: vi.fn(async () => null),
      downloadBloop: vi.fn(async () => ({ ok: false })),
      pullOllama: vi.fn(async () => ({ ok: false })),
      importBloop: vi.fn(async () => ({ ok: false })),
      verifyBloop: vi.fn(async () => ({ ok: false }))
    }
    const registry = createRegistry({
      local: local as unknown as LocalModule,
      cloud: null,
      getSettings: () => ({ ...DEFAULT_AI_SETTINGS, choice: { kind: 'local', runtime: 'bloop', model: 'bloop-qwen3.5-0.8b' }, autoCloud: [] }) as never
    })
    const check = await runModelCheck({ resolve: () => registry.resolve(), system: DEFAULT_SYSTEM_PROMPT })
    expect(check.ok).toBe(false)
    const tried = await tryPrompt(() => registry.resolve(), 'hello', undefined)
    expect(tried.ok).toBe(false)
    expect(local.downloadBloop).not.toHaveBeenCalled()
    expect(local.pullOllama).not.toHaveBeenCalled()
    expect(local.importBloop).not.toHaveBeenCalled()
  })
})
