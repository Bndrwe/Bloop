// Chat with Bloop (#/chat, its own window). Conversations are stored by the main process in
// userData/chats; this view lists them, shows one, and sends messages to the AI in use.
import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { CHAT_INPUT_MAX, type ChatErrorCode, type ChatSummary, type Conversation } from '@shared/chat'
import { useAi } from '../hooks/useAi'
import { Pet } from '../pet/Pet'
import { Icon } from '../lib/Icon'
import { errMsg } from '../lib/format'
import { RichText } from './chatMarkdown'
import './chat.css'

const SUGGESTIONS = ['Plan my evening', "I can't focus, help", 'Quiz me on CHEM 201']

function Glyph({ d, size = 15 }: { d: string; size?: number }): JSX.Element {
  return (
    <svg className="icon" width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={d} />
    </svg>
  )
}
const PENCIL = 'M10.8 2.8l2.4 2.4-7.6 7.6-3 .6.6-3z'
const LIST = 'M3 4.5h10M3 8h10M3 11.5h7'
const SEARCH = 'M7 12a5 5 0 1 1 0-10 5 5 0 0 1 0 10zM10.6 10.6l3 3'
/** Speech bubble, used for the Chat entry points. */
export const CHAT_GLYPH = 'M3 3.5h10a1.5 1.5 0 0 1 1.5 1.5v5a1.5 1.5 0 0 1-1.5 1.5H7.5L4.5 14v-2.5H3A1.5 1.5 0 0 1 1.5 10V5A1.5 1.5 0 0 1 3 3.5z'
export function ChatGlyph({ size = 13 }: { size?: number }): JSX.Element {
  return <Glyph d={CHAT_GLYPH} size={size} />
}

function when(ms: number): string {
  const d = new Date(ms)
  const now = new Date()
  if (d.toDateString() === now.toDateString()) return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  const days = Math.round((now.getTime() - ms) / 864e5)
  if (days < 7) return d.toLocaleDateString([], { weekday: 'short' })
  return d.toLocaleDateString([], { month: 'short', day: 'numeric' })
}

function useWide(): boolean {
  const q = '(min-width: 640px)'
  const [wide, setWide] = useState(() => window.matchMedia(q).matches)
  useEffect(() => {
    const m = window.matchMedia(q)
    const on = (): void => setWide(m.matches)
    m.addEventListener('change', on)
    return () => m.removeEventListener('change', on)
  }, [])
  return wide
}

interface ChatError {
  code: ChatErrorCode
  message: string
}

function ConversationList(props: {
  items: ChatSummary[]
  activeId: string | null
  onPick: (id: string) => void
  onNew: () => void
  onRenamed: () => void
  onDelete: (id: string) => void
  onClear: () => void
}): JSX.Element {
  const [query, setQuery] = useState('')
  const [editing, setEditing] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  const [askDelete, setAskDelete] = useState<string | null>(null)
  const [askClear, setAskClear] = useState(false)
  const q = query.trim().toLowerCase()
  const shown = q ? props.items.filter((c) => c.title.toLowerCase().includes(q) || c.preview.toLowerCase().includes(q)) : props.items

  const commit = async (id: string): Promise<void> => {
    const t = draft.trim()
    setEditing(null)
    if (t) await window.studyPet.chat.rename(id, t).catch(() => null)
    props.onRenamed()
  }

  return (
    <nav className="chat-list" aria-label="Conversations">
      <div className="chat-list-head">
        <button className="btn btn--small btn--primary chat-new" onClick={props.onNew}>
          <Icon name="plus" size={13} />
          New chat
        </button>
        <label className="chat-search">
          <Glyph d={SEARCH} size={13} />
          <span className="visually-hidden">Search chats</span>
          <input type="search" placeholder="Search chats" value={query} onChange={(e) => setQuery(e.target.value)} maxLength={100} />
        </label>
      </div>
      <ul className="chat-items">
        {shown.map((c) => (
          <li key={c.id} className={`chat-item${c.id === props.activeId ? ' is-active' : ''}`}>
            {editing === c.id ? (
              <input
                className="chat-rename"
                aria-label="Chat name"
                value={draft}
                autoFocus
                maxLength={80}
                onChange={(e) => setDraft(e.target.value)}
                onBlur={() => void commit(c.id)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void commit(c.id)
                  if (e.key === 'Escape') { e.stopPropagation(); setEditing(null) }
                }}
              />
            ) : askDelete === c.id ? (
              <div className="chat-item-confirm" role="group" aria-label={`Delete ${c.title}?`} onKeyDown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); setAskDelete(null) } }}>
                <span>Delete this chat?</span>
                <button className="btn btn--small btn--danger" autoFocus onClick={() => (setAskDelete(null), props.onDelete(c.id))}>
                  Delete
                </button>
                <button className="btn btn--small btn--ghost" onClick={() => setAskDelete(null)}>
                  Cancel
                </button>
              </div>
            ) : (
              <>
                <button className="chat-item-main" onClick={() => props.onPick(c.id)} aria-current={c.id === props.activeId ? 'true' : undefined}>
                  <span className="chat-item-title">{c.title}</span>
                  <span className="chat-item-meta faint">
                    <span className="num">{when(c.updatedAt)}</span>
                    {c.preview && <span className="chat-item-preview">{c.preview}</span>}
                  </span>
                </button>
                <span className="chat-item-actions">
                  <button
                    className="icon-btn"
                    aria-label={`Rename ${c.title}`}
                    title="Rename"
                    onClick={() => {
                      setDraft(c.title)
                      setEditing(c.id)
                    }}
                  >
                    <Glyph d={PENCIL} size={13} />
                  </button>
                  <button className="icon-btn" aria-label={`Delete ${c.title}`} title="Delete" onClick={() => setAskDelete(c.id)}>
                    <Icon name="trash" size={13} />
                  </button>
                </span>
              </>
            )}
          </li>
        ))}
        {shown.length === 0 && <li className="chat-items-empty faint">{q ? 'No chats match.' : 'No chats yet.'}</li>}
      </ul>
      {props.items.length > 0 && (
        <div className="chat-list-foot">
          {askClear ? (
            <div className="chat-item-confirm" role="group" aria-label="Delete all chats?" onKeyDown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); setAskClear(false) } }}>
              <span>Delete all {props.items.length} chats?</span>
              <button className="btn btn--small btn--danger" autoFocus onClick={() => (setAskClear(false), props.onClear())}>
                Delete all
              </button>
              <button className="btn btn--small btn--ghost" onClick={() => setAskClear(false)}>
                Cancel
              </button>
            </div>
          ) : (
            <button className="btn btn--small btn--ghost" onClick={() => setAskClear(true)}>
              <Icon name="trash" size={12} />
              Delete all chats
            </button>
          )}
        </div>
      )}
    </nav>
  )
}

export function ChatView(): JSX.Element {
  const chat = window.studyPet.chat
  const { status, refresh } = useAi()
  const wide = useWide()
  const [items, setItems] = useState<ChatSummary[]>([])
  const [conv, setConv] = useState<Conversation | null>(null)
  const [loaded, setLoaded] = useState(false)
  const [draft, setDraft] = useState('')
  const [pending, setPending] = useState<{ id: string; provider?: string } | null>(null)
  const [error, setError] = useState<ChatError | null>(null)
  const [shareStats, setShareStats] = useState<boolean | null>(null)
  const [listOpen, setListOpen] = useState(false)
  const scroller = useRef<HTMLDivElement>(null)
  const input = useRef<HTMLTextAreaElement>(null)

  const active = status?.active ?? null
  const noAi = status != null && active == null

  // Share study stats: on by default for on-device models, off for cloud ones (the user can flip it).
  useEffect(() => {
    if (shareStats == null && status) setShareStats(status.active?.kind !== 'cloud')
  }, [status, shareStats])

  // This window isn't sent AI status pushes; re-read it whenever the user comes back to it.
  useEffect(() => {
    const on = (): void => void refresh().catch(() => undefined)
    window.addEventListener('focus', on)
    return () => window.removeEventListener('focus', on)
  }, [refresh])

  useEffect(() => chat.onThinking((t) => setPending((p) => (t.thinking ? { id: t.id, provider: t.provider } : p?.id === t.id ? null : p))), [chat])

  const reload = useCallback(async (): Promise<ChatSummary[]> => {
    const l = await chat.list().catch(() => [] as ChatSummary[])
    setItems(l)
    return l
  }, [chat])

  useEffect(() => {
    void (async () => {
      const l = await reload()
      const first = l[0]
      if (first) setConv(await chat.get(first.id).catch(() => null))
      setLoaded(true)
    })()
  }, [chat, reload])

  useEffect(() => {
    const el = scroller.current
    if (el) el.scrollTop = el.scrollHeight
  }, [conv?.id, conv?.messages.length, pending, error])

  const pick = async (id: string): Promise<void> => {
    setError(null)
    setListOpen(false)
    setConv(await chat.get(id).catch(() => null))
    input.current?.focus()
  }

  const newChat = async (): Promise<void> => {
    setError(null)
    setListOpen(false)
    try {
      setConv(await chat.create())
      await reload()
    } catch (e) {
      setError({ code: 'error', message: errMsg(e) })
    }
    input.current?.focus()
  }

  const run = async (id: string, text: string, retry: boolean): Promise<void> => {
    setError(null)
    setPending({ id })
    try {
      const r = await chat.send(id, text, { shareStats: shareStats ?? false, retry })
      if (r.ok) setConv(r.conversation)
      else {
        if (r.conversation) setConv(r.conversation)
        if (r.code === 'invalid' && !retry && !r.conversation?.messages.some((m) => m.content === text.trim())) setDraft(text)
        setError({ code: r.code, message: r.error })
        if (r.code === 'no-ai') void refresh().catch(() => undefined)
      }
    } catch (e) {
      setError({ code: 'error', message: errMsg(e) })
    } finally {
      setPending((p) => (p?.id === id ? null : p))
      void reload()
    }
  }

  const send = async (raw: string): Promise<void> => {
    const text = raw.trim()
    if (!text || pending || text.length > CHAT_INPUT_MAX) return
    let c = conv
    if (!c) {
      try {
        c = await chat.create()
      } catch (e) {
        setError({ code: 'error', message: errMsg(e) })
        return
      }
    }
    // Show the message right away; the stored conversation replaces this when the reply lands.
    setConv({ ...c, messages: [...c.messages, { role: 'user', content: text, at: Date.now() }] })
    setDraft('')
    await run(c.id, text, false)
  }

  const retry = (): void => {
    if (conv && !pending) void run(conv.id, '', true)
  }

  const remove = async (id: string): Promise<void> => {
    await chat.delete(id).catch(() => undefined)
    const l = await reload()
    if (conv?.id === id) {
      setError(null)
      const next = l[0]
      setConv(next ? await chat.get(next.id).catch(() => null) : null)
    }
  }

  const clearAll = async (): Promise<void> => {
    await chat.clear().catch(() => undefined)
    setConv(null)
    setError(null)
    setPending(null)
    await reload()
  }

  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>): void => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault()
      void send(draft)
    }
  }

  const messages = conv?.messages ?? []
  const thinking = pending != null && pending.id === conv?.id
  const lastIsUser = messages[messages.length - 1]?.role === 'user'
  const title = conv && messages.length ? conv.title : 'Chat with Bloop'
  const showList = wide || listOpen
  const cloudNote = useMemo(() => (active?.kind === 'cloud' ? active.label : null), [active])

  return (
    <div className={`chat${wide ? ' chat--wide' : ''}`} onKeyDown={(e) => e.key === 'Escape' && listOpen && setListOpen(false)}>
      {showList && (
        <>
          {!wide && <div className="chat-scrim" onClick={() => setListOpen(false)} aria-hidden="true" />}
          <ConversationList
            items={items}
            activeId={conv?.id ?? null}
            onPick={(id) => void pick(id)}
            onNew={() => void newChat()}
            onRenamed={() => {
              void reload()
              if (conv) void chat.get(conv.id).then((c) => c && setConv(c))
            }}
            onDelete={(id) => void remove(id)}
            onClear={() => void clearAll()}
          />
        </>
      )}

      <main className="chat-main">
        <header className="chat-head">
          {!wide && (
            <button className="icon-btn icon-btn--pill" aria-label="Show chats" aria-expanded={listOpen} onClick={() => setListOpen((v) => !v)}>
              <Glyph d={LIST} />
            </button>
          )}
          <div className="chat-head-text">
            <h1 title={title}>{title}</h1>
            <p className="faint">{status == null ? 'Checking AI…' : active ? `via ${active.label}` : 'No AI set up yet'}</p>
          </div>
          <button className="icon-btn icon-btn--pill" aria-label="New chat" title="New chat" onClick={() => void newChat()}>
            <Icon name="plus" size={15} />
          </button>
        </header>

        <div className="chat-scroll" ref={scroller}>
          {noAi && (
            <section className="card chat-setup">
              <p>Bloop needs an AI to chat. Turn on the Bloop model, an Ollama model or a cloud provider.</p>
              <button className="btn btn--small btn--primary" onClick={() => void window.studyPet.openSettings()}>
                <Icon name="gear" size={13} />
                Set up AI in Settings → AI
              </button>
            </section>
          )}

          {loaded && messages.length === 0 && !thinking && (
            <section className="chat-empty">
              <Pet mood="wave" size={84} />
              <h2 className="serif">Hi, I’m Bloop.</h2>
              <p className="muted">Ask me anything about your studies. Your chats stay on this computer.</p>
              <div className="chat-suggest">
                {SUGGESTIONS.map((s) => (
                  <button key={s} className="btn btn--small" onClick={() => void send(s)} disabled={pending != null}>
                    {s}
                  </button>
                ))}
              </div>
            </section>
          )}

          <ol className="chat-msgs" role="log" aria-live="polite" aria-relevant="additions" aria-label="Messages">
            {messages.map((m, i) =>
              m.role === 'user' ? (
                <li key={i} className="msg msg--user">
                  <span className="visually-hidden">You said:</span>
                  <div className="bubble">{m.content}</div>
                </li>
              ) : (
                <li key={i} className="msg msg--bloop">
                  <Pet mood="happy" size={24} />
                  <div className="bubble">
                    <span className="visually-hidden">Bloop said:</span>
                    <RichText text={m.content} />
                  </div>
                </li>
              )
            )}
          </ol>

          {thinking && (
            <div className="msg msg--bloop msg--typing" aria-live="polite">
              <Pet mood="happy" size={24} />
              <div className="bubble" aria-label={`Bloop is thinking${pending?.provider ? ` via ${pending.provider}` : ''}`}>
                <span className="dot" />
                <span className="dot" />
                <span className="dot" />
              </div>
            </div>
          )}

          {error && !thinking && (
            <div className="chat-error" role="alert">
              <p>
                <Icon name="alert" size={13} />
                {error.code === 'cancelled' ? 'Stopped. Bloop didn’t finish that reply.' : error.message}
              </p>
              <div className="chat-error-actions">
                {lastIsUser && (
                  <button className="btn btn--small" onClick={retry}>
                    <Icon name="refresh" size={12} />
                    Retry
                  </button>
                )}
                {error.code === 'no-ai' && (
                  <button className="btn btn--small btn--primary" onClick={() => void window.studyPet.openSettings()}>
                    <Icon name="gear" size={12} />
                    Set up AI in Settings → AI
                  </button>
                )}
              </div>
            </div>
          )}
        </div>

        <footer className="chat-compose">
          <div className="chat-options">
            <label className="chat-share">
              <span className="toggle">
                <input type="checkbox" checked={shareStats ?? false} onChange={(e) => setShareStats(e.target.checked)} />
                <span />
              </span>
              Share my study stats with Bloop
            </label>
            {cloudNote && <p className="chat-cloud-note faint">Each message is sent to {cloudNote}.</p>}
          </div>
          <div className="chat-input">
            <label className="visually-hidden" htmlFor="chat-text">
              Message Bloop
            </label>
            <textarea
              id="chat-text"
              ref={input}
              rows={2}
              placeholder="Message Bloop…"
              value={draft}
              maxLength={CHAT_INPUT_MAX}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={onKey}
              aria-describedby="chat-count"
            />
            <div className="chat-input-bar">
              <span id="chat-count" className={`num faint${draft.length > CHAT_INPUT_MAX * 0.9 ? ' chat-count--near' : ''}`}>
                {draft.length} / {CHAT_INPUT_MAX}
              </span>
              <span className="faint chat-hint"><span className="chat-hint-long">Enter to send · Shift+Enter for a new line</span><span className="chat-hint-short">Enter to send</span></span>
              {thinking ? (
                <button className="btn btn--small" onClick={() => conv && void chat.cancel(conv.id)}>
                  <Icon name="stop" size={12} />
                  Stop
                </button>
              ) : (
                <button className="btn btn--small btn--primary" onClick={() => void send(draft)} disabled={!draft.trim() || pending != null}>
                  Send
                </button>
              )}
            </div>
          </div>
        </footer>
      </main>
    </div>
  )
}
