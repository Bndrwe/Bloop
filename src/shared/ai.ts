// Shared AI contract: provider ids, settings shape and the renderer-facing API (window.studyPet.ai).
// Two halves: "Use Local" (Bloop model + Ollama models) and "Cloud" (CLIs + API keys).

/** Where a local model runs. */
export type LocalRuntime = 'bloop' | 'ollama'

/** Cloud providers. CLIs use the user's own logged-in tools; the others use API keys. */
export type CloudProviderId = 'claude-cli' | 'codex-cli' | 'gemini-cli' | 'anthropic' | 'openrouter'

/** What the user picked. 'auto' = first ready option: local first, then cloud (see main/ai/registry.ts). */
export type AiChoice =
  | { kind: 'auto' }
  | { kind: 'local'; runtime: LocalRuntime; model: string } // bloop: catalog id; ollama: model tag e.g. "qwen3.5:0.8b"
  | { kind: 'cloud'; provider: CloudProviderId; model?: string } // model omitted = provider/CLI default

export interface AiSettings {
  choice: AiChoice
  /** Remembered per-cloud-provider model choice. */
  cloudModels: Partial<Record<CloudProviderId, string>>
  /** Ollama base URL. */
  ollamaUrl: string
  /** User said "Not now" to the Bloop model download offer; don't offer again unprompted. */
  bloopOfferDismissed: boolean
  /**
   * The user explicitly turned the Bloop model on ("Use Bloop model"). Default false. The model
   * that ships inside the app is never used, not even by 'auto', until this is true.
   */
  bloopEnabled: boolean
}

export const DEFAULT_AI_SETTINGS: AiSettings = {
  choice: { kind: 'auto' },
  cloudModels: {},
  ollamaUrl: 'http://127.0.0.1:11434',
  bloopOfferDismissed: false,
  bloopEnabled: false
}

/** One selectable model row in the picker. */
export interface AiModelOption {
  /** Stable key, e.g. "local:bloop:bloop-qwen3.5-0.8b" or "local:ollama:qwen3.5:0.8b". */
  key: string
  label: string
  /** Badge text, e.g. "Bloop", "Ollama", "CLI", "API". */
  source: string
  sizeBytes?: number
  ready: boolean
  /** Why it isn't ready / extra info ("not downloaded", "Ollama not running"). */
  note?: string
}

/** Where the Bloop model file comes from: shipped inside the app, downloaded, or imported from disk. */
export type BloopSource = 'bundled' | 'downloaded' | 'imported'

export interface LocalStatus {
  bloop: {
    /** Catalog entry for the built-in Bloop model (fine-tuned Qwen3.5 0.8B). */
    id: string
    label: string
    /** Empty until the fine-tuned GGUF is published. */
    url: string
    sizeBytes: number | null
    /** A model file is available on this device (bundled, downloaded or imported). */
    downloaded: boolean
    /** Which file would run: the bundled one first, then userData/models. null = none. */
    source: BloopSource | null
    /** AiSettings.bloopEnabled: the user turned the model on. Bundled models never run before this. */
    enabled: boolean
    /** From bloop-model.json of a bundled model. */
    base?: string
    builtAt?: string
    path?: string
    /** Download in progress. */
    progress?: DownloadProgress
  }
  ollama: {
    installed: boolean
    running: boolean
    version?: string
    url: string
    models: { name: string; sizeBytes?: number; family?: string }[]
    /** Pull in progress. */
    pull?: DownloadProgress & { model: string }
  }
}

export interface DownloadProgress {
  receivedBytes: number
  totalBytes: number | null
  bytesPerSec: number
  state: 'running' | 'verifying' | 'done' | 'error' | 'cancelled'
  error?: string
}

export interface CloudProviderStatus {
  id: CloudProviderId
  label: string
  kind: 'cli' | 'api'
  /** CLI: binary found; API: key stored. */
  available: boolean
  /** e.g. "/opt/homebrew/bin/claude" or "key set". Never the key itself. */
  detail?: string
  /** Official install / key page. */
  helpUrl: string
  models: { id: string; label: string }[]
  defaultModel?: string
}

export interface AiStatus {
  /** What a plan generation would use right now, or null if nothing is ready. */
  active: { label: string; kind: 'local' | 'cloud' } | null
  local: LocalStatus
  cloud: CloudProviderStatus[]
}

/** window.studyPet.ai */
export interface AiApi {
  getStatus(refresh?: boolean): Promise<AiStatus>
  onStatus(cb: (s: AiStatus) => void): () => void
  getSettings(): Promise<AiSettings>
  setChoice(choice: AiChoice): Promise<AiSettings>
  setCloudModel(provider: CloudProviderId, model: string): Promise<AiSettings>
  setOllamaUrl(url: string): Promise<AiSettings>
  /** Downloads ONLY when confirmed === true (the user clicked Download in a confirmation). */
  downloadBloopModel(confirmed: boolean): Promise<{ ok: boolean; error?: string }>
  cancelBloopDownload(): Promise<void>
  /** Rejects for the bundled model (it is part of the app). */
  deleteBloopModel(): Promise<void>
  /**
   * "Use Bloop model" / "Turn off". true: verifies a bundled file the first time, sets bloopEnabled and
   * selects the Bloop model. false: clears bloopEnabled and, if Bloop was selected, goes back to auto.
   * Never downloads anything. Rejects with a message when the model can't be turned on.
   */
  setBloopEnabled(enabled: boolean): Promise<AiSettings>
  /** Use a .gguf the user picked from disk (opens a file dialog in main). */
  importBloopModelFile(): Promise<{ ok: boolean; error?: string }>
  dismissBloopOffer(): Promise<void>
  /** Pulls ONLY when confirmed === true. */
  pullOllamaModel(model: string, confirmed: boolean): Promise<{ ok: boolean; error?: string }>
  /** Store / remove an API key (encrypted with safeStorage in main; never returned). */
  setApiKey(provider: 'anthropic' | 'openrouter', key: string | null): Promise<{ ok: boolean; error?: string }>
  /** Run a tiny prompt through a choice (default: current) and report. */
  test(choice?: AiChoice): Promise<{ ok: boolean; ms: number; sample?: string; error?: string }>
}
