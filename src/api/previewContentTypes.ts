import type { ScheduleTrigger } from '@/lib/scheduleCalendar'

/**
 * What the browser preview shows that the backend cannot report (yet). The desktop app gets
 * none of it: see {@link getPreviewContent} in `previewContent.ts`.
 */

/** A connection the agent needs before it can run (Needs panel on screen 04). */
export interface AgentAppRequirement {
  label: string
  isConnected: boolean
}

/** Scheduler (screen 10) pinning and the triggers the backend has no kind for. */
export interface SchedulerPreview {
  /** Event and webhook triggers: the backend only has clock-based ones. They toggle locally. */
  eventTriggers: ScheduleTrigger[]
  /** The design's trigger order (by trigger id); others follow in their own order. */
  triggerOrderById: ReadonlyMap<string, number>
  /** Short names inside calendar blocks, by agent id ("Maps leads"). */
  shortNamesByAgentId: ReadonlyMap<string, string>
  /** The "today" the calendar is pinned to ("YYYY-MM-DD"), so it matches the design's week. */
  todayIsoDate: string
  /** Zone of the sample schedules when no trigger names one. */
  timeZone: string
}

export interface PreviewContent {
  /** Names of the sample agents by id, for runs and triggers whose agent the list does not hold. */
  agentNamesById: Readonly<Record<string, string>>
  /** App connections per agent id: the backend does not report app connections yet. */
  appRequirementsByAgentId: Readonly<Record<string, AgentAppRequirement[]>>
  /** Run opened in the Runs screen's detail panel when no `?runId=` is given, as in the design. */
  selectedRunId: string
  scheduler: SchedulerPreview
}
