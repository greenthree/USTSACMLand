import { type KeyboardEvent as ReactKeyboardEvent, useCallback, useRef } from 'react'

const focusableSelector =
  'button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [href], [tabindex]:not([tabindex="-1"])'

export function useDialogFocus() {
  const dialogRef = useRef<HTMLElement>(null)
  const dialogTriggerRef = useRef<HTMLElement | null>(null)

  const rememberDialogTrigger = useCallback((trigger?: HTMLElement) => {
    dialogTriggerRef.current =
      trigger ?? (document.activeElement instanceof HTMLElement ? document.activeElement : null)
  }, [])

  const closeDialog = useCallback((close: () => void) => {
    close()
    const trigger = dialogTriggerRef.current
    dialogTriggerRef.current = null
    window.setTimeout(() => {
      if (trigger && document.contains(trigger)) trigger.focus()
    }, 0)
  }, [])

  const handleDialogKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLElement>, close: () => void, locked = false) => {
      if (event.key === 'Escape' && !locked) {
        event.preventDefault()
        closeDialog(close)
        return
      }
      if (event.key !== 'Tab') return

      const focusable = Array.from(
        dialogRef.current?.querySelectorAll<HTMLElement>(focusableSelector) ?? [],
      )
      if (focusable.length === 0) return

      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    },
    [closeDialog],
  )

  return { closeDialog, dialogRef, handleDialogKeyDown, rememberDialogTrigger }
}
