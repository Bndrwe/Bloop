import { useEffect, useRef } from 'react'
import type { PlannerTask } from '@shared/planner'
import { Icon } from '../../lib/Icon'
import { StepRow } from './StepRow'
import { dueText, progress, unscheduledCount } from './plannerFormat'

/** One level down from the list: a project's steps, each with its block and a checkbox. */
export function ProjectDetail({ task, onBack }: { task: PlannerTask; onBack: () => void }): JSX.Element {
  const backRef = useRef<HTMLButtonElement>(null)
  useEffect(() => backRef.current?.focus(), [])
  const { done, total } = progress(task)
  const missing = unscheduledCount(task)
  const remove = (): void => {
    window.studyPet.planner
      .remove(task.id)
      .then(onBack)
      .catch(() => undefined)
  }
  return (
    <div className="pl-detail">
      <div className="pl-detail-head">
        <button ref={backRef} className="icon-btn" aria-label="Back to projects and tasks" onClick={onBack}>
          <Icon name="chevron-left" size={14} />
        </button>
        <div className="pl-detail-title">
          <h3 title={task.title}>{task.title}</h3>
          <span className="faint">
            {dueText(task.due)} · {done} of {total} done
          </span>
        </div>
      </div>
      <span className="pl-bar" aria-hidden="true">
        <span style={{ transform: `scaleX(${total ? done / total : 0})` }} />
      </span>
      {missing > 0 && (
        <p className="note note--error">
          <Icon name="alert" size={13} />
          {missing} step{missing === 1 ? '' : 's'} didn’t fit in your study window before the due date. Widen the window in Settings.
        </p>
      )}
      <ol className="pl-steps">
        {task.steps.map((s) => (
          <StepRow key={s.id} taskId={task.id} step={s} />
        ))}
      </ol>
      <div className="pl-detail-foot">
        <span className="faint">{task.classifiedBy === 'ai' ? 'Steps planned by AI' : 'Steps from Bloop’s built-in plan'}</span>
        <button className="link-btn" onClick={remove}>
          Remove project
        </button>
      </div>
    </div>
  )
}
