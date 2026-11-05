// scripts/model-info.mjs: the installers read the model constants from bloop.ts through it.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { BLOOP_MODEL_BYTES, BLOOP_MODEL_FILE, BLOOP_MODEL_SHA256, BLOOP_MODEL_URL } from '../src/main/ai/local/bloop'
// @ts-expect-error plain .mjs without types
import { applyOverrides, parseModelInfo } from '../scripts/model-info.mjs'

describe('model-info', () => {
  it('reads exactly what bloop.ts exports', () => {
    const src = readFileSync(join(__dirname, '..', 'src/main/ai/local/bloop.ts'), 'utf8')
    expect(parseModelInfo(src)).toEqual({
      url: BLOOP_MODEL_URL,
      sha256: BLOOP_MODEL_SHA256,
      bytes: BLOOP_MODEL_BYTES,
      file: BLOOP_MODEL_FILE
    })
  })
  it('returns null when a constant is missing', () => {
    expect(parseModelInfo("export const BLOOP_MODEL_URL = 'x'")).toBeNull()
  })
  it('applies the test-only overrides', () => {
    const base = { url: 'u', sha256: 's', bytes: 5, file: 'f' }
    expect(applyOverrides(base, {})).toEqual(base)
    // ignored unless BLOOP_TEST_MODE=1, so a stray env var can't redirect a real install
    expect(applyOverrides(base, { BLOOP_MODEL_URL_OVERRIDE: 'http://x', BLOOP_MODEL_BYTES_OVERRIDE: '9' })).toEqual(base)
    expect(applyOverrides(base, { BLOOP_TEST_MODE: '1', BLOOP_MODEL_URL_OVERRIDE: 'http://x', BLOOP_MODEL_BYTES_OVERRIDE: '9' })).toEqual({
      url: 'http://x', sha256: 's', bytes: 9, file: 'f'
    })
  })
})

// What the installers leave on disk must read as a downloaded (not imported, not bundled) model that is still off.
describe('installer-placed model file', () => {
  it('shows as downloaded with source "downloaded", and enabled stays false', async () => {
    const { mkdtempSync, mkdirSync, writeFileSync } = await import('node:fs')
    const { tmpdir } = await import('node:os')
    const { BloopManager } = await import('../src/main/ai/local/bloop')
    const home = mkdtempSync(join(tmpdir(), 'bloop-inst-'))
    const models = join(home, '.config', 'bloop', 'models') // Linux: $XDG_CONFIG_HOME/bloop or ~/.config/bloop
    mkdirSync(models, { recursive: true })
    writeFileSync(join(models, BLOOP_MODEL_FILE), 'GGUF')
    const m = new BloopManager({ modelsDir: () => models })
    const s = m.status()
    expect(s.downloaded).toBe(true)
    expect(s.source).toBe('downloaded')
    expect(s.enabled).toBe(false)
    expect(s.path).toBe(join(models, BLOOP_MODEL_FILE))
  })
})
