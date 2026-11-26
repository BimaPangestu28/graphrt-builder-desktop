/**
 * Elapsed time of a recording as a clock.
 *
 * @example
 * formatElapsed('2026-11-26T10:00:00Z', Date.parse('2026-11-26T10:12:34Z')) // "12:34"
 * formatElapsed('2026-11-26T10:00:00Z', Date.parse('2026-11-26T11:02:03Z')) // "1:02:03"
 */
export function formatElapsed(startedAt: string, nowMs: number): string {
  const startedMs = Date.parse(startedAt)
  const totalSeconds = Number.isNaN(startedMs) ? 0 : Math.max(0, Math.floor((nowMs - startedMs) / 1000))
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const seconds = totalSeconds % 60
  const pad = (value: number) => String(value).padStart(2, '0')
  return hours > 0 ? `${hours}:${pad(minutes)}:${pad(seconds)}` : `${pad(minutes)}:${pad(seconds)}`
}

/**
 * Who works on the notes, for the prompt card.
 *
 * @example
 * describeNoteTakers(['Meeting notes to Notion']) // "Meeting notes to Notion gets the notes."
 * describeNoteTakers(['A', 'B', 'C']) // "A, B and C get the notes."
 */
export function describeNoteTakers(agentNames: string[]): string {
  if (agentNames.length === 0) return 'No agent takes the notes yet.'
  if (agentNames.length === 1) return `${agentNames[0]} gets the notes.`
  return `${agentNames.slice(0, -1).join(', ')} and ${agentNames[agentNames.length - 1]} get the notes.`
}

/** "Stops in 12 s" while the automatic stop counts down. */
export function describeAutoStop(seconds: number): string {
  return `The meeting seems over. Notes stop in ${Math.max(0, Math.round(seconds))} s.`
}
