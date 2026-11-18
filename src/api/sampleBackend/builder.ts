import { BackendError } from '../client'
import type { Agent, BuildProgress, BuildRequest, FlowSummary, RevisionResult } from '../types'
import { isSampleProviderConfigured, readSampleDefaultModel } from './credentials'
import { readCurrentSteps, readStoredAgent, resetSampleAgentStore, saveNewVersion, summarizeStoredAgent } from './sampleAgentStore'
import { planSampleRevision } from './sampleRevision'
import { requireText, respondWith, waitFor } from './sampleResponse'

/**
 * Sample agent building for the browser preview and tests. "Build agent" walks through
 * the same stages as the desktop builder with small delays and always produces the
 * sample "maps-leads" agent; chat revisions apply keyword rules and save a new version.
 */

/** The agent every sample build resolves to. */
export const sampleBuiltAgentId = 'maps-leads'

/** Pause between progress stages. Tests advance fake timers by these amounts. */
export const sampleBuildTiming = {
  buildStageDelayMs: 900,
  revisionStageDelayMs: 250,
}

/** Stages of a sample build, in the order the desktop builder reports them (one repair round). */
export const sampleBuildStages: BuildProgress[] = [
  { stage: 'understanding', message: 'Search places, write a message per place, send on WhatsApp' },
  { stage: 'drafting', message: 'Picked 6 steps. Added an approval step because it sends messages to other people' },
  { stage: 'repairing', message: 'Step 4 read the wrong field for the place name' },
  { stage: 'checking', message: 'No problems found' },
  { stage: 'done', message: 'WhatsApp needs to be linked on this Mac' },
]

const sampleRevisionStages: BuildProgress[] = [
  { stage: 'understanding', message: 'Reading your change' },
  { stage: 'drafting', message: 'Updating the steps' },
  { stage: 'checking', message: 'Checking the steps again' },
]

/** @throws BackendError - `missing_credentials` when the default model's provider has no key */
function requireUsableModel(): void {
  const defaultModel = readSampleDefaultModel()
  if (!isSampleProviderConfigured(defaultModel.provider)) {
    throw new BackendError('missing_credentials', `Add a ${defaultModel.provider} API key in Connections first`)
  }
}

async function reportStages(stages: BuildProgress[], delayMs: number, onProgress: (progress: BuildProgress) => void): Promise<void> {
  for (const progress of stages) {
    onProgress({ ...progress })
    await waitFor(delayMs)
  }
}

async function buildSampleAgent(request: BuildRequest, onProgress: (progress: BuildProgress) => void): Promise<Agent> {
  await respondWith(() => {
    requireText(request.description, 'describe what the agent should do')
    requireUsableModel()
  })
  await reportStages(sampleBuildStages, sampleBuildTiming.buildStageDelayMs, onProgress)
  return readStoredAgent(sampleBuiltAgentId)
}

async function reviseSampleAgent(agentId: string, instruction: string, onProgress: (progress: BuildProgress) => void): Promise<RevisionResult> {
  const trimmedInstruction = await respondWith(() => {
    readStoredAgent(agentId)
    requireUsableModel()
    return requireText(instruction, 'describe the change')
  })
  await reportStages(sampleRevisionStages, sampleBuildTiming.revisionStageDelayMs, onProgress)
  const plan = planSampleRevision(readCurrentSteps(agentId), trimmedInstruction)
  const agent = saveNewVersion(agentId, plan.steps, trimmedInstruction)
  onProgress({ stage: 'done', message: plan.summary })
  return { agent, summary: plan.summary, changedStepIds: plan.changedStepIds }
}

export const sampleBuilderBackend = {
  buildAgent: buildSampleAgent,
  reviseAgent: reviseSampleAgent,
  getFlowSummary: (agentId: string): Promise<FlowSummary> => respondWith(() => summarizeStoredAgent(agentId)),
}

/** Restores the build timing and the sample agents the builder edits (use in test `beforeEach`). */
export function resetSampleBuilder(): void {
  sampleBuildTiming.buildStageDelayMs = 900
  sampleBuildTiming.revisionStageDelayMs = 250
  resetSampleAgentStore()
}
