import { useCallback, useRef, useState } from 'react'

/** Fallback width where ResizeObserver is missing (tests in jsdom). */
const fallbackWidth = 640

/**
 * The content width of an element, kept up to date as it resizes. Updates are rounded to whole pixels so a
 * chart only re-lays out when its width really changes.
 *
 * @returns A ref callback for the element and its width (0 until measured)
 */
export function useElementWidth<Element extends HTMLElement>(): [(element: Element | null) => void, number] {
  const [width, setWidth] = useState(0)
  const observerRef = useRef<ResizeObserver | null>(null)
  const ref = useCallback((element: Element | null) => {
    observerRef.current?.disconnect()
    observerRef.current = null
    if (!element) return
    if (typeof ResizeObserver === 'undefined') {
      setWidth(Math.round(element.clientWidth) || fallbackWidth)
      return
    }
    const observer = new ResizeObserver((entries) => {
      const measured = Math.round(entries[0]?.contentRect.width ?? 0)
      setWidth((current) => (current === measured ? current : measured))
    })
    observer.observe(element)
    observerRef.current = observer
    setWidth(Math.round(element.clientWidth))
  }, [])
  return [ref, width]
}
