// Chat storage: one JSON file per conversation in userData/chats/<id>.json, plus index.json with
// the list rows. Every write is atomic (write a temp file, then rename over the old one). No
// electron import, so tests run it against a temp folder. Never logs message contents.
import { randomBytes } from 'node:crypto'
import { closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, readdirSync, renameSync, rmSync, unlinkSync, writeSync } from 'node:fs'
import { join } from 'node:path'
import {
  CHAT_DEFAULT_TITLE,
  CHAT_MAX_CONVERSATIONS,
  CHAT_MAX_MESSAGES,
  CHAT_MESSAGE_MAX_BYTES,
  CHAT_TITLE_MAX,
  type ChatMessage,
  type ChatSummary,
  type Conversation
} from '@shared/chat'

const INDEX = 'index.json'
const ID_RE = /^c_[a-z0-9]{6,40}$/
const PREVIEW_MAX = 120

export function isChatId(v: unknown): v is string {
  return typeof v === 'string' && ID_RE.test(v)
}

export function newChatId(now = Date.now()): string {
  return `c_${now.toString(36)}${randomBytes(5).toString('hex')}`
}

/** Trim to at most `maxBytes` of UTF-8 without splitting a character. */
export function clipBytes(s: string, maxBytes = CHAT_MESSAGE_MAX_BYTES): string {
  if (Buffer.byteLength(s, 'utf8') <= maxBytes) return s
  let out = ''
  let used = 0
  for (const ch of s) {
    const n = Buffer.byteLength(ch, 'utf8')
    if (used + n > maxBytes) break
    out += ch
    used += n
  }
  return out
}

/** One line, no control characters, collapsed spaces. */
export function oneLine(s: string): string {
  // eslint-disable-next-line no-control-regex
  return s.replace(/[\u0000-\u001f\u007f\u2028\u2029]+/g, ' ').replace(/\s+/g, ' ').trim()
}

/** Title from the first user message: its first ~6 words, at most 60 characters. */
export function titleFrom(text: string): string {
  const words = oneLine(text).split(' ').filter(Boolean)
  if (!words.length) return CHAT_DEFAULT_TITLE
  let t = words.slice(0, 6).join(' ')
  let cut = words.length > 6
  if (t.length > 60) {
    t = t.slice(0, 60).replace(/\s+\S*$/, '') || t.slice(0, 60)
    cut = true
  }
  t = t.replace(/[\s.,;:!?-]+$/, '')
  return cut ? `${t}…` : t || CHAT_DEFAULT_TITLE
}

/** User-entered title: one line, at most CHAT_TITLE_MAX characters. Empty → null. */
export function cleanTitle(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const t = oneLine(raw).slice(0, CHAT_TITLE_MAX).trim()
  return t || null
}

function writeAtomic(file: string, data: unknown): void {
  const tmp = `${file}.${randomBytes(4).toString('hex')}.tmp`
  try {
    // fsync before the rename: a power loss must not leave an empty file under the real name
    const fd = openSync(tmp, 'w', 0o600)
    try {
      writeSync(fd, JSON.stringify(data), null, 'utf8')
      fsyncSync(fd)
    } finally {
      closeSync(fd)
    }
    renameSync(tmp, file)
  } catch (e) {
    try {
      unlinkSync(tmp)
    } catch {
      /* never written */
    }
    throw e
  }
}

function validMessage(m: unknown): m is ChatMessage {
  if (!m || typeof m !== 'object') return false
  const x = m as Record<string, unknown>
  return (x['role'] === 'user' || x['role'] === 'assistant') && typeof x['content'] === 'string' && Number.isFinite(x['at'])
}

/** Parses a conversation file; null when it is not one. Bad messages are dropped. */
export function parseConversation(raw: unknown, id: string): Conversation | null {
  if (!raw || typeof raw !== 'object') return null
  const c = raw as Record<string, unknown>
  if (c['id'] !== id || !Array.isArray(c['messages'])) return null
  const createdAt = Number.isFinite(c['createdAt']) ? (c['createdAt'] as number) : 0
  const messages = (c['messages'] as unknown[]).filter(validMessage).map((m) => ({
    role: m.role,
    content: clipBytes(m.content),
    at: m.at,
    ...(typeof m.provider === 'string' ? { provider: m.provider.slice(0, 120) } : {})
  }))
  return {
    id,
    title: cleanTitle(c['title']) ?? CHAT_DEFAULT_TITLE,
    createdAt,
    updatedAt: Number.isFinite(c['updatedAt']) ? (c['updatedAt'] as number) : createdAt,
    messages: messages.slice(-CHAT_MAX_MESSAGES)
  }
}

export function summarize(c: Conversation): ChatSummary {
  const last = c.messages[c.messages.length - 1]
  return {
    id: c.id,
    title: c.title,
    createdAt: c.createdAt,
    updatedAt: c.updatedAt,
    count: c.messages.length,
    // Markdown markers stripped so the list reads as plain text.
    preview: last ? oneLine(last.content.replace(/[*_`#]+/g, '')).slice(0, PREVIEW_MAX) : ''
  }
}

export interface ChatStoreOptions {
  now?: () => number
  log?: (m: string) => void
  maxConversations?: number
  maxMessages?: number
}

export class ChatStore {
  private index: ChatSummary[] | null = null
  private readonly now: () => number
  private readonly log: (m: string) => void
  private readonly maxConversations: number
  private readonly maxMessages: number

  /** `dir` may be a function so the path is only read when first used (after app ready). */
  constructor(
    private readonly dir: string | (() => string),
    opts: ChatStoreOptions = {}
  ) {
    this.now = opts.now ?? Date.now
    this.log = opts.log ?? ((m) => console.log(`[bloop] ${m}`))
    this.maxConversations = opts.maxConversations ?? CHAT_MAX_CONVERSATIONS
    this.maxMessages = opts.maxMessages ?? CHAT_MAX_MESSAGES
  }

  private root(): string {
    const d = typeof this.dir === 'function' ? this.dir() : this.dir
    mkdirSync(d, { recursive: true, mode: 0o700 })
    return d
  }

  private file(id: string): string {
    if (!isChatId(id)) throw new Error('Invalid chat id.')
    return join(this.root(), `${id}.json`)
  }

  private readConv(id: string): Conversation | null {
    const f = this.file(id)
    if (!existsSync(f)) return null
    try {
      const c = parseConversation(JSON.parse(readFileSync(f, 'utf8')), id)
      if (c) return c
    } catch {
      /* fall through */
    }
    // Unreadable: keep it aside (not deleted, in case it can be fixed by hand) and drop it from the list.
    this.log(`chat ${id}: unreadable file moved aside`)
    try {
      renameSync(f, `${f}.corrupt`)
    } catch {
      /* ignore */
    }
    return null
  }

  private saveIndex(): void {
    writeAtomic(join(this.root(), INDEX), { version: 1, items: this.index ?? [] })
  }

  /** Loads index.json and reconciles it with the conversation files on disk (once per run). */
  private loadIndex(): ChatSummary[] {
    if (this.index) return this.index
    const dir = this.root()
    let items: ChatSummary[] | null = null
    try {
      const raw = JSON.parse(readFileSync(join(dir, INDEX), 'utf8')) as { items?: unknown }
      if (Array.isArray(raw.items)) items = raw.items.filter((x): x is ChatSummary => !!x && typeof x === 'object' && isChatId((x as ChatSummary).id))
    } catch {
      /* missing or corrupt: rebuilt below */
    }
    const files = new Set(
      readdirSync(dir)
        .filter((n) => n.endsWith('.json') && n !== INDEX)
        .map((n) => n.slice(0, -5))
        .filter(isChatId)
    )
    let changed = items == null
    const byId = new Map<string, ChatSummary>()
    for (const it of items ?? []) {
      if (files.has(it.id) && !byId.has(it.id)) byId.set(it.id, it)
      else changed = true
    }
    // Files written without an index update (crash in between) or a lost index: read them back.
    for (const id of files) {
      if (byId.has(id)) continue
      const c = this.readConv(id)
      if (c) byId.set(id, summarize(c))
      changed = true
    }
    this.index = [...byId.values()].sort((a, b) => b.updatedAt - a.updatedAt)
    if (changed) {
      this.log(`chats: index rebuilt (${this.index.length} conversations)`)
      this.saveIndex()
    }
    return this.index
  }

  private put(c: Conversation): void {
    writeAtomic(this.file(c.id), c)
    const idx = this.loadIndex().filter((x) => x.id !== c.id)
    idx.unshift(summarize(c))
    idx.sort((a, b) => b.updatedAt - a.updatedAt)
    // Cap: drop the least recently updated conversations.
    const drop = idx.splice(this.maxConversations)
    for (const d of drop) this.removeFile(d.id)
    if (drop.length) this.log(`chats: cap reached, removed ${drop.length} old conversation(s)`)
    this.index = idx
    this.saveIndex()
  }

  private removeFile(id: string): void {
    try {
      rmSync(this.file(id), { force: true })
    } catch {
      /* ignore */
    }
  }

  list(): ChatSummary[] {
    return this.loadIndex().map((x) => ({ ...x }))
  }

  get(id: string): Conversation | null {
    if (!isChatId(id)) return null
    this.loadIndex()
    const c = this.readConv(id)
    if (!c && this.index?.some((x) => x.id === id)) {
      this.index = this.index.filter((x) => x.id !== id)
      this.saveIndex()
    }
    return c
  }

  create(): Conversation {
    const newest = this.loadIndex()[0]
    if (newest && newest.count === 0) {
      const c = this.get(newest.id)
      if (c && c.messages.length === 0) return c
    }
    const t = this.now()
    const c: Conversation = { id: newChatId(t), title: CHAT_DEFAULT_TITLE, createdAt: t, updatedAt: t, messages: [] }
    this.put(c)
    this.log(`chat ${c.id} created`)
    return c
  }

  /** Appends messages (trimmed to 8 KB each, newest 500 kept); names the chat from its first user message. */
  append(id: string, msgs: ChatMessage[]): Conversation | null {
    const c = this.get(id)
    if (!c) return null
    for (const m of msgs) {
      c.messages.push({ ...m, content: clipBytes(m.content) })
    }
    if (c.messages.length > this.maxMessages) c.messages = c.messages.slice(-this.maxMessages)
    if (c.title === CHAT_DEFAULT_TITLE) {
      const first = c.messages.find((m) => m.role === 'user')
      if (first) c.title = titleFrom(first.content)
    }
    c.updatedAt = Math.max(this.now(), c.updatedAt)
    this.put(c)
    return c
  }

  rename(id: string, title: unknown): ChatSummary | null {
    const t = cleanTitle(title)
    if (!t) return null
    const c = this.get(id)
    if (!c) return null
    c.title = t
    this.put(c)
    return summarize(c)
  }

  delete(id: string): boolean {
    if (!isChatId(id)) return false
    const idx = this.loadIndex()
    const had = idx.some((x) => x.id === id)
    this.removeFile(id)
    this.index = idx.filter((x) => x.id !== id)
    this.saveIndex()
    this.log(`chat ${id} deleted`)
    return had
  }

  /** Deletes every chat (the whole userData/chats folder). Used by "Delete all chats" and Reset all data. */
  clear(): void {
    const d = typeof this.dir === 'function' ? this.dir() : this.dir
    const n = this.index?.length
    rmSync(d, { recursive: true, force: true })
    this.index = null
    this.log(`chats cleared${n != null ? ` (${n})` : ''}`)
  }
}
