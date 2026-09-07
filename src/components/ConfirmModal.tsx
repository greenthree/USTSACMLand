import { type ReactNode, useEffect, useRef } from 'react'
import { useDialogFocus } from '../hooks/useDialogFocus'

export interface ConfirmModalProps {
  open: boolean
  title: string
  description: ReactNode
  confirmText?: string
  cancelText?: string
  danger?: boolean
  busy?: boolean
  onConfirm: () => void | Promise<void>
  onCancel: () => void
}

export function ConfirmModal({
  open,
  title,
  description,
  confirmText = '确认',
  cancelText = '取消',
  danger = false,
  busy = false,
  onConfirm,
  onCancel,
}: ConfirmModalProps) {
  const { closeDialog, dialogRef, handleDialogKeyDown } = useDialogFocus()
  const confirmBtnRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (open) {
      window.setTimeout(() => {
        confirmBtnRef.current?.focus()
      }, 0)
    }
  }, [open])

  if (!open) return null

  return (
    <div
      className="dialog-backdrop"
      role="presentation"
      onClick={(event) => {
        if (event.target === event.currentTarget && !busy) {
          closeDialog(onCancel)
        }
      }}
    >
      <section
        className="modal-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="confirm-modal-title"
        aria-describedby="confirm-modal-description"
        ref={dialogRef}
        onKeyDown={(event) => handleDialogKeyDown(event, onCancel, busy)}
      >
        <div className="modal-dialog-header">
          <h2 id="confirm-modal-title">{title}</h2>
        </div>
        <div id="confirm-modal-description" className="modal-dialog-description">
          {description}
        </div>
        <div className="modal-dialog-actions">
          <button
            type="button"
            className="text-button"
            onClick={() => closeDialog(onCancel)}
            disabled={busy}
          >
            {cancelText}
          </button>
          <button
            ref={confirmBtnRef}
            type="button"
            className={danger ? 'danger-button' : 'primary-button'}
            onClick={async () => {
              await onConfirm()
              closeDialog(() => {})
            }}
            disabled={busy}
          >
            {busy ? '处理中...' : confirmText}
          </button>
        </div>
      </section>
    </div>
  )
}
