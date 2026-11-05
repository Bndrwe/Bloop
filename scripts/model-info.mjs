#!/usr/bin/env node
// Prints the Bloop model download info as JSON, read from src/main/ai/local/bloop.ts so the
// installers (install.sh / install.ps1) never carry their own copy of the URL, hash or size.
//
//   node scripts/model-info.mjs                 {"url":…,"sha256":…,"bytes":…,"file":…}
//   node scripts/model-info.mjs --field bytes   just that value, no quotes
//
// TEST ONLY: BLOOP_MODEL_URL_OVERRIDE, BLOOP_MODEL_SHA256_OVERRIDE and BLOOP_MODEL_BYTES_OVERRIDE
// replace the values (for testing the installer against a local server). They only take effect
// together with BLOOP_TEST_MODE=1, and a warning is printed to stderr when they do. Never set them normally.
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

/** Pulls the four catalog constants out of the TypeScript source text. Returns null if any is missing. */
export function parseModelInfo(src) {
  const str = (name) => {
    const m = src.match(new RegExp(`export const ${name}\\s*=\\s*\\n?\\s*'([^']*)'`))
    return m ? m[1] : null
  }
  const num = src.match(/export const BLOOP_MODEL_BYTES\s*=\s*([0-9_]+)/)
  const url = str('BLOOP_MODEL_URL')
  const sha256 = str('BLOOP_MODEL_SHA256')
  const file = str('BLOOP_MODEL_FILE')
  if (url == null || sha256 == null || file == null || !num) return null
  return { url, sha256, bytes: Number(num[1].replace(/_/g, '')), file }
}

/** Applies the test-only overrides from `env` (only when env.BLOOP_TEST_MODE === '1'). */
export function applyOverrides(info, env) {
  const out = { ...info }
  if (env.BLOOP_TEST_MODE !== '1') return out
  if (env.BLOOP_MODEL_URL_OVERRIDE) out.url = env.BLOOP_MODEL_URL_OVERRIDE
  if (env.BLOOP_MODEL_SHA256_OVERRIDE) out.sha256 = env.BLOOP_MODEL_SHA256_OVERRIDE
  if (env.BLOOP_MODEL_BYTES_OVERRIDE) out.bytes = Number(env.BLOOP_MODEL_BYTES_OVERRIDE)
  return out
}

function main() {
  const here = dirname(fileURLToPath(import.meta.url))
  const src = readFileSync(join(here, '..', 'src', 'main', 'ai', 'local', 'bloop.ts'), 'utf8')
  const parsed = parseModelInfo(src)
  if (!parsed) {
    console.error('model-info: could not read the model constants from src/main/ai/local/bloop.ts')
    process.exit(1)
  }
  const info = applyOverrides(parsed, process.env)
  if (process.env.BLOOP_TEST_MODE === '1' && (info.url !== parsed.url || info.sha256 !== parsed.sha256)) {
    console.error('model-info: WARNING test-mode overrides are active (BLOOP_TEST_MODE=1); the model will NOT come from the official source')
  }
  const i = process.argv.indexOf('--field')
  if (i > 0) {
    const v = info[process.argv[i + 1]]
    if (v == null) process.exit(2)
    console.log(String(v))
  } else {
    console.log(JSON.stringify(info))
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main()
