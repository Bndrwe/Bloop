import type { LocalStatus } from '@shared/ai'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { formatBytes } from '../../hooks/useAi'

/** Text of the download offer; shared by Settings → AI and the panel's plan card. */
export function bloopOfferText(bloop: LocalStatus['bloop']): string {
  const mb = bloop.sizeBytes ? `It's ${formatBytes(bloop.sizeBytes)} and ` : 'It '
  return `${mb}runs on this device, so nothing leaves your computer.`
}

/**
 * The one and only way a Bloop model download starts: the user clicks Download here, and the
 * caller passes confirmed=true to ai.downloadBloopModel. "Not now" remembers the dismissal.
 */
export function BloopConfirm({
  open,
  bloop,
  onDownload,
  onNotNow
}: {
  open: boolean
  bloop: LocalStatus['bloop']
  onDownload: () => void
  onNotNow: () => void
}): JSX.Element {
  return (
    <ConfirmDialog
      open={open}
      eyebrow="On-device AI"
      title="Download the Bloop model?"
      confirmLabel="Download"
      cancelLabel="Not now"
      onConfirm={onDownload}
      onCancel={onNotNow}
    >
      <p>{bloopOfferText(bloop)}</p>
      <p className="faint">
        A fine-tuned Qwen3.5 0.8B that writes your study plans. Saved in Bloop’s app folder; delete it any time in Settings → AI.
      </p>
    </ConfirmDialog>
  )
}
