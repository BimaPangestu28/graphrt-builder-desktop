import { BackendError } from '../client'
import type { Agent, AgentStatus, AgentVersion, FlowInput, FlowStep, FlowSummary } from '../types'
import { sampleAgentSeeds, type SampleAgentSeed, type SampleVersionSeed } from './sampleAgentCatalog'
import { renderSampleFlowYaml } from './sampleFlowYaml'

/**
 * In-memory agents shared by the sample agents and builder backends. Module state
 * survives for the page (browser preview) or the test file; call
 * {@link resetSampleAgentStore} to go back to the seed data.
 */

interface StoredAgent {
  id: string
  name: string
  kind: Agent['kind']
  description: string
  status: AgentStatus
  inputs: FlowInput[]
  createdAt: string
  updatedAt: string
  /** Oldest first; the last one is current. */
  versions: SampleVersionSeed[]
}

let storedAgents: StoredAgent[] = []

function copySteps(steps: FlowStep[]): FlowStep[] {
  return steps.map((flowStep) => ({ ...flowStep }))
}

function toStoredAgent(seed: SampleAgentSeed): StoredAgent {
  const versions = seed.versions.map((version) => ({ ...version, steps: copySteps(version.steps) }))
  return {
    id: seed.id,
    name: seed.name,
    kind: seed.kind,
    description: seed.description,
    status: seed.status,
    inputs: seed.inputs.map((input) => ({ ...input })),
    createdAt: seed.createdAt,
    updatedAt: versions[versions.length - 1].createdAt,
    versions,
  }
}

/** Restores every sample agent to its seed data. */
export function resetSampleAgentStore(): void {
  storedAgents = sampleAgentSeeds.map(toStoredAgent)
}

resetSampleAgentStore()

function currentVersionOf(storedAgent: StoredAgent): SampleVersionSeed {
  return storedAgent.versions[storedAgent.versions.length - 1]
}

function renderVersionYaml(storedAgent: StoredAgent, version: SampleVersionSeed): string {
  return renderSampleFlowYaml(storedAgent.name, version.steps, storedAgent.inputs)
}

function toAgent(storedAgent: StoredAgent): Agent {
  const currentVersion = currentVersionOf(storedAgent)
  return {
    id: storedAgent.id,
    name: storedAgent.name,
    kind: storedAgent.kind,
    description: storedAgent.description,
    flowYaml: renderVersionYaml(storedAgent, currentVersion),
    status: storedAgent.status,
    currentVersion: currentVersion.version,
    createdAt: storedAgent.createdAt,
    updatedAt: storedAgent.updatedAt,
  }
}

/**
 * Finds a stored agent.
 *
 * @throws BackendError - `not_found` when no agent has this id
 */
function findStoredAgent(agentId: string): StoredAgent {
  const storedAgent = storedAgents.find((candidate) => candidate.id === agentId)
  if (!storedAgent) throw new BackendError('not_found', `No agent with id ${agentId}`)
  return storedAgent
}

/** All agents, most recently updated first. */
export function listStoredAgents(): Agent[] {
  return [...storedAgents].sort((first, second) => second.updatedAt.localeCompare(first.updatedAt)).map(toAgent)
}

/** @throws BackendError - `not_found` */
export function readStoredAgent(agentId: string): Agent {
  return toAgent(findStoredAgent(agentId))
}

/** @throws BackendError - `not_found` */
export function updateStoredAgent(agentId: string, changes: { name?: string; status?: AgentStatus }): Agent {
  const storedAgent = findStoredAgent(agentId)
  if (changes.name !== undefined) storedAgent.name = changes.name
  if (changes.status !== undefined) storedAgent.status = changes.status
  storedAgent.updatedAt = new Date().toISOString()
  return toAgent(storedAgent)
}

/** @throws BackendError - `not_found` */
export function removeStoredAgent(agentId: string): void {
  findStoredAgent(agentId)
  storedAgents = storedAgents.filter((storedAgent) => storedAgent.id !== agentId)
}

/** Versions of one agent, newest first. @throws BackendError - `not_found` */
export function listStoredVersions(agentId: string): AgentVersion[] {
  const storedAgent = findStoredAgent(agentId)
  return [...storedAgent.versions].reverse().map((version) => ({
    agentId,
    version: version.version,
    flowYaml: renderVersionYaml(storedAgent, version),
    changeSummary: version.changeSummary,
    createdAt: version.createdAt,
  }))
}

/** Steps of the agent's current version (copies). @throws BackendError - `not_found` */
export function readCurrentSteps(agentId: string): FlowStep[] {
  return copySteps(currentVersionOf(findStoredAgent(agentId)).steps)
}

/**
 * Saves `steps` as the next version and makes it current; history is never rewritten.
 *
 * @throws BackendError - `not_found`
 */
export function saveNewVersion(agentId: string, steps: FlowStep[], changeSummary: string): Agent {
  const storedAgent = findStoredAgent(agentId)
  const createdAt = new Date().toISOString()
  storedAgent.versions.push({ version: currentVersionOf(storedAgent).version + 1, changeSummary, createdAt, steps: copySteps(steps) })
  storedAgent.updatedAt = createdAt
  return toAgent(storedAgent)
}

/**
 * Copies an old version's steps into a new version on top.
 *
 * @throws BackendError - `not_found` when the agent or version does not exist
 */
export function restoreStoredVersion(agentId: string, versionNumber: number): Agent {
  const storedAgent = findStoredAgent(agentId)
  const restoredVersion = storedAgent.versions.find((version) => version.version === versionNumber)
  if (!restoredVersion) throw new BackendError('not_found', `Agent ${agentId} has no version ${versionNumber}`)
  // Like the desktop backend: restoring the current steps again adds no version.
  if (renderVersionYaml(storedAgent, restoredVersion) === renderVersionYaml(storedAgent, currentVersionOf(storedAgent))) return toAgent(storedAgent)
  return saveNewVersion(agentId, restoredVersion.steps, `Restored v${versionNumber}`)
}

function summarizeVersion(storedAgent: StoredAgent, version: SampleVersionSeed): FlowSummary {
  const steps = copySteps(version.steps)
  const usesModel = steps.some((flowStep) => flowStep.nodeType === 'llm')
  return { steps, inputs: storedAgent.inputs.map((input) => ({ ...input })), modelProviders: usesModel ? ['openai'] : [], env: [] }
}

/** Steps, inputs and model providers of the current version. @throws BackendError - `not_found` */
export function summarizeStoredAgent(agentId: string): FlowSummary {
  const storedAgent = findStoredAgent(agentId)
  return summarizeVersion(storedAgent, currentVersionOf(storedAgent))
}

/**
 * Steps, inputs and model providers of one saved version.
 *
 * @throws BackendError - `not_found` when the agent or version does not exist
 */
export function summarizeStoredVersion(agentId: string, versionNumber: number): FlowSummary {
  const storedAgent = findStoredAgent(agentId)
  const version = storedAgent.versions.find((candidate) => candidate.version === versionNumber)
  if (!version) throw new BackendError('not_found', `Agent ${agentId} has no version ${versionNumber}`)
  return summarizeVersion(storedAgent, version)
}
