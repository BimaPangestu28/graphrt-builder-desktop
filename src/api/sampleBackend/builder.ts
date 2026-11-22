import { BackendError } from '../client'
import type { Agent, BuilderMessage, BuildProgress, BuildRequest, DraftPreview, FlowStep, FlowSummary, RevisionResult } from '../types'
import { isSampleProviderConfigured, readSampleDefaultModel } from './credentials'
import { listStoredBuilderMessages, readCurrentSteps, readStoredAgent, resetSampleAgentStore, saveNewVersion, summarizeStoredAgent } from './sampleAgentStore'
import { reviseWithSampleHistory } from './sampleBuilderHistory'
import { planSampleRevision, type SampleRevisionPlan } from './sampleRevision'
import { requireText, respondWith, waitFor } from './sampleResponse'
import { createStoppedError, runStoppableSampleRevision, stopSampleRevisions, type SampleRevisionStopSignal } from './sampleRevisionStop'

/**
 * Sample agent building for the browser preview and tests. "Build agent" walks through
 * the same stages as the desktop builder with small delays and always produces the
 * sample "maps-leads" agent; chat revisions apply keyword rules and save a new version.
 * While a stage "writes" (drafting, repairing) it streams draft previews like the
 * desktop builder: the explanation word by word, then the step titles one by one.
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
  { stage: 'done', message: 'WhatsApp needs to be linked on this computer' },
]

/** What the sample model "writes" in one drafting or repairing round. */
interface SampleDraftScript {
  explanation: string
  stepTitles: string[]
  /** Tokens the round has written once it is complete. */
  totalTokens: number
}

const sampleBuiltStepTitles = ['Ask for keyword, city and offer', 'Search Google Maps', 'For each place', 'Write a short message', 'Ask me before sending', 'Send WhatsApp']

/** Draft rounds of the sample build, keyed by the stage that streams them. */
export const sampleBuildDrafts: Partial<Record<BuildProgress['stage'], SampleDraftScript>> = {
  drafting: {
    explanation:
      'This agent searches Google Maps for places that match your keyword and city, then writes a short message for each one. It asks you before sending anything on WhatsApp.',
    stepTitles: sampleBuiltStepTitles,
    totalTokens: 1184,
  },
  repairing: {
    explanation: 'Step 4 read the wrong field for the place name, so I pointed it at the name from the Maps search.',
    stepTitles: sampleBuiltStepTitles,
    totalTokens: 1236,
  },
}

/** Draft previews sent per writing stage; each one waits `stageDelay / frames`, so stages keep their length. */
const buildDraftFrameCount = 12
const revisionDraftFrameCount = 6
/** Share of a round spent on the opening text before the steps start appearing. */
const explanationShareOfRound = 0.4
const approximateTokensPerStep = 64

/**
 * The preview after `frameNumber` of `frameCount` frames: the explanation fills the first
 * part of the round word by word, the step titles appear one by one after it, and the
 * token count rises evenly. The last frame shows everything.
 */
function createDraftFrame(script: SampleDraftScript, frameNumber: number, frameCount: number): DraftPreview {
  const roundProgress = frameNumber / frameCount
  const explanationWords = script.explanation.split(' ')
  const shownWordCount = Math.min(explanationWords.length, Math.ceil((explanationWords.length * roundProgress) / explanationShareOfRound))
  const stepProgress = Math.max(0, (roundProgress - explanationShareOfRound) / (1 - explanationShareOfRound))
  return {
    explanation: explanationWords.slice(0, shownWordCount).join(' '),
    stepTitles: script.stepTitles.slice(0, Math.floor(script.stepTitles.length * stepProgress)),
    outputTokens: Math.round(script.totalTokens * roundProgress),
  }
}

/** Reports one stage: once, or (when it has a draft script) as a stream of previews over the same time. */
async function reportStage(
  progress: BuildProgress,
  draftScript: SampleDraftScript | undefined,
  timing: { delayMs: number; frameCount: number },
  onProgress: (progress: BuildProgress) => void,
): Promise<void> {
  if (!draftScript) {
    onProgress({ ...progress })
    await waitFor(timing.delayMs)
    return
  }
  for (let frameNumber = 1; frameNumber <= timing.frameCount; frameNumber += 1) {
    onProgress({ ...progress, draft: createDraftFrame(draftScript, frameNumber, timing.frameCount) })
    await waitFor(timing.delayMs / timing.frameCount)
  }
}

/** @throws BackendError - `missing_credentials` when no model is connected yet (the default's provider is not set up) */
function requireUsableModel(): void {
  const defaultModel = readSampleDefaultModel()
  if (!isSampleProviderConfigured(defaultModel.provider)) {
    throw new BackendError('missing_credentials', 'No model is connected yet: pick Claude Code, Codex, Ollama or an API key in Connections')
  }
}

async function buildSampleAgent(request: BuildRequest, onProgress: (progress: BuildProgress) => void): Promise<Agent> {
  await respondWith(() => {
    requireText(request.description, 'describe what the agent should do')
    requireUsableModel()
  })
  const timing = { delayMs: sampleBuildTiming.buildStageDelayMs, frameCount: buildDraftFrameCount }
  for (const progress of sampleBuildStages) {
    await reportStage(progress, sampleBuildDrafts[progress.stage], timing, onProgress)
  }
  return readStoredAgent(sampleBuiltAgentId)
}

function joinTitles(titles: string[]): string {
  return titles.map((title) => `“${title}”`).join(' and ')
}

/**
 * The sample model's opening words about a revision ("I added … I updated …").
 *
 * @returns One or two plain sentences (string)
 */
export function describeSampleRevision(plan: SampleRevisionPlan, previousSteps: FlowStep[]): string {
  const previousStepIds = new Set(previousSteps.map((flowStep) => flowStep.id))
  const changedSteps = plan.steps.filter((flowStep) => plan.changedStepIds.includes(flowStep.id))
  const addedTitles = changedSteps.filter((flowStep) => !previousStepIds.has(flowStep.id)).map((flowStep) => flowStep.title)
  const updatedTitles = changedSteps.filter((flowStep) => previousStepIds.has(flowStep.id)).map((flowStep) => flowStep.title)
  const sentences: string[] = []
  if (addedTitles.length > 0) sentences.push(`I added ${joinTitles(addedTitles)} so the agent only goes on with the places you want.`)
  if (updatedTitles.length > 0) sentences.push(`I updated ${joinTitles(updatedTitles)} to do what you asked.`)
  return sentences.join(' ')
}

function createRevisionDraftScript(plan: SampleRevisionPlan, explanation: string): SampleDraftScript {
  const explanationTokens = Math.round(explanation.split(' ').length * 1.3)
  return { explanation, stepTitles: plan.steps.map((flowStep) => flowStep.title), totalTokens: explanationTokens + plan.steps.length * approximateTokensPerStep }
}

async function reviseSampleAgent(agentId: string, instruction: string, onProgress: (progress: BuildProgress) => void, stopSignal: SampleRevisionStopSignal): Promise<RevisionResult> {
  const trimmedInstruction = await respondWith(() => {
    readStoredAgent(agentId)
    requireUsableModel()
    return requireText(instruction, 'describe the change')
  })
  const previousSteps = readCurrentSteps(agentId)
  const plan = planSampleRevision(previousSteps, trimmedInstruction)
  const explanation = describeSampleRevision(plan, previousSteps)
  const timing = { delayMs: sampleBuildTiming.revisionStageDelayMs, frameCount: revisionDraftFrameCount }
  await reportStage({ stage: 'understanding', message: 'Reading your change' }, undefined, timing, onProgress)
  await reportStage({ stage: 'drafting', message: 'Updating the steps' }, createRevisionDraftScript(plan, explanation), timing, onProgress)
  await reportStage({ stage: 'checking', message: 'Checking the steps again' }, undefined, timing, onProgress)
  // A stopped revision has already ended for the caller; it must not save anything either.
  if (stopSignal.isStopped()) throw createStoppedError()
  const agent = saveNewVersion(agentId, plan.steps, trimmedInstruction)
  onProgress({ stage: 'done', message: plan.summary })
  return { agent, summary: plan.summary, changedStepIds: plan.changedStepIds, explanation }
}

export const sampleBuilderBackend = {
  buildAgent: buildSampleAgent,
  reviseAgent: (agentId: string, instruction: string, onProgress: (progress: BuildProgress) => void): Promise<RevisionResult> =>
    reviseWithSampleHistory(agentId, instruction, () => runStoppableSampleRevision(agentId, (stopSignal) => reviseSampleAgent(agentId, instruction, onProgress, stopSignal))),
  stopAgentRevision: (agentId: string): Promise<boolean> => respondWith(() => stopSampleRevisions(agentId)),
  getFlowSummary: (agentId: string): Promise<FlowSummary> => respondWith(() => summarizeStoredAgent(agentId)),
  listBuilderMessages: (agentId: string): Promise<BuilderMessage[]> => respondWith(() => listStoredBuilderMessages(agentId)),
}

/** Restores the build timing and the sample agents the builder edits (use in test `beforeEach`). */
export function resetSampleBuilder(): void {
  sampleBuildTiming.buildStageDelayMs = 900
  sampleBuildTiming.revisionStageDelayMs = 250
  resetSampleAgentStore()
}
