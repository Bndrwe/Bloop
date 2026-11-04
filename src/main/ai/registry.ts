// Resolves AiSettings.choice into a provider, assembles AiStatus and pushes it to windows.
// 'auto' = local first (Bloop model, then Ollama), then cloud; it never downloads or pulls.
import type { AiChoice, AiSettings, AiStatus } from '@shared/ai'
import * as store from '../store'
import { onAiChanged } from './events'
import { cloudModule as cloud, setCloudModelsReader } from './cloud'
import { localModule } from './local'
import type { AiProvider, CloudModule, CompleteOptions, LocalModule } from './types'

/** The Cloud side (src/main/ai/cloud). Typed nullable so the registry also runs local-only. */
export const cloudModule: CloudModule | null = cloud
// 'auto' and cloud choices without a model use the model remembered per provider.
setCloudModelsReader(() => store.getAiSettings().cloudModels)

export const NO_AI_MESSAGE =
  'No AI is set up yet. Open Settings → AI to download the Bloop model, pick an Ollama model or connect a cloud provider.'

export interface RegistryDeps {
  local: LocalModule
  cloud: CloudModule | null
  getSettings: () => AiSettings
}

export interface Registry {
  resolve(choice?: AiChoice): Promise<AiProvider | Error>
  generateText(prompt: string, opts?: CompleteOptions): Promise<string>
  status(refresh?: boolean): Promise<AiStatus>
}

export function createRegistry(deps: RegistryDeps): Registry {
  async function resolve(choice: AiChoice = deps.getSettings().choice): Promise<AiProvider | Error> {
    try {
      if (choice.kind === 'local') return await deps.local.provider(choice)
      if (choice.kind === 'cloud') {
        return deps.cloud ? await deps.cloud.provider(choice) : new Error('Cloud providers are not available in this build yet.')
      }
      const local = await deps.local.autoProvider()
      if (local) return local
      const cloud = deps.cloud ? await deps.cloud.autoProvider() : null
      return cloud ?? new Error(NO_AI_MESSAGE)
    } catch (e) {
      return e instanceof Error ? e : new Error(String(e))
    }
  }

  return {
    resolve,
    async generateText(prompt, opts) {
      const p = await resolve()
      if (p instanceof Error) throw p
      return p.complete(prompt, opts)
    },
    async status(refresh = false) {
      const [local, cloud, active] = await Promise.all([
        deps.local.status(refresh),
        deps.cloud ? deps.cloud.status(refresh).catch(() => []) : Promise.resolve([]),
        resolve()
      ])
      return { active: active instanceof Error ? null : { label: active.label, kind: active.kind }, local, cloud }
    }
  }
}

export const registry = createRegistry({ local: localModule, cloud: cloudModule, getSettings: () => store.getAiSettings() })

/** Used by plan.ts. Throws an Error with a user-facing message when nothing is ready. */
export function generateText(prompt: string, opts?: CompleteOptions): Promise<string> {
  return registry.generateText(prompt, opts)
}

export function getAiStatus(refresh = false): Promise<AiStatus> {
  return registry.status(refresh)
}

/** Pushes a fresh AiStatus whenever something changes, at most 4 times a second. */
export function startStatusPush(send: (s: AiStatus) => void, minGapMs = 250): () => void {
  let last = 0
  let timer: ReturnType<typeof setTimeout> | null = null
  let running = false
  let again = false
  let lastJson = ''
  const run = async (): Promise<void> => {
    if (running) {
      again = true
      return
    }
    running = true
    last = Date.now()
    try {
      const s = await registry.status()
      const json = JSON.stringify(s)
      if (json !== lastJson) {
        lastJson = json
        send(s)
      }
    } catch (e) {
      console.log(`[bloop] ai status failed: ${(e as Error).message}`)
    } finally {
      running = false
      if (again) {
        again = false
        schedule()
      }
    }
  }
  const schedule = (): void => {
    if (timer) return
    const wait = Math.max(0, minGapMs - (Date.now() - last))
    timer = setTimeout(() => {
      timer = null
      void run()
    }, wait)
  }
  const off = onAiChanged(schedule)
  return () => {
    off()
    if (timer) clearTimeout(timer)
  }
}
