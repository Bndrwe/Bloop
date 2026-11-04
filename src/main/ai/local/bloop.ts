// The Bloop model: our fine-tuned Qwen3.5-0.8B (Q4_K_M GGUF), run in-app with node-llama-cpp.
// It is downloaded ONLY after the user confirms in the UI (download(true)); nothing here ever
// starts a download on its own. Electron-free so it can be unit tested; local/index.ts wires it up.
import { createHash } from 'node:crypto'
import { createReadStream, createWriteStream, existsSync, statSync, type WriteStream } from 'node:fs'
import { copyFile, mkdir, open, rename, rm, stat, statfs } from 'node:fs/promises'
import { once } from 'node:events'
import { join } from 'node:path'
import type { DownloadProgress, LocalStatus } from '@shared/ai'
import type { CompleteOptions } from '../types'

// ------------------------------------------------------------------ catalog
// Filled in after the fine-tuned GGUF is published (see README → AI → Publishing the Bloop model).
// While BLOOP_MODEL_URL is empty the download button is disabled ("Not published yet");
// importing a .gguf from disk still works.

export const BLOOP_MODEL_ID = 'bloop-qwen3.5-0.8b'
export const BLOOP_MODEL_LABEL = 'Bloop model · Qwen3.5 0.8B (fine-tuned, Q4_K_M)'
/** Direct https URL of the .gguf (e.g. a Hugging Face "resolve/main/…gguf" link). */
export const BLOOP_MODEL_URL = ''
/** Lowercase hex sha256 of the .gguf; when set, downloads are verified. */
export const BLOOP_MODEL_SHA256 = ''
/** Exact size in bytes; used for the "~X MB" prompt and the free-space check. 0 = unknown. */
export const BLOOP_MODEL_BYTES = 0
/** File name inside userData/models. */
export const BLOOP_MODEL_FILE = 'bloop-qwen3.5-0.8b-q4_k_m.gguf'

/** Shown on the disabled download button while the URL is empty. */
export const NOT_PUBLISHED_NOTE = 'Not published yet'

export interface BloopCatalogEntry {
  id: string
  label: string
  url: string
  sha256: string
  bytes: number
  file: string
}

export const BLOOP_CATALOG: BloopCatalogEntry = {
  id: BLOOP_MODEL_ID,
  label: BLOOP_MODEL_LABEL,
  url: BLOOP_MODEL_URL,
  sha256: BLOOP_MODEL_SHA256,
  bytes: BLOOP_MODEL_BYTES,
  file: BLOOP_MODEL_FILE
}

/** Extra room kept free on disk beyond the model itself. */
const DISK_HEADROOM = 200 * 1024 * 1024
/** At most this often while bytes are flowing (state changes are always pushed). */
const PROGRESS_EVERY_MS = 250

export interface BloopDeps {
  /** userData/models */
  modelsDir: () => string
  /** Called whenever status changes (progress is throttled to ≤ 4/s). */
  onChange?: () => void
  catalog?: BloopCatalogEntry
  fetch?: typeof fetch
  /** Free bytes on the volume holding `dir`, or null if unknown. */
  freeBytes?: (dir: string) => Promise<number | null>
}

export type OpResult = { ok: boolean; error?: string }

async function defaultFreeBytes(dir: string): Promise<number | null> {
  try {
    const s = await statfs(dir)
    return Number(s.bavail) * Number(s.bsize)
  } catch {
    return null
  }
}

export function formatMB(bytes: number): string {
  return `${Math.round(bytes / (1024 * 1024))} MB`
}

/** Files start with the ASCII magic "GGUF". */
export async function isGgufFile(path: string): Promise<boolean> {
  let fh: Awaited<ReturnType<typeof open>> | null = null
  try {
    fh = await open(path, 'r')
    const buf = Buffer.alloc(4)
    await fh.read(buf, 0, 4, 0)
    return buf.toString('latin1') === 'GGUF'
  } catch {
    return false
  } finally {
    await fh?.close()
  }
}

async function sha256File(path: string, signal: AbortSignal): Promise<string> {
  const h = createHash('sha256')
  for await (const chunk of createReadStream(path, { signal })) h.update(chunk as Buffer)
  return h.digest('hex')
}

// ------------------------------------------------------------------ download manager

export class BloopManager {
  private progress: DownloadProgress | undefined
  private abort: AbortController | null = null
  private lastEmit = 0

  constructor(private readonly deps: BloopDeps) {}

  get catalog(): BloopCatalogEntry {
    return this.deps.catalog ?? BLOOP_CATALOG
  }

  filePath(): string {
    return join(this.deps.modelsDir(), this.catalog.file)
  }
  private partPath(): string {
    return `${this.filePath()}.part`
  }

  isDownloaded(): boolean {
    return existsSync(this.filePath())
  }

  isBusy(): boolean {
    return this.abort != null
  }

  status(): LocalStatus['bloop'] {
    const c = this.catalog
    const downloaded = this.isDownloaded()
    let sizeBytes: number | null = c.bytes > 0 ? c.bytes : null
    if (downloaded) {
      try {
        sizeBytes = statSync(this.filePath()).size
      } catch {
        /* raced with delete */
      }
    }
    return {
      id: c.id,
      label: c.label,
      url: c.url,
      sizeBytes,
      downloaded,
      ...(downloaded ? { path: this.filePath() } : {}),
      ...(this.progress ? { progress: { ...this.progress } } : {})
    }
  }

  private emit(force = true): void {
    const now = Date.now()
    if (!force && now - this.lastEmit < PROGRESS_EVERY_MS) return
    this.lastEmit = now
    this.deps.onChange?.()
  }

  private setProgress(p: DownloadProgress | undefined, force = true): void {
    this.progress = p
    this.emit(force)
  }

  /**
   * Download the GGUF to userData/models. Refuses unless `confirmed === true` (the user clicked
   * Download in the confirmation). Resolves when the download finishes, fails or is cancelled.
   */
  async download(confirmed: boolean): Promise<OpResult> {
    if (confirmed !== true) {
      return { ok: false, error: 'The Bloop model is only downloaded after you confirm.' }
    }
    const c = this.catalog
    if (!c.url) return { ok: false, error: `${NOT_PUBLISHED_NOTE}: the Bloop model hasn't been published. You can import a .gguf file instead.` }
    if (this.abort) return { ok: false, error: 'Already downloading.' }
    if (this.isDownloaded()) return { ok: true }

    const ac = new AbortController()
    this.abort = ac
    const dir = this.deps.modelsDir()
    const part = this.partPath()
    const doFetch = this.deps.fetch ?? fetch
    let ws: WriteStream | null = null
    try {
      await mkdir(dir, { recursive: true })
      let have = 0
      try {
        have = (await stat(part)).size
      } catch {
        have = 0
      }
      this.setProgress({ receivedBytes: have, totalBytes: c.bytes || null, bytesPerSec: 0, state: 'running' })

      const free = await (this.deps.freeBytes ?? defaultFreeBytes)(dir)
      if (free != null && c.bytes > 0 && free < c.bytes - have + DISK_HEADROOM) {
        throw new Error(`Not enough disk space: the Bloop model needs about ${formatMB(c.bytes - have + DISK_HEADROOM)} free, and ${formatMB(free)} is available.`)
      }

      let res = await doFetch(c.url, { headers: have > 0 ? { Range: `bytes=${have}-` } : {}, signal: ac.signal, redirect: 'follow' })
      if (res.status === 416) {
        // The partial file is bigger than the remote one: start over.
        await rm(part, { force: true })
        have = 0
        res = await doFetch(c.url, { signal: ac.signal, redirect: 'follow' })
      }
      if (!res.ok || !res.body) throw new Error(`Download failed (HTTP ${res.status}).`)
      const resumed = res.status === 206 && have > 0
      if (!resumed) have = 0
      const len = Number(res.headers.get('content-length')) || 0
      const total = len > 0 ? have + len : c.bytes || null

      if (free != null && total != null && free < total - have + DISK_HEADROOM) {
        throw new Error(`Not enough disk space: need about ${formatMB(total - have + DISK_HEADROOM)}, ${formatMB(free)} available.`)
      }

      ws = createWriteStream(part, { flags: resumed ? 'a' : 'w' })
      const wsErr = new Promise<never>((_, reject) => ws?.once('error', reject))
      wsErr.catch(() => undefined)
      let received = have
      let winT = Date.now()
      let winBytes = received
      let speed = 0
      const reader = res.body.getReader()
      for (;;) {
        const { done, value } = await Promise.race([reader.read(), wsErr])
        if (done) break
        received += value.byteLength
        if (!ws.write(value)) await Promise.race([once(ws, 'drain'), wsErr])
        const now = Date.now()
        if (now - winT >= 500) {
          const inst = ((received - winBytes) * 1000) / (now - winT)
          speed = speed ? speed * 0.6 + inst * 0.4 : inst
          winT = now
          winBytes = received
        }
        this.setProgress({ receivedBytes: received, totalBytes: total, bytesPerSec: Math.round(speed), state: 'running' }, false)
      }
      await new Promise<void>((resolve, reject) => ws!.end((e?: Error | null) => (e ? reject(e) : resolve())))
      ws = null
      if (total != null && received < total) throw new Error('The download ended early. Try again to resume.')

      if (c.sha256) {
        this.setProgress({ receivedBytes: received, totalBytes: total, bytesPerSec: 0, state: 'verifying' })
        const got = await sha256File(part, ac.signal)
        if (got.toLowerCase() !== c.sha256.toLowerCase()) {
          await rm(part, { force: true })
          throw new Error('The downloaded file failed its checksum, so it was deleted. Try again.')
        }
      }
      await rename(part, this.filePath())
      this.setProgress({ receivedBytes: received, totalBytes: total ?? received, bytesPerSec: 0, state: 'done' })
      return { ok: true }
    } catch (e) {
      ws?.destroy()
      if (ac.signal.aborted) {
        this.setProgress({ ...(this.progress ?? { receivedBytes: 0, totalBytes: null }), bytesPerSec: 0, state: 'cancelled' })
        return { ok: false, error: 'Download cancelled.' }
      }
      const error = (e as Error).message || String(e)
      this.setProgress({ ...(this.progress ?? { receivedBytes: 0, totalBytes: null }), bytesPerSec: 0, state: 'error', error })
      return { ok: false, error }
    } finally {
      this.abort = null
    }
  }

  /** Stops a running download; the .part file stays so the next download resumes. */
  cancel(): void {
    this.abort?.abort()
  }

  /** Deletes the model (and any partial download). */
  async delete(): Promise<void> {
    this.cancel()
    await rm(this.filePath(), { force: true })
    await rm(this.partPath(), { force: true })
    this.setProgress(undefined)
  }

  /** Copies a user-picked .gguf into place as the Bloop model. */
  async importFile(src: string): Promise<OpResult> {
    if (this.abort) return { ok: false, error: 'A download is in progress. Cancel it first.' }
    if (!/\.gguf$/i.test(src)) return { ok: false, error: 'Pick a .gguf model file.' }
    if (!(await isGgufFile(src))) return { ok: false, error: "That file isn't a GGUF model." }
    try {
      const size = (await stat(src)).size
      await mkdir(this.deps.modelsDir(), { recursive: true })
      this.setProgress({ receivedBytes: 0, totalBytes: size, bytesPerSec: 0, state: 'running' })
      const tmp = `${this.filePath()}.import`
      await copyFile(src, tmp)
      await rename(tmp, this.filePath())
      await rm(this.partPath(), { force: true })
      this.setProgress({ receivedBytes: size, totalBytes: size, bytesPerSec: 0, state: 'done' })
      return { ok: true }
    } catch (e) {
      const error = `Couldn't import the model: ${(e as Error).message}`
      this.setProgress({ receivedBytes: 0, totalBytes: null, bytesPerSec: 0, state: 'error', error })
      return { ok: false, error }
    }
  }
}

// ------------------------------------------------------------------ inference

type Nlc = typeof import('node-llama-cpp')
type Llama = Awaited<ReturnType<Nlc['getLlama']>>
type LlamaModel = Awaited<ReturnType<Llama['loadModel']>>
type LlamaContext = Awaited<ReturnType<LlamaModel['createContext']>>

export const BLOOP_CONTEXT_SIZE = 4096
export const BLOOP_IDLE_UNLOAD_MS = 5 * 60_000

export interface BloopRuntimeOptions {
  /** Loads node-llama-cpp (overridable in tests). */
  load?: () => Promise<Nlc>
  /** Packaged apps never try to compile llama.cpp from source. */
  packaged?: boolean
  idleMs?: number
  contextSize?: number
}

interface Loaded {
  path: string
  nlc: Nlc
  llama: Llama
  model: LlamaModel
  context: LlamaContext
}

/**
 * Runs the GGUF with node-llama-cpp. The model loads lazily on the first prompt and is unloaded
 * after 5 minutes idle. llama.cpp's heavy work (model load, decode) runs on native worker threads
 * (N-API AsyncWorkers in the addon), so awaiting it in the main process never blocks the UI.
 * Prompts are serialized: one context sequence, one prompt at a time.
 */
export class BloopRuntime {
  private loaded: Loaded | null = null
  private loading: Promise<Loaded> | null = null
  private queue: Promise<unknown> = Promise.resolve()
  private idleTimer: ReturnType<typeof setTimeout> | null = null

  constructor(private readonly opts: BloopRuntimeOptions = {}) {}

  isLoaded(): boolean {
    return this.loaded != null
  }

  private async ensure(path: string): Promise<Loaded> {
    if (this.loaded?.path === path) return this.loaded
    if (this.loaded) await this.unload()
    if (!this.loading) {
      this.loading = (async () => {
        const nlc = await (this.opts.load ?? (() => import('node-llama-cpp')))()
        const llama = await nlc.getLlama({
          build: this.opts.packaged ? 'never' : 'auto',
          logLevel: nlc.LlamaLogLevel.warn
        })
        const model = await llama.loadModel({ modelPath: path })
        const context = await model.createContext({ contextSize: this.opts.contextSize ?? BLOOP_CONTEXT_SIZE })
        return { path, nlc, llama, model, context }
      })()
    }
    try {
      this.loaded = await this.loading
      return this.loaded
    } finally {
      this.loading = null
    }
  }

  private armIdle(): void {
    if (this.idleTimer) clearTimeout(this.idleTimer)
    this.idleTimer = setTimeout(() => void this.unload(), this.opts.idleMs ?? BLOOP_IDLE_UNLOAD_MS)
    this.idleTimer.unref?.()
  }

  async unload(): Promise<void> {
    if (this.idleTimer) clearTimeout(this.idleTimer)
    this.idleTimer = null
    const l = this.loaded
    this.loaded = null
    if (!l) return
    await l.context.dispose().catch(() => undefined)
    await l.model.dispose().catch(() => undefined)
    await l.llama.dispose().catch(() => undefined)
  }

  complete(path: string, prompt: string, opts: CompleteOptions = {}): Promise<string> {
    const run = async (): Promise<string> => {
      if (this.idleTimer) clearTimeout(this.idleTimer)
      const l = await this.ensure(path)
      const session = new l.nlc.LlamaChatSession({ contextSequence: l.context.getSequence() })
      try {
        const grammar = opts.jsonSchema ? await l.llama.createGrammarForJsonSchema(opts.jsonSchema as never) : undefined
        const signals = [opts.signal, opts.timeoutMs ? AbortSignal.timeout(opts.timeoutMs) : undefined].filter(
          (s): s is AbortSignal => s != null
        )
        return await session.prompt(prompt, {
          ...(grammar ? { grammar } : {}),
          maxTokens: opts.maxTokens ?? 1024,
          // Small model, structured output: answer directly instead of thinking first.
          budgets: { thoughtTokens: 0 },
          ...(signals.length ? { signal: AbortSignal.any(signals) } : {})
        })
      } finally {
        session.dispose({ disposeSequence: true })
        this.armIdle()
      }
    }
    const p = this.queue.then(run, run)
    this.queue = p.catch(() => undefined)
    return p
  }
}
