import type { Run } from '@/api/types'
import { hiddenPlaceCount, testRunPlaces, testRunStats, type PlaceOutcome, type RunResultStat, type TestRunPlace } from '@/data/testRun'

/**
 * What screen 07 shows for a finished run. Each part comes from the run's outputs when the backend
 * provides it and falls back to the mockup's content otherwise.
 */
export interface RunResultSummary {
  stats: RunResultStat[]
  places: TestRunPlace[]
  hiddenPlaceCount: number
  placesFound: number
  /** "Today 13:03 · on this Mac" */
  meta: string
  /** "The message reached [PLACE NAME] at 13:04. Everything worked" */
  builderReply: string
}

const fallbackStatByLabel = new Map(testRunStats.map((stat) => [stat.label, stat.value]))
const fallbackPlacesFound = testRunPlaces.length + hiddenPlaceCount

function readNumber(outputs: Record<string, unknown> | null, key: string): number | null {
  const outputValue = outputs?.[key]
  return typeof outputValue === 'number' && Number.isFinite(outputValue) ? outputValue : null
}

function isPlaceOutcome(value: unknown): value is PlaceOutcome {
  return value === 'Sent' || value === 'Not in test'
}

function readPlaces(outputs: Record<string, unknown> | null): TestRunPlace[] | null {
  const rawPlaces = outputs?.places
  if (!Array.isArray(rawPlaces)) return null
  const places = rawPlaces.flatMap((rawPlace, index): TestRunPlace[] => {
    if (!rawPlace || typeof rawPlace !== 'object') return []
    const { name, phone, outcome } = rawPlace as Record<string, unknown>
    if (typeof name !== 'string') return []
    return [{ id: `place-${index + 1}`, name, phone: typeof phone === 'string' ? phone : '', outcome: isPlaceOutcome(outcome) ? outcome : 'Not in test' }]
  })
  return places.length > 0 ? places : null
}

/** "41s" or "2m 05s". */
export function formatRunDuration(startedAt: string, finishedAt: string | null): string | null {
  if (!finishedAt) return null
  const totalSeconds = Math.max(0, Math.round((new Date(finishedAt).getTime() - new Date(startedAt).getTime()) / 1000))
  if (totalSeconds < 60) return `${totalSeconds}s`
  const minutes = Math.floor(totalSeconds / 60)
  if (minutes < 60) return `${minutes}m ${String(totalSeconds % 60).padStart(2, '0')}s`
  return `${Math.floor(minutes / 60)}h ${String(minutes % 60).padStart(2, '0')}m`
}

/** "$0.004" with up to three decimals. */
export function formatAiCost(costUsd: number): string {
  return `$${Number(costUsd.toFixed(3))}`
}

function isSameLocalDay(first: Date, second: Date): boolean {
  return first.toDateString() === second.toDateString()
}

/** "13:04" in the machine's zone. */
export function formatClockTime(isoTimestamp: string): string {
  const instant = new Date(isoTimestamp)
  return `${String(instant.getHours()).padStart(2, '0')}:${String(instant.getMinutes()).padStart(2, '0')}`
}

/** "Today 13:03", "Yesterday 07:00" or "16 Nov 07:00", relative to `now`. */
export function formatRunDay(isoTimestamp: string, now: Date = new Date()): string {
  const instant = new Date(isoTimestamp)
  const yesterday = new Date(now)
  yesterday.setDate(now.getDate() - 1)
  if (isSameLocalDay(instant, now)) return `Today ${formatClockTime(isoTimestamp)}`
  if (isSameLocalDay(instant, yesterday)) return `Yesterday ${formatClockTime(isoTimestamp)}`
  return `${instant.getDate()} ${instant.toLocaleString('en-GB', { month: 'short' })} ${formatClockTime(isoTimestamp)}`
}

function buildStats(run: Run): RunResultStat[] {
  const placesFound = readNumber(run.outputs, 'placesFound')
  const messagesSent = readNumber(run.outputs, 'messagesSent')
  const aiCostUsd = readNumber(run.outputs, 'aiCostUsd')
  const statValues: Record<string, string | null> = {
    'Places found': placesFound === null ? null : String(placesFound),
    'Messages sent': messagesSent === null ? null : String(messagesSent),
    Time: formatRunDuration(run.startedAt, run.finishedAt),
    'AI cost': aiCostUsd === null ? null : formatAiCost(aiCostUsd),
  }
  return testRunStats.map((stat) => ({ label: stat.label, value: statValues[stat.label] ?? fallbackStatByLabel.get(stat.label) ?? stat.value }))
}

/**
 * Builds screen 07's content for a run, or the mockup's content when there is no run.
 *
 * @param run - The finished run, or null (Run | null)
 * @returns Stats, places and texts (RunResultSummary)
 */
export function buildRunResultSummary(run: Run | null): RunResultSummary {
  if (!run) {
    return {
      stats: testRunStats,
      places: testRunPlaces,
      hiddenPlaceCount,
      placesFound: fallbackPlacesFound,
      meta: 'Today 13:03 · on this Mac',
      builderReply: 'The message reached [PLACE NAME] at 13:04. Everything worked',
    }
  }
  const places = readPlaces(run.outputs) ?? testRunPlaces
  const placesFound = readNumber(run.outputs, 'placesFound') ?? fallbackPlacesFound
  const sentPlace = readNumber(run.outputs, 'messagesSent') === 0 ? undefined : places.find((place) => place.outcome === 'Sent')
  const finishedClock = run.finishedAt ? formatClockTime(run.finishedAt) : null
  const builderReply =
    run.status === 'succeeded'
      ? sentPlace
        ? `The message reached ${sentPlace.name}${finishedClock ? ` at ${finishedClock}` : ''}. Everything worked`
        : 'The test finished. Nothing was sent'
      : `The test did not finish: ${run.errorMessage ?? run.status}`
  return {
    stats: buildStats(run),
    places,
    hiddenPlaceCount: Math.max(0, placesFound - places.length),
    placesFound,
    meta: `${formatRunDay(run.startedAt)} · on this Mac`,
    builderReply,
  }
}
