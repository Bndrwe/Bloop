import { useEffect, useRef, useState } from 'react'
import {
  CHECK_CASE_COUNT,
  DEFAULT_SYSTEM_PROMPT,
  SYSTEM_PROMPT_MAX,
  TRY_PROMPT_MAX,
  type AiSettings,
  type AiStatus,
  type CheckCaseResult,
  type CheckResult,
  type ModelCheckProgress,
  type ModelCheckReport,
  type TryPromptResult
} from '@shared/ai'
import { Icon } from '../../lib/Icon'
import { errMsg } from '../../lib/format'

const secs = (ms: number): string => `${(ms / 1000).toFixed(1)} s`

/** Pass = solid dot, fail = empty ring with a cross, no answer = dashed ring. Never colour. */
function Mark({ c, error }: { c: CheckResult; error: boolean }): JSX.Element {
  const kind = c.pass ? 'pass' : error ? 'none' : 'fail'
  const word = c.pass ? 'pass' : error ? 'not run' : 'fail'
  const tip = `${c.label}: ${word}${c.reason ? ` (${c.reason})` : ''}`
  return (
    <li className={`ck-mark ck-mark--${kind}`} title={tip}>
      <span aria-hidden className="ck-dot" />
      <span className="visually-hidden">{tip}</span>
    </li>
  )
}

function CaseRow({ r }: { r: CheckCaseResult }): JSX.Element {
  const passed = r.checks.filter((c) => c.pass).length
  return (
    <tr>
      <th scope="row" className="ck-case">
        <span className="ck-case-title">{r.title}</span>
        <details className="ck-raw">
          <summary>
            {r.error ? 'Error' : 'Raw output'}
            {r.truncated ? ' (first 4 KB)' : ''}
          </summary>
          {r.error && <p className="ck-err">{r.error}</p>}
          {!r.error && <pre className="ck-pre">{r.output || '(empty)'}</pre>}
          <ul className="ck-list">
            {r.checks.map((c) => (
              <li key={c.id}>
                <span className={`ck-word ck-word--${c.pass ? 'pass' : 'fail'}`}>{c.pass ? 'Pass' : 'Fail'}</span> {c.label}
                {c.reason && <span className="faint"> · {c.reason}</span>}
              </li>
            ))}
          </ul>
        </details>
      </th>
      <td>
        <ul className="ck-marks" aria-label={`${passed} of ${r.checks.length} checks passed`}>
          {r.checks.map((c) => (
            <Mark key={c.id} c={c} error={Boolean(r.error)} />
          ))}
        </ul>
        <span className="num faint ck-count">
          {passed}/{r.checks.length}
        </span>
      </td>
      <td className="num">{r.error ? '–' : secs(r.latencyMs)}</td>
      <td className="num faint">{r.tokensPerSec != null ? `≈${Math.round(r.tokensPerSec)}` : '–'}</td>
    </tr>
  )
}

/** Settings → AI → Check model: runs the built-in test prompts and a free "Try a prompt" box. */
export function ModelCheck({ status }: { status: AiStatus }): JSX.Element {
  const ai = window.studyPet.ai
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState<ModelCheckProgress | null>(null)
  const [live, setLive] = useState<CheckCaseResult[]>([])
  const [report, setReport] = useState<ModelCheckReport | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(
    () =>
      ai.onCheckProgress((p) => {
        setProgress(p)
        if (p.result) setLive((l) => [...l.filter((x) => x.id !== p.result!.id), p.result!])
      }),
    [ai]
  )

  const active = status.active
  const run = async (): Promise<void> => {
    setBusy(true)
    setError(null)
    setReport(null)
    setLive([])
    setProgress({ done: 0, total: CHECK_CASE_COUNT, current: null })
    try {
      const r = await ai.runCheck()
      if (!r.ok) setError(r.error ?? 'The check could not run.')
      else setReport(r)
    } catch (e) {
      setError(errMsg(e))
    } finally {
      setBusy(false)
    }
  }

  const rows = report?.cases ?? live
  const s = report?.summary
  const pct = progress && progress.total ? Math.round((progress.done / progress.total) * 100) : 0

  return (
    <div className="ck" aria-labelledby="ck-h">
      <div className="ai-group-head">
        <h3 id="ck-h">Check model</h3>
        <span className="faint">plan and nudge test prompts, scored with Bloop's rules</span>
      </div>
      <p className="ck-testing">
        Testing: <strong>{active ? active.label : 'nothing ready yet'}</strong>
      </p>
      {active?.kind === 'cloud' && (
        <p className="ai-note ck-cloud">
          <Icon name="alert" size={13} />
          This sends {CHECK_CASE_COUNT} short test prompts to {active.label}. They hold made-up deadlines, nothing of yours.
        </p>
      )}
      <div className="ai-actions ck-run">
        {busy ? (
          <button type="button" className="btn btn--small" onClick={() => void ai.cancelCheck()}>
            <Icon name="close" size={12} />
            Cancel
          </button>
        ) : (
          <button type="button" className="btn btn--small btn--primary" disabled={!active} onClick={() => void run()}>
            <Icon name="play" size={12} />
            {report ? 'Run checks again' : 'Run checks'}
          </button>
        )}
        {busy && progress && (
          <span className="ck-progress" aria-live="polite">
            <span className="ai-bar ck-bar" role="progressbar" aria-label="Model check" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct}>
              <span style={{ width: `${Math.max(4, pct)}%` }} />
            </span>
            <span className="num">
              {progress.done}/{progress.total}
            </span>
            {progress.current && <span className="faint">{progress.current}</span>}
          </span>
        )}
      </div>

      {error && (
        <p className="ai-note ai-note--error" role="alert">
          <Icon name="alert" size={13} />
          {error}
        </p>
      )}

      {s && (
        <p className={`ck-verdict ck-verdict--${s.verdict}`} aria-live="polite">
          <span className={`mark ${s.verdict === 'good' ? 'level-good' : s.verdict === 'ok' ? 'level-ok' : ''}`} aria-hidden />
          Overall: <strong>{s.verdict}</strong>
          <span className="num">
            {' '}
            · {s.passed}/{s.total} checks · avg {secs(s.avgLatencyMs)}
          </span>
          {report?.provider && <span className="faint"> · {report.provider.label}</span>}
          {report?.systemPrompt === 'custom' && <span className="faint"> · your instructions</span>}
          {report?.cancelled && <span className="faint"> · cancelled</span>}
        </p>
      )}

      {rows.length > 0 && (
        <div className="ck-table-wrap">
          <table className="ck-table">
            <thead>
              <tr>
                <th scope="col">Case</th>
                <th scope="col">Checks</th>
                <th scope="col">Time</th>
                <th scope="col" title="Approximate output tokens per second">tok/s</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <CaseRow key={r.id} r={r} />
              ))}
            </tbody>
          </table>
          <p className="faint ck-legend">
            <span className="ck-mark ck-mark--pass">
              <span className="ck-dot" aria-hidden />
            </span>{' '}
            pass{' '}
            <span className="ck-mark ck-mark--fail">
              <span className="ck-dot" aria-hidden />
            </span>{' '}
            fail{' '}
            <span className="ck-mark ck-mark--none">
              <span className="ck-dot" aria-hidden />
            </span>{' '}
            no answer · open a case for its raw output
          </p>
        </div>
      )}

      <TryPrompt active={active} />
    </div>
  )
}

function TryPrompt({ active }: { active: AiStatus['active'] }): JSX.Element {
  const ai = window.studyPet.ai
  const [text, setText] = useState('')
  const [useSystem, setUseSystem] = useState(true)
  const [busy, setBusy] = useState(false)
  const [res, setRes] = useState<TryPromptResult | null>(null)

  const send = async (): Promise<void> => {
    if (!text.trim() || busy) return
    setBusy(true)
    setRes(null)
    try {
      setRes(await ai.tryPrompt(text, useSystem))
    } catch (e) {
      setRes({ ok: false, ms: 0, error: errMsg(e) })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="ck-try">
      <div className="ai-group-head">
        <h3 id="try-h">Try a prompt</h3>
        {active?.kind === 'cloud' && <span className="faint">sent to {active.label} when you press Send</span>}
      </div>
      <textarea
        className="text-input ck-textarea"
        aria-labelledby="try-h"
        rows={3}
        maxLength={TRY_PROMPT_MAX}
        placeholder="e.g. Plan two short study blocks for my Friday stats quiz."
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) void send()
        }}
      />
      <div className="ck-try-row">
        <label className="ck-check">
          <input type="checkbox" checked={useSystem} onChange={(e) => setUseSystem(e.target.checked)} />
          Use instructions (system prompt)
        </label>
        <span className="num faint">
          {text.length}/{TRY_PROMPT_MAX}
        </span>
        <button type="button" className="btn btn--small" disabled={!active || busy || !text.trim()} onClick={() => void send()}>
          <Icon name="spark" size={12} />
          {busy ? 'Waiting…' : 'Send'}
        </button>
      </div>
      {res && (
        <div className="ck-reply" aria-live="polite">
          {res.ok ? (
            <>
              <pre className="ck-pre">{res.text || '(empty)'}</pre>
              <span className="faint num">
                {res.provider} · {secs(res.ms)}
                {res.truncated ? ' · first 4 KB' : ''}
              </span>
            </>
          ) : (
            <p className="ai-note ai-note--error" role="alert">
              <Icon name="alert" size={13} />
              {res.error ?? 'No reply.'}
            </p>
          )}
        </div>
      )}
    </div>
  )
}

/** Settings → AI → Advanced → Instructions (system prompt). */
export function SystemPromptEditor({ settings, onSettings }: { settings: AiSettings; onSettings: (s: AiSettings) => void }): JSX.Element {
  const ai = window.studyPet.ai
  const current = settings.systemPrompt ?? DEFAULT_SYSTEM_PROMPT
  const [text, setText] = useState(current)
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null)
  const dirtyRef = useRef(false)
  useEffect(() => {
    if (!dirtyRef.current) setText(current)
  }, [current])

  const isDefault = !settings.systemPrompt
  const changed = text.trim() !== current.trim()
  const over = text.trim().length > SYSTEM_PROMPT_MAX

  const save = async (value: string | null): Promise<void> => {
    try {
      const s = await ai.setSystemPrompt(value)
      dirtyRef.current = false
      onSettings(s)
      setText(s.systemPrompt ?? DEFAULT_SYSTEM_PROMPT)
      setNote({ ok: true, text: value == null || !s.systemPrompt ? 'Using the default instructions.' : 'Saved.' })
    } catch (e) {
      setNote({ ok: false, text: errMsg(e) })
    }
  }

  return (
    <details className="ai-advanced ck-sys">
      <summary>Advanced: Instructions (system prompt)</summary>
      <p className="faint ck-sys-help">
        Sent with every request as Bloop's instructions, to whichever model you use. The plan request itself doesn't change. The on-device Bloop
        model was tuned without instructions, so keep them short.
      </p>
      <textarea
        className="text-input ck-textarea ck-sys-text"
        aria-label="Instructions (system prompt)"
        rows={20}
        spellCheck={false}
        value={text}
        onChange={(e) => {
          dirtyRef.current = true
          setText(e.target.value)
          setNote(null)
        }}
      />
      <div className="ck-try-row">
        <span className={`num ${over ? 'ai-note--error' : 'faint'}`}>
          {text.trim().length}/{SYSTEM_PROMPT_MAX}
        </span>
        <span className="faint">{isDefault ? 'Default' : 'Custom'}</span>
        {note && <span className={note.ok ? 'faint' : 'ai-note--error'} role={note.ok ? 'status' : 'alert'}>{note.text}</span>}
        <span className="ck-spacer" />
        <button type="button" className="btn btn--small" disabled={isDefault && !changed} onClick={() => void save(null)}>
          Reset to default
        </button>
        <button type="button" className="btn btn--small btn--primary" disabled={!changed || over || !text.trim()} onClick={() => void save(text)}>
          Save
        </button>
      </div>
    </details>
  )
}
