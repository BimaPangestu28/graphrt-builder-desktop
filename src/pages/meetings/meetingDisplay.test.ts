import type { MeetingRecord } from '@/api/meetingTypes'
import { formatBytes, formatElapsed, meetingDuration, meetingStatusBadge, trackLabel } from './meetingDisplay'

function record(overrides: Partial<MeetingRecord> = {}): MeetingRecord {
  return {
    id: '20261126-100000-abc123',
    title: 'Zoom meeting, Nov 26 10:00',
    app: 'Zoom',
    startedAt: '2026-11-26T10:00:00Z',
    endedAt: null,
    status: 'recording',
    tracks: [],
    error: null,
    folder: '/data/meetings/20261126-100000-abc123',
    ...overrides,
  }
}

describe('meetingDisplay', () => {
  it('formats the elapsed clock', () => {
    const start = '2026-11-26T10:00:00Z'
    expect(formatElapsed(start, Date.parse('2026-11-26T10:00:07Z'))).toBe('00:07')
    expect(formatElapsed(start, Date.parse('2026-11-26T10:12:34Z'))).toBe('12:34')
    expect(formatElapsed(start, Date.parse('2026-11-26T11:02:03Z'))).toBe('1:02:03')
    expect(formatElapsed(start, Date.parse('2026-11-26T09:00:00Z'))).toBe('00:00')
    expect(formatElapsed('not a date', 0)).toBe('00:00')
  })

  it('formats track sizes', () => {
    expect(formatBytes(44)).toBe('44 B')
    expect(formatBytes(524_278)).toBe('524 KB')
    expect(formatBytes(1_900_000)).toBe('1.9 MB')
  })

  it('gives a finished meeting a length', () => {
    expect(meetingDuration(record())).toBeNull()
    expect(meetingDuration(record({ endedAt: '2026-11-26T10:00:20Z' }))).toBe('under a minute')
    expect(meetingDuration(record({ endedAt: '2026-11-26T10:14:10Z' }))).toBe('14 min')
  })

  it('labels tracks and statuses', () => {
    expect(trackLabel('mic')).toBe('Your microphone')
    expect(trackLabel('system')).toBe("Computer's sound")
    expect(meetingStatusBadge(record(), false)).toEqual({ label: 'Recording', tone: 'danger' })
    expect(meetingStatusBadge(record({ status: 'recorded' }), true).label).toBe('Transcribing…')
    expect(meetingStatusBadge(record({ status: 'transcriptionFailed' }), false).tone).toBe('amber')
    expect(meetingStatusBadge(record({ status: 'transcribed' }), false)).toEqual({ label: 'Transcribed', tone: 'ok' })
  })
})
