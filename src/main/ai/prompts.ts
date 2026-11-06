// Bloop's built-in instructions (system prompt). Every provider receives it as a real system message
// where it has one (Anthropic `system`, OpenRouter / Ollama system message, node-llama-cpp
// `systemPrompt`, Claude CLI `--append-system-prompt-file`), else as a delimited block before the
// prompt on stdin (Codex / Gemini CLIs). The plan prompt from buildPrompt() stays the user message.
import { DEFAULT_SYSTEM_PROMPT } from '@shared/ai'

export { DEFAULT_SYSTEM_PROMPT }

/**
 * For providers with no system-message slot (Codex / Gemini CLIs, and the Claude CLI fallback): a
 * clearly delimited block in front of the prompt. Both go over stdin, never argv.
 */
export function prependSystem(prompt: string, system?: string): string {
  const s = system?.trim()
  if (!s) return prompt
  return `System instructions (follow these for your whole reply):\n<<<\n${s}\n>>>\n\nRequest:\n${prompt}`
}
