// Main-process provider interface. Local (src/main/ai/local/*) and cloud (src/main/ai/cloud/*)
// providers implement it; src/main/ai/registry.ts picks one for an AiChoice.
import type { AiChoice, CloudProviderId, CloudProviderStatus, LocalStatus } from '@shared/ai'

export interface CompleteOptions {
  maxTokens?: number
  /** JSON schema the output must follow (local runtimes use it as a grammar / format). */
  jsonSchema?: Record<string, unknown>
  signal?: AbortSignal
  /** Overall timeout in ms. */
  timeoutMs?: number
  /**
   * Instructions (system prompt), sent as a system message where the provider has one, else as a
   * delimited block before the prompt (always over stdin for CLIs). Omitted = no system message.
   */
  system?: string
}

export interface AiProvider {
  /** Human label for status lines, e.g. "Bloop model (on-device)", "Claude CLI". */
  label: string
  kind: 'local' | 'cloud'
  complete(prompt: string, opts?: CompleteOptions): Promise<string>
}

/** Implemented by src/main/ai/local/index.ts */
export interface LocalModule {
  status(refresh?: boolean): Promise<LocalStatus>
  /** Provider for a local choice, or an Error explaining why it isn't ready (never downloads). */
  provider(choice: Extract<AiChoice, { kind: 'local' }>): Promise<AiProvider | Error>
  /** First ready local option for 'auto' (never downloads/pulls), or null. */
  autoProvider(): Promise<AiProvider | null>
}

/** Implemented by src/main/ai/cloud/index.ts */
export interface CloudModule {
  status(refresh?: boolean): Promise<CloudProviderStatus[]>
  provider(choice: Extract<AiChoice, { kind: 'cloud' }>): Promise<AiProvider | Error>
  /**
   * First available provider among `allowed` (the user's AiSettings.autoCloud, in priority order), or null.
   * Providers not in `allowed` are never considered.
   */
  autoProvider(allowed: CloudProviderId[]): Promise<AiProvider | null>
  setApiKey(provider: 'anthropic' | 'openrouter', key: string | null): Promise<{ ok: boolean; error?: string }>
}
