#!/usr/bin/env node
// Copies the fine-tuned Bloop GGUF into resources/models/ so electron-builder ships it inside the app
// (extraResources: resources/** -> <resourcesPath>/resources/**). Also writes bloop-model.json
// ({file, bytes, sha256, base, builtAt}) next to it, which the app uses to show info and verify the file.
//
//   npm run model:bundle                      newest ml/out/bloop-*-Q4_K_M.gguf
//   npm run model:bundle -- path/to/x.gguf    a specific file
//   node scripts/bundle-model.mjs --check     only warn if no model is bundled (used by `npm run build`)
import { createHash } from 'node:crypto'
import { closeSync, copyFileSync, createReadStream, existsSync, mkdirSync, openSync, readdirSync, readSync, statSync, writeFileSync } from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export const META_FILE = 'bloop-model.json'
export const DEFAULT_BASE = 'Qwen3.5-0.8B'

/** Newest (by mtime) bloop-*-Q4_K_M.gguf among `entries` ({name, mtimeMs}), or null. */
export function pickNewestGguf(entries) {
  const re = /^bloop-.*-Q4_K_M\.gguf$/i
  const hits = entries.filter((e) => re.test(e.name)).sort((a, b) => b.mtimeMs - a.mtimeMs || (a.name < b.name ? 1 : -1))
  return hits[0] ?? null
}

/** The bloop-model.json payload. `base` is guessed from the file name (bloop-qwen3.5-0.8b-... -> Qwen3.5-0.8B). */
export function buildMetadata({ file, bytes, sha256, builtAt = new Date().toISOString() }) {
  const m = /^bloop-(qwen[\d.]+-[\d.]+b)-/i.exec(file)
  const base = m ? m[1].replace(/^qwen/i, 'Qwen').replace(/b$/i, 'B') : DEFAULT_BASE
  return { file, bytes, sha256, base, builtAt }
}

export function sha256File(path) {
  return new Promise((res, rej) => {
    const h = createHash('sha256')
    createReadStream(path).on('data', (c) => h.update(c)).on('error', rej).on('end', () => res(h.digest('hex')))
  })
}

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const mb = (n) => `${(n / 1024 / 1024).toFixed(1)} MB`

async function main(argv) {
  const dest = join(root, 'resources', 'models')
  if (argv.includes('--check')) {
    const has = existsSync(dest) && readdirSync(dest).some((f) => /\.gguf$/i.test(f))
    if (has) console.log('[bundle-model] a Bloop model is bundled; it will ship inside the app (off until the user turns it on).')
    else console.warn('[bundle-model] WARNING: no .gguf in resources/models/. This build will not include the Bloop model (users can still Import .gguf). Run `npm run model:bundle` first to include it.')
    return
  }
  const arg = argv.find((a) => !a.startsWith('-'))
  let src
  if (arg) src = resolve(arg)
  else {
    const out = join(root, 'ml', 'out')
    const entries = existsSync(out) ? readdirSync(out).map((name) => ({ name, mtimeMs: statSync(join(out, name)).mtimeMs })) : []
    const pick = pickNewestGguf(entries)
    if (!pick) throw new Error('No ml/out/bloop-*-Q4_K_M.gguf found. Train one with `npm run model:train`, or pass a path: npm run model:bundle -- /path/to/model.gguf')
    src = join(out, pick.name)
  }
  if (!existsSync(src)) throw new Error(`Not found: ${src}`)
  const head = Buffer.alloc(4)
  const fd = openSync(src, 'r')
  readSync(fd, head, 0, 4, 0)
  closeSync(fd)
  if (head.toString('latin1') !== 'GGUF') throw new Error(`${src} is not a GGUF file.`)

  mkdirSync(dest, { recursive: true })
  const file = basename(src)
  console.log(`[bundle-model] copying ${src}`)
  copyFileSync(src, join(dest, file))
  const bytes = statSync(join(dest, file)).size
  const sha256 = await sha256File(join(dest, file))
  const meta = buildMetadata({ file, bytes, sha256 })
  writeFileSync(join(dest, META_FILE), JSON.stringify(meta, null, 2) + '\n')
  console.log(`[bundle-model] ${file}\n  size   ${mb(bytes)} (${bytes} bytes)\n  sha256 ${sha256}\n  -> resources/models/ (+ ${META_FILE}). Now run: npm run build`)
  console.log('[bundle-model] note: the built app grows by about this much; the model stays off until the user picks "Use Bloop model".')
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch((e) => {
    console.error(`[bundle-model] ${e.message}`)
    process.exit(1)
  })
}
