import { useEffect, useState } from 'react'

/**
 * The current time in ms, refreshed every `intervalMs` while `isTicking` (live durations and
 * elapsed clocks). Stops ticking, and keeps the last value, when `isTicking` turns false.
 *
 * @param isTicking - Whether the clock should advance (boolean)
 * @param intervalMs - Refresh interval (number, default 1000)
 * @returns `Date.now()` as of the last tick (number)
 *
 * @example
 * const now = useNow(run?.status === 'running')
 */
export function useNow(isTicking: boolean, intervalMs = 1000): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!isTicking) return
    setNow(Date.now())
    const timer = setInterval(() => setNow(Date.now()), intervalMs)
    return () => clearInterval(timer)
  }, [isTicking, intervalMs])
  return now
}
