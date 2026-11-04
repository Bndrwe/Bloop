import { useEffect, useId, useMemo, useRef, useState } from 'react'
import type { KeyboardEvent, MouseEvent } from 'react'
import type { AiApi, AiChoice, AiSettings, CloudProviderId, CloudProviderStatus } from '@shared/ai'
import './cloud.css'

interface Props {
  status: CloudProviderStatus[]
  settings: AiSettings
  onChoose(choice: AiChoice): void
  api: AiApi
}

type Model = { id: string; label: string }

const MAX_LISTED = 60

/** Open a help link in the system browser (uses a preload openExternal when present, else a normal link). */
function openLink(e: MouseEvent<HTMLAnchorElement>, url: string): void {
  const w = window.studyPet as unknown as { openExternal?: (u: string) => unknown } | undefined
  if (typeof w?.openExternal === 'function') {
    e.preventDefault()
    void w.openExternal(url)
  }
}

function ModelSelect({ label, value, models, onChange }: { label: string; value: string; models: Model[]; onChange(v: string): void }) {
  const list = models.some((m) => m.id === value) || !value ? models : [{ id: value, label: value }, ...models]
  return (
    <select className="cloud-select" aria-label={label} value={value} onChange={(e) => onChange(e.target.value)}>
      {list.map((m) => (
        <option key={m.id || 'default'} value={m.id}>
          {m.label}
        </option>
      ))}
    </select>
  )
}

/** Searchable model picker (ARIA 1.2 combobox with a listbox popup). */
function ModelCombobox({ label, value, models, onChange }: { label: string; value: string; models: Model[]; onChange(v: string): void }) {
  const uid = useId()
  const listId = `${uid}-list`
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  const wrap = useRef<HTMLDivElement>(null)

  const selected = models.find((m) => m.id === value)
  const matches = useMemo(() => {
    const terms = query.toLowerCase().split(/\s+/).filter(Boolean)
    const hit = terms.length ? models.filter((m) => terms.every((t) => m.id.toLowerCase().includes(t) || m.label.toLowerCase().includes(t))) : models
    return hit.slice(0, MAX_LISTED)
  }, [models, query])
  const custom = query.trim() && /^[\w.:/@+-]+\/[\w.:/@+-]+$/.test(query.trim()) && !models.some((m) => m.id === query.trim()) ? query.trim() : null
  const options: Model[] = custom ? [...matches, { id: custom, label: `Use "${custom}"` }] : matches

  useEffect(() => setActive(0), [query])
  useEffect(() => {
    if (!open) return
    const off = (e: globalThis.MouseEvent): void => {
      if (!wrap.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', off)
    return () => document.removeEventListener('mousedown', off)
  }, [open])

  const pick = (id: string): void => {
    onChange(id)
    setOpen(false)
    setQuery('')
  }
  const onKey = (e: KeyboardEvent<HTMLInputElement>): void => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setOpen(true)
      setActive((a) => Math.min(a + 1, options.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActive((a) => Math.max(a - 1, 0))
    } else if (e.key === 'Enter' && open && options[active]) {
      e.preventDefault()
      pick(options[active].id)
    } else if (e.key === 'Escape' && open) {
      e.preventDefault()
      setOpen(false)
      setQuery('')
    }
  }

  return (
    <div className="cloud-combo" ref={wrap}>
      <input
        className="cloud-input"
        role="combobox"
        aria-label={label}
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={open && options[active] ? `${uid}-o${active}` : undefined}
        placeholder="Search models…"
        spellCheck={false}
        autoComplete="off"
        value={open ? query : (selected?.label ?? value)}
        title={value}
        onFocus={() => setOpen(true)}
        onChange={(e) => {
          setQuery(e.target.value)
          setOpen(true)
        }}
        onKeyDown={onKey}
      />
      {open && (
        <ul className="cloud-list" role="listbox" id={listId} aria-label={`${label} results`}>
          {options.length === 0 && <li className="cloud-list__empty">No models match</li>}
          {options.map((m, i) => (
            <li
              key={m.id}
              id={`${uid}-o${i}`}
              role="option"
              aria-selected={m.id === value}
              className={`cloud-opt${i === active ? ' is-active' : ''}${m.id === value ? ' is-selected' : ''}`}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => pick(m.id)}
              onMouseEnter={() => setActive(i)}
            >
              <span>{m.label}</span>
              {m.label !== m.id && <span className="cloud-opt__id">{m.id}</span>}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function KeyField({ provider, label, isSet, api }: { provider: 'anthropic' | 'openrouter'; label: string; isSet: boolean; api: AiApi }) {
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)

  const run = async (key: string | null): Promise<void> => {
    setBusy(true)
    setMsg(null)
    try {
      const r = await api.setApiKey(provider, key)
      if (r.ok) {
        setDraft('')
        setMsg({ ok: true, text: key === null ? 'Key removed.' : 'Key saved (encrypted on this computer).' })
        void api.getStatus(true).catch(() => undefined)
      } else setMsg({ ok: false, text: r.error ?? "Couldn't save the key." })
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message })
    } finally {
      setBusy(false)
    }
  }

  return (
    <form
      className="cloud-key"
      onSubmit={(e) => {
        e.preventDefault()
        if (draft.trim()) void run(draft.trim())
      }}
    >
      <input
        className="cloud-input"
        type="password"
        aria-label={`${label} API key`}
        placeholder={isSet ? 'Paste a new key to replace' : 'Paste API key'}
        autoComplete="off"
        spellCheck={false}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        disabled={busy}
      />
      <button type="submit" className="btn btn--small btn--primary" disabled={busy || !draft.trim()}>
        Save
      </button>
      <button type="button" className="btn btn--small" disabled={busy || !isSet} onClick={() => void run(null)}>
        Remove
      </button>
      <p className={`cloud-msg${msg && !msg.ok ? ' is-error' : ''}`} role={msg && !msg.ok ? 'alert' : 'status'}>
        {msg?.text ?? ''}
      </p>
    </form>
  )
}

export default function CloudSection({ status, settings, onChoose, api }: Props) {
  const [models, setModels] = useState<Partial<Record<CloudProviderId, string>>>({})

  const current = (p: CloudProviderStatus): string => {
    const own = models[p.id]
    if (own !== undefined) return own
    const remembered = settings.cloudModels[p.id]
    if (remembered !== undefined) return remembered
    if (settings.choice.kind === 'cloud' && settings.choice.provider === p.id && settings.choice.model) return settings.choice.model
    return p.defaultModel ?? ''
  }
  const choose = (p: CloudProviderStatus, model: string): void => onChoose({ kind: 'cloud', provider: p.id, ...(model ? { model } : {}) })
  const changeModel = (p: CloudProviderStatus, model: string, selected: boolean): void => {
    setModels((m) => ({ ...m, [p.id]: model }))
    void api.setCloudModel(p.id, model).catch(() => undefined)
    if (selected) choose(p, model)
  }

  return (
    <div className="cloud" role="radiogroup" aria-label="Cloud AI provider">
      {status.map((p) => {
        const selected = settings.choice.kind === 'cloud' && settings.choice.provider === p.id
        const model = current(p)
        const isApi = p.kind === 'api'
        const statusText = p.available
          ? isApi
            ? `${p.detail ?? 'key set'} ✓`
            : `found at ${p.detail}`
          : (p.detail ?? (isApi ? 'no key' : 'not installed'))
        return (
          <div key={p.id} className={`cloud-row${selected ? ' is-selected' : ''}${p.available ? '' : ' is-off'}`}>
            <div className="cloud-row__main">
              <button
                type="button"
                role="radio"
                aria-checked={selected}
                aria-disabled={!p.available}
                className="cloud-pick"
                onClick={() => p.available && choose(p, model)}
                title={p.available ? `Use ${p.label}` : isApi ? 'Add an API key first' : 'Install it first'}
              >
                <span className="cloud-dot" aria-hidden="true" />
                <span className="cloud-name">{p.label}</span>
                <span className="tag tag--outline cloud-badge">{isApi ? 'API' : 'CLI'}</span>
                <span className="cloud-status">{statusText}</span>
              </button>
              {!p.available && !p.detail?.startsWith('saved key') && (
                <a className="cloud-link" href={p.helpUrl} target="_blank" rel="noreferrer noopener" onClick={(e) => openLink(e, p.helpUrl)}>
                  {isApi ? 'Get a key' : 'Install'} →
                </a>
              )}
              {p.available && p.kind === 'cli' && (
                <a className="cloud-link cloud-link--quiet" href={p.helpUrl} target="_blank" rel="noreferrer noopener" onClick={(e) => openLink(e, p.helpUrl)}>
                  Docs
                </a>
              )}
              {p.id === 'openrouter' ? (
                <ModelCombobox label={`${p.label} model`} value={model} models={p.models} onChange={(v) => changeModel(p, v, selected)} />
              ) : (
                <ModelSelect label={`${p.label} model`} value={model} models={p.models} onChange={(v) => changeModel(p, v, selected)} />
              )}
            </div>
            {isApi && (
              <>
                <KeyField provider={p.id as 'anthropic' | 'openrouter'} label={p.label} isSet={p.available} api={api} />
                {!p.available && (
                  <p className="cloud-hint">
                    Keys are stored encrypted on this computer and never shown again.
                  </p>
                )}
              </>
            )}
          </div>
        )
      })}
    </div>
  )
}
