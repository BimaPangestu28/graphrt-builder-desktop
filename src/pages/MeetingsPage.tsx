import { useState } from 'react'
import { AppShell, PageFrame, PageTitleBlock } from '@/components/layout'
import { startMeetingRecording, stopMeetingRecording } from '@/api/meetings'
import { Button, Card, Icon } from '@/components/ui'
import { useMeetingList, useMeetingStatus } from '@/hooks/useMeetings'
import { useNow } from '@/hooks/useNow'
import { toErrorMessage } from '@/lib/errors'
import { formatElapsed } from './meetings/meetingDisplay'
import { MeetingListItem } from './meetings/MeetingListItem'
import { DetectionCard, TranscriptionCard } from './meetings/MeetingSettingsCards'

/**
 * Meetings: notes of calls, recorded and transcribed on this computer
 * (docs/design/meeting-notetaker.md). Detection switch, Start / Stop, transcription
 * set-up and the list of meetings with their transcripts.
 */
export function MeetingsPage() {
  const { data: status, reload: reloadStatus, error: statusError } = useMeetingStatus()
  const { data: meetings, reload: reloadMeetings } = useMeetingList()
  const [isBusy, setIsBusy] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const now = useNow(Boolean(status?.recording))

  async function reloadAll() {
    await Promise.all([reloadStatus(), reloadMeetings()])
  }

  async function toggleRecording() {
    setIsBusy(true)
    setErrorMessage(null)
    try {
      if (status?.recording) await stopMeetingRecording()
      else await startMeetingRecording()
    } catch (rawError) {
      setErrorMessage(toErrorMessage(rawError))
    } finally {
      setIsBusy(false)
      await reloadAll()
    }
  }

  const recordButton = status?.isSupported && (
    <Button variant={status.recording ? 'danger' : 'primary'} disabled={isBusy} onClick={() => void toggleRecording()}>
      <Icon name={status.recording ? 'pause' : 'mic'} size={16} />
      {status.recording ? `Stop recording · ${formatElapsed(status.recording.startedAt, now)}` : 'Start recording'}
    </Button>
  )

  return (
    <AppShell activeNav="meetings" agents={{ kind: 'list' }}>
      <PageFrame>
        <PageTitleBlock
          title="Meetings"
          subtitle="Notes of your calls, recorded and transcribed on this computer. No bot joins the call."
          actions={recordButton}
        />
        {errorMessage && <p className="m-0 text-[13px] text-danger">{errorMessage}</p>}
        {statusError && <p className="m-0 text-[13px] text-danger">{statusError.message}</p>}
        {status && !status.isSupported && (
          <Card className="p-5 text-[14px]">Meeting notes work on Linux for now. macOS and Windows are coming.</Card>
        )}
        {status?.isSupported && (
          <>
            <DetectionCard status={status} onChanged={reloadStatus} />
            <TranscriptionCard status={status} onChanged={reloadStatus} />
          </>
        )}
        <section aria-label="Past meetings" className="flex flex-col gap-3">
          <h2 className="m-0 text-[16px] font-semibold">Past meetings</h2>
          {meetings && meetings.length === 0 && <span className="text-body">No meetings yet. Start a recording or turn on detection.</span>}
          {meetings?.map((record) => (
            <MeetingListItem
              key={record.id}
              record={record}
              isTranscribing={status?.transcribing.includes(record.id) ?? false}
              canTranscribe={status?.transcriber.isReady ?? false}
              onChanged={reloadAll}
            />
          ))}
        </section>
      </PageFrame>
    </AppShell>
  )
}
