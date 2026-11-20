import { useState } from 'react'
import type { PlannerStep } from '@shared/planner'
import { Icon } from '../../lib/Icon'
import { blockText, isNow } from './plannerFormat'

/** One step with its block and a done checkbox. */
export function StepRow({ taskId, step, showTitle = true }: { taskId: string; step: PlannerStep; showTitle?: boolean }): JSX.Element {
  const [busy, setBusy] = useState(false)
  const now = isNow(step.block) && !step.done
  const toggle = (): void => {
    setBusy(true)
    window.studyPet.planner
      .setStepDone(taskId, step.id, !step.done)
      .catch(() => undefined)
      .finally(() => setBusy(false))
  }
  return (
    <li className={`pl-step${step.done ? ' pl-step--done' : ''}${now ? ' pl-step--now' : ''}`}>
      <label className="pl-check">
        <input type="checkbox" checked={step.done} disabled={busy} onChange={toggle} aria-label={`${step.title}: done`} />
        <span aria-hidden="true">
          <Icon name="check" size={11} />
        </span>
      </label>
      <span className="pl-step-body">
        {showTitle && <span className="pl-step-title">{step.title}</span>}
        <span className="pl-step-when num">
          {step.block ? (
            <>
              {now && <span className="tag pl-now">now</span>}
              {blockText(step.block)}
            </>
          ) : step.done ? (
            'done'
          ) : (
            <span className="pl-nofit">Couldn’t fit before the due date</span>
          )}
        </span>
      </span>
      <span className="num faint pl-step-min">{step.minutes}m</span>
    </li>
  )
}
