/** Meeting notes types, mirroring `src-tauri/src/meeting` (camelCase JSON). */

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

/** One recorded meeting (a folder in the app data). */
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
  /** Runs of the agents the meeting started. */
  runIds: string[]
  audioDeleted: boolean
  folder: string
}

/** Settings > Runner > Meeting notes. */
export interface MeetingSettings {
  /** Offer to take notes when another app uses the microphone (off until turned on). */
  detectionEnabled: boolean
  /** Keep the audio after the transcript is made (deleted by default). */
  keepAudio: boolean
  /** Developer overrides, not shown in the app. */
  whisperCliPath: string | null
  whisperModelPath: string | null
}

export interface MeetingPrompt {
  apps: MeetingApp[]
  /** "Zoom is using the microphone". */
  message: string
  /** "Let the others know you are taking notes." */
  consentReminder: string
  /** The agents that will work on the notes. */
  agentNames: string[]
}

export interface TranscriberStatus {
  /** whisper.cpp is on this computer (else it downloads on first use). */
  isInstalled: boolean
  downloadMessage: string | null
}

export interface MeetingStatus {
  /** False on systems without a notetaker backend yet (macOS, Windows). */
  isSupported: boolean
  settings: MeetingSettings
  /** Agents with "When a meeting is recorded" on (tested or active). */
  triggeredAgents: string[]
  micUsers: MeetingApp[]
  probeError: string | null
  /** "Meeting detected. Take notes?" — never acted on without the user. */
  prompt: MeetingPrompt | null
  recording: MeetingRecord | null
  /** Recording stops by itself in this many seconds (the meeting app left the microphone). */
  autoStopInSeconds: number | null
  transcriber: TranscriberStatus
}

/** An agent's "When a meeting is recorded" trigger. */
export interface MeetingTrigger {
  enabled: boolean
}
