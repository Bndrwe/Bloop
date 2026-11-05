// Security review v2, checks 1-2: chat ids cannot escape the chats folder, the chat IPC runs the
// sender guard and validates arguments before touching the store, input caps are enforced in main,
// chat contents never reach the log, and the renderer has no raw-HTML sinks.
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CHAT_INPUT_MAX } from '../src/shared/chat'
import { ChatService, registerChatIpc, validateSend, type ChatIpcEvent } from '../src/main/chat'
import { ChatStore, isChatId, newChatId } from '../src/main/chatStore'
import type { AiProvider } from '../src/main/ai/types'
import { IPC } from '../src/shared/ipc'

let root: string
let dir: string
let logs: string[]
let t: number

const makeStore = (): ChatStore => new ChatStore(dir, { now: () => ++t, log: (m) => logs.push(m) })

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'bloop-sec2-chat-'))
  dir = join(root, 'chats')
  logs = []
  t = 1_700_000_000_000
})
afterEach(() => rmSync(root, { recursive: true, force: true }))

describe('chat ids (check 2: no path traversal)', () => {
  it.each(['../x', 'c_../../etc', 'c_../../etc/passwd', 'c_abc/../../x', 'c_abcdef/..', '/etc/passwd', 'c_ABCDEF12', 'c_abc', 'c_' + 'a'.repeat(41), '', 'c_abc\u0000def', 'c_abcdef.json', '..\\x'])(
    'rejects %j',
    (id) => {
      expect(isChatId(id)).toBe(false)
    }
  )

  it.each([null, undefined, 42, {}, ['c_abcdef12'], true])('rejects non-string %j', (id) => {
    expect(isChatId(id)).toBe(false)
  })

  it('accepts the ids newChatId produces', () => {
    for (let i = 0; i < 20; i++) expect(isChatId(newChatId(1_700_000_000_000 + i))).toBe(true)
  })

  it('store get/delete/append/rename never touch a file outside the chats folder', () => {
    const victim = join(root, 'victim.json')
    writeFileSync(victim, '{"keep":true}')
    const store = makeStore()
    const c = store.create()
    for (const bad of ['../victim', 'c_../victim', '../../victim', '/etc/passwd']) {
      expect(store.get(bad)).toBeNull()
      expect(store.delete(bad)).toBe(false)
      expect(store.append(bad, [{ role: 'user', content: 'x', at: 1 }])).toBeNull()
      expect(store.rename(bad, 'title')).toBeNull()
    }
    expect(readFileSync(victim, 'utf8')).toBe('{"keep":true}')
    // the real chat is untouched and still the only conversation file
    expect(store.get(c.id)?.id).toBe(c.id)
    expect(readdirSync(dir).filter((n) => n.endsWith('.json') && n !== 'index.json')).toEqual([`${c.id}.json`])
  })

  it('the chat IPC rejects traversal ids before the store is called', async () => {
    const store = makeStore()
    const spy = vi.spyOn(store, 'get')
    const { handlers, ipc } = fakeIpc()
    registerChatIpc(ipc as never, { service: new ChatService({ store, resolve: async () => new Error('x'), getSystem: () => '', getContext: () => ({}) as never, log: () => undefined }), store, guard: () => undefined, openChat: () => undefined, log: () => undefined })
    await expect(handlers.get(IPC.chatGet)!(event(), '../x')).rejects.toThrow('Invalid chat id.')
    await expect(handlers.get(IPC.chatGet)!(event(), 'c_../../etc')).rejects.toThrow('Invalid chat id.')
    expect(spy).not.toHaveBeenCalled()
  })
})

describe('chat storage writes are atomic (check 2)', () => {
  it('leaves no temp files behind after creates, appends and renames', () => {
    const store = makeStore()
    const c = store.create()
    store.append(c.id, [{ role: 'user', content: 'hello', at: 1 }, { role: 'assistant', content: 'hi', at: 2 }])
    store.rename(c.id, 'A new title')
    const names = readdirSync(dir)
    expect(names.filter((n) => n.endsWith('.tmp') || n.endsWith('.corrupt'))).toEqual([])
    expect(JSON.parse(readFileSync(join(dir, `${c.id}.json`), 'utf8')).title).toBe('A new title')
  })

  it('a leftover half-written temp file is ignored, not listed or parsed as a chat', () => {
    const store = makeStore()
    store.create()
    writeFileSync(join(dir, 'c_abcdef12.json.deadbeef.tmp'), '{"id":"c_abcdef12"')
    const ids = store.list().map((x) => x.id)
    expect(ids.every((id) => isChatId(id))).toBe(true)
    expect(ids).not.toContain('c_abcdef12')
  })

  it('chat files are written owner-only', () => {
    const store = makeStore()
    const c = store.create()
    if (process.platform !== 'win32') expect(statSync(join(dir, `${c.id}.json`)).mode & 0o777).toBe(0o600)
  })
})

describe('chat input caps are enforced in main (check 5 style, applied to chat)', () => {
  it('validateSend rejects over-long text, bad ids and bad options', () => {
    expect(validateSend('c_abcdef12', 'x'.repeat(CHAT_INPUT_MAX * 2 + 1), undefined)).toBe('Invalid message.')
    expect(validateSend('c_abcdef12', 42, undefined)).toBe('Invalid message.')
    expect(validateSend('../x', 'hi', undefined)).toBe('Invalid chat id.')
    expect(validateSend('c_abcdef12', 'hi', 'yes')).toBe('Invalid options.')
    expect(validateSend('c_abcdef12', 'hi', ['x'])).toBe('Invalid options.')
    const ok = validateSend('c_abcdef12', 'hi', { shareStats: 'true', retry: 1 })
    expect(ok).toEqual({ id: 'c_abcdef12', text: 'hi', opts: { shareStats: false, retry: false } })
  })

  it('a message over CHAT_INPUT_MAX characters never reaches the provider', async () => {
    const store = makeStore()
    const c = store.create()
    const complete = vi.fn(async () => 'ok')
    const svc = new ChatService({ store, resolve: async () => provider(complete), getSystem: () => '', getContext: () => ({}) as never, log: (m) => logs.push(m) })
    const r = await svc.send(c.id, 'x'.repeat(CHAT_INPUT_MAX + 1), { shareStats: false, retry: false }, 1)
    expect(r.ok).toBe(false)
    expect(complete).not.toHaveBeenCalled()
  })

  it('the rename IPC rejects titles over 1000 characters and non-string titles', async () => {
    const store = makeStore()
    const c = store.create()
    const { handlers, ipc } = fakeIpc()
    registerChatIpc(ipc as never, { service: new ChatService({ store, resolve: async () => new Error('x'), getSystem: () => '', getContext: () => ({}) as never }), store, guard: () => undefined, openChat: () => undefined, log: () => undefined })
    await expect(handlers.get(IPC.chatRename)!(event(), c.id, 'x'.repeat(1001))).rejects.toThrow('Invalid title.')
    await expect(handlers.get(IPC.chatRename)!(event(), c.id, { toString: () => 'x' })).rejects.toThrow('Invalid title.')
  })
})

describe('the chat IPC runs the sender guard first (check 1)', () => {
  it('a guard refusal stops the handler before the store is read', async () => {
    const store = makeStore()
    const spy = vi.spyOn(store, 'list')
    const { handlers, ipc } = fakeIpc()
    const guard = vi.fn((ch: string) => {
      throw new Error(`Blocked IPC "${ch}" from an untrusted sender.`)
    })
    registerChatIpc(ipc as never, { service: new ChatService({ store, resolve: async () => new Error('x'), getSystem: () => '', getContext: () => ({}) as never }), store, guard, openChat: () => undefined, log: () => undefined })
    await expect(handlers.get(IPC.chatList)!(event())).rejects.toThrow('untrusted sender')
    expect(guard).toHaveBeenCalledWith(IPC.chatList, expect.anything())
    expect(spy).not.toHaveBeenCalled()
  })
})

describe('message contents never reach the log (check 2)', () => {
  const MARKER = 'PRIVATE-MARKER-7f3a9c'

  it('a send that fails in the provider logs only ids and counts', async () => {
    const store = makeStore()
    const c = store.create()
    const failing = provider(async () => {
      throw new Error(`provider echoed ${MARKER}`)
    })
    const svc = new ChatService({ store, resolve: async () => failing, getSystem: () => '', getContext: () => ({}) as never, log: (m) => logs.push(m) })
    const r = await svc.send(c.id, `my question ${MARKER}`, { shareStats: false, retry: false }, 1)
    expect(r.ok).toBe(false)
    expect(logs.length).toBeGreaterThan(0)
    expect(logs.join('\n')).not.toContain(MARKER)
  })

  it('a successful send and a rename log nothing with the text in it', async () => {
    const store = makeStore()
    const c = store.create()
    const svc = new ChatService({ store, resolve: async () => provider(async () => `reply ${MARKER}`), getSystem: () => '', getContext: () => ({}) as never, log: (m) => logs.push(m) })
    const r = await svc.send(c.id, `question ${MARKER}`, { shareStats: true, retry: false }, 1)
    expect(r.ok).toBe(true)
    store.rename(c.id, `title ${MARKER}`)
    expect(logs.join('\n')).not.toContain(MARKER)
  })

  it('the IPC error log carries the message only and never the request arguments', async () => {
    const store = makeStore()
    const ipcLogs: string[] = []
    const { handlers, ipc } = fakeIpc()
    store.append = () => {
      throw new Error('disk full')
    }
    const c = store.create() as { id: string }
    registerChatIpc(ipc as never, { service: new ChatService({ store, resolve: async () => new Error('x'), getSystem: () => '', getContext: () => ({}) as never }), store, guard: () => undefined, openChat: () => undefined, log: (m) => ipcLogs.push(m) })
    await (handlers.get(IPC.chatSend) as (...a: unknown[]) => Promise<unknown>)(event(), c.id, `secret ${MARKER}`, undefined).catch(() => undefined)
    expect(ipcLogs.join('\n')).not.toContain(MARKER)
  })

  it('chat sources only log through the injected logger (no bare console calls)', () => {
    for (const f of ['chat.ts', 'chatStore.ts', 'chatApp.ts']) {
      const src = readFileSync(join(process.cwd(), 'src/main', f), 'utf8')
      const bare = src.split('\n').filter((l) => /console\.(log|info|warn|error|debug)\(/.test(l) && !l.includes('const log') && !l.includes('?? ((m'))
      // the only allowed console calls are the default loggers passed in as `?? ((m) => console.log(...))`
      expect(bare, f).toEqual([])
    }
  })
})

describe('renderer has no raw-HTML sinks (check 2)', () => {
  it('no dangerouslySetInnerHTML, innerHTML assignment, or document.write under src/renderer', () => {
    const hits: string[] = []
    const walk = (d: string): void => {
      for (const n of readdirSync(d)) {
        const p = join(d, n)
        if (statSync(p).isDirectory()) walk(p)
        else if (/\.(tsx?|jsx?)$/.test(n)) {
          readFileSync(p, 'utf8')
            .split('\n')
            .forEach((l, i) => {
              if (/dangerouslySetInnerHTML|\.innerHTML\s*=|insertAdjacentHTML|document\.write|outerHTML\s*=/.test(l)) hits.push(`${p}:${i + 1}`)
            })
        }
      }
    }
    walk(join(process.cwd(), 'src/renderer'))
    expect(hits).toEqual([])
  })

  it('chat markdown emits no links or raw HTML (no href in the markdown renderer)', () => {
    const src = readFileSync(join(process.cwd(), 'src/renderer/src/views/chatMarkdown.tsx'), 'utf8')
    expect(src).not.toMatch(/href=|dangerouslySetInnerHTML/)
  })
})

// ------------------------------------------------------------------ helpers

function event(): ChatIpcEvent {
  return { sender: { id: 1, isDestroyed: () => false, send: () => undefined } } as unknown as ChatIpcEvent
}

function fakeIpc(): { handlers: Map<string, (...a: unknown[]) => unknown>; ipc: { handle(ch: string, fn: (...a: unknown[]) => unknown): void } } {
  const handlers = new Map<string, (...a: unknown[]) => unknown>()
  return { handlers, ipc: { handle: (ch, fn) => void handlers.set(ch, fn) } }
}

function provider(complete: (prompt: string) => Promise<string>): AiProvider {
  return { label: 'Test model', kind: 'local', complete: (p) => complete(p) }
}

