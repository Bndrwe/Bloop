// Chat with Bloop: the shared contract (window.studyPet.chat). Conversations live only on this
// computer in userData/chats (see src/main/chatStore.ts) and are sent only to the AI in use.

/** Longest message the composer accepts (characters). */
export const CHAT_INPUT_MAX = 2000
/** Longest stored message (UTF-8 bytes); longer replies are trimmed. */
export const CHAT_MESSAGE_MAX_BYTES = 8 * 1024
/** Conversations kept; the least recently updated ones are deleted past this. */
export const CHAT_MAX_CONVERSATIONS = 200
/** Messages kept per conversation; the oldest are dropped past this. */
export const CHAT_MAX_MESSAGES = 500
/** Longest conversation title (characters). */
export const CHAT_TITLE_MAX = 80
export const CHAT_DEFAULT_TITLE = 'New chat'

export interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
  /** epoch ms */
  at: number
  /** Label of the AI that wrote an assistant message, e.g. "Bloop model (on-device)". */
  provider?: string
}

export interface Conversation {
  id: string
  title: string
  createdAt: number
  updatedAt: number
  messages: ChatMessage[]
}

/** One row of the conversation list (userData/chats/index.json). */
export interface ChatSummary {
  id: string
  title: string
  createdAt: number
  updatedAt: number
  count: number
  /** Start of the last message (for search), at most 120 characters. */
  preview: string
}

export interface ChatSendOptions {
  /** Add today's date, session state, focus minutes and the next 3 deadlines to the prompt. */
  shareStats: boolean
  /** Reply to the conversation's trailing user message again instead of adding `text`. */
  retry?: boolean
}

export type ChatErrorCode = 'no-ai' | 'cancelled' | 'busy' | 'timeout' | 'not-found' | 'invalid' | 'error'

export type ChatSendResult =
  | { ok: true; conversation: Conversation; reply: ChatMessage }
  | { ok: false; code: ChatErrorCode; error: string; conversation?: Conversation }

/** Pushed to the window that sent a message while its reply is being written. */
export interface ChatThinking {
  id: string
  thinking: boolean
  provider?: string
}

export interface ChatApi {
  list(): Promise<ChatSummary[]>
  get(id: string): Promise<Conversation | null>
  /** A new empty conversation (reuses the newest one if it is still empty). */
  create(): Promise<Conversation>
  send(id: string, text: string, opts: ChatSendOptions): Promise<ChatSendResult>
  cancel(id: string): Promise<void>
  rename(id: string, title: string): Promise<ChatSummary | null>
  delete(id: string): Promise<void>
  /** Delete all chats. */
  clear(): Promise<void>
  /** Open (or focus) the chat window. */
  open(): Promise<void>
  onThinking(cb: (t: ChatThinking) => void): () => void
}
