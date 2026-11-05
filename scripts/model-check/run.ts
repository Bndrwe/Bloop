// `npm run model:check -- --provider ollama --model qwen3.5:0.8b`
// Runs the in-app "Check model" cases (src/main/ai/check.ts) from Node, without Electron.
// Never downloads or pulls anything. Cloud providers receive the test prompts (made-up data only).
//
//   --provider  ollama | gguf | anthropic | openrouter | claude-cli | codex-cli | gemini-cli
//   --model     model id (ollama: required; others: optional)
//   --gguf      path to a .gguf (provider gguf; implied when --gguf is given)
//   --url       Ollama URL (default http://127.0.0.1:11434)
//   --system-file <path>   use these instructions instead of the default
//   --no-system            send no system prompt
//   --timeout <s>          per-case timeout
//   --json                 print the full report as JSON
import { existsSync, readFileSync } from 'node:fs'
import { DEFAULT_SYSTEM_PROMPT } from '@shared/ai'
import { runModelCheck } from '../../src/main/ai/check'
import { createAnthropicProvider, createOpenRouterProvider, OPENROUTER_DEFAULT_MODEL, ANTHROPIC_DEFAULT_MODEL } from '../../src/main/ai/cloud/api'
import { CLI_SPECS, createCliProvider, isSafeModelId, type CliId } from '../../src/main/ai/cloud/cli'
import { resolveBinary } from '../../src/main/ai/cloud/cli-detect'
import { BloopRuntime, isGgufFile } from '../../src/main/ai/local/bloop'
import { ollamaChat, probeOllama, sameModel } from '../../src/main/ai/local/ollama'
import type { AiProvider } from '../../src/main/ai/types'

function parseArgs(argv: string[]): Record<string, string | true> {
  const out: Record<string, string | true> = {}
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!
    if (!a.startsWith('--')) continue
    const key = a.slice(2)
    const next = argv[i + 1]
    if (next != null && !next.startsWith('--')) {
      out[key] = next
      i++
    } else out[key] = true
  }
  return out
}

const args = parseArgs(process.argv.slice(2))
const str = (k: string): string | undefined => (typeof args[k] === 'string' ? (args[k] as string) : undefined)

async function makeProvider(): Promise<{ provider: AiProvider | Error; dispose?: () => Promise<void> }> {
  const gguf = str('gguf')
  const kind = str('provider') ?? (gguf ? 'gguf' : undefined)
  const model = str('model')
  switch (kind) {
    case 'ollama': {
      const url = str('url') ?? 'http://127.0.0.1:11434'
      if (!model) return { provider: new Error('--model is required for ollama (e.g. qwen3.5:0.8b).') }
      const p = await probeOllama(url, 3000)
      if (!p.running) return { provider: new Error(`Ollama isn't running at ${url}.`) }
      if (!p.models.some((m) => sameModel(m.name, model))) return { provider: new Error(`model not found: ${model}. Pull it yourself with \`ollama pull ${model}\` (this check never pulls).`) }
      return { provider: { label: `Ollama · ${model}`, kind: 'local', complete: (prompt, o) => ollamaChat(url, model, prompt, o) } }
    }
    case 'gguf': {
      if (!gguf || !existsSync(gguf) || !(await isGgufFile(gguf))) return { provider: new Error('--gguf must point at a .gguf file.') }
      // packaged: true = never build llama.cpp from source (and nothing is downloaded).
      const rt = new BloopRuntime({ packaged: true })
      return { provider: { label: `GGUF · ${gguf.split(/[\\/]/).pop()}`, kind: 'local', complete: (prompt, o) => rt.complete(gguf, prompt, o) }, dispose: () => rt.unload() }
    }
    case 'anthropic': {
      const key = process.env['ANTHROPIC_API_KEY']
      if (!key) return { provider: new Error('Set ANTHROPIC_API_KEY in the environment.') }
      return { provider: createAnthropicProvider(key, model || ANTHROPIC_DEFAULT_MODEL) }
    }
    case 'openrouter': {
      const key = process.env['OPENROUTER_API_KEY']
      if (!key) return { provider: new Error('Set OPENROUTER_API_KEY in the environment.') }
      return { provider: createOpenRouterProvider(key, model || OPENROUTER_DEFAULT_MODEL) }
    }
    case 'claude-cli':
    case 'codex-cli':
    case 'gemini-cli': {
      const id = kind as CliId
      if (model && !isSafeModelId(model)) return { provider: new Error('That model name has unsupported characters.') }
      const bin = await resolveBinary(CLI_SPECS[id].bin)
      if (!bin) return { provider: new Error(`${CLI_SPECS[id].label} isn't installed (or isn't on your PATH).`) }
      return { provider: createCliProvider(id, bin, model) }
    }
    default:
      return { provider: new Error('Pick a provider: --provider ollama|gguf|anthropic|openrouter|claude-cli|codex-cli|gemini-cli (or --gguf <path>).') }
  }
}

async function main(): Promise<number> {
  const sysFile = str('system-file')
  const system = args['no-system'] ? '' : sysFile ? readFileSync(sysFile, 'utf8').trim() : DEFAULT_SYSTEM_PROMPT
  const timeout = Number(str('timeout'))
  const { provider, dispose } = await makeProvider()
  if (provider instanceof Error) {
    console.error(provider.message)
    return 2
  }
  if (provider.kind === 'cloud') console.error(`Note: this sends 5 short test prompts (made-up data) to ${provider.label}.`)
  try {
    const report = await runModelCheck(
      { resolve: async () => provider, system, systemIsDefault: system === DEFAULT_SYSTEM_PROMPT },
      (p) => {
        if (!args['json'] && p.result) {
          const r = p.result
          const pass = r.checks.filter((c) => c.pass).length
          console.log(`[${p.done}/${p.total}] ${r.title}: ${pass}/${r.checks.length} checks, ${(r.latencyMs / 1000).toFixed(1)} s${r.error ? ` (${r.error})` : ''}`)
          for (const c of r.checks.filter((c) => !c.pass)) console.log(`        fail: ${c.label}${c.reason ? ` (${c.reason})` : ''}`)
        }
      },
      Number.isFinite(timeout) && timeout > 0 ? { timeoutMs: timeout * 1000 } : {}
    )
    if (args['json']) console.log(JSON.stringify(report, null, 2))
    else if (!report.ok) console.error(report.error)
    else {
      const s = report.summary!
      console.log(`\n${report.provider!.label}: overall ${s.verdict.toUpperCase()} · ${s.passed}/${s.total} checks · avg ${(s.avgLatencyMs / 1000).toFixed(1)} s`)
    }
    if (!report.ok) return 2
    return report.summary!.verdict === 'poor' ? 1 : 0
  } finally {
    await dispose?.()
  }
}

main().then(
  (code) => process.exit(code),
  (e) => {
    console.error((e as Error)?.stack ?? e)
    process.exit(2)
  }
)
