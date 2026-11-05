// All AI IPC handlers (window.studyPet.ai). Registered from main/index.ts with one call.
import { BrowserWindow, app, dialog, session, shell, type IpcMain } from 'electron'
import { IPC } from '@shared/ipc'
import type { AiChoice, AiSettings, AiStatus, CloudProviderId } from '@shared/ai'
import * as store from '../store'
import { aiChanged } from './events'
import { localModule } from './local'
import { cloudModule, getAiStatus, registry, startStatusPush } from './registry'
import { CLOUD_PROVIDER_IDS, normalizeOllamaUrl, validateChoice } from './settings'
import { denyAllPermissions, guardSender, hardenWebContents, isSafeExternalUrl, rendererIndexFor, type TrustedOrigins } from './guard'

const log = (m: string): void => console.log(`[bloop] ${m}`)

export interface AiIpcDeps {
  /** Every window that should receive `ai:status` pushes. */
  allWindows: () => BrowserWindow[]
}

/** Our own renderer: the packaged index.html, or the Vite dev server when not packaged. */
export function trustedOrigins(): TrustedOrigins {
  return {
    rendererIndex: rendererIndexFor(app.getAppPath()),
    devUrl: process.env['ELECTRON_RENDERER_URL'],
    packaged: app.isPackaged
  }
}

const openExternalSafe = (url: string): void => {
  if (isSafeExternalUrl(url)) void shell.openExternal(url).catch(() => undefined)
}

const TEST_PROMPT = 'You are checking that an AI connection works. Reply with exactly: Ready to plan!'

export function registerAiIpc(ipcMain: IpcMain, deps: AiIpcDeps): void {
  const origins = trustedOrigins()
  const h = (ch: string, fn: (e: Electron.IpcMainInvokeEvent, ...args: unknown[]) => unknown): void => {
    ipcMain.handle(ch, async (e, ...args) => {
      // Only our own renderer (top frame, file:// index.html or the dev server) may call these.
      guardSender(ch, e, origins)
      try {
        return await fn(e, ...args)
      } catch (err) {
        log(`ipc ${ch} failed: ${(err as Error).stack ?? err}`)
        throw err
      }
    })
  }
  const saved = (next: AiSettings): AiSettings => {
    aiChanged()
    return next
  }

  const push = (s: AiStatus): void => {
    for (const w of deps.allWindows()) {
      if (!w.isDestroyed() && !w.webContents.isDestroyed()) w.webContents.send(IPC.aiStatusPush, s)
    }
  }
  startStatusPush(push)

  // Every webContents: help links (ollama.com, provider key pages) open in the system browser, never
  // in a new window; navigation away from our renderer and <webview> are blocked.
  app.on('web-contents-created', (_e, contents) => hardenWebContents(contents, origins, openExternalSafe))
  // The renderer needs no web permissions (camera, mic, geolocation, notifications...): deny all.
  denyAllPermissions(session.defaultSession)

  h(IPC.openExternal, async (_e, url) => {
    if (!isSafeExternalUrl(url)) throw new Error('Only https links can be opened.')
    await shell.openExternal(url)
  })

  h(IPC.aiGetStatus, async (_e, refresh) => {
    const s = await getAiStatus(refresh === true)
    // A deep refresh (e.g. after an API key change) updates every window, not just the caller.
    if (refresh === true) push(s)
    return s
  })
  h(IPC.aiGetSettings, () => store.getAiSettings())

  h(IPC.aiSetChoice, (_e, raw) => {
    const choice = validateChoice(raw)
    if (!choice) throw new Error('Unknown AI choice.')
    log(`ai choice: ${JSON.stringify(choice)}`)
    // Picking the Bloop model is the explicit "use it": same path as the Use Bloop model button.
    if (choice.kind === 'local' && choice.runtime === 'bloop') return enableBloop(choice)
    return saved(store.saveAiSettings({ choice }))
  })

  async function enableBloop(choice: AiChoice): Promise<AiSettings> {
    const v = await localModule.verifyBloop()
    if (!v.ok) throw new Error(v.error ?? 'The Bloop model could not be verified.')
    return saved(store.saveAiSettings({ choice, bloopEnabled: true }))
  }

  // "Use Bloop model" / "Turn off". Nothing is downloaded here.
  h(IPC.aiSetBloopEnabled, async (_e, enabled) => {
    if (enabled === true) {
      const st = (await getAiStatus()).local.bloop
      if (st.source == null) throw new Error("The Bloop model isn't on this device yet.")
      return enableBloop({ kind: 'local', runtime: 'bloop', model: st.id })
    }
    const cur = store.getAiSettings()
    const choice: AiChoice = cur.choice.kind === 'local' && cur.choice.runtime === 'bloop' ? { kind: 'auto' } : cur.choice
    const next = saved(store.saveAiSettings({ choice, bloopEnabled: false }))
    await localModule.unloadBloop()
    return next
  })

  h(IPC.aiSetCloudModel, (_e, provider, model) => {
    const id = provider as CloudProviderId
    if (!CLOUD_PROVIDER_IDS.includes(id) || typeof model !== 'string' || !model.trim() || model.trim().length > 200) throw new Error('Unknown model.')
    const cur = store.getAiSettings()
    const choice: AiChoice = cur.choice.kind === 'cloud' && cur.choice.provider === id ? { ...cur.choice, model: model.trim() } : cur.choice
    return saved(store.saveAiSettings({ cloudModels: { ...cur.cloudModels, [id]: model.trim() }, choice }))
  })

  h(IPC.aiSetOllamaUrl, (_e, url) => {
    const ollamaUrl = normalizeOllamaUrl(url)
    if (!ollamaUrl) throw new Error('That Ollama URL looks wrong. Use something like http://127.0.0.1:11434')
    return saved(store.saveAiSettings({ ollamaUrl }))
  })

  // Downloads ONLY when the renderer passes confirmed === true (the user clicked Download).
  h(IPC.aiDownloadBloop, (_e, confirmed) => localModule.downloadBloop(confirmed === true))
  h(IPC.aiCancelBloop, () => localModule.cancelBloopDownload())
  h(IPC.aiDeleteBloop, async () => {
    await localModule.deleteBloop()
    aiChanged()
  })
  h(IPC.aiImportBloop, async (e) => {
    const win = BrowserWindow.fromWebContents(e.sender)
    const opts: Electron.OpenDialogOptions = {
      title: 'Import a Bloop model (.gguf)',
      properties: ['openFile'],
      filters: [{ name: 'GGUF model', extensions: ['gguf'] }]
    }
    const r = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts)
    const file = r.filePaths[0]
    if (r.canceled || !file) return { ok: false, error: 'cancelled' }
    const res = await localModule.importBloop(file)
    aiChanged()
    return res
  })
  h(IPC.aiDismissBloopOffer, () => {
    saved(store.saveAiSettings({ bloopOfferDismissed: true }))
  })

  // Pulls ONLY when confirmed === true.
  h(IPC.aiPullOllama, (_e, model, confirmed) =>
    typeof model === 'string' && model.length <= 200 ? localModule.pullOllama(model, confirmed === true) : { ok: false, error: 'No model given.' }
  )

  h(IPC.aiSetApiKey, async (_e, provider, key) => {
    if (provider !== 'anthropic' && provider !== 'openrouter') return { ok: false, error: 'Unknown provider.' }
    if (!cloudModule) return { ok: false, error: 'Cloud providers are not available in this build yet.' }
    if (key != null && (typeof key !== 'string' || key.length > 4096)) return { ok: false, error: 'That does not look like an API key.' }
    const r = await cloudModule.setApiKey(provider, typeof key === 'string' ? key : null)
    aiChanged()
    return r
  })

  h(IPC.aiTest, async (_e, raw) => {
    const choice = raw == null ? undefined : validateChoice(raw)
    if (raw != null && !choice) return { ok: false, ms: 0, error: 'Unknown AI choice.' }
    const t0 = Date.now()
    const p = await registry.resolve(choice ?? undefined)
    if (p instanceof Error) return { ok: false, ms: Date.now() - t0, error: p.message }
    try {
      const text = await p.complete(TEST_PROMPT, { maxTokens: 24, timeoutMs: 120_000 })
      return { ok: true, ms: Date.now() - t0, sample: text.trim().slice(0, 120) }
    } catch (e) {
      return { ok: false, ms: Date.now() - t0, error: (e as Error).message }
    }
  })

  app.on('before-quit', () => void localModule.dispose())
}
