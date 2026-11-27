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
  if (__SAMPLE_BACKEND__ && !isDesktopApp()) return sampleRunSummaryBackend.getRunSummary(runId)
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
  if (__SAMPLE_BACKEND__ && !isDesktopApp()) return sampleRunSummaryBackend.listAgentRunStats(agentId)
  return callBackend('list_agent_run_stats', { agentId: agentId ?? null })
}

/**
 * Opens the target of a card's Action.OpenUrl (or a link in card text) in the default browser.
 *
 * @param url - An https or mailto link (string)
 * @throws BackendError - `invalid_input` for any other link
 */
export function openCardLink(url: string): Promise<void> {
  if (__SAMPLE_BACKEND__ && !isDesktopApp()) {
    console.info(`Sample backend: would open ${url}`)
    return Promise.resolve()
  }
  return callBackend('open_card_link', { url })
}

/**
 * Opens a file the run made with its default app (a PDF in the PDF viewer). The backend only
 * opens a file that run reported and wrote.
 *
 * @param runId - The run that made the file (string)
 * @param path - The file's `path` from the run summary (string)
 * @throws BackendError - `not_found` when the file is gone or was not made by the run
 */
export function openRunFile(runId: string, path: string): Promise<void> {
  if (__SAMPLE_BACKEND__ && !isDesktopApp()) {
    console.info(`Sample backend: would open ${path}`)
    return Promise.resolve()
  }
  return callBackend('open_run_file', { runId, path })
}

/**
 * Opens the folder of a file the run made in the file manager.
 *
 * @param runId - The run that made the file (string)
 * @param path - The file's `path` from the run summary (string)
 * @throws BackendError - `not_found` when the file is gone or was not made by the run
 */
export function openRunFileFolder(runId: string, path: string): Promise<void> {
  if (__SAMPLE_BACKEND__ && !isDesktopApp()) {
    console.info(`Sample backend: would open the folder of ${path}`)
    return Promise.resolve()
  }
  return callBackend('open_run_file_folder', { runId, path })
}
