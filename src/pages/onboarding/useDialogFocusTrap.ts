import { useEffect, type RefObject } from 'react'

const focusableSelector = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

function listFocusableElements(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>(focusableSelector))
}

/**
 * Keeps Tab and Shift+Tab inside a modal dialog. Call from a document `keydown` listener, so it also works after the focused button disappears.
 *
 * @param event - The key event (KeyboardEvent)
 * @param dialog - The dialog element (HTMLElement)
 */
export function keepTabFocusInside(event: KeyboardEvent, dialog: HTMLElement): void {
  if (event.key !== 'Tab') return
  const focusableElements = listFocusableElements(dialog)
  if (focusableElements.length === 0) {
    event.preventDefault()
    return
  }
  const firstElement = focusableElements[0]
  const lastElement = focusableElements[focusableElements.length - 1]
  const activeElement = document.activeElement
  const isFocusOutside = !dialog.contains(activeElement)
  if (event.shiftKey && (activeElement === firstElement || isFocusOutside)) {
    event.preventDefault()
    lastElement.focus()
  } else if (!event.shiftKey && (activeElement === lastElement || isFocusOutside)) {
    event.preventDefault()
    firstElement.focus()
  }
}

/**
 * Moves focus into the dialog when it opens and back to whatever had focus before
 * when it closes (if that element is still on the page).
 *
 * @param initialFocusRef - Element focused on open, e.g. the primary button (RefObject<HTMLElement>)
 */
export function useFocusOnOpenAndRestore(initialFocusRef: RefObject<HTMLElement>): void {
  useEffect(() => {
    const previouslyFocusedElement = document.activeElement instanceof HTMLElement ? document.activeElement : null
    initialFocusRef.current?.focus()
    return () => {
      if (previouslyFocusedElement?.isConnected) previouslyFocusedElement.focus()
    }
  }, [initialFocusRef])
}
