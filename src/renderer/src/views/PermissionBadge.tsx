import type { PermissionState } from '@shared/types'
import { Icon } from '../lib/Icon'
import './permissions.css'

export function permissionLabel(s: PermissionState): { kind: 'ok' | 'warn' | 'unknown'; text: string } {
  switch (s) {
    case 'granted':
      return { kind: 'ok', text: 'Allowed' }
    case 'denied':
      return { kind: 'warn', text: 'Not allowed yet' }
    case 'not-applicable':
      return { kind: 'ok', text: 'Not needed here' }
    default:
      return { kind: 'unknown', text: 'Not checked yet' }
  }
}

/** Solid + check when granted, dashed + alert when not, dotted + alert when unknown. */
export function PermissionBadge({ state }: { state: PermissionState }): JSX.Element {
  const l = permissionLabel(state)
  return (
    <span className={`perm-state perm-state--${l.kind}`}>
      <Icon name={l.kind === 'ok' ? 'check' : 'alert'} size={13} />
      {l.text}
    </span>
  )
}
