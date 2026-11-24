/**
 * The Runs screen's (20) row shape and status wording. Rows are built from backend runs in
 * `runViewModel.ts`; the sample history lives in `api/sampleBackend/fixtures/runRecords.ts`.
 */
/** `stopped`: the user stopped the run (backend `aborted`); not a failure. */
export type RunStatus = 'running' | 'done' | 'needsYou' | 'failed' | 'stopped'

export interface RunStep {
  label: string
  detail: string
  isDone: boolean
}

export interface RunRecord {
  id: string
  /** Backend agent id, when the record comes from the runs API. */
  agentId?: string
  agentName: string
  startedBy: string
  when: string
  /** Plain-language result, possibly Markdown (shown as a clamped preview). */
  result: string
  /** Full text behind the preview for the hover title, e.g. the raw error. Defaults to `result`. */
  resultTitle?: string
  status: RunStatus
  /** Subtitle of the detail panel: date, duration and AI cost. */
  timing: string
  steps: RunStep[]
  output: string
  rawLog: string[]
  /** RFC 3339 start time, for ordering local and online runs together. */
  startedAt?: string
  /** Where it ran: this computer (default) or online (Put it online). */
  place?: 'local' | 'online'
  /** Optional screen to jump to for a run that needs attention. */
  followUp?: { label: string; path: string }
}

export const runStatusLabels: Record<RunStatus, string> = {
  running: 'Running',
  done: 'Done',
  needsYou: 'Needs you',
  failed: 'Failed',
  stopped: 'Stopped',
}
