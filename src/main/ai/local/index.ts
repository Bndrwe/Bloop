// "Use Local": the Bloop model (in-app, node-llama-cpp) and the user's Ollama models.
// Nothing in here downloads or pulls unless the UI passes confirmed === true.
import { join } from 'node:path'
import { app } from 'electron'
import type { AiChoice, AiSettings, DownloadProgress, LocalStatus } from '@shared/ai'
import * as store from '../../store'
import { aiChanged } from '../events'
import type { AiProvider, CompleteOptions, LocalModule } from '../types'
import { BLOOP_MODEL_ID, BloopManager, bundledModelDirs, BloopRuntime, type OpResult } from './bloop'
import {
  findOllamaBinary,
  friendlyOllamaError,
  ollamaChat,
  OllamaError,
  pickAutoOllamaModel,
  probeOllama,
  pullOllamaModel,
  sameModel,
  type OllamaProbe
} from './ollama'

export const BLOOP_PROVIDER_LABEL = 'Bloop model (on-device)'
export const ollamaProviderLabel = (model: string): string => `Ollama · ${model}`

/** Extra controls the IPC layer needs beyond the LocalModule contract. */
export interface LocalControls {
  downloadBloop(confirmed: boolean): Promise<OpResult>
  cancelBloopDownload(): void
  /** Rejects for the bundled model. */
  deleteBloop(): Promise<void>
  /** Verifies a bundled model (first time only, cached by size+mtime). Never downloads. */
  verifyBloop(): Promise<OpResult>
  /** Frees the in-memory model (Bloop turned off). */
  unloadBloop(): Promise<void>
  importBloop(path: string): Promise<OpResult>
  pullOllama(model: string, confirmed: boolean): Promise<OpResult>
  /** Frees the in-memory model (app quit). */
  dispose(): Promise<void>
}

export interface LocalDeps {
  getSettings: () => AiSettings
  onChange: () => void
  bloop: BloopManager
  runtime: Pick<BloopRuntime, 'complete' | 'unload'>
  findBinary?: () => Promise<string | null>
  probe?: (url: string) => Promise<OllamaProbe>
  /** How long an Ollama probe stays fresh without refresh=true. */
  probeTtlMs?: number
}

export function createLocalModule(deps: LocalDeps): LocalModule & LocalControls {
  const findBinary = deps.findBinary ?? (() => findOllamaBinary())
  const probe = deps.probe ?? ((url: string) => probeOllama(url))
  const ttl = deps.probeTtlMs ?? 10_000
  let probeCache: { url: string; at: number; value: OllamaProbe } | null = null
  let binCache: { at: number; value: string | null } | null = null
  let pull: (DownloadProgress & { model: string }) | undefined
  let pulling = false

  async function getProbe(refresh = false): Promise<OllamaProbe> {
    const url = deps.getSettings().ollamaUrl
    if (!refresh && probeCache && probeCache.url === url && Date.now() - probeCache.at < ttl) return probeCache.value
    const value = await probe(url)
    probeCache = { url, at: Date.now(), value }
    return value
  }
  async function getBinary(refresh = false): Promise<string | null> {
    if (!refresh && binCache && Date.now() - binCache.at < 5 * 60_000) return binCache.value
    const value = await findBinary()
    binCache = { at: Date.now(), value }
    return value
  }

  const bloopProvider = (): AiProvider => ({
    label: BLOOP_PROVIDER_LABEL,
    kind: 'local',
    complete: (prompt: string, opts?: CompleteOptions) => deps.runtime.complete(deps.bloop.filePath(), prompt, opts)
  })

  const ollamaProvider = (model: string): AiProvider => ({
    label: ollamaProviderLabel(model),
    kind: 'local',
    complete: async (prompt: string, opts?: CompleteOptions) => {
      const url = deps.getSettings().ollamaUrl
      try {
        return await ollamaChat(url, model, prompt, opts)
      } catch (e) {
        const installed = Boolean(await getBinary())
        throw friendlyOllamaError(e, { installed, url, model })
      }
    }
  })

  return {
    async status(refresh = false): Promise<LocalStatus> {
      const url = deps.getSettings().ollamaUrl
      const [p, bin] = await Promise.all([getProbe(refresh), getBinary(refresh)])
      return {
        bloop: { ...deps.bloop.status(), enabled: deps.getSettings().bloopEnabled },
        ollama: {
          installed: Boolean(bin) || p.running,
          running: p.running,
          ...(p.version ? { version: p.version } : {}),
          url,
          models: p.models,
          ...(pull ? { pull: { ...pull } } : {})
        }
      }
    },

    async provider(choice: Extract<AiChoice, { kind: 'local' }>): Promise<AiProvider | Error> {
      if (choice.runtime === 'bloop') {
        if (choice.model !== BLOOP_MODEL_ID) return new Error(`Unknown Bloop model "${choice.model}".`)
        const source = deps.bloop.source()
        if (source == null) {
          return new Error("The Bloop model isn't on this device yet. Download it (or import a .gguf) in Settings → AI.")
        }
        if (source === 'bundled' && !deps.getSettings().bloopEnabled) {
          return new Error('The built-in Bloop model is off. Turn it on in Settings → AI → Use Local.')
        }
        return bloopProvider()
      }
      const p = await getProbe()
      if (!p.running) {
        const installed = Boolean(await getBinary())
        return installed
          ? new OllamaError('Ollama is installed but not running: open Ollama', 'not-running')
          : new OllamaError('Ollama isn\'t installed or running. Get it from ollama.com.', 'not-installed')
      }
      if (!p.models.some((m) => sameModel(m.name, choice.model))) {
        return new OllamaError(`model not found: ${choice.model}. Pull it with \`ollama pull ${choice.model}\`.`, 'model-not-found')
      }
      return ollamaProvider(choice.model)
    },

    /**
     * Local-first order for 'auto': the Bloop model, then an Ollama model. Never downloads/pulls.
     * Bloop only counts once the user turned it on (bloopEnabled), so a bundled model never runs by itself.
     */
    async autoProvider(): Promise<AiProvider | null> {
      if (deps.getSettings().bloopEnabled && deps.bloop.isDownloaded()) return bloopProvider()
      const p = await getProbe()
      if (!p.running) return null
      const m = pickAutoOllamaModel(p.models)
      return m ? ollamaProvider(m.name) : null
    },

    downloadBloop: (confirmed) => deps.bloop.download(confirmed),
    cancelBloopDownload: () => deps.bloop.cancel(),
    async deleteBloop() {
      if (deps.bloop.source() === 'bundled') {
        throw new Error("The built-in Bloop model is part of the app and can't be deleted. Turn it off instead.")
      }
      await deps.runtime.unload()
      await deps.bloop.delete()
    },
    verifyBloop: () => deps.bloop.verifyBundled(),
    unloadBloop: () => deps.runtime.unload(),
    async importBloop(path) {
      await deps.runtime.unload()
      return deps.bloop.importFile(path)
    },

    async pullOllama(model, confirmed) {
      if (confirmed !== true) return { ok: false, error: 'Ollama models are only pulled after you confirm.' }
      if (pulling) return { ok: false, error: 'Already pulling a model.' }
      pulling = true
      const url = deps.getSettings().ollamaUrl
      pull = { model, receivedBytes: 0, totalBytes: null, bytesPerSec: 0, state: 'running' }
      deps.onChange()
      const t0 = Date.now()
      try {
        const r = await pullOllamaModel(url, model, true, (p) => {
          const secs = (Date.now() - t0) / 1000
          pull = { model, receivedBytes: p.receivedBytes, totalBytes: p.totalBytes, bytesPerSec: secs > 0 ? Math.round(p.receivedBytes / secs) : 0, state: 'running' }
          deps.onChange()
        })
        pull = r.ok
          ? { ...pull, bytesPerSec: 0, state: 'done' }
          : { ...pull, bytesPerSec: 0, state: 'error', ...(r.error ? { error: r.error } : {}) }
        return r
      } catch (e) {
        const err = friendlyOllamaError(e, { installed: Boolean(await getBinary()), url, model })
        pull = { ...pull, bytesPerSec: 0, state: 'error', error: err.message }
        return { ok: false, error: err.message }
      } finally {
        pulling = false
        probeCache = null
        deps.onChange()
      }
    },

    dispose: () => deps.runtime.unload()
  }
}

/** The app's local module (userData/models, AiSettings from electron-store). */
export const localModule = createLocalModule({
  getSettings: () => store.getAiSettings(),
  onChange: aiChanged,
  bloop: new BloopManager({
    modelsDir: () => join(app.getPath('userData'), 'models'),
    // Packaged: <resources>/resources/models. Dev: <repo>/resources/models.
    bundledDirs: () => bundledModelDirs(app.getAppPath()),
    verifyCacheFile: () => join(app.getPath('userData'), 'bloop-bundled-verified.json'),
    onChange: aiChanged
  }),
  runtime: new BloopRuntime({ packaged: app.isPackaged })
})
