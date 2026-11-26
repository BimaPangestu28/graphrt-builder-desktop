import { useEffect, useState } from 'react'
import { updateMeetingSettings } from '@/api/meetings'
import type { MeetingSettings, MeetingStatus } from '@/api/meetingTypes'
import { Badge, Button, Card } from '@/components/ui'
import { toErrorMessage } from '@/lib/errors'

interface CardProps {
  status: MeetingStatus
  onChanged: () => Promise<void>
}

const inputClassName =
  'box-border h-9 w-full min-w-0 rounded-lg border border-line-strong bg-surface px-3 text-[13px] text-ink outline-none focus:border-ink'

/** Detection switch and who uses the microphone now. */
export function DetectionCard({ status, onChanged }: CardProps) {
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const isEnabled = status.settings.detectionEnabled

  async function toggle() {
    setErrorMessage(null)
    try {
      await updateMeetingSettings({ ...status.settings, detectionEnabled: !isEnabled })
    } catch (rawError) {
      setErrorMessage(toErrorMessage(rawError))
    }
    await onChanged()
  }

  return (
    <Card className="flex flex-col gap-3 p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-1">
          <strong className="text-[15px]">Detect meetings</strong>
          <span className="max-w-[70ch] text-[13px] text-body">
            When another app (Zoom, Teams, Meet in a browser…) uses the microphone, graphrt asks whether to take notes. It never
            records until you say so.
          </span>
        </div>
        <label className="flex cursor-pointer items-center gap-2 text-[13px] font-medium">
          <input type="checkbox" checked={isEnabled} onChange={() => void toggle()} className="size-4 accent-ink" />
          {isEnabled ? 'On' : 'Off'}
        </label>
      </div>
      {isEnabled && (
        <div className="flex flex-col gap-1 text-[13px]">
          <span className="text-muted">Using the microphone now</span>
          {status.micUsers.length === 0 ? (
            <span>Nothing</span>
          ) : (
            <ul className="m-0 flex list-none flex-wrap gap-1.5 p-0">
              {status.micUsers.map((app) => (
                <li key={app.streamId}>
                  <Badge tone={app.kind === 'other' ? 'neutral' : 'brand'}>{app.label}</Badge>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
      {status.probeError && <p className="m-0 text-[13px] text-danger">{status.probeError}</p>}
      {errorMessage && <p className="m-0 text-[13px] text-danger">{errorMessage}</p>}
    </Card>
  )
}

/** whisper.cpp paths for local transcripts. */
export function TranscriptionCard({ status, onChanged }: CardProps) {
  const [cliPath, setCliPath] = useState(status.settings.whisperCliPath ?? '')
  const [modelPath, setModelPath] = useState(status.settings.whisperModelPath ?? '')
  const [message, setMessage] = useState<{ text: string; isError: boolean } | null>(null)
  const { transcriber } = status

  useEffect(() => {
    setCliPath(status.settings.whisperCliPath ?? '')
    setModelPath(status.settings.whisperModelPath ?? '')
  }, [status.settings.whisperCliPath, status.settings.whisperModelPath])

  async function save() {
    const settings: MeetingSettings = { ...status.settings, whisperCliPath: cliPath || null, whisperModelPath: modelPath || null }
    try {
      await updateMeetingSettings(settings)
      setMessage({ text: 'Saved', isError: false })
    } catch (rawError) {
      setMessage({ text: toErrorMessage(rawError), isError: true })
    }
    await onChanged()
  }

  return (
    <Card className="flex flex-col gap-3 p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <strong className="text-[15px]">Transcription on this computer</strong>
        <Badge tone={transcriber.isReady ? 'ok' : 'amber'}>{transcriber.isReady ? 'Ready' : 'Not set up'}</Badge>
      </div>
      <span className="max-w-[80ch] text-[13px] text-body">
        Uses whisper.cpp: the <code>whisper-cli</code> program and a ggml model (for example <code>ggml-base.bin</code>). Leave a
        field empty to use <code>whisper-cli</code> from PATH and the first model in{' '}
        <code className="break-all">{transcriber.modelsFolder || 'the meetings models folder'}</code>.
      </span>
      <div className="grid gap-2 text-[13px] md:grid-cols-2">
        <label className="flex min-w-0 flex-col gap-1">
          <span className="text-muted">whisper-cli{transcriber.whisperCli && !cliPath ? ` (found: ${transcriber.whisperCli})` : ''}</span>
          <input className={inputClassName} value={cliPath} placeholder="/usr/local/bin/whisper-cli" onChange={(event) => setCliPath(event.target.value)} />
        </label>
        <label className="flex min-w-0 flex-col gap-1">
          <span className="text-muted">Model{transcriber.whisperModel && !modelPath ? ` (found: ${transcriber.whisperModel})` : ''}</span>
          <input className={inputClassName} value={modelPath} placeholder="/path/to/ggml-base.bin" onChange={(event) => setModelPath(event.target.value)} />
        </label>
      </div>
      <div className="flex items-center gap-3">
        <Button variant="secondary" size="sm" onClick={() => void save()}>
          Save
        </Button>
        {message && <span className={message.isError ? 'text-[13px] text-danger' : 'text-[13px] text-muted'}>{message.text}</span>}
      </div>
    </Card>
  )
}
