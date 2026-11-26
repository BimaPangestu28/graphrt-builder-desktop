import { callBackend, isDesktopApp, listenToBackend } from './client'
import type { MeetingRecord, MeetingSettings, MeetingStatus, MeetingTrigger } from './meetingTypes'

/**
 * Meeting notes (docs/design/meeting-notetaker.md): the "Meeting detected. Take notes?"
 * card, the recording pill, the Settings rows and an agent's "When a meeting is
 * recorded" trigger. Transcribing and summarizing are steps of the agent's workflow.
 * Nothing records without {@link startMeetingRecording}, which only the user's click calls.
 *
 * Outside the desktop app (browser preview, tests) the notes are not supported and every
 * trigger is off.
 */

/** Tauri event (no payload): refetch the status. */
export const meetingStatusEvent = 'meeting-status-changed'

const unsupportedStatus: MeetingStatus = {
  isSupported: false,
  settings: { detectionEnabled: false, keepAudio: false, whisperCliPath: null, whisperModelPath: null },
  triggeredAgents: [],
  micUsers: [],
  probeError: null,
  prompt: null,
  recording: null,
  autoStopInSeconds: null,
  transcriber: { isInstalled: false, downloadMessage: null },
}

function hasBackend(): boolean {
  return !(__SAMPLE_BACKEND__ && !isDesktopApp())
}

export function getMeetingStatus(): Promise<MeetingStatus> {
  if (!hasBackend()) return Promise.resolve(unsupportedStatus)
  return callBackend('get_meeting_status')
}

/** Saves the detection switch and "Keep meeting audio"; returns them as saved. */
export function updateMeetingSettings(settings: MeetingSettings): Promise<MeetingSettings> {
  if (!hasBackend()) return Promise.resolve(settings)
  return callBackend('update_meeting_settings', { settings })
}

/** "Not now" on the prompt, or "Keep recording" before it stops by itself. */
export function dismissMeetingPrompt(): Promise<void> {
  if (!hasBackend()) return Promise.resolve()
  return callBackend('dismiss_meeting_prompt')
}

/**
 * "Take notes": starts recording the microphone and the computer's sound.
 *
 * @throws BackendError - `invalid_input` while already recording, `internal` when the audio system cannot record
 */
export function startMeetingRecording(): Promise<MeetingRecord> {
  return callBackend('start_meeting_recording')
}

/** Stop: finishes the recording and starts the agents with the meeting trigger. */
export function stopMeetingRecording(): Promise<MeetingRecord> {
  return callBackend('stop_meeting_recording')
}

/** Whether the agent runs when a meeting is recorded. */
export function getMeetingTrigger(agentId: string): Promise<MeetingTrigger> {
  if (!hasBackend()) return Promise.resolve({ enabled: false })
  return callBackend('get_meeting_trigger', { agentId })
}

export function setMeetingTrigger(agentId: string, enabled: boolean): Promise<MeetingTrigger> {
  if (!hasBackend()) return Promise.resolve({ enabled })
  return callBackend('set_meeting_trigger', { agentId, enabled })
}

export function listenToMeetingStatus(onChange: (payload: null) => void): Promise<() => void> {
  return listenToBackend<null>(meetingStatusEvent, onChange)
}
