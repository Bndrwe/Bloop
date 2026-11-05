// Pure helpers of scripts/bundle-model.mjs.
import { describe, expect, it } from 'vitest'
// @ts-expect-error plain .mjs without types
import { buildMetadata, pickNewestGguf } from '../scripts/bundle-model.mjs'

describe('bundle-model helpers', () => {
  it('picks the newest bloop-*-Q4_K_M.gguf and ignores other files', () => {
    const pick = pickNewestGguf([
      { name: 'bloop-qwen3.5-0.8b-f16.gguf', mtimeMs: 900 },
      { name: 'bloop-qwen3.5-0.8b-Q4_K_M.gguf', mtimeMs: 100 },
      { name: 'bloop-v2-Q4_K_M.gguf', mtimeMs: 200 },
      { name: 'notes.txt', mtimeMs: 999 }
    ])
    expect(pick.name).toBe('bloop-v2-Q4_K_M.gguf')
    expect(pickNewestGguf([{ name: 'a.gguf', mtimeMs: 1 }])).toBeNull()
    expect(pickNewestGguf([])).toBeNull()
  })

  it('computes metadata', () => {
    expect(buildMetadata({ file: 'bloop-qwen3.5-0.8b-Q4_K_M.gguf', bytes: 5, sha256: 'ab', builtAt: 't' })).toEqual({
      file: 'bloop-qwen3.5-0.8b-Q4_K_M.gguf',
      bytes: 5,
      sha256: 'ab',
      base: 'Qwen3.5-0.8B',
      builtAt: 't'
    })
    expect(buildMetadata({ file: 'custom.gguf', bytes: 1, sha256: 'c' }).base).toBe('Qwen3.5-0.8B')
  })
})
