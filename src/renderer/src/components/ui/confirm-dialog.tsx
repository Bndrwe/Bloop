import { useEffect, useId, useRef, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import './confirm-dialog.css'

export interface ConfirmDialogProps {
  open: boolean
  title: string
  children: ReactNode
  confirmLabel: string
  cancelLabel?: string
  onConfirm: () => void
  onCancel: () => void
  /** Small label above the title, e.g. "Ollama". */
  eyebrow?: string
  /** Which button gets focus when the dialog opens. Use 'cancel' when confirming is costly (Enter then won't trigger it). */
  initialFocus?: 'confirm' | 'cancel'
}

const FOCUSABLE = 'button:not([disabled]), [href], input:not([disabled]), select, textarea, [tabindex]:not([tabindex="-1"])'

/**
 * Black-and-white confirmation modal. Focus moves to the confirm button (or cancel, via initialFocus) and is trapped inside;
 * Esc or a click on the backdrop cancels; focus returns to the opener on close.
 */
export function ConfirmDialog({
  open,
  title,
  children,
  confirmLabel,
  cancelLabel = 'Cancel',
  onConfirm,
  onCancel,
  eyebrow,
  initialFocus = 'confirm'
}: ConfirmDialogProps): JSX.Element | null {
  const boxRef = useRef<HTMLDivElement>(null)
  const confirmRef = useRef<HTMLButtonElement>(null)
  const cancelRef = useRef<HTMLButtonElement>(null)
  const titleId = useId()
  const bodyId = useId()

  useEffect(() => {
    if (!open) return
    const opener = document.activeElement as HTMLElement | null
    ;(initialFocus === 'cancel' ? cancelRef : confirmRef).current?.focus()
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.preventDefault()
        e.stopPropagation()
        onCancel()
        return
      }
      if (e.key !== 'Tab' || !boxRef.current) return
      const items = Array.from(boxRef.current.querySelectorAll<HTMLElement>(FOCUSABLE))
      if (!items.length) return
      const first = items[0]!
      const last = items[items.length - 1]!
      const active = document.activeElement
      if (e.shiftKey && (active === first || !boxRef.current.contains(active))) {
        e.preventDefault()
        last.focus()
      } else if (!e.shiftKey && (active === last || !boxRef.current.contains(active))) {
        e.preventDefault()
        first.focus()
      }
    }
    document.addEventListener('keydown', onKey, true)
    return () => {
      document.removeEventListener('keydown', onKey, true)
      opener?.focus?.()
    }
  }, [open, onCancel])

  if (!open) return null
  return createPortal(
    <div className="cdlg-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onCancel()}>
      <div className="cdlg" role="dialog" aria-modal="true" aria-labelledby={titleId} aria-describedby={bodyId} ref={boxRef}>
        {eyebrow && <span className="cdlg-eyebrow">{eyebrow}</span>}
        <h2 id={titleId} className="cdlg-title">
          {title}
        </h2>
        <div id={bodyId} className="cdlg-body">
          {children}
        </div>
        <div className="cdlg-actions">
          <button type="button" className="btn" ref={cancelRef} onClick={onCancel}>
            {cancelLabel}
          </button>
          <button type="button" className="btn btn--primary" ref={confirmRef} onClick={onConfirm}>
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>,
    document.body
  )
}
