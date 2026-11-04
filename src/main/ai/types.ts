// Main-process provider interface. Local (src/main/ai/local/*) and cloud (src/main/ai/cloud/*)
// providers implement it; src/main/ai/registry.ts picks one for an AiChoice.
import type { AiChoice, CloudProviderStatus, LocalStatus } from '@shared/ai'

export interface CompleteOptions {
  maxTokens?: number
  /** JSON schema the output must follow (local runtimes use it as a grammar / format). */
  jsonSchema?: Record<string, unknown>
  signal?: AbortSignal
  /** Overall timeout in ms. */
  timeoutMs?: number
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
  /** First ready cloud option for 'auto', or null. Order: claude-cli, codex-cli, gemini-cli, anthropic, openrouter. */
  autoProvider(): Promise<AiProvider | null>
  setApiKey(provider: 'anthropic' | 'openrouter', key: string | null): Promise<{ ok: boolean; error?: string }>
}
