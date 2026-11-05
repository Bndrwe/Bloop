// Chat storage (src/main/chatStore.ts): atomic writes, caps, titles, index consistency, delete/clear
// and recovery from corrupted files.
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { CHAT_DEFAULT_TITLE, CHAT_MESSAGE_MAX_BYTES } from '../src/shared/chat'
import { ChatStore, clipBytes, cleanTitle, isChatId, titleFrom } from '../src/main/chatStore'

let dir: string
let logs: string[]
let t: number
const make = (o: { maxConversations?: number; maxMessages?: number } = {}): ChatStore =>
  new ChatStore(dir, { now: () => ++t, log: (m) => logs.push(m), ...o })
const user = (content: string) => ({ role: 'user' as const, content, at: t })
const bot = (content: string) => ({ role: 'assistant' as const, content, at: t, provider: 'Bloop model (on-device)' })
const readIndex = () => JSON.parse(readFileSync(join(dir, 'index.json'), 'utf8')) as { items: { id: string; title: string; count: number }[] }

beforeEach(() => {
  dir = join(mkdtempSync(join(tmpdir(), 'bloop-chat-')), 'chats')
  logs = []
  t = 1_700_000_000_000
})
afterEach(() => rmSync(join(dir, '..'), { recursive: true, force: true }))

describe('titles and limits', () => {
  it('titles a chat from the first ~6 words of the first message', () => {
    expect(titleFrom('Plan my evening')).toBe('Plan my evening')
    expect(titleFrom('  can you help me\nplan my chem   review tonight please?')).toBe('can you help me plan my…')
    expect(titleFrom('   \n ')).toBe(CHAT_DEFAULT_TITLE)
    expect(titleFrom('a'.repeat(200)).length).toBeLessThanOrEqual(61)
    expect(titleFrom('Hello!')).toBe('Hello')
  })
  it('cleans user titles', () => {
    expect(cleanTitle('  Chem\n review ')).toBe('Chem review')
    expect(cleanTitle('x'.repeat(200))).toHaveLength(80)
    expect(cleanTitle('   ')).toBeNull()
    expect(cleanTitle(42)).toBeNull()
  })
  it('clips to 8 KB without splitting characters', () => {
    const s = 'é'.repeat(6000) // 2 bytes each
    const c = clipBytes(s)
    expect(Buffer.byteLength(c)).toBeLessThanOrEqual(CHAT_MESSAGE_MAX_BYTES)
    expect(c).toBe('é'.repeat(4096))
    expect(clipBytes('short')).toBe('short')
  })
  it('accepts only well-formed ids (no paths)', () => {
    expect(isChatId('c_abc123def')).toBe(true)
    for (const bad of ['../x', 'c_../../etc', 'c_ABC123', 'index', '', 'c_a', 42, null]) expect(isChatId(bad)).toBe(false)
  })
})

describe('ChatStore', () => {
  it('creates, appends, auto-titles and keeps the index in step', () => {
    const s = make()
    const c = s.create()
    expect(isChatId(c.id)).toBe(true)
    expect(c.title).toBe(CHAT_DEFAULT_TITLE)
    // an empty newest chat is reused rather than piling up
    expect(s.create().id).toBe(c.id)
    const after = s.append(c.id, [user('Quiz me on CHEM 201 acids and bases'), bot('Sure!')])!
    expect(after.title).toBe('Quiz me on CHEM 201 acids…')
    expect(after.messages).toHaveLength(2)
    const idx = readIndex()
    expect(idx.items).toEqual([expect.objectContaining({ id: c.id, title: after.title, count: 2 })])
    expect(s.list()[0]).toMatchObject({ id: c.id, count: 2, preview: 'Sure!' })
    // a fresh store (next launch) reads the same thing back
    const s2 = make()
    expect(s2.get(c.id)?.messages.map((m) => m.content)).toEqual(['Quiz me on CHEM 201 acids and bases', 'Sure!'])
    expect(s2.list().map((x) => x.id)).toEqual([c.id])
  })

  it('writes atomically: no temp files left, file is complete JSON', () => {
    const s = make()
    const c = s.create()
    s.append(c.id, [user('hi')])
    const files = readdirSync(dir)
    expect(files.filter((f) => f.endsWith('.tmp'))).toEqual([])
    expect(files.sort()).toEqual([`${c.id}.json`, 'index.json'].sort())
    expect(JSON.parse(readFileSync(join(dir, `${c.id}.json`), 'utf8'))).toMatchObject({ id: c.id, messages: [{ role: 'user', content: 'hi' }] })
  })

  it('caps messages per chat, bytes per message and the number of chats', () => {
    const s = make({ maxMessages: 5, maxConversations: 3 })
    const c = s.create()
    for (let i = 0; i < 8; i++) s.append(c.id, [user(`m${i}`)])
    const got = s.get(c.id)!
    expect(got.messages.map((m) => m.content)).toEqual(['m3', 'm4', 'm5', 'm6', 'm7'])
    expect(got.title).toBe('m0') // named from the first message when it arrived; trimming doesn't rename
    s.append(c.id, [bot('x'.repeat(20_000))])
    expect(Buffer.byteLength(s.get(c.id)!.messages.at(-1)!.content)).toBe(CHAT_MESSAGE_MAX_BYTES)

    const ids = [c.id]
    for (let i = 0; i < 3; i++) {
      const n = s.create()
      s.append(n.id, [user(`chat ${i}`)])
      ids.push(n.id)
    }
    const list = s.list().map((x) => x.id)
    expect(list).toHaveLength(3)
    expect(list).not.toContain(c.id) // the least recently updated one went
    expect(existsSync(join(dir, `${c.id}.json`))).toBe(false)
  })

  it('renames, deletes one and clears all', () => {
    const s = make()
    const a = s.create()
    s.append(a.id, [user('first')])
    const b = s.create()
    s.append(b.id, [user('second')])
    expect(s.rename(a.id, '  Chem   review ')?.title).toBe('Chem review')
    expect(s.rename(a.id, '   ')).toBeNull()
    expect(s.rename('c_doesnotexist1', 'x')).toBeNull()
    expect(s.get(a.id)?.title).toBe('Chem review')

    expect(s.delete(a.id)).toBe(true)
    expect(s.get(a.id)).toBeNull()
    expect(readIndex().items.map((x) => x.id)).toEqual([b.id])
    expect(s.delete('../../etc/passwd')).toBe(false)

    s.clear()
    expect(existsSync(dir)).toBe(false)
    expect(s.list()).toEqual([])
    expect(logs.join('\n')).not.toMatch(/first|second/) // never logs contents
  })

  it('rebuilds a lost or corrupted index from the chat files', () => {
    const s = make()
    const a = s.create()
    s.append(a.id, [user('alpha')])
    const b = s.create()
    s.append(b.id, [user('beta')])
    writeFileSync(join(dir, 'index.json'), '{not json')
    const s2 = make()
    expect(s2.list().map((x) => x.id).sort()).toEqual([a.id, b.id].sort())
    expect(readIndex().items).toHaveLength(2)

    // an index entry whose file vanished is dropped; an orphan file is added
    rmSync(join(dir, `${a.id}.json`))
    writeFileSync(join(dir, 'c_orphan12345.json'), JSON.stringify({ id: 'c_orphan12345', title: 'Orphan', createdAt: 1, updatedAt: 2, messages: [] }))
    const s3 = make()
    expect(s3.list().map((x) => x.id).sort()).toEqual([b.id, 'c_orphan12345'].sort())
  })

  it('moves a corrupted chat file aside and keeps going', () => {
    const s = make()
    const a = s.create()
    s.append(a.id, [user('alpha')])
    const b = s.create()
    s.append(b.id, [user('beta')])
    writeFileSync(join(dir, `${a.id}.json`), '{"id": "trunc')
    const s2 = make()
    expect(s2.get(a.id)).toBeNull()
    expect(s2.list().map((x) => x.id)).toEqual([b.id])
    expect(existsSync(join(dir, `${a.id}.json.corrupt`))).toBe(true)
    expect(s2.get(b.id)?.messages[0]?.content).toBe('beta')
    // bad messages inside an otherwise valid file are dropped, not fatal
    writeFileSync(join(dir, `${b.id}.json`), JSON.stringify({ id: b.id, title: 'T', createdAt: 1, updatedAt: 2, messages: [{ role: 'system', content: 'x', at: 1 }, { role: 'user', content: 'ok', at: 2 }, null] }))
    expect(s2.get(b.id)?.messages).toEqual([{ role: 'user', content: 'ok', at: 2 }])
    // a file that claims a different id is not trusted
    writeFileSync(join(dir, `${b.id}.json`), JSON.stringify({ id: 'c_someoneelse1', messages: [] }))
    expect(s2.get(b.id)).toBeNull()
  })
})
