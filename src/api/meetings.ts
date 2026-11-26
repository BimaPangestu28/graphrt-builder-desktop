import { callBackend, isDesktopApp, listenToBackend } from './client'
import type { MeetingRecord, MeetingSettings, MeetingStatus } from './meetingTypes'

/**
 * Meeting notetaker: detection prompt, recording the microphone and the computer's sound,
 * and local transcripts (see docs/design/meeting-notetaker.md). Nothing records without a
 * call to {@link startMeetingRecording}, which only the user's click makes.
 *
 * Outside the desktop app (browser preview, tests) the notetaker reports itself as not
 * supported and has no meetings.
 */

/** Tauri events (no payload): refetch the status / the list. */
export const meetingStatusEvent = 'meeting-status-changed'
export const meetingsChangedEvent = 'meetings-changed'

const unsupportedStatus: MeetingStatus = {
  isSupported: false,
  settings: { detectionEnabled: false, whisperCliPath: null, whisperModelPath: null },
  micUsers: [],
  probeError: null,
  prompt: null,
  meetingSeemsOver: false,
  recording: null,
  transcribing: [],
  transcriber: { whisperCli: null, whisperModel: null, modelsFolder: '', isReady: false },
}

function hasBackend(): boolean {
  return !(__SAMPLE_BACKEND__ && !isDesktopApp())
}

export function getMeetingStatus(): Promise<MeetingStatus> {
  if (!hasBackend()) return Promise.resolve(unsupportedStatus)
  return callBackend('get_meeting_status')
}

/** Saves the detection switch and the whisper paths; returns them as saved (blank paths cleared). */
export function updateMeetingSettings(settings: MeetingSettings): Promise<MeetingSettings> {
  if (!hasBackend()) return Promise.resolve(settings)
  return callBackend('update_meeting_settings', { settings })
}

/** "Not now" on the prompt, or "Keep recording" on "Meeting seems over". */
export function dismissMeetingPrompt(): Promise<void> {
  if (!hasBackend()) return Promise.resolve()
  return callBackend('dismiss_meeting_prompt')
}

/**
 * Starts recording the microphone and the computer's sound.
 *
 * @param app - Names the meeting ("Zoom"); defaults to the program of the open prompt
 * @throws BackendError - `invalid_input` while already recording, `internal` when the audio system cannot record
 */
export function startMeetingRecording(app?: string): Promise<MeetingRecord> {
  return callBackend('start_meeting_recording', { app: app ?? null })
}

export function stopMeetingRecording(): Promise<MeetingRecord> {
  return callBackend('stop_meeting_recording')
}

/** Every meeting, newest first. */
export function listMeetings(): Promise<MeetingRecord[]> {
  if (!hasBackend()) return Promise.resolve([])
  return callBackend('list_meetings')
}

/** Transcribes a meeting on this computer with whisper.cpp; resolves when done (can take minutes). */
export function transcribeMeeting(meetingId: string): Promise<MeetingRecord> {
  return callBackend('transcribe_meeting', { meetingId })
}

/** The transcript as Markdown: `[00:01:05] You: …` / `Others: …`. */
export function getMeetingTranscript(meetingId: string): Promise<string> {
  return callBackend('get_meeting_transcript', { meetingId })
}

export function deleteMeeting(meetingId: string): Promise<void> {
  return callBackend('delete_meeting', { meetingId })
}

export function listenToMeetingStatus(onChange: (payload: null) => void): Promise<() => void> {
  return listenToBackend<null>(meetingStatusEvent, onChange)
}

export function listenToMeetingList(onChange: (payload: null) => void): Promise<() => void> {
  return listenToBackend<null>(meetingsChangedEvent, onChange)
}
