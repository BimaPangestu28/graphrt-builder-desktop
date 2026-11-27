import { vi } from 'vitest'

/**
 * A fixed early afternoon. Tests that read "Today 13:11" or "Yesterday 07:00" from
 * timestamps relative to now pin the clock here, so they do not depend on the hour they
 * run at (just after midnight, "30 minutes ago" is yesterday).
 */
export const pinnedNow = new Date(2026, 10, 20, 13, 41, 4)

/** Pins `Date` to {@link pinnedNow}. Timers stay real, so `findBy...` still waits. */
export function pinClock(): void {
  vi.useFakeTimers({ toFake: ['Date'], now: pinnedNow })
}
