import { useCallback, useEffect, useRef, useState } from 'react'
import { animate } from 'animejs'
import type { AppStatus, Deadline, Stats, StudyPlan } from '@shared/types'
import { useStatus } from '../hooks/useStatus'
import { Pet } from '../pet/Pet'
import { Icon } from '../lib/Icon'
import { prefersReducedMotion, useEntrance, useReveal } from '../lib/motion'
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

const RING_R = 40
const RING_C = 2 * Math.PI * RING_R

/** Score ring: number counts up and the arc tweens together, driven by one anime.js tween. */
function ScoreRing({ score }: { score: number | null }): JSX.Element {
  const numRef = useRef<HTMLSpanElement>(null)
  const arcRef = useRef<SVGCircleElement>(null)
  const shown = useRef({ v: 0 })

  useEffect(() => {
    const num = numRef.current
    const arc = arcRef.current
    if (!num || !arc) return
    const target = score == null ? 0 : Math.max(0, Math.min(100, score))
    const paint = (): void => {
      const v = shown.current.v
      num.textContent = score == null ? '—' : String(Math.round(v))
      arc.style.strokeDashoffset = String(RING_C * (1 - v / 100))
    }
    if (prefersReducedMotion() || Math.abs(target - shown.current.v) < 0.5) {
      shown.current.v = target
      paint()
      return
    }
    const anim = animate(shown.current, {
      v: target,
      duration: 1100,
      ease: 'outExpo',
      onUpdate: paint
    })
    return () => {
      anim.pause()
    }
  }, [score])

  return (
    <div className={`ring level-${scoreLevel(score)}`}>
      <svg viewBox="0 0 100 100" width="104" height="104" aria-hidden="true">
        <circle cx="50" cy="50" r={RING_R} className="ring-track" />
        <circle
          ref={arcRef}
          cx="50"
          cy="50"
          r={RING_R}
          className="ring-arc"
          strokeDasharray={RING_C}
          strokeDashoffset={RING_C}
          transform="rotate(-90 50 50)"
        />
      </svg>
      <div className="ring-label">
        <span ref={numRef} className="ring-num serif">
          {scoreText(score)}
        </span>
        <span className="ring-cap">focus score</span>
      </div>
    </div>
  )
}

function Controls({ status }: { status: AppStatus }): JSX.Element {
  const api = window.studyPet
  const run = (fn: () => Promise<void>) => () => void fn().catch(() => undefined)
  const stop = (
    <button className="btn btn--danger" onClick={run(() => api.stopSession())}>
      <Icon name="stop" size={14} />
      Stop
    </button>
  )
  switch (status.phase) {
    case 'focus':
      return (
        <div className="controls">
          <button className="btn" onClick={run(() => api.pauseSession())}>
            <Icon name="pause" size={14} />
            Pause
          </button>
          {stop}
        </div>
      )
    case 'break':
      return (
        <div className="controls">
          <button className="btn btn--primary" onClick={run(() => api.skipBreak())}>
            <Icon name="skip" size={14} />
            Skip break
          </button>
          <button className="btn" onClick={run(() => api.pauseSession())} aria-label="Pause">
            <Icon name="pause" size={14} />
          </button>
          {stop}
        </div>
      )
    case 'paused':
      return (
        <div className="controls">
          <button className="btn btn--primary" onClick={run(() => api.resumeSession())}>
            <Icon name="play" size={14} />
            Resume
          </button>
          {stop}
        </div>
      )
    default:
      return (
        <div className="controls">
          <button className="btn btn--accent btn--wide" onClick={run(() => api.startSession())}>
            <Icon name="play" size={14} />
            Start a focus session
          </button>
        </div>
      )
  }
}

function WeekChart({ stats }: { stats: Stats }): JSX.Element {
  const days = stats.last7
  const max = Math.max(25 * 60, ...days.map((d) => d.focusSec))
  const W = 252
  const H = 56
  const gap = 10
  const bw = (W - gap * (days.length - 1)) / Math.max(1, days.length)
  const total = days.reduce((a, d) => a + d.focusSec, 0)
  return (
    <div className="week-wrap">
      <div className="week-head">
        <span className="muted">Last 7 days</span>
        <span className="num faint">{minutes(total)}</span>
      </div>
      <svg className="week" viewBox={`0 0 ${W} ${H + 16}`} width="100%" role="img" aria-label="Focus minutes per day, last 7 days">
        {days.map((d, i) => {
          const h = d.focusSec > 0 ? Math.max(4, (d.focusSec / max) * H) : 3
          const x = i * (bw + gap)
          const date = parseLocalDate(d.date)
          const today = i === days.length - 1
          return (
            <g key={d.date} className={today ? 'week-today' : undefined}>
              <title>
                {`${DAY_SHORT[date.getDay()]} ${d.date}: ${minutes(d.focusSec)} focused · avg score ${scoreText(d.avgScore)} · ${d.sessions} session${d.sessions === 1 ? '' : 's'}`}
              </title>
              <rect x={x} y={0} width={bw} height={H} rx={6} className="week-hit" />
              <rect
                x={x}
                y={H - h}
                width={bw}
                height={h}
                rx={Math.min(5, bw / 2)}
                className={`week-bar level-${d.focusSec > 0 ? scoreLevel(d.avgScore) : 'none'}`}
              />
              <text x={x + bw / 2} y={H + 13} textAnchor="middle" className="week-label">
                {DAY_LETTERS[date.getDay()]}
              </text>
            </g>
          )
        })}
      </svg>
    </div>
  )
}

function Deadlines({ refreshKey }: { refreshKey: string }): JSX.Element | null {
  const [items, setItems] = useState<Deadline[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [hasUrl, setHasUrl] = useState(false)
  const ref = useRef<HTMLElement>(null)

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

  const visible = items != null && !(items.length === 0 && !hasUrl && !error)
  useReveal(ref, visible)
  if (!visible || items == null) return null

  return (
    <section className="glass section" ref={ref}>
      <h2 className="section-title">
        <Icon name="calendar" size={14} />
        Upcoming deadlines
      </h2>
      {error && (
        <p className="note note--error">
          <Icon name="alert" size={13} />
          Couldn’t load your calendar. Check the iCal link in Settings. <span className="faint">({error})</span>
        </p>
      )}
      {!error && items.length === 0 && <p className="note">Nothing due soon. Enjoy the calm.</p>}
      {items.length > 0 && (
        <ul className="deadlines">
          {items.map((d) => (
            <li key={d.uid}>
              <span className="dl-title" title={d.summary}>
                {d.summary}
              </span>
              <span className="dl-meta">
                {d.isExam && <span className="sticker sticker--amber dl-exam">exam</span>}
                <span className="faint">{relativeDate(d.start)}</span>
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

function AiPlan(): JSX.Element | null {
  const [hasKey, setHasKey] = useState<boolean | null>(null)
  const [plan, setPlan] = useState<StudyPlan | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [note, setNote] = useState<string | null>(null)
  const ref = useRef<HTMLElement>(null)

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

  useReveal(ref, hasKey != null)

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
    setError(null)
    try {
      const res = await window.studyPet.addPlanReminders()
      if (res.ok) setNote(`Added ${res.value} reminder${res.value === 1 ? '' : 's'}. Edit them in Settings.`)
      else setError(res.error)
    } catch (e) {
      setError(errMsg(e))
    }
  }

  if (hasKey == null) return null

  if (!hasKey) {
    return (
      <section className="glass section section--quiet" ref={ref}>
        <h2 className="section-title">
          <Icon name="spark" size={14} />
          AI study plan
        </h2>
        <p className="note">
          Add <code>ANTHROPIC_API_KEY</code> to <code>.env</code> to enable.
        </p>
      </section>
    )
  }

  return (
    <section className="glass section" ref={ref} aria-busy={loading}>
      <h2 className="section-title">
        <Icon name="spark" size={14} />
        AI study plan
      </h2>
      {loading && (
        <div className="plan-loading" aria-live="polite">
          <span className="shimmer" />
          <span className="shimmer shimmer--short" />
          <span className="faint">Planning your week…</span>
        </div>
      )}
      {!loading && plan && (
        <div className="plan">
          <p className="plan-summary">{plan.summary}</p>
          {plan.blocks.length > 0 && (
            <ul className="plan-blocks">
              {plan.blocks.map((b, i) => (
                <li key={i}>
                  <span className="plan-when num">
                    {DAY_SHORT[b.day] ?? '?'} {b.time}
                  </span>
                  <span className="plan-label">{b.label}</span>
                  <span className="num faint">{b.minutes}m</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
      {!loading && !plan && !error && (
        <p className="note">Get a week of study blocks shaped around your deadlines and focus history.</p>
      )}
      {error && (
        <p className="note note--error">
          <Icon name="alert" size={13} />
          {error}
        </p>
      )}
      {note && (
        <p className="note note--ok">
          <Icon name="check" size={13} />
          {note}
        </p>
      )}
      <div className="controls controls--start">
        <button className="btn btn--small" onClick={() => void generate()} disabled={loading}>
          {plan ? <Icon name="refresh" size={13} /> : <Icon name="spark" size={13} />}
          {loading ? 'Thinking…' : plan ? 'Regenerate' : 'Generate plan'}
        </button>
        {plan && plan.blocks.length > 0 && (
          <button className="btn btn--small btn--primary" onClick={() => void addReminders()} disabled={loading}>
            <Icon name="bell" size={13} />
            Add as reminders
          </button>
        )}
      </div>
    </section>
  )
}

function Pomodoros({ n }: { n: number }): JSX.Element | null {
  if (n <= 0) return null
  const dots = Math.min(n, 8)
  return (
    <span className="pomos" aria-label={`${n} pomodoro${n === 1 ? '' : 's'} completed`}>
      {Array.from({ length: dots }, (_, i) => (
        <span key={i} className="pomo" />
      ))}
      {n > dots && <span className="num faint">+{n - dots}</span>}
    </span>
  )
}

const PHASE_STICKER: Record<string, string> = {
  focus: 'sticker--cyan',
  break: 'sticker--peri',
  paused: 'sticker--amber',
  done: '',
  idle: 'sticker--muted'
}

export function Panel(): JSX.Element {
  const { status, remaining } = useStatus()
  const [stats, setStats] = useState<Stats | null>(null)
  const [statsError, setStatsError] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const phase = status?.phase ?? 'idle'

  useEntrance(rootRef, ':scope > .enter', status != null)

  const loadStats = useCallback(() => {
    window.studyPet
      .getStats()
      .then((s) => {
        setStats(s)
        setStatsError(false)
      })
      .catch(() => setStatsError(true))
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

  if (!status) {
    return (
      <div className="panel panel--loading">
        <Pet mood="sleeping" size={72} />
        <p className="faint">Waking up…</p>
      </div>
    )
  }

  const current = status.current
  const timed = phase === 'focus' || phase === 'break' || phase === 'paused'
  const progress = timed && status.phaseTotalSec > 0 ? 1 - remaining / status.phaseTotalSec : 0

  return (
    <div className="panel" ref={rootRef}>
      <header className="panel-head enter">
        <div className="panel-title">
          <Pet mood={status.pet.mood} size={34} />
          <h1 className="serif">Study Pet</h1>
        </div>
        <button className="icon-btn" aria-label="Close panel" onClick={() => void window.studyPet.closePanel()}>
          <Icon name="close" />
        </button>
      </header>

      <section className="glass hero enter">
        <ScoreRing score={status.score} />
        <div className="hero-info">
          <span className={`sticker ${PHASE_STICKER[phase] ?? ''}`}>{phaseLabel(phase)}</span>
          {timed ? (
            <div className="timer num" aria-label={`${mmss(remaining)} left`}>
              {mmss(remaining)}
            </div>
          ) : (
            <div className="timer timer--idle serif">{phase === 'done' ? 'Nice work.' : 'Ready when you are.'}</div>
          )}
          {timed && <span className="faint hero-cap">{phase === 'break' ? 'left of your break' : 'left in this round'}</span>}
          <Pomodoros n={status.pomodorosCompleted} />
        </div>
        {timed && (
          <div className="progress" aria-hidden="true">
            <span style={{ transform: `scaleX(${Math.min(1, Math.max(0, progress))})` }} />
          </div>
        )}
      </section>

      <div className="enter">
        <Controls status={status} />
      </div>

      <div className="now enter">
        <span className="faint">Now</span>
        {current ? (
          <>
            <span className="now-name" title={current.domain ?? current.app}>
              {current.domain ?? current.app}
            </span>
            <span className={`chip chip--${current.category}`}>{current.category}</span>
          </>
        ) : (
          <span className="faint">Nothing tracked yet</span>
        )}
      </div>

      <hr className="zigzag enter" />

      <section className="glass section enter">
        <h2 className="section-title">Today</h2>
        {statsError && !stats ? (
          <p className="note note--error">
            <Icon name="alert" size={13} />
            Couldn’t load stats. They’ll retry in 30s.
          </p>
        ) : (
          <>
            <dl className="stats">
              <div>
                <dt>avg score</dt>
                <dd className={`num level-${scoreLevel(stats?.todayAvgScore)}`}>{scoreText(stats?.todayAvgScore)}</dd>
              </div>
              <div>
                <dt>focused</dt>
                <dd className="num">{stats ? minutes(stats.todayFocusSec) : '—'}</dd>
              </div>
              <div>
                <dt>sessions</dt>
                <dd className="num">{stats ? stats.todaySessions : '—'}</dd>
              </div>
            </dl>
            {stats && stats.last7.length > 0 && <WeekChart stats={stats} />}
          </>
        )}
      </section>

      <Deadlines refreshKey={phase} />
      <AiPlan />

      <footer className="panel-foot enter">
        <button className="btn btn--ghost btn--small" onClick={() => void window.studyPet.openSettings()}>
          <Icon name="gear" size={14} />
          Settings
        </button>
      </footer>
    </div>
  )
}
