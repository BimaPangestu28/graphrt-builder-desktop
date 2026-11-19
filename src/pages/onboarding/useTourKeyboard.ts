import { useEffect, useRef, type RefObject } from 'react'
import { keepTabFocusInside } from './useDialogFocusTrap'

interface TourKeyboardHandlers {
  dialogRef: RefObject<HTMLElement>
  onEscape: () => void
  onPrevious: () => void
  onNext: () => void
}

/**
 * Keyboard for the tour while it is open: Escape closes, ← and → move between steps, and
 * Tab stays inside the dialog. Listens on the document, so the keys keep working when the
 * focused button disappears (Back on the first step).
 *
 * @param handlers - The dialog element and what each key does (TourKeyboardHandlers)
 */
export function useTourKeyboard(handlers: TourKeyboardHandlers): void {
  const latestHandlersRef = useRef(handlers)
  latestHandlersRef.current = handlers

  useEffect(() => {
    function handleDocumentKeyDown(event: KeyboardEvent) {
      const { dialogRef, onEscape, onPrevious, onNext } = latestHandlersRef.current
      const keyActions: Record<string, (() => void) | undefined> = { Escape: onEscape, ArrowLeft: onPrevious, ArrowRight: onNext }
      const keyAction = keyActions[event.key]
      if (keyAction) {
        event.preventDefault()
        keyAction()
        return
      }
      if (dialogRef.current) keepTabFocusInside(event, dialogRef.current)
    }
    document.addEventListener('keydown', handleDocumentKeyDown)
    return () => document.removeEventListener('keydown', handleDocumentKeyDown)
  }, [])
}
