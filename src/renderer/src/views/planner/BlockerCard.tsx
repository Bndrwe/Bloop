import { Icon } from '../../lib/Icon'
import { useBlocker } from '../../hooks/usePlanner'
import './planner.css'

const time = (ms: number): string => new Date(ms).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })

/** Panel card: is the website blocker on, why, and a manual switch. */
export function BlockerCard(): JSX.Element | null {
  const [status, setStatus] = useBlocker()
  if (!status || !status.supported) return null

  const toggle = (): void => {
    window.studyPet.blocker
      .setManual(!status.manual)
      .then(setStatus)
      .catch(() => undefined)
  }
  const n = status.sites.length
  const line = status.busy
    ? 'Updating… (macOS may ask for your password once)'
    : status.active && status.reason === 'block' && status.until
      ? `Blocking ${n} site${n === 1 ? '' : 's'} until ${time(status.until)} · ${status.blockLabel ?? 'study block'}`
      : status.active
        ? `Blocking ${n} site${n === 1 ? '' : 's'} until you turn it off`
        : n === 0
          ? 'Add distracting sites in Settings to block them.'
          : `Turns on by itself during your study blocks (${n} site${n === 1 ? '' : 's'}).`

  return (
    <section className={`card section bl-card${status.active ? ' bl-card--on' : ''}`}>
      <div className="bl-row">
        <h2 className="section-title bl-title">
          <Icon name="shield" size={14} />
          Website blocker
          {status.active && <span className="tag bl-tag">on</span>}
        </h2>
        <label className="toggle" title={status.manual ? 'Turn blocking off' : 'Block sites now'}>
          <input
            type="checkbox"
            checked={status.manual || (status.active && status.reason === 'manual')}
            disabled={status.busy || (n === 0 && !status.manual)}
            onChange={toggle}
            aria-label="Block distracting websites now"
          />
          <span />
        </label>
      </div>
      <p className="note bl-line">{line}</p>
      {status.error && (
        <p className="note note--error">
          <Icon name="alert" size={13} />
          <span>{status.error}</span>
        </p>
      )}
      <button className="link-btn bl-edit" onClick={() => void window.studyPet.openSettings()}>
        Edit blocked sites
      </button>
    </section>
  )
}
