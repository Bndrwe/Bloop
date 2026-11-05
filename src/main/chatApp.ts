// Wires Chat with Bloop into the app: the store in userData/chats, the real AI registry and the
// guarded IPC. Called once from main/index.ts.
import { join } from 'node:path'
import { app, type IpcMain } from 'electron'
import type { AppStatus } from '@shared/types'
import { guardSender } from './ai/guard'
import { trustedOrigins } from './ai/ipc'
import { effectiveSystemPrompt } from './ai/prompts'
import { registry } from './ai/registry'
import { ChatService, registerChatIpc, type ChatIpcEvent } from './chat'
import { ChatStore } from './chatStore'
import { getDeadlines } from './deadlines'
import * as store from './store'

/** userData/chats: one JSON file per conversation plus index.json. Cleared by Reset all data. */
export const chatStore = new ChatStore(() => join(app.getPath('userData'), 'chats'))

export function registerChat(ipcMain: IpcMain, deps: { getStatus: () => AppStatus; openChat: () => void }): ChatService {
  const service = new ChatService({
    store: chatStore,
    resolve: () => registry.resolve(),
    getSystem: () => effectiveSystemPrompt(store.getAiSettings()),
    getContext: () => {
      const dl = getDeadlines()
      return { now: Date.now(), status: deps.getStatus(), stats: store.getStats(), deadlines: dl.ok ? dl.value : [] }
    }
  })
  const origins = trustedOrigins()
  registerChatIpc(ipcMain as unknown as Parameters<typeof registerChatIpc>[0], {
    service,
    store: chatStore,
    guard: (ch, e: ChatIpcEvent) => guardSender(ch, e as unknown as Parameters<typeof guardSender>[1], origins),
    openChat: deps.openChat
  })
  return service
}
