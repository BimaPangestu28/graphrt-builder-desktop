import type { BadgeTone } from '@/components/ui'
import type { MeetingRecord, TrackKind } from '@/api/meetingTypes'

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
 * Size of a track on disk.
 *
 * @example
 * formatBytes(1_900_000) // "1.9 MB"
 */
export function formatBytes(bytes: number): string {
  if (bytes < 1000) return `${bytes} B`
  if (bytes < 1_000_000) return `${Math.round(bytes / 1000)} KB`
  return `${(bytes / 1_000_000).toFixed(1)} MB`
}

/** Length of a finished meeting ("14 min", "under a minute"), or null while recording. */
export function meetingDuration(record: MeetingRecord): string | null {
  if (!record.endedAt) return null
  const minutes = Math.round((Date.parse(record.endedAt) - Date.parse(record.startedAt)) / 60_000)
  if (Number.isNaN(minutes)) return null
  return minutes < 1 ? 'under a minute' : `${minutes} min`
}

export function trackLabel(kind: TrackKind): string {
  return kind === 'mic' ? 'Your microphone' : "Computer's sound"
}

/** Badge of a meeting in the list. */
export function meetingStatusBadge(record: MeetingRecord, isTranscribing: boolean): { label: string; tone: BadgeTone } {
  if (isTranscribing || record.status === 'transcribing') return { label: 'Transcribing…', tone: 'brand' }
  switch (record.status) {
    case 'recording':
      return { label: 'Recording', tone: 'danger' }
    case 'recorded':
      return { label: 'Recorded', tone: 'neutral' }
    case 'transcribed':
      return { label: 'Transcribed', tone: 'ok' }
    case 'transcriptionFailed':
      return { label: 'Transcription failed', tone: 'amber' }
  }
}
