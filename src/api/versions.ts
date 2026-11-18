import { callBackend, isDesktopApp } from './client'
import { sampleVersionsBackend } from './sampleBackend/versions'
import type { FlowSummary } from './types'
import type { VersionComparison } from './versionTypes'

/** Comparing saved versions of an agent. Sample data outside the desktop app. */

/**
 * Compares two saved versions step by step. A version whose workflow no longer
 * compiles comes back with `error` set instead of failing the call.
 *
 * @param agentId - Agent whose versions to compare (string)
 * @param fromVersion - Base version, e.g. the current one (number)
 * @param toVersion - Version to compare with, e.g. the one to restore (number)
 * @returns Both versions' steps and the per-step changes (VersionComparison)
 * @throws BackendError - `not_found` when the agent or a version does not exist
 *
 * @example
 * const comparison = await compareAgentVersions('maps-leads', 7, 5)
 */
export function compareAgentVersions(agentId: string, fromVersion: number, toVersion: number): Promise<VersionComparison> {
  if (!isDesktopApp()) return sampleVersionsBackend.compareAgentVersions(agentId, fromVersion, toVersion)
  return callBackend('compare_agent_versions', { agentId, fromVersion, toVersion })
}

/**
 * Steps, inputs and model providers of one saved version.
 *
 * @throws BackendError - `not_found` for an unknown agent or version; `workflow` when it no longer compiles
 */
export function getVersionFlowSummary(agentId: string, version: number): Promise<FlowSummary> {
  if (!isDesktopApp()) return sampleVersionsBackend.getVersionFlowSummary(agentId, version)
  return callBackend('get_version_flow_summary', { agentId, version })
}
