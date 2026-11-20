import { useId, useState } from 'react'
import type { PlannerTask } from '@shared/planner'
import { Icon } from '../../lib/Icon'
import { errMsg } from '../../lib/format'
import { usePlanner } from '../../hooks/usePlanner'
import { ProjectDetail } from './ProjectDetail'
import { StepRow } from './StepRow'
import { blockText, defaultDueInput, dueText, nextStep, progress } from './plannerFormat'
import './planner.css'

function AddTask({ onDone }: { onDone: () => void }): JSX.Element {
  const id = useId()
  const [title, setTitle] = useState('')
  const [due, setDue] = useState(defaultDueInput())
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const submit = (): void => {
    const at = new Date(due).getTime()
    if (!title.trim() || busy) return
    setBusy(true)
    setError(null)
    window.studyPet.planner
      .add(title, at)
      .then((r) => (r.ok ? onDone() : setError(r.error)))
      .catch((e) => setError(errMsg(e)))
      .finally(() => setBusy(false))
  }
  return (
    <form
      className="pl-add"
      onSubmit={(e) => {
        e.preventDefault()
        submit()
      }}
    >
      <label className="lock-field" htmlFor={`${id}-t`}>
        <span className="faint">What’s due</span>
        <input
          id={`${id}-t`}
          className="lock-input"
          placeholder="e.g. History essay, Problem set 6"
          value={title}
          maxLength={200}
          autoFocus
          onChange={(e) => setTitle(e.target.value)}
        />
      </label>
      <label className="lock-field" htmlFor={`${id}-d`}>
        <span className="faint">Due</span>
        <input id={`${id}-d`} className="lock-input" type="datetime-local" value={due} onChange={(e) => setDue(e.target.value)} />
      </label>
      {error && (
        <p className="note note--error">
          <Icon name="alert" size={13} />
          {error}
        </p>
      )}
      <div className="controls controls--start">
        <button type="submit" className="btn btn--small btn--primary" disabled={busy || !title.trim()}>
          <Icon name="spark" size={13} />
          {busy ? 'Planning…' : 'Plan it'}
        </button>
        <button type="button" className="btn btn--small btn--ghost" onClick={onDone}>
          Cancel
        </button>
      </div>
    </form>
  )
}

function ProjectRow({ task, onOpen }: { task: PlannerTask; onOpen: () => void }): JSX.Element {
  const { done, total } = progress(task)
  const next = nextStep(task)
  return (
    <li>
      <button className="pl-project" onClick={onOpen} aria-label={`${task.title}, ${done} of ${total} steps done. Open steps`}>
        <span className="pl-row-main">
          <span className="pl-title">{task.title}</span>
          <span className="pl-meta faint">
            <span className="tag tag--outline pl-kind">project</span>
            {done}/{total} · {dueText(task.due)}
          </span>
          {next?.block && <span className="pl-next num">Next: {blockText(next.block)}</span>}
        </span>
        <Icon name="chevron-right" size={14} />
      </button>
    </li>
  )
}

function TaskRow({ task }: { task: PlannerTask }): JSX.Element {
  return (
    <li className="pl-task">
      <div className="pl-task-head">
        <span className="pl-title" title={task.title}>
          {task.title}
        </span>
        <span className="pl-meta faint">{dueText(task.due)}</span>
        <button className="icon-btn pl-remove" aria-label={`Remove ${task.title}`} onClick={() => void window.studyPet.planner.remove(task.id)}>
          <Icon name="close" size={12} />
        </button>
      </div>
      <ul className="pl-steps pl-steps--inline">
        {task.steps.map((s) => (
          <StepRow key={s.id} taskId={task.id} step={s} />
        ))}
      </ul>
    </li>
  )
}

/** Panel card: projects (click for their steps) and small tasks with their study blocks. */
export function PlannerCard(): JSX.Element {
  const [state] = usePlanner()
  const [openId, setOpenId] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)
  const tasks = [...(state?.tasks ?? [])].sort((a, b) => a.due - b.due)
  const open = tasks.find((t) => t.id === openId)

  if (open) {
    return (
      <section className="card section pl-card">
        <ProjectDetail task={open} onBack={() => setOpenId(null)} />
      </section>
    )
  }

  const projects = tasks.filter((t) => t.kind === 'project')
  const small = tasks.filter((t) => t.kind === 'task')
  return (
    <section className="card section pl-card" aria-busy={state?.busy}>
      <h2 className="section-title">
        <Icon name="list" size={14} />
        Projects &amp; tasks
        {state?.busy && <span className="pl-busy faint">Planning…</span>}
        {!adding && (
          <button className="btn btn--tiny pl-add-btn" onClick={() => setAdding(true)}>
            <Icon name="plus" size={11} />
            Add
          </button>
        )}
      </h2>
      {adding && <AddTask onDone={() => setAdding(false)} />}
      {state?.note && (
        <p className="note">
          <Icon name="alert" size={13} />
          <span>{state.note}</span>
        </p>
      )}
      {state && tasks.length === 0 && !adding && (
        <p className="note">
          <span>
            Nothing planned yet. Add something that’s due, or{' '}
            <button className="link-btn" onClick={() => void window.studyPet.openSettings()}>
              connect Brightspace in Settings
            </button>
            . Bloop breaks big work into steps and books study time between {state.window.start} and {state.window.end}.
          </span>
        </p>
      )}
      {projects.length > 0 && (
        <>
          <h3 className="pl-group">Projects</h3>
          <ul className="pl-list">
            {projects.map((t) => (
              <ProjectRow key={t.id} task={t} onOpen={() => setOpenId(t.id)} />
            ))}
          </ul>
        </>
      )}
      {small.length > 0 && (
        <>
          <h3 className="pl-group">Tasks</h3>
          <ul className="pl-list">
            {small.map((t) => (
              <TaskRow key={t.id} task={t} />
            ))}
          </ul>
        </>
      )}
    </section>
  )
}
