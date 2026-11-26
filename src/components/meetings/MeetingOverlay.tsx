import { useMemo, useState } from 'react'
import { dismissMeetingPrompt, startMeetingRecording, stopMeetingRecording } from '@/api/meetings'
import type { MeetingStatus } from '@/api/meetingTypes'
import { Button } from '@/components/ui'
import { useMeetingStatus } from '@/hooks/useMeetings'
import { useNow } from '@/hooks/useNow'
import { toErrorMessage } from '@/lib/errors'
import { describeAutoStop, describeNoteTakers, formatElapsed } from '@/lib/meetingDisplay'

/**
 * Meeting notes on every screen, bottom right (the only UI the notes add besides a few
 * Settings rows and the meeting trigger of an agent's schedule): the "Meeting detected.
 * Take notes?" card while a prompt is open, and a red "Recording" pill with Stop while it
 * records. Renders nothing otherwise, and outside the desktop app.
 */
export function MeetingOverlay() {
  const { data: status, reload } = useMeetingStatus()
  if (!status?.isSupported) return null
  return <MeetingOverlayView status={status} onChanged={reload} />
}

interface MeetingOverlayViewProps {
  status: MeetingStatus
  onChanged: () => Promise<void>
}

export function MeetingOverlayView({ status, onChanged }: MeetingOverlayViewProps) {
  const [isBusy, setIsBusy] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const now = useNow(status.recording !== null)
  // The backend reports seconds left at fetch time; count down locally from there.
  const autoStopAtMs = useMemo(
    () => (status.autoStopInSeconds === null ? null : Date.now() + status.autoStopInSeconds * 1000),
    [status.autoStopInSeconds],
  )

  async function act(action: () => Promise<unknown>) {
    setIsBusy(true)
    setErrorMessage(null)
    try {
      await action()
    } catch (rawError) {
      setErrorMessage(toErrorMessage(rawError))
    } finally {
      setIsBusy(false)
      await onChanged()
    }
  }

  const error = errorMessage && <p className="m-0 text-[13px] text-danger">{errorMessage}</p>

  if (status.recording) {
    return (
      <aside
        aria-label="Meeting notes"
        className="fixed right-4 bottom-4 z-50 flex max-w-[360px] flex-col gap-2 rounded-[14px] border border-danger-line bg-surface p-3 shadow-[0_8px_24px_rgba(0,0,0,0.12)]"
      >
        <div className="flex items-center gap-3">
          <span aria-hidden="true" className="size-2.5 shrink-0 animate-pulse rounded-full bg-danger" />
          <div className="min-w-0 flex-1">
            <span className="block font-semibold">Recording {formatElapsed(status.recording.startedAt, now)}</span>
            <span className="block truncate text-[12px] text-muted">{status.recording.title}</span>
          </div>
          <Button variant="danger" size="sm" disabled={isBusy} onClick={() => void act(stopMeetingRecording)}>
            Stop
          </Button>
        </div>
        {autoStopAtMs !== null && (
          <div className="flex items-center justify-between gap-2 border-t border-line pt-2 text-[13px]">
            <span>{describeAutoStop((autoStopAtMs - now) / 1000)}</span>
            <Button variant="ghost" size="sm" disabled={isBusy} onClick={() => void act(dismissMeetingPrompt)}>
              Keep recording
            </Button>
          </div>
        )}
        {error}
      </aside>
    )
  }

  if (status.prompt) {
    return (
      <aside
        aria-label="Meeting detected"
        className="fixed right-4 bottom-4 z-50 flex w-[340px] max-w-[calc(100vw-32px)] flex-col gap-2 rounded-[14px] border border-line bg-surface p-4 shadow-[0_8px_24px_rgba(0,0,0,0.12)]"
      >
        <strong className="text-[15px]">Meeting detected. Take notes?</strong>
        <span className="text-[13px] text-body">
          {status.prompt.message}. graphrt records your microphone and the computer's sound until you press Stop.{' '}
          {describeNoteTakers(status.prompt.agentNames)}
        </span>
        <span className="text-[12px] text-muted">{status.prompt.consentReminder}</span>
        <div className="flex gap-2 pt-1">
          <Button size="sm" disabled={isBusy} onClick={() => void act(startMeetingRecording)}>
            Take notes
          </Button>
          <Button variant="ghost" size="sm" disabled={isBusy} onClick={() => void act(dismissMeetingPrompt)}>
            Not now
          </Button>
        </div>
        {error}
      </aside>
    )
  }

  return null
}
