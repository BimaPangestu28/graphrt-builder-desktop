import { useState } from 'react'
import { updateMeetingSettings } from '@/api/meetings'
import type { MeetingSettings, MeetingStatus } from '@/api/meetingTypes'
import { useMeetingStatus } from '@/hooks/useMeetings'
import { toErrorMessage } from '@/lib/errors'
import { ActionRow, SettingsGroup, ToggleRow } from './SettingRows'

/**
 * Settings > Runner > Meeting notes: the two switches of the notetaker. Which agents
 * take the notes is each agent's "When a meeting is recorded" trigger (its Schedule
 * screen). Hidden where meeting notes are not supported yet.
 */
export function MeetingNotesSection() {
  const { data: status, reload } = useMeetingStatus()
  if (!status?.isSupported) return null
  return <MeetingNotesSettings status={status} onChanged={reload} />
}

export function MeetingNotesSettings({ status, onChanged }: { status: MeetingStatus; onChanged: () => Promise<void> }) {
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  async function save(changes: Partial<MeetingSettings>) {
    setErrorMessage(null)
    try {
      await updateMeetingSettings({ ...status.settings, ...changes })
    } catch (rawError) {
      setErrorMessage(toErrorMessage(rawError))
    }
    await onChanged()
  }

  const agentsLine =
    status.triggeredAgents.length === 0
      ? 'No agent takes meeting notes yet: turn on "When a meeting is recorded" in an agent\'s schedule.'
      : `Notes go to: ${status.triggeredAgents.join(', ')}`
  const transcriberLine =
    status.transcriber.downloadMessage ??
    (status.transcriber.isInstalled
      ? 'Speech to text (whisper.cpp) is installed on this computer.'
      : 'Speech to text (whisper.cpp, about 150 MB) downloads the first time a meeting is transcribed.')

  return (
    <SettingsGroup headingId="settings-meeting-notes-heading" title="Meeting notes">
      <ToggleRow
        title="Offer to take meeting notes"
        description="When another app (Zoom, Teams, Meet in a browser…) uses the microphone, ask whether to record the meeting for your agents. Never records without asking."
        isChecked={status.settings.detectionEnabled}
        onToggle={(isChecked) => void save({ detectionEnabled: isChecked })}
      />
      <ToggleRow
        title="Keep meeting audio"
        description="Otherwise the recording is deleted once its transcript is made"
        isChecked={status.settings.keepAudio}
        onToggle={(isChecked) => void save({ keepAudio: isChecked })}
      />
      <ActionRow title="Agents" description={agentsLine} action={null} />
      <ActionRow title="Transcription" description={transcriberLine} action={null} hasDivider={false} />
      {status.probeError && <p className="m-0 text-[13px] text-danger">{status.probeError}</p>}
      {errorMessage && <p className="m-0 text-[13px] text-danger">{errorMessage}</p>}
    </SettingsGroup>
  )
}
