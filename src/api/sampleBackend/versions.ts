import type { FlowStep, FlowSummary } from '../types'
import type { StepChange, VersionComparison } from '../versionTypes'
import { summarizeStoredVersion } from './sampleAgentStore'
import { respondWith } from './sampleResponse'

/**
 * Sample version comparisons for the browser preview and tests, built on the sample
 * agent store. Matches steps the way `src-tauri/src/agent_builder/diff.rs` does: by
 * id, changed when the type, title or detail differ.
 */

function stepDiffers(before: FlowStep, after: FlowStep): boolean {
  return before.nodeType !== after.nodeType || before.title !== after.title || before.detail !== after.detail
}

function describeStepChange(before: FlowStep | null, after: FlowStep | null, toSteps: FlowStep[]): StepChange {
  const position = after ? toSteps.findIndex((step) => step.id === after.id) + 1 : null
  const stepId = (after ?? before)?.id ?? ''
  if (!before) return { stepId, kind: 'added', before: null, after, position }
  if (!after) return { stepId, kind: 'removed', before, after: null, position: null }
  return { stepId, kind: stepDiffers(before, after) ? 'changed' : 'unchanged', before, after, position }
}

/**
 * Rows follow `fromSteps`; steps only in `toSteps` come right after the step that
 * precedes them there (or first).
 */
function listStepChanges(fromSteps: FlowStep[], toSteps: FlowStep[]): StepChange[] {
  const fromIds = new Set(fromSteps.map((step) => step.id))
  const changes: StepChange[] = []
  const appendAddedStepsAfter = (toIndex: number) => {
    for (const nextStep of toSteps.slice(toIndex + 1)) {
      if (fromIds.has(nextStep.id)) return
      changes.push(describeStepChange(null, nextStep, toSteps))
    }
  }
  appendAddedStepsAfter(-1)
  for (const fromStep of fromSteps) {
    const toIndex = toSteps.findIndex((step) => step.id === fromStep.id)
    changes.push(describeStepChange(fromStep, toSteps[toIndex] ?? null, toSteps))
    if (toIndex >= 0) appendAddedStepsAfter(toIndex)
  }
  return changes
}

function compareStoredVersions(agentId: string, fromVersion: number, toVersion: number): VersionComparison {
  const fromSteps = summarizeStoredVersion(agentId, fromVersion).steps
  const toSteps = summarizeStoredVersion(agentId, toVersion).steps
  return {
    agentId,
    from: { version: fromVersion, steps: fromSteps, error: null },
    to: { version: toVersion, steps: toSteps, error: null },
    changes: listStepChanges(fromSteps, toSteps),
  }
}

export const sampleVersionsBackend = {
  compareAgentVersions: (agentId: string, fromVersion: number, toVersion: number): Promise<VersionComparison> =>
    respondWith(() => compareStoredVersions(agentId, fromVersion, toVersion)),
  getVersionFlowSummary: (agentId: string, version: number): Promise<FlowSummary> => respondWith(() => summarizeStoredVersion(agentId, version)),
}
