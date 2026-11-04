import { useCallback, useEffect, useId, useRef, useState } from 'react'
import { animate } from 'animejs'
import type { AppStatus, Deadline, Stats, StudyPlan } from '@shared/types'
import { useStatus } from '../hooks/useStatus'
import { useWindowAwake } from '../hooks/useWindowAwake'
import { useAi } from '../hooks/useAi'
import { BloopConfirm } from './ai/BloopConfirm'
import { Pet } from '../pet/Pet'
import { Icon } from '../lib/Icon'
import { ShaderMetal } from '@/components/ui/shader-metal'
import { prefersReducedMotion, useBreathe, useCountUp, useEntrance, usePopIn, useReveal, useStaggerIn } from '../lib/motion'
import {
  DAY_LETTERS,
  DAY_SHORT,
  errMsg,
  minutes,
  mmss,
  parseLocalDate,
  phaseLabel,
  relativeDate,
  scoreBand,
  scoreLevel,
  scoreText
} from '../lib/format'
import './panel.css'

const RING_R = 45
const RING_C = 2 * Math.PI * RING_R

/** The band word as a tilted sticker; it pops back in whenever the band changes. */
function BandSticker({ score }: { score: number | null }): JSX.Element {
  const ref = useRef<HTMLSpanElement>(null)
  usePopIn(ref)
  return (
    <span ref={ref} className={`band-sticker level-${scoreLevel(score)}`}>
      {scoreBand(score)}
    </span>
  )
}

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
    <div className={`ring level-${scoreLevel(score)}`} role="img" aria-label={`Focus score ${scoreText(score)}, ${scoreBand(score)}`}>
      <svg viewBox="0 0 100 100" aria-hidden="true">
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
      <div className="ring-label" aria-hidden="true">
        <span ref={numRef} className="ring-num serif">
          {scoreText(score)}
        </span>
        <span className="ring-cap">focus score</span>
      </div>
      <span className="ring-sticker">
        <BandSticker key={scoreLevel(score)} score={score} />
      </span>
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

/** A stat that counts up from zero when the panel opens, and tweens on every change after. */
function Stat({ value, format }: { value: number | null | undefined; format?: (n: number) => string }): JSX.Element {
  const ref = useRef<HTMLSpanElement>(null)
  useCountUp(ref, value, format)
  // Starts at zero; useCountUp tweens it (or jumps straight there under reduced motion).
  return <span ref={ref}>{value == null ? '—' : format ? format(0) : '0'}</span>
}

function WeekChart({ stats }: { stats: Stats }): JSX.Element {
  const svgRef = useRef<SVGSVGElement>(null)
  useStaggerIn(svgRef, '.week-bar', true, true)
  const days = stats.last7
  const max = Math.max(25 * 60, ...days.map((d) => d.focusSec))
  const W = 252
  const H = 56
  const gap = 10
  const bw = (W - gap * (days.length - 1)) / Math.max(1, days.length)
  const total = days.reduce((a, d) => a + d.focusSec, 0)
  const hatch = `week-hatch-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`
  return (
    <div className="week-wrap">
      <div className="week-head">
        <span className="muted">Last 7 days</span>
        <span className="num faint">
          <Stat value={total} format={(n) => minutes(n)} />
        </span>
      </div>
      <svg ref={svgRef} className="week" viewBox={`0 0 ${W} ${H + 18}`} width="100%" role="img" aria-label="Focus minutes per day, last 7 days">
        <defs>
          {/* Low-score days are hatched, not tinted: the pattern carries the band. */}
          <pattern id={hatch} width="4" height="4" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <line x1="0" y1="0" x2="0" y2="4" className="week-hatch-line" />
          </pattern>
        </defs>
        {days.map((d, i) => {
          const h = d.focusSec > 0 ? Math.max(4, (d.focusSec / max) * H) : 3
          const x = i * (bw + gap)
          const date = parseLocalDate(d.date)
          const today = i === days.length - 1
          const level = d.focusSec > 0 ? scoreLevel(d.avgScore) : 'none'
          return (
            <g key={d.date} className={today ? 'week-today' : undefined}>
              <title>
                {`${DAY_SHORT[date.getDay()]} ${d.date}: ${minutes(d.focusSec)} focused · avg score ${scoreText(d.avgScore)} (${scoreBand(d.avgScore)}) · ${d.sessions} session${d.sessions === 1 ? '' : 's'}`}
              </title>
              <rect x={x} y={0} width={bw} height={H} rx={6} className="week-hit" />
              <rect
                x={x + 0.75}
                y={H - h + 0.75}
                width={bw - 1.5}
                height={Math.max(1.5, h - 1.5)}
                rx={Math.min(4, bw / 2)}
                className={`week-bar level-${level}`}
                style={level === 'bad' ? { fill: `url(#${hatch})` } : undefined}
              />
              <text x={x + bw / 2} y={H + 13} textAnchor="middle" className="week-label">
                {DAY_LETTERS[date.getDay()]}
              </text>
              {today && <rect x={x + bw / 2 - 5} y={H + 16} width={10} height={1.5} rx={0.75} className="week-today-mark" />}
            </g>
          )
        })}
      </svg>
      <ul className="week-key" aria-hidden="true">
        <li>
          <span className="week-swatch level-good" />
          70+
        </li>
        <li>
          <span className="week-swatch level-ok" />
          40–69
        </li>
        <li>
          <span className="week-swatch level-bad" />
          under 40
        </li>
      </ul>
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
    <section className="card section" ref={ref}>
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
                {d.isExam && <span className="tag dl-exam">exam</span>}
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
  const { status, settings } = useAi()
  const [plan, setPlan] = useState<StudyPlan | null>(null)
  const [planLoaded, setPlanLoaded] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [note, setNote] = useState<string | null>(null)
  const [askBloop, setAskBloop] = useState(false)
  const ref = useRef<HTMLElement>(null)
  useBreathe(ref, '.shimmer', loading)

  useEffect(() => {
    window.studyPet
      .getPlan()
      .then((p) => setPlan(p))
      .catch(() => undefined)
      .finally(() => setPlanLoaded(true))
  }, [])

  const ready = status != null && settings != null && planLoaded
  useReveal(ref, ready)

  const bloop = status?.local.bloop
  const bloopProgress = bloop?.progress
  const bloopDownloading = bloopProgress?.state === 'running' || bloopProgress?.state === 'verifying'
  // The user picked the Bloop model but it isn't on disk: Generate offers the download (never automatic).
  const needsBloop =
    settings?.choice.kind === 'local' && settings.choice.runtime === 'bloop' && bloop != null && !bloop.downloaded

  const generate = async (): Promise<void> => {
    if (needsBloop) {
      if (bloop?.url && !bloopDownloading) setAskBloop(true)
      else if (!bloop?.url) void window.studyPet.openSettings()
      return
    }
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

  const downloadBloop = async (): Promise<void> => {
    setAskBloop(false)
    setError(null)
    const r = await window.studyPet.ai.downloadBloopModel(true)
    if (!r.ok && r.error && !/cancelled/i.test(r.error)) setError(r.error)
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

  if (!ready) return null

  const active = status.active
  const title = (
    <h2 className="section-title">
      <Icon name="spark" size={14} />
      AI study plan
      {active && <span className="plan-via faint">via {active.label}</span>}
    </h2>
  )

  if (!active && !needsBloop) {
    return (
      <section className="card section section--quiet" ref={ref}>
        {title}
        {plan && <p className="plan-summary">{plan.summary}</p>}
        <p className="note">Pick a model on this device or a cloud provider to plan your week.</p>
        <div className="controls controls--start">
          <button className="btn btn--small btn--primary" onClick={() => void window.studyPet.openSettings()}>
            <Icon name="gear" size={13} />
            Set up AI in Settings
          </button>
        </div>
      </section>
    )
  }

  return (
    <section className="card section" ref={ref} aria-busy={loading}>
      {title}
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
      {!loading && !plan && !error && !needsBloop && (
        <p className="note">Get a week of study blocks shaped around your deadlines and focus history.</p>
      )}
      {needsBloop && (
        <p className="note">
          {bloopDownloading && bloopProgress
            ? `Downloading the Bloop model… ${bloopProgress.totalBytes ? Math.round((bloopProgress.receivedBytes / bloopProgress.totalBytes) * 100) + '%' : ''}`
            : bloop?.url
              ? 'The Bloop model isn’t on this device yet.'
              : 'The Bloop model isn’t published yet. Import a .gguf in Settings.'}
        </p>
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
        <button className="btn btn--small" onClick={() => void generate()} disabled={loading || bloopDownloading}>
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
      {bloop && (
        <BloopConfirm
          open={askBloop}
          bloop={bloop}
          onDownload={() => void downloadBloop()}
          onNotNow={() => {
            setAskBloop(false)
            void window.studyPet.ai.dismissBloopOffer()
          }}
        />
      )}
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

/** Phase tag: solid while focusing or done, outline on break, dashed while paused, grey when idle. */
const PHASE_TAG: Record<string, string> = {
  focus: '',
  break: 'tag--outline',
  paused: 'tag--dashed',
  done: '',
  idle: 'tag--muted'
}

export function Panel(): JSX.Element {
  const { status, remaining } = useStatus()
  const [stats, setStats] = useState<Stats | null>(null)
  const [statsError, setStatsError] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const phase = status?.phase ?? 'idle'
  // The panel hides on blur, so the chrome only draws while it's visible and focused.
  const { visible, focused } = useWindowAwake()
  const awake = visible && focused

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
      <section className="hero enter">
        <ShaderMetal className="hero-chrome" metal="chrome" ribbons={3} speed={0.35} iridescence={0} interactive theme="dark" paused={!awake} />
        <header className="hero-bar">
          <div className="hero-brand">
            <Pet mood={status.pet.mood} size={30} />
            <h1 className="serif">Bloop</h1>
          </div>
          <div className="hero-actions">
            <button className="icon-btn icon-btn--pill" aria-label="Settings" onClick={() => void window.studyPet.openSettings()}>
              <Icon name="gear" size={15} />
            </button>
            <button className="icon-btn icon-btn--pill" aria-label="Close panel" onClick={() => void window.studyPet.closePanel()}>
              <Icon name="close" />
            </button>
          </div>
        </header>

        <ScoreRing score={status.score} />

        <div className="hero-status">
          <span className={`tag ${PHASE_TAG[phase] ?? ''}`}>{phaseLabel(phase)}</span>
          {timed ? (
            <span className="hero-time" aria-label={`${mmss(remaining)} ${phase === 'break' ? 'left of your break' : 'left in this round'}`}>
              <span className="num">{mmss(remaining)}</span>
              <span className="faint">left</span>
            </span>
          ) : (
            <span className="hero-time muted">{phase === 'done' ? 'Nice work.' : 'Ready when you are.'}</span>
          )}
          <Pomodoros n={status.pomodorosCompleted} />
          {timed && (
            <span className="progress" aria-hidden="true">
              <span style={{ transform: `scaleX(${Math.min(1, Math.max(0, progress))})` }} />
            </span>
          )}
        </div>
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

      <section className="card section enter">
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
                <dd className={`num level-${scoreLevel(stats?.todayAvgScore)}`} title={scoreBand(stats?.todayAvgScore)}>
                  <Stat value={stats?.todayAvgScore} />
                  <span className="mark" aria-label={scoreBand(stats?.todayAvgScore)} />
                </dd>
              </div>
              <div>
                <dt>focused</dt>
                <dd className="num">
                  <Stat value={stats?.todayFocusSec} format={(n) => minutes(n)} />
                </dd>
              </div>
              <div>
                <dt>sessions</dt>
                <dd className="num">
                  <Stat value={stats?.todaySessions} />
                </dd>
              </div>
            </dl>
            {stats && stats.last7.length > 0 && <WeekChart stats={stats} />}
          </>
        )}
      </section>

      <Deadlines refreshKey={phase} />
      <AiPlan />
    </div>
  )
}
