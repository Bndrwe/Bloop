import { useCallback, useEffect, useState } from 'react'
import type { AppStatus, Deadline, Stats, StudyPlan } from '@shared/types'
import { useStatus } from '../hooks/useStatus'
import { Pet } from '../pet/Pet'
import {
  DAY_LETTERS,
  DAY_SHORT,
  errMsg,
  minutes,
  mmss,
  parseLocalDate,
  phaseLabel,
  relativeDate,
  scoreLevel,
  scoreText
} from '../lib/format'
import './panel.css'

function ScoreRing({ score }: { score: number | null }): JSX.Element {
  const r = 34
  const c = 2 * Math.PI * r
  const pct = score == null ? 0 : Math.max(0, Math.min(100, score)) / 100
  return (
    <div className={`ring level-${scoreLevel(score)}`}>
      <svg viewBox="0 0 80 80" width="84" height="84" aria-hidden="true">
        <circle cx="40" cy="40" r={r} className="ring-track" />
        <circle
          cx="40"
          cy="40"
          r={r}
          className="ring-arc"
          strokeDasharray={`${c * pct} ${c}`}
          transform="rotate(-90 40 40)"
        />
      </svg>
      <div className="ring-label">
        <strong>{scoreText(score)}</strong>
        <span>focus</span>
      </div>
    </div>
  )
}

function Controls({ status }: { status: AppStatus }): JSX.Element {
  const api = window.studyPet
  const run = (fn: () => Promise<void>) => () => void fn().catch(() => undefined)
  switch (status.phase) {
    case 'focus':
      return (
        <div className="controls">
          <button className="btn" onClick={run(() => api.pauseSession())}>
            Pause
          </button>
          <button className="btn btn--danger" onClick={run(() => api.stopSession())}>
            Stop
          </button>
        </div>
      )
    case 'break':
      return (
        <div className="controls">
          <button className="btn btn--primary" onClick={run(() => api.skipBreak())}>
            Skip break
          </button>
          <button className="btn" onClick={run(() => api.pauseSession())}>
            Pause
          </button>
          <button className="btn btn--danger" onClick={run(() => api.stopSession())}>
            Stop
          </button>
        </div>
      )
    case 'paused':
      return (
        <div className="controls">
          <button className="btn btn--primary" onClick={run(() => api.resumeSession())}>
            Resume
          </button>
          <button className="btn btn--danger" onClick={run(() => api.stopSession())}>
            Stop
          </button>
        </div>
      )
    default:
      return (
        <div className="controls">
          <button className="btn btn--primary" onClick={run(() => api.startSession())}>
            Start focus session
          </button>
        </div>
      )
  }
}

function WeekChart({ stats }: { stats: Stats }): JSX.Element {
  const days = stats.last7
  const max = Math.max(25 * 60, ...days.map((d) => d.focusSec))
  const W = 252
  const H = 64
  const gap = 8
  const bw = (W - gap * (days.length - 1)) / Math.max(1, days.length)
  return (
    <svg className="week" viewBox={`0 0 ${W} ${H + 16}`} width="100%" role="img" aria-label="Focus minutes, last 7 days">
      {days.map((d, i) => {
        const h = d.focusSec > 0 ? Math.max(4, (d.focusSec / max) * H) : 2
        const x = i * (bw + gap)
        const date = parseLocalDate(d.date)
        const today = i === days.length - 1
        return (
          <g key={d.date} className={today ? 'week-today' : undefined}>
            <title>
              {`${DAY_SHORT[date.getDay()]} ${d.date}: ${minutes(d.focusSec)} focus · avg ${scoreText(d.avgScore)} · ${d.sessions} session${d.sessions === 1 ? '' : 's'}`}
            </title>
            <rect x={x} y={0} width={bw} height={H} rx={6} className="week-hit" />
            <rect x={x} y={H - h} width={bw} height={h} rx={Math.min(6, bw / 2)} className={`week-bar level-${scoreLevel(d.avgScore)}`} />
            <text x={x + bw / 2} y={H + 13} textAnchor="middle" className="week-label">
              {DAY_LETTERS[date.getDay()]}
            </text>
          </g>
        )
      })}
    </svg>
  )
}

function Deadlines({ refreshKey }: { refreshKey: string }): JSX.Element | null {
  const [items, setItems] = useState<Deadline[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [hasUrl, setHasUrl] = useState(false)

  useEffect(() => {
    let alive = true
    const api = window.studyPet
    Promise.all([api.getDeadlines(), api.getSettings().catch(() => null)])
      .then(([res, settings]) => {
        if (!alive) return
        setHasUrl(!!settings?.icalUrl?.trim())
        if (res.ok) {
          const now = Date.now()
          setItems(
            res.value
              .filter((d) => d.start >= now - 60 * 60 * 1000)
              .sort((a, b) => a.start - b.start)
              .slice(0, 5)
          )
          setError(null)
        } else {
          setItems([])
          setError(res.error)
        }
      })
      .catch((e) => {
        if (!alive) return
        setItems([])
        setError(errMsg(e))
      })
    return () => {
      alive = false
    }
  }, [refreshKey])

  if (items == null) return null
  if (items.length === 0 && !hasUrl) return null

  return (
    <section className="card section">
      <h3>Upcoming deadlines</h3>
      {error && <p className="muted small">Couldn’t load calendar: {error}</p>}
      {!error && items.length === 0 && <p className="muted small">Nothing due soon. Nice!</p>}
      <ul className="deadlines">
        {items.map((d) => (
          <li key={d.uid}>
            <div className="dl-main">
              <span className="dl-title" title={d.summary}>
                {d.summary}
              </span>
              {d.isExam && <span className="chip chip--distract">exam</span>}
            </div>
            <span className="muted small">{relativeDate(d.start)}</span>
          </li>
        ))}
      </ul>
    </section>
  )
}

function AiPlan(): JSX.Element | null {
  const [hasKey, setHasKey] = useState<boolean | null>(null)
  const [plan, setPlan] = useState<StudyPlan | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [note, setNote] = useState<string | null>(null)

  useEffect(() => {
    const api = window.studyPet
    api
      .hasApiKey()
      .then((k) => {
        setHasKey(k)
        if (k) return api.getPlan().then((p) => setPlan(p))
        return undefined
      })
      .catch(() => setHasKey(false))
  }, [])

  const generate = async (): Promise<void> => {
    setLoading(true)
    setError(null)
    setNote(null)
    try {
      const res = await window.studyPet.generatePlan()
      if (res.ok) setPlan(res.value)
      else setError(res.error)
    } catch (e) {
      setError(errMsg(e))
    } finally {
      setLoading(false)
    }
  }

  const addReminders = async (): Promise<void> => {
    setNote(null)
    try {
      const res = await window.studyPet.addPlanReminders()
      if (res.ok) setNote(`Added ${res.value} reminder${res.value === 1 ? '' : 's'} ✓`)
      else setError(res.error)
    } catch (e) {
      setError(errMsg(e))
    }
  }

  if (hasKey == null) return null

  return (
    <section className="card section">
      <h3>AI study plan</h3>
      {!hasKey ? (
        <p className="muted small">Add ANTHROPIC_API_KEY to .env to enable.</p>
      ) : (
        <>
          {plan && (
            <div className="plan">
              <p className="plan-summary">{plan.summary}</p>
              {plan.blocks.length > 0 && (
                <ul className="plan-blocks">
                  {plan.blocks.map((b, i) => (
                    <li key={i}>
                      <span className="plan-when">
                        {DAY_SHORT[b.day] ?? '?'} {b.time}
                      </span>
                      <span className="plan-label">{b.label}</span>
                      <span className="muted">{b.minutes}m</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
          {error && <p className="error small">{error}</p>}
          {note && <p className="ok small">{note}</p>}
          <div className="controls">
            <button className="btn btn--small" onClick={() => void generate()} disabled={loading}>
              {loading ? 'Thinking…' : plan ? 'Regenerate' : 'Generate plan'}
            </button>
            {plan && plan.blocks.length > 0 && (
              <button className="btn btn--small btn--primary" onClick={() => void addReminders()} disabled={loading}>
                Add as reminders
              </button>
            )}
          </div>
        </>
      )}
    </section>
  )
}

export function Panel(): JSX.Element {
  const { status, remaining } = useStatus()
  const [stats, setStats] = useState<Stats | null>(null)
  const phase = status?.phase

  const loadStats = useCallback(() => {
    window.studyPet
      .getStats()
      .then(setStats)
      .catch(() => undefined)
  }, [])

  useEffect(() => {
    loadStats()
  }, [phase, loadStats])

  useEffect(() => {
    const id = window.setInterval(loadStats, 30_000)
    return () => window.clearInterval(id)
  }, [loadStats])

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') void window.studyPet.closePanel()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const current = status?.current
  const progress =
    status && status.phaseTotalSec > 0 && (status.phase === 'focus' || status.phase === 'break' || status.phase === 'paused')
      ? 1 - remaining / status.phaseTotalSec
      : 0

  return (
    <div className="panel">
      <header className="panel-head">
        <div className="panel-title">
          <Pet mood={status?.pet.mood ?? 'idle'} size={30} />
          <span>Study Pet</span>
        </div>
        <button className="icon-btn" aria-label="Close" onClick={() => void window.studyPet.closePanel()}>
          ×
        </button>
      </header>

      <section className="card hero">
        <ScoreRing score={status?.score ?? null} />
        <div className="hero-info">
          <span className={`phase phase--${phase ?? 'idle'}`}>{phaseLabel(phase ?? 'idle')}</span>
          {phase && phase !== 'idle' && phase !== 'done' ? (
            <div className="timer">{mmss(remaining)}</div>
          ) : (
            <div className="timer timer--idle">{phase === 'done' ? 'Nice work!' : 'Ready?'}</div>
          )}
          {status && status.pomodorosCompleted > 0 && (
            <span className="muted small">🍅 × {status.pomodorosCompleted}</span>
          )}
        </div>
        {progress > 0 && (
          <div className="progress">
            <span style={{ width: `${Math.min(100, progress * 100)}%` }} />
          </div>
        )}
      </section>

      {status && <Controls status={status} />}

      <div className="now">
        <span className="muted">Now:</span>
        {current ? (
          <>
            <span className="now-name" title={current.domain ?? current.app}>
              {current.domain ?? current.app}
            </span>
            <span className={`chip chip--${current.category}`}>{current.category}</span>
          </>
        ) : (
          <span className="muted">—</span>
        )}
      </div>

      <section className="card section">
        <h3>Today</h3>
        <div className="stats">
          <div>
            <strong className={`level-${scoreLevel(stats?.todayAvgScore)}`}>{scoreText(stats?.todayAvgScore)}</strong>
            <span>avg score</span>
          </div>
          <div>
            <strong>{stats ? minutes(stats.todayFocusSec) : '—'}</strong>
            <span>focused</span>
          </div>
          <div>
            <strong>{stats ? stats.todaySessions : '—'}</strong>
            <span>sessions</span>
          </div>
        </div>
        {stats && stats.last7.length > 0 && <WeekChart stats={stats} />}
      </section>

      <Deadlines refreshKey={phase ?? 'idle'} />
      <AiPlan />

      <footer className="panel-foot">
        <button className="btn btn--ghost btn--small" onClick={() => void window.studyPet.openSettings()}>
          ⚙︎ Settings
        </button>
      </footer>
    </div>
  )
}
