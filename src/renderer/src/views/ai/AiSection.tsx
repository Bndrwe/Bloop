import { useCallback, useEffect, useState } from 'react'
import { ollamaSetupStep, type AiChoice, type AiSettings, type AiStatus, type CloudProviderId, type DownloadProgress, type LocalStatus } from '@shared/ai'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { Icon } from '../../lib/Icon'
import { errMsg } from '../../lib/format'
import { formatBytes, useAi } from '../../hooks/useAi'
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

const OLLAMA_DOWNLOAD_URL = 'https://ollama.com/download'

const STEP_TITLES: Record<1 | 2 | 3, string> = { 1: 'Install Ollama', 2: 'Get a model', 3: 'Pick a model' }

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
  const step = ollamaSetupStep(ollama)

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

  const checkAgain = (
    <button type="button" className="btn btn--small" disabled={refreshing} onClick={() => void refresh()}>
      <Icon name="refresh" size={12} />
      {refreshing ? 'Checking…' : 'Check again'}
    </button>
  )

  const pullProgress = (
    <>
      {pulling && pull && <Progress p={pull} label={`Pulling ${pull.model}`} />}
      {(pullErr || pull?.state === 'error') && (
        <p className="ai-note ai-note--error">
          <Icon name="alert" size={13} />
          {pullErr ?? pull?.error}
        </p>
      )}
    </>
  )

  const body: Record<1 | 2 | 3, JSX.Element> = {
    1: ollama.installed ? (
      <>
        <p className="ai-note faint">Ollama is installed but not running. Open the Ollama app, then press Check again.</p>
        <div className="ai-actions">{checkAgain}</div>
      </>
    ) : (
      <>
        <p className="ai-note faint">Ollama is a free app that runs AI models on your computer. Nothing you write leaves it.</p>
        <div className="ai-actions">
          <button type="button" className="btn btn--small btn--primary" onClick={() => void window.studyPet.openExternal(OLLAMA_DOWNLOAD_URL)}>
            <Icon name="download" size={13} />
            Download Ollama
          </button>
          {checkAgain}
        </div>
        <p className="ai-note faint">Already installed? Open the Ollama app, then press Check again.</p>
      </>
    ),
    2: (
      <>
        <p className="ai-note faint">
          Ollama is running but has no models yet. Get <code>{SUGGESTED_OLLAMA}</code>, a small, fast model that works well with Bloop (about 1 GB).
        </p>
        <div className="ai-actions">
          <button type="button" className="btn btn--small btn--primary" disabled={pulling} onClick={() => setAskPull(true)}>
            <Icon name="download" size={13} />
            {pulling ? 'Getting it…' : `Get ${SUGGESTED_OLLAMA}…`}
          </button>
          {checkAgain}
        </div>
        {pullProgress}
        <p className="ai-note faint">
          Want a different model? Run <code>ollama pull &lt;name&gt;</code> in a terminal, then press Check again.
        </p>
      </>
    ),
    3: (
      <>
        <p className="ai-note faint">Pick the model Bloop should use. Auto never uses Ollama on its own, so this is how you turn it on.</p>
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
        {!hasSuggested && (
          <div className="ai-actions">
            <button type="button" className="btn btn--small" disabled={pulling} onClick={() => setAskPull(true)}>
              <Icon name="download" size={13} />
              {pulling ? 'Getting it…' : `Get ${SUGGESTED_OLLAMA}…`}
            </button>
          </div>
        )}
        {pullProgress}
        <p className="ai-note faint">
          Other models: run <code>ollama pull &lt;name&gt;</code> in a terminal, then Refresh.
        </p>
      </>
    )
  }

  return (
    <div className="ai-group">
      <div className="ai-group-head">
        <h3>Ollama</h3>
        {statusLine}
        <button type="button" className="btn btn--small btn--ghost ai-refresh" disabled={refreshing} onClick={() => void refresh()}>
          <Icon name="refresh" size={12} />
          {refreshing ? 'Checking…' : 'Refresh'}
        </button>
      </div>

      <p className="faint ai-steps__count" aria-live="polite">
        Setup: step {step} of 3
      </p>
      <ol className="ai-steps" aria-label="Ollama setup">
        {([1, 2, 3] as const).map((n) => {
          const state = n < step ? 'done' : n === step ? 'current' : 'todo'
          return (
            <li key={n} className={`ai-step ai-step--${state}`} {...(state === 'current' ? { 'aria-current': 'step' as const } : {})}>
              <div className="ai-step__head">
                <span className="ai-step__num num" aria-hidden>
                  {state === 'done' ? <Icon name="check" size={11} /> : n}
                </span>
                <span className="ai-step__title">
                  Step {n}: {STEP_TITLES[n]}
                  {state === 'done' && <span className="visually-hidden"> (done)</span>}
                </span>
              </div>
              {state === 'current' && <div className="ai-step__body">{body[n]}</div>}
            </li>
          )
        })}
      </ol>

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
        title={`Get ${SUGGESTED_OLLAMA}?`}
        confirmLabel="Download"
        cancelLabel="Not now"
        onCancel={() => setAskPull(false)}
        onConfirm={() => void doPull()}
      >
        <p>
          Ollama downloads <strong>{SUGGESTED_OLLAMA}</strong> (about 1 GB) and keeps it with your other Ollama models. It runs on this
          device.
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
  const [note, setNote] = useState<string | null>(null)
  const [test, setTest] = useState<{ busy: boolean; text: string | null; ok: boolean }>({ busy: false, text: null, ok: true })

  useEffect(() => {
    if (settings && view == null) setView(settings.choice.kind)
  }, [settings, view])

  const choose = useCallback(
    (choice: AiChoice) => {
      ai.setChoice(choice)
        .then(async (s) => {
          // Picking a cloud provider by hand is also "use it in Auto": it goes to the front of the list.
          if (choice.kind === 'cloud') s = await ai.setAutoCloud([choice.provider, ...s.autoCloud.filter((id) => id !== choice.provider)])
          setSettings(s)
          setNote(null)
        })
        .catch((e) => setNote(errMsg(e)))
    },
    [ai, setSettings]
  )

  const setAutoCloud = useCallback(
    (list: CloudProviderId[]) => {
      ai.setAutoCloud(list)
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

  return (
    <section className="card ai-card enter" aria-labelledby="ai-h">
      <div className="section-head">
        <h2 id="ai-h">AI</h2>
        <Segmented value={view} onChange={onView} />
      </div>
      <p className="section-sub muted">
        Writes your weekly study plan. {view === 'auto' && 'Auto tries the cloud providers you turned on for it, in the order below. To run a model on this computer, pick an Ollama model in Use Local.'}
        {view === 'local' && 'Runs on this computer with Ollama. Pick one model.'}
        {view === 'cloud' && 'Uses a tool or API key you already have.'}
      </p>

      {view === 'auto' && <AutoSummary status={status} settings={settings} onPick={setView} />}

      {view === 'local' && (
        <div className="ai-local">
          <OllamaGroup
            ollama={status.local.ollama}
            settings={settings}
            onSettings={setSettings}
            onSelect={(model) => choose({ kind: 'local', runtime: 'ollama', model })}
            onRefresh={() => refresh(true)}
          />
        </div>
      )}

      {view === 'cloud' && <CloudSection status={status.cloud} settings={settings} onChoose={choose} onAutoCloud={setAutoCloud} api={ai} />}

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

    </section>
  )
}

/** The exact providers Auto will try, first to last: the ready cloud providers the user turned on. Never a local model. */
export function autoOrder(status: AiStatus, settings: AiSettings): string[] {
  const out: string[] = []
  for (const id of settings.autoCloud) {
    const c = status.cloud.find((x) => x.id === id)
    if (!c?.available) continue
    const m = settings.cloudModels[id]
    const ml = m ? (c.models.find((x) => x.id === m)?.label ?? m) : ''
    out.push(ml ? `${c.label} (${ml})` : c.label)
  }
  return out
}

function AutoSummary({ status, settings, onPick }: { status: AiStatus; settings: AiSettings; onPick: (v: View) => void }): JSX.Element {
  const rows: [string, string, boolean][] = settings.autoCloud.map((id) => {
    const c = status.cloud.find((x) => x.id === id)
    return [c?.label ?? id, c?.available ? 'turned on' : 'turned on, but not available', Boolean(c?.available)]
  })
  const order = autoOrder(status, settings)
  return (
    <div className="ai-auto">
      <p className="ai-auto__line" aria-live="polite">
        <strong>Auto uses:</strong> {order.length ? order.map((o, i) => `${i + 1}. ${o}`).join(' · ') : 'nothing yet'}
      </p>
      {rows.length === 0 && <p className="faint">No cloud providers are turned on for Auto yet.</p>}
      <ol className="ai-order">
        {rows.map(([name, detail, ready]) => (
          <li key={name} className={ready ? 'is-ready' : ''}>
            <span className={`mark ${ready ? 'level-good' : 'level-none'}`} aria-hidden />
            <span className="ai-name">{name}</span>
            <span className="faint">{detail}</span>
          </li>
        ))}
      </ol>
      <p className="faint ai-auto__note">Cloud models are only used if you turn them on. Auto never picks an Ollama model by itself.</p>
      {!status.active && (
        <div className="ai-actions">
          <button type="button" className="btn btn--small btn--primary" onClick={() => onPick('cloud')}>
            Set up Cloud
          </button>
          <button type="button" className="btn btn--small" onClick={() => onPick('local')}>
            Use Local
          </button>
        </div>
      )}
    </div>
  )
}
