// "Use Local": the user's Ollama models.
// Nothing in here pulls a model unless the UI passes confirmed === true.
import type { AiChoice, AiSettings, DownloadProgress, LocalStatus } from '@shared/ai'
import * as store from '../../store'
import { aiChanged } from '../events'
import type { AiProvider, CompleteOptions, LocalModule } from '../types'
import {
  findOllamaBinary,
  friendlyOllamaError,
  ollamaChat,
  OllamaError,
  probeOllama,
  pullOllamaModel,
  sameModel,
  type OllamaProbe
} from './ollama'

export const ollamaProviderLabel = (model: string): string => `Ollama · ${model}`

export interface OpResult {
  ok: boolean
  error?: string
}

/** Extra controls the IPC layer needs beyond the LocalModule contract. */
export interface LocalControls {
  pullOllama(model: string, confirmed: boolean): Promise<OpResult>
}

export interface LocalDeps {
  getSettings: () => AiSettings
  onChange: () => void
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
    }
  }
}

/** The app's local module (AiSettings from electron-store). */
export const localModule = createLocalModule({
  getSettings: () => store.getAiSettings(),
  onChange: aiChanged
})
