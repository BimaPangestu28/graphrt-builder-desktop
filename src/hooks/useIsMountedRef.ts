import { useEffect, useRef, type MutableRefObject } from 'react'

/**
 * A ref that is true while the component is mounted.
 *
 * For async handlers (not effects, which clean up themselves) that await a backend
 * call and then set state: once the screen is gone the result is dropped instead
 * of updating an unmounted component, which React warns about and which made tests
 * that unmount mid-request flaky.
 *
 * @returns Ref whose `current` is false after unmount (MutableRefObject<boolean>)
 *
 * @example
 * const isMountedRef = useIsMountedRef()
 * const result = await saveThing()
 * if (!isMountedRef.current) return
 * setResult(result)
 */
export function useIsMountedRef(): MutableRefObject<boolean> {
  const isMountedRef = useRef(false)
  useEffect(() => {
    isMountedRef.current = true
    return () => {
      isMountedRef.current = false
    }
  }, [])
  return isMountedRef
}
