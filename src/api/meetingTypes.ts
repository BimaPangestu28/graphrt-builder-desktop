/** Meeting notetaker types, mirroring `src-tauri/src/meeting` (camelCase JSON). */

export type MeetingAppKind = 'zoom' | 'teams' | 'slack' | 'discord' | 'webex' | 'skype' | 'browser' | 'other'

/** A program using the microphone that could be a meeting. */
export interface MeetingApp {
  kind: MeetingAppKind
  /** "Zoom", "Google Chrome", or the program's own name. */
  label: string
  streamId: number
  pid: number | null
}

export type TrackKind = 'mic' | 'system'

export interface TrackFile {
  kind: TrackKind
  fileName: string
  sizeBytes: number
}

export type MeetingRecordStatus = 'recording' | 'recorded' | 'transcribing' | 'transcribed' | 'transcriptionFailed'

/** One meeting: its folder holds the tracks and, once transcribed, the transcript. */
export interface MeetingRecord {
  id: string
  title: string
  app: string | null
  /** ISO 8601 (UTC). */
  startedAt: string
  endedAt: string | null
  status: MeetingRecordStatus
  tracks: TrackFile[]
  error: string | null
  /** Absolute folder on disk. */
  folder: string
}

export interface MeetingSettings {
  /** Watch the microphone and offer to take notes (off until turned on). */
  detectionEnabled: boolean
  whisperCliPath: string | null
  whisperModelPath: string | null
}

export interface MeetingPrompt {
  apps: MeetingApp[]
  /** "Zoom is using the microphone". */
  message: string
}

export interface TranscriberStatus {
  whisperCli: string | null
  whisperModel: string | null
  modelsFolder: string
  isReady: boolean
}

export interface MeetingStatus {
  /** False on systems without a notetaker backend yet (macOS, Windows). */
  isSupported: boolean
  settings: MeetingSettings
  micUsers: MeetingApp[]
  probeError: string | null
  /** "Meeting detected, take notes?" — never acted on without the user. */
  prompt: MeetingPrompt | null
  /** Recording, and the microphone has been free for a while. */
  meetingSeemsOver: boolean
  recording: MeetingRecord | null
  transcribing: string[]
  transcriber: TranscriberStatus
}
