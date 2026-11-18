import { callBackend, isDesktopApp } from './client'
import { sampleRunSummaryBackend } from './sampleBackend/runSummary'
import type { AgentRunStats, RunSummary } from './runSummaryTypes'

/** Plain-language summaries of runs (screen 07) and weekly agent stats (Home, 09). */

/**
 * Headline, items, counters, step and approval counts of one run.
 *
 * @param runId - The run to summarize (string)
 * @returns The run summary (RunSummary)
 * @throws BackendError - `not_found` when the run does not exist
 *
 * @example
 * const summary = await getRunSummary(runId)
 */
export function getRunSummary(runId: string): Promise<RunSummary> {
  if (!isDesktopApp()) return sampleRunSummaryBackend.getRunSummary(runId)
  return callBackend('get_run_summary', { runId })
}

/**
 * Last-7-days run stats per agent, for every agent or just `agentId`.
 *
 * @param agentId - Only this agent (string, optional)
 * @returns One entry per agent (AgentRunStats[])
 * @throws BackendError - `not_found` when `agentId` names no agent
 */
export function listAgentRunStats(agentId?: string): Promise<AgentRunStats[]> {
  if (!isDesktopApp()) return sampleRunSummaryBackend.listAgentRunStats(agentId)
  return callBackend('list_agent_run_stats', { agentId: agentId ?? null })
}
