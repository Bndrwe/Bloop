// Security review v2, checks 4-5: the pet context-menu request is only accepted from the pet window
// with a strict argument shape; resolving a model never pulls anything.
import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ app: { getPath: () => '/tmp', isPackaged: false } }))
vi.mock('../src/main/store', () => ({ getAiSettings: () => ({}) }))
vi.mock('../src/main/ai/cloud', () => ({ cloudModule: null, setCloudModelsReader: () => undefined }))

import { DEFAULT_AI_SETTINGS } from '../src/shared/ai'
import { parsePetContextMenu } from '../src/main/petVisibility'
import { createRegistry } from '../src/main/ai/registry'
import type { LocalModule } from '../src/main/ai/types'

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

describe('resolving a model never pulls (check 5)', () => {
  it('with nothing installed, an Ollama choice resolves to a friendly error and no pull runs', async () => {
    const local = {
      status: vi.fn(async () => ({})),
      provider: vi.fn(async () => new Error('model not found: qwen3.5:0.8b')),
      autoProvider: vi.fn(async () => null),
      pullOllama: vi.fn(async () => ({ ok: false }))
    }
    const registry = createRegistry({
      local: local as unknown as LocalModule,
      cloud: null,
      getSettings: () => ({ ...DEFAULT_AI_SETTINGS, choice: { kind: 'local', runtime: 'ollama', model: 'qwen3.5:0.8b' }, autoCloud: [] })
    })
    expect(await registry.resolve()).toBeInstanceOf(Error)
    expect(await registry.resolve({ kind: 'auto' })).toBeInstanceOf(Error)
    expect(local.pullOllama).not.toHaveBeenCalled()
  })
})
