import { useCallback, useEffect, useState } from 'react'
import type { AiChoice, AiSettings, AiStatus, DownloadProgress, LocalStatus } from '@shared/ai'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { Icon } from '../../lib/Icon'
import { errMsg } from '../../lib/format'
import { formatBytes, useAi } from '../../hooks/useAi'
import { BloopConfirm } from './BloopConfirm'
import CloudSection from './CloudSection'
import './ai.css'

type View = 'auto' | 'local' | 'cloud'
const SUGGESTED_OLLAMA = 'qwen3.5:0.8b'
const sameModel = (a: string, b: string): boolean => {
  const n = (s: string): string => (s.includes(':') ? s : `${s}:latest`).toLowerCase()
  return n(a) === n(b)
}

function Progress({ p, label }: { p: DownloadProgress; label: string }): JSX.Element {
  const pct = p.totalBytes ? Math.min(100, Math.round((p.receivedBytes / p.totalBytes) * 100)) : null
  const indeterminate = pct == null || p.state === 'verifying'
  return (
    <div className="ai-progress">
      <div
        className={`ai-bar${indeterminate ? ' ai-bar--busy' : ''}`}
        role="progressbar"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={100}
        {...(pct != null ? { 'aria-valuenow': pct } : {})}
      >
        <span style={{ width: `${indeterminate ? 100 : pct}%` }} />
      </div>
      <div className="ai-progress-meta num">
        <span>
          {p.state === 'verifying'
            ? 'Verifying…'
            : `${formatBytes(p.receivedBytes)}${p.totalBytes ? ` / ${formatBytes(p.totalBytes)}` : ''}`}
        </span>
        <span>
          {p.state === 'running' && p.bytesPerSec > 0 ? `${formatBytes(p.bytesPerSec)}/s · ` : ''}
          {pct != null && p.state === 'running' ? `${pct}%` : ''}
        </span>
      </div>
    </div>
  )
}

function Segmented({ value, onChange }: { value: View; onChange: (v: View) => void }): JSX.Element {
  const opts: [View, string][] = [
    ['auto', 'Auto'],
    ['local', 'Use Local'],
    ['cloud', 'Cloud']
  ]
  return (
    <div className="ai-seg" role="tablist" aria-label="Where AI runs">
      {opts.map(([v, label]) => (
        <button
          key={v}
          type="button"
          role="tab"
          aria-selected={value === v}
          className={`ai-seg-btn${value === v ? ' is-on' : ''}`}
          onClick={() => onChange(v)}
        >
          {label}
        </button>
      ))}
    </div>
  )
}

function BloopGroup({
  bloop,
  selected,
  onSelect,
  onAskDownload,
  onEnable,
  onDisable,
  busyNote
}: {
  bloop: LocalStatus['bloop']
  selected: boolean
  onSelect: () => void
  onAskDownload: () => void
  onEnable: () => void
  onDisable: () => void
  busyNote: (msg: string | null) => void
}): JSX.Element {
  const ai = window.studyPet.ai
  const [askDelete, setAskDelete] = useState(false)
  const bundled = bloop.source === 'bundled'
  const on = bundled && bloop.enabled && selected
  const p = bloop.progress
  const downloading = p?.state === 'running' || p?.state === 'verifying'
  const published = Boolean(bloop.url)
  const tag = bundled ? (
    on ? <span className="tag">On</span> : <span className="tag tag--muted">Off</span>
  ) : downloading ? (
    <span className="tag tag--dashed">Downloading</span>
  ) : bloop.downloaded ? (
    <span className="tag">On this device</span>
  ) : published ? (
    <span className="tag tag--muted">Not downloaded</span>
  ) : (
    <span className="tag tag--muted">Not published yet</span>
  )

  const importFile = async (): Promise<void> => {
    try {
      const r = await ai.importBloopModelFile()
      if (!r.ok && r.error !== 'cancelled') busyNote(r.error ?? 'Import failed.')
      else if (r.ok) {
        busyNote(null)
        onSelect()
      }
    } catch (e) {
      busyNote(errMsg(e))
    }
  }

  if (bundled) {
    return (
      <div className="ai-group">
        <div className="ai-group-head">
          <h3>Bloop model</h3>
          <span className="faint">included with Bloop</span>
        </div>
        <div className={`ai-row ai-row--bloop${on ? ' is-selected' : ''}`}>
          <div className="ai-pick" role="radio" aria-checked={on}>
            <span className="ai-radio" aria-hidden />
            <span className="ai-pick-text">
              <span className="ai-name">{bloop.label}</span>
              <span className="ai-sub faint">
                {on ? 'On · runs on this device' : 'Included with Bloop · off'}
                {bloop.sizeBytes ? <> · <span className="num">{formatBytes(bloop.sizeBytes)}</span></> : null}
              </span>
            </span>
            {tag}
          </div>
          <p className="ai-note faint">Runs fully on this device. Nothing leaves your computer.</p>
          <div className="ai-actions">
            {on ? (
              <button type="button" className="btn btn--small" onClick={onDisable}>
                Turn off
              </button>
            ) : (
              <button type="button" className="btn btn--small btn--primary" onClick={onEnable}>
                Use Bloop model
              </button>
            )}
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="ai-group">
      <div className="ai-group-head">
        <h3>Bloop model</h3>
        <span className="faint">runs in the app</span>
      </div>
      <div className={`ai-row ai-row--bloop${selected ? ' is-selected' : ''}`}>
        <button
          type="button"
          role="radio"
          aria-checked={selected}
          className="ai-pick"
          onClick={() => (bloop.downloaded ? onSelect() : published && !downloading ? onAskDownload() : undefined)}
        >
          <span className="ai-radio" aria-hidden />
          <span className="ai-pick-text">
            <span className="ai-name">{bloop.label}</span>
            <span className="ai-sub faint">
              Writes your study plans on this device. Nothing leaves your computer.
              {bloop.sizeBytes ? <> · <span className="num">{formatBytes(bloop.sizeBytes)}</span></> : null}
            </span>
          </span>
          {tag}
        </button>
        {downloading && p && <Progress p={p} label="Bloop model download" />}
        {p?.state === 'error' && (
          <p className="ai-note ai-note--error">
            <Icon name="alert" size={13} />
            {p.error ?? 'Download failed.'}
          </p>
        )}
        {p?.state === 'cancelled' && !bloop.downloaded && <p className="ai-note faint">Paused. Download again to resume.</p>}
        <div className="ai-actions">
          {downloading ? (
            <button type="button" className="btn btn--small" onClick={() => void ai.cancelBloopDownload()}>
              <Icon name="close" size={12} />
              Cancel
            </button>
          ) : !bloop.downloaded ? (
            <button
              type="button"
              className="btn btn--small btn--primary"
              disabled={!published}
              title={published ? undefined : 'Not published yet'}
              onClick={onAskDownload}
            >
              <Icon name="download" size={13} />
              {published ? 'Download…' : 'Download · Not published yet'}
            </button>
          ) : null}
          {!downloading && (
            <button type="button" className="btn btn--small" onClick={() => void importFile()}>
              <Icon name="folder" size={13} />
              Import .gguf…
            </button>
          )}
          {bloop.downloaded && !downloading && (
            <button type="button" className="btn btn--small btn--danger" onClick={() => setAskDelete(true)}>
              <Icon name="trash" size={13} />
              Delete
            </button>
          )}
        </div>
      </div>
      <ConfirmDialog
        open={askDelete}
        title="Delete the Bloop model?"
        confirmLabel="Delete"
        onCancel={() => setAskDelete(false)}
        onConfirm={() => {
          setAskDelete(false)
          void ai.deleteBloopModel()
        }}
      >
        <p>This frees {bloop.sizeBytes ? `about ${formatBytes(bloop.sizeBytes)}` : 'the disk space it uses'}. You can download or import it again later.</p>
      </ConfirmDialog>
    </div>
  )
}

function OllamaGroup({
  ollama,
  settings,
  onSelect,
  onSettings,
  onRefresh
}: {
  ollama: LocalStatus['ollama']
  settings: AiSettings
  onSelect: (model: string) => void
  onSettings: (s: AiSettings) => void
  onRefresh: () => Promise<void>
}): JSX.Element {
  const ai = window.studyPet.ai
  const [askPull, setAskPull] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [url, setUrl] = useState(settings.ollamaUrl)
  const [urlErr, setUrlErr] = useState<string | null>(null)
  const [pullErr, setPullErr] = useState<string | null>(null)
  useEffect(() => setUrl(settings.ollamaUrl), [settings.ollamaUrl])

  const pull = ollama.pull
  const pulling = pull?.state === 'running'
  const hasSuggested = ollama.models.some((m) => sameModel(m.name, SUGGESTED_OLLAMA))
  const selectedModel = settings.choice.kind === 'local' && settings.choice.runtime === 'ollama' ? settings.choice.model : null

  const refresh = async (): Promise<void> => {
    setRefreshing(true)
    try {
      await onRefresh()
    } finally {
      setRefreshing(false)
    }
  }
  const saveUrl = async (): Promise<void> => {
    if (url.trim() === settings.ollamaUrl) return
    try {
      onSettings(await ai.setOllamaUrl(url))
      setUrlErr(null)
      await onRefresh()
    } catch (e) {
      setUrlErr(errMsg(e))
    }
  }
  const doPull = async (): Promise<void> => {
    setAskPull(false)
    setPullErr(null)
    const r = await ai.pullOllamaModel(SUGGESTED_OLLAMA, true)
    if (!r.ok) setPullErr(r.error ?? 'Pull failed.')
    else onSelect(SUGGESTED_OLLAMA)
  }

  const statusLine = ollama.running ? (
    <span className="tag tag--outline">Running{ollama.version ? ` · v${ollama.version}` : ''}</span>
  ) : ollama.installed ? (
    <span className="tag tag--dashed">Installed, not running</span>
  ) : (
    <span className="tag tag--muted">Not found</span>
  )

  return (
    <div className="ai-group">
      <div className="ai-group-head">
        <h3>Ollama models</h3>
        {statusLine}
        <button type="button" className="btn btn--small btn--ghost ai-refresh" disabled={refreshing} onClick={() => void refresh()}>
          <Icon name="refresh" size={12} />
          {refreshing ? 'Checking…' : 'Refresh'}
        </button>
      </div>

      {!ollama.running && (
        <p className="ai-note faint">
          {ollama.installed ? (
            <>Ollama is installed but not running: open Ollama, then Refresh.</>
          ) : (
            <>
              Use models you already run with Ollama. Install it from{' '}
              <a href="https://ollama.com/download" target="_blank" rel="noreferrer">
                ollama.com
              </a>
              , then run <code>ollama pull {SUGGESTED_OLLAMA}</code>.
            </>
          )}
        </p>
      )}

      {ollama.running && ollama.models.length === 0 && <p className="ai-note faint">No models installed in Ollama yet.</p>}

      {ollama.models.length > 0 && (
        <div className="ai-list" role="radiogroup" aria-label="Ollama model">
          {ollama.models.map((m) => {
            const sel = selectedModel != null && sameModel(selectedModel, m.name)
            return (
              <button
                key={m.name}
                type="button"
                role="radio"
                aria-checked={sel}
                className={`ai-row ai-pick ai-pick--row${sel ? ' is-selected' : ''}`}
                onClick={() => onSelect(m.name)}
              >
                <span className="ai-radio" aria-hidden />
                <span className="ai-pick-text">
                  <span className="ai-name mono">{m.name}</span>
                  {m.family && <span className="ai-sub faint">{m.family}</span>}
                </span>
                <span className="num faint">{formatBytes(m.sizeBytes)}</span>
              </button>
            )
          })}
        </div>
      )}

      {ollama.running && !hasSuggested && (
        <div className="ai-offer">
          <div>
            <strong>Pull {SUGGESTED_OLLAMA} with Ollama?</strong>
            <span className="faint"> The small Qwen3.5 model Bloop is tuned around, about 1 GB.</span>
          </div>
          {pulling && pull ? (
            <Progress p={pull} label={`Pulling ${pull.model}`} />
          ) : (
            <button type="button" className="btn btn--small" onClick={() => setAskPull(true)}>
              <Icon name="download" size={13} />
              Pull…
            </button>
          )}
          {(pullErr || pull?.state === 'error') && (
            <p className="ai-note ai-note--error">
              <Icon name="alert" size={13} />
              {pullErr ?? pull?.error}
            </p>
          )}
        </div>
      )}

      <details className="ai-advanced">
        <summary>Advanced</summary>
        <label className="field field--wide">
          <span className="field-label">Ollama URL</span>
          <input
            className="text-input"
            value={url}
            spellCheck={false}
            onChange={(e) => setUrl(e.target.value)}
            onBlur={() => void saveUrl()}
            onKeyDown={(e) => e.key === 'Enter' && void saveUrl()}
          />
          {urlErr ? <span className="field-help ai-note--error">{urlErr}</span> : <span className="faint field-help">Default http://127.0.0.1:11434</span>}
        </label>
      </details>

      <ConfirmDialog
        open={askPull}
        eyebrow="Ollama"
        title={`Pull ${SUGGESTED_OLLAMA}?`}
        confirmLabel="Pull"
        cancelLabel="Not now"
        onCancel={() => setAskPull(false)}
        onConfirm={() => void doPull()}
      >
        <p>
          Pull <strong>{SUGGESTED_OLLAMA}</strong> with Ollama? Ollama downloads it (about 1 GB) and keeps it with your other Ollama
          models. It runs on this device.
        </p>
      </ConfirmDialog>
    </div>
  )
}

/** Settings → AI: Auto / Use Local / Cloud. */
export function AiSection(): JSX.Element {
  const { status, settings, setSettings, refresh } = useAi()
  const ai = window.studyPet.ai
  const [view, setView] = useState<View | null>(null)
  const [askBloop, setAskBloop] = useState(false)
  const [note, setNote] = useState<string | null>(null)
  const [test, setTest] = useState<{ busy: boolean; text: string | null; ok: boolean }>({ busy: false, text: null, ok: true })

  useEffect(() => {
    if (settings && view == null) setView(settings.choice.kind)
  }, [settings, view])

  const choose = useCallback(
    (choice: AiChoice) => {
      ai.setChoice(choice)
        .then((s) => {
          setSettings(s)
          setNote(null)
        })
        .catch((e) => setNote(errMsg(e)))
    },
    [ai, setSettings]
  )

  const onView = (v: View): void => {
    setView(v)
    if (v === 'auto') choose({ kind: 'auto' })
  }

  const download = async (): Promise<void> => {
    setAskBloop(false)
    if (!status) return
    const id = status.local.bloop.id
    const r = await ai.downloadBloopModel(true)
    if (r.ok) choose({ kind: 'local', runtime: 'bloop', model: id })
    else if (r.error && !/cancelled/i.test(r.error)) setNote(r.error)
  }

  const runTest = async (): Promise<void> => {
    setTest({ busy: true, text: null, ok: true })
    try {
      const r = await ai.test()
      setTest({
        busy: false,
        ok: r.ok,
        text: r.ok ? `“${r.sample ?? ''}” · ${(r.ms / 1000).toFixed(1)}s` : (r.error ?? 'Test failed.')
      })
    } catch (e) {
      setTest({ busy: false, ok: false, text: errMsg(e) })
    }
  }

  if (!status || !settings || !view) {
    return (
      <section className="card ai-card enter">
        <h2>AI</h2>
        <p className="faint">Checking what’s available…</p>
      </section>
    )
  }

  const bloopSelected = settings.choice.kind === 'local' && settings.choice.runtime === 'bloop'
  const enableBloop = (): void => {
    ai.setBloopEnabled(true)
      .then((s) => {
        setSettings(s)
        setNote(null)
      })
      .catch((e) => setNote(errMsg(e)))
  }
  const disableBloop = (): void => {
    ai.setBloopEnabled(false)
      .then((s) => {
        setSettings(s)
        setNote(null)
      })
      .catch((e) => setNote(errMsg(e)))
  }

  return (
    <section className="card ai-card enter" aria-labelledby="ai-h">
      <div className="section-head">
        <h2 id="ai-h">AI</h2>
        <Segmented value={view} onChange={onView} />
      </div>
      <p className="section-sub muted">
        Writes your weekly study plan. {view === 'auto' && 'Auto uses the first ready option: on this device first, then cloud.'}
        {view === 'local' && 'Runs on this computer. Pick one model.'}
        {view === 'cloud' && 'Uses a tool or API key you already have.'}
      </p>

      {view === 'auto' && <AutoSummary status={status} onPick={setView} />}

      {view === 'local' && (
        <div className="ai-local">
          <BloopGroup
            bloop={status.local.bloop}
            selected={bloopSelected}
            onSelect={() => choose({ kind: 'local', runtime: 'bloop', model: status.local.bloop.id })}
            onAskDownload={() => setAskBloop(true)}
            onEnable={enableBloop}
            onDisable={disableBloop}
            busyNote={setNote}
          />
          <OllamaGroup
            ollama={status.local.ollama}
            settings={settings}
            onSettings={setSettings}
            onSelect={(model) => choose({ kind: 'local', runtime: 'ollama', model })}
            onRefresh={() => refresh(true)}
          />
        </div>
      )}

      {view === 'cloud' && <CloudSection status={status.cloud} settings={settings} onChoose={choose} api={ai} />}

      {note && (
        <p className="ai-note ai-note--error" role="alert">
          <Icon name="alert" size={13} />
          {note}
        </p>
      )}

      <div className="ai-foot">
        <span className="ai-active">
          {status.active ? (
            <>
              <span className="mark level-good" aria-hidden /> Using <strong>{status.active.label}</strong>
            </>
          ) : (
            <>
              <span className="mark level-none" aria-hidden /> Nothing ready yet
            </>
          )}
        </span>
        <span className="ai-test">
          {test.text && <span className={test.ok ? 'faint' : 'ai-note--error'}>{test.text}</span>}
          <button type="button" className="btn btn--small" disabled={test.busy || !status.active} onClick={() => void runTest()}>
            <Icon name="spark" size={12} />
            {test.busy ? 'Testing…' : 'Test'}
          </button>
        </span>
      </div>

      <BloopConfirm
        open={askBloop}
        bloop={status.local.bloop}
        onDownload={() => void download()}
        onNotNow={() => {
          setAskBloop(false)
          void ai.dismissBloopOffer()
        }}
      />
    </section>
  )
}

function AutoSummary({ status, onPick }: { status: AiStatus; onPick: (v: View) => void }): JSX.Element {
  const { bloop, ollama } = status.local
  const bloopDetail =
    bloop.source === 'bundled'
      ? bloop.enabled
        ? 'included, on'
        : 'included, off until you turn it on'
      : bloop.downloaded
        ? 'on this device'
        : 'not downloaded'
  const cloudReady = status.cloud.filter((c) => c.available)
  const rows: [string, string, boolean][] = [
    ['Bloop model', bloopDetail, bloop.downloaded && bloop.enabled],
    ['Ollama', ollama.running ? `${ollama.models.length} model${ollama.models.length === 1 ? '' : 's'}` : ollama.installed ? 'not running' : 'not found', ollama.running && ollama.models.length > 0],
    ['Cloud', cloudReady.length ? cloudReady.map((c) => c.label).join(', ') : 'none set up', cloudReady.length > 0]
  ]
  return (
    <div className="ai-auto">
      <ol className="ai-order">
        {rows.map(([name, detail, ready]) => (
          <li key={name} className={ready ? 'is-ready' : ''}>
            <span className={`mark ${ready ? 'level-good' : 'level-none'}`} aria-hidden />
            <span className="ai-name">{name}</span>
            <span className="faint">{detail}</span>
          </li>
        ))}
      </ol>
      {!status.active && (
        <div className="ai-actions">
          <button type="button" className="btn btn--small btn--primary" onClick={() => onPick('local')}>
            Set up Use Local
          </button>
          <button type="button" className="btn btn--small" onClick={() => onPick('cloud')}>
            Set up Cloud
          </button>
        </div>
      )}
    </div>
  )
}
