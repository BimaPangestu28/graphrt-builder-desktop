import { callBackend, isDesktopApp, listenToBackend } from './client'
import type { AgentTest, CheckProgress, CheckView, QualityOverview, QualitySettings, Release, ReleaseSwitchOutcome, SuggestedTest, TestInput } from './qualityTypes'
import { sampleQualityBackend, subscribeToSampleCheckProgress } from './sampleBackend/quality'

/**
 * Tests and releases of an agent: write or suggest test questions, check the latest version
 * (graphrt's eval harness scores every answer), release it, go back to an earlier release.
 * Outside the desktop app every call goes to the sample backend.
 */

function useSample(): boolean {
  return __SAMPLE_BACKEND__ && !isDesktopApp()
}

/** Tests, the latest check, whether the latest version may be released, and the releases. */
export function getAgentQuality(agentId: string): Promise<QualityOverview> {
  if (useSample()) return sampleQualityBackend.getAgentQuality(agentId)
  return callBackend('get_agent_quality', { agentId })
}

/** @throws BackendError - `invalid_input` for an empty question or one over a limit */
export function addAgentTests(agentId: string, tests: TestInput[]): Promise<AgentTest[]> {
  if (useSample()) return sampleQualityBackend.addAgentTests(agentId, tests)
  return callBackend('add_agent_tests', { agentId, tests })
}

export function updateAgentTest(agentId: string, testId: string, test: TestInput): Promise<AgentTest> {
  if (useSample()) return sampleQualityBackend.updateAgentTest(agentId, testId, test)
  return callBackend('update_agent_test', { agentId, testId, test })
}

export function deleteAgentTest(agentId: string, testId: string): Promise<void> {
  if (useSample()) return sampleQualityBackend.deleteAgentTest(agentId, testId)
  return callBackend('delete_agent_test', { agentId, testId })
}

/** Draft tests from what the agent is for (nothing is saved). @throws BackendError - `missing_credentials`, `model` */
export function suggestAgentTests(agentId: string): Promise<SuggestedTest[]> {
  if (useSample()) return sampleQualityBackend.suggestAgentTests(agentId)
  return callBackend('suggest_agent_tests', { agentId })
}

/** Starts checking the latest version; progress arrives through {@link subscribeToCheckProgress}. */
export function startAgentCheck(agentId: string): Promise<CheckView> {
  if (useSample()) return sampleQualityBackend.startAgentCheck(agentId)
  return callBackend('start_agent_check', { agentId })
}

export function getAgentCheck(agentId: string, checkId: string): Promise<CheckView> {
  if (useSample()) return sampleQualityBackend.getAgentCheck(agentId, checkId)
  return callBackend('get_agent_check', { agentId, checkId })
}

export function setAgentQualitySettings(agentId: string, settings: QualitySettings): Promise<QualitySettings> {
  if (useSample()) return sampleQualityBackend.setAgentQualitySettings(agentId, settings)
  return callBackend('set_agent_quality_settings', { agentId, settings })
}

/**
 * Releases the latest version. `overrideReason` releases it although the check does not allow it.
 *
 * @throws BackendError - `invalid_input` with the reason when it may not be released
 */
export function createAgentRelease(agentId: string, notes: string, overrideReason: string | null): Promise<Release> {
  if (useSample()) return sampleQualityBackend.createAgentRelease(agentId, notes, overrideReason)
  return callBackend('create_agent_release', { agentId, notes, overrideReason })
}

/** Puts an earlier (or later) release back in use, and the online copy with it when it can. */
export function switchAgentRelease(agentId: string, releaseNumber: number): Promise<ReleaseSwitchOutcome> {
  if (useSample()) return sampleQualityBackend.switchAgentRelease(agentId, releaseNumber)
  return callBackend('use_agent_release', { agentId, number: releaseNumber })
}

/** Progress of running checks. Returns an unsubscribe function. */
export async function subscribeToCheckProgress(onProgress: (progress: CheckProgress) => void): Promise<() => void> {
  if (useSample()) return subscribeToSampleCheckProgress(onProgress)
  return listenToBackend<CheckProgress>('agent-check-event', onProgress)
}
