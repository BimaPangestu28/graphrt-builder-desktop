import { useState } from 'react'
import { deleteMeeting, getMeetingTranscript, transcribeMeeting } from '@/api/meetings'
import type { MeetingRecord } from '@/api/meetingTypes'
import { Badge, Button, Card, Spinner } from '@/components/ui'
import { toErrorMessage } from '@/lib/errors'
import { formatBytes, meetingDuration, meetingStatusBadge, trackLabel } from './meetingDisplay'

interface MeetingListItemProps {
  record: MeetingRecord
  isTranscribing: boolean
  canTranscribe: boolean
  onChanged: () => Promise<void>
}

/** One meeting: when, tracks, Transcribe / transcript / Delete. */
export function MeetingListItem({ record, isTranscribing, canTranscribe, onChanged }: MeetingListItemProps) {
  const [transcript, setTranscript] = useState<string | null>(null)
  const [isWorking, setIsWorking] = useState(false)
  const [isConfirmingDelete, setIsConfirmingDelete] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const badge = meetingStatusBadge(record, isTranscribing)
  const duration = meetingDuration(record)
  const isBusy = isWorking || isTranscribing || record.status === 'recording'

  async function run(action: () => Promise<void>) {
    setIsWorking(true)
    setErrorMessage(null)
    try {
      await action()
    } catch (rawError) {
      setErrorMessage(toErrorMessage(rawError))
    } finally {
      setIsWorking(false)
    }
  }

  const transcribe = () =>
    run(async () => {
      try {
        await transcribeMeeting(record.id)
        setTranscript(await getMeetingTranscript(record.id))
      } finally {
        await onChanged()
      }
    })

  const toggleTranscript = () =>
    transcript !== null ? setTranscript(null) : void run(async () => setTranscript(await getMeetingTranscript(record.id)))

  const remove = () =>
    run(async () => {
      await deleteMeeting(record.id)
      await onChanged()
    })

  return (
    <Card className="flex flex-col gap-3 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-0.5">
          <strong className="truncate">{record.title}</strong>
          <span className="text-[12px] text-muted">
            {new Date(record.startedAt).toLocaleString()}
            {duration && ` · ${duration}`}
          </span>
        </div>
        <Badge tone={badge.tone}>{badge.label}</Badge>
      </div>
      {record.tracks.length > 0 && (
        <ul className="m-0 flex list-none flex-wrap gap-x-4 gap-y-1 p-0 text-[13px] text-body">
          {record.tracks.map((track) => (
            <li key={track.kind}>
              {trackLabel(track.kind)} · {formatBytes(track.sizeBytes)}
            </li>
          ))}
        </ul>
      )}
      {record.error && <p className="m-0 text-[13px] text-amber-strong">{record.error}</p>}
      <div className="flex flex-wrap items-center gap-2">
        {record.status !== 'recording' && (
          <Button size="sm" disabled={isBusy || !canTranscribe} onClick={() => void transcribe()} title={canTranscribe ? undefined : 'Set up transcription above first'}>
            {isTranscribing ? <Spinner /> : null}
            {record.status === 'transcribed' ? 'Transcribe again' : 'Transcribe'}
          </Button>
        )}
        {record.status === 'transcribed' && (
          <Button variant="secondary" size="sm" disabled={isWorking} onClick={toggleTranscript}>
            {transcript !== null ? 'Hide transcript' : 'Show transcript'}
          </Button>
        )}
        {record.status !== 'recording' &&
          (isConfirmingDelete ? (
            <>
              <Button variant="danger" size="sm" disabled={isBusy} onClick={() => void remove()}>
                Delete audio and transcript
              </Button>
              <Button variant="ghost" size="sm" onClick={() => setIsConfirmingDelete(false)}>
                Cancel
              </Button>
            </>
          ) : (
            <Button variant="ghost" size="sm" disabled={isBusy} onClick={() => setIsConfirmingDelete(true)}>
              Delete
            </Button>
          ))}
        <span className="min-w-0 truncate text-[12px] text-muted" title={record.folder}>
          {record.folder}
        </span>
      </div>
      {errorMessage && <p className="m-0 text-[13px] text-danger">{errorMessage}</p>}
      {transcript !== null && (
        <pre className="m-0 max-h-[360px] overflow-auto rounded-lg bg-subtle p-3 text-[13px] leading-relaxed whitespace-pre-wrap">{transcript}</pre>
      )}
    </Card>
  )
}
