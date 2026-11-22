import { teamMembers } from '@/api/sampleBackend/fixtures/team'
import { BackendError } from '../client'
import type { AgentStepInfo, Chain, ChainDraft, ChainStatus, TeamMember, TeamOverview } from '../chainTypes'
import type { BuildProgress, FlowStep, RevisionResult, Run } from '../types'
import { readCurrentSteps, readStoredAgent, saveNewVersion } from './sampleAgentStore'
import { requireText, respondWith } from './sampleResponse'
import { buildSampleAgentSteps, buildSampleChain, buildSampleMemberRun, sampleTeamAgentId } from './sampleChainSeeds'

/**
 * Sample chains, agents-as-steps catalog and team for the browser preview and tests,
 * kept in module memory and seeded from the mock data of screens 11 to 13.
 * Call {@link resetSampleChains} in tests to start from the seed again.
 */

let storedChains: Chain[] = []
let agentSteps: AgentStepInfo[] = []
let teamMemberIds: string[] = []
let createdChainCount = 0
let startedRunCount = 0

/** Puts the sample chains, catalog and team back to the seed. */
export function resetSampleChains(): void {
  storedChains = [buildSampleChain()]
  agentSteps = buildSampleAgentSteps()
  teamMemberIds = teamMembers.map((member) => member.id)
  createdChainCount = 0
  startedRunCount = 0
}

resetSampleChains()

/** Deep copy of plain JSON data, so callers never share state with the store. */
function copyJson<Data>(data: Data): Data {
  return JSON.parse(JSON.stringify(data)) as Data
}

function copyChain(chain: Chain): Chain {
  return copyJson(chain)
}

/** @throws BackendError - `not_found` */
function findChainIndex(chainId: string): number {
  const chainIndex = storedChains.findIndex((chain) => chain.id === chainId)
  if (chainIndex < 0) throw new BackendError('not_found', `No chain ${chainId}`)
  return chainIndex
}

/** @throws BackendError - `not_found` */
function findAgentStep(agentId: string): AgentStepInfo {
  const agentStepInfo = agentSteps.find((candidate) => candidate.agentId === agentId)
  if (!agentStepInfo) throw new BackendError('not_found', `No agent with id ${agentId}`)
  return agentStepInfo
}

/** Same checks as the backend's chain validation. @throws BackendError - `invalid_input` / `not_found` */
function validateDraft(draft: ChainDraft): ChainDraft {
  const name = requireText(draft.name, 'give the chain a name')
  draft.steps.forEach((step, position) => {
    findAgentStep(step.agentId)
    if (position > 0 && draft.steps[position - 1].agentId === step.agentId) {
      throw new BackendError('invalid_input', `step ${position + 1} would start the same agent again`)
    }
    if (position === 0 && step.inputs.some((mapping) => mapping.source.kind === 'output')) {
      throw new BackendError('invalid_input', 'the first agent has no previous agent to read outputs from')
    }
  })
  return { name, steps: copyJson(draft.steps) }
}

function replaceChain(chainIndex: number, chain: Chain): Chain {
  storedChains = storedChains.map((storedChain, index) => (index === chainIndex ? chain : storedChain))
  return copyChain(chain)
}

function buildStartedRun(agentId: string): Run {
  startedRunCount += 1
  return {
    id: `sample-chain-run-${startedRunCount}`,
    agentId,
    agentVersion: 1,
    trigger: 'test',
    status: 'running',
    startedAt: new Date().toISOString(),
    finishedAt: null,
    outputs: null,
    errorMessage: null,
    pauseReasons: null,
  }
}

/** Where the sample puts an inserted step: after the step named in "after <title>", inside it if it is a loop. */
function insertAgentStep(steps: FlowStep[], addedStep: FlowStep, placement: string | null): FlowStep[] {
  const anchorIndex = placement ? steps.findIndex((flowStep) => placement.includes(flowStep.title)) : -1
  if (anchorIndex < 0) return [...steps, addedStep]
  const anchorStep = steps[anchorIndex]
  const depth = anchorStep.nodeType === 'iteration' ? anchorStep.depth + 1 : anchorStep.depth
  return [...steps.slice(0, anchorIndex + 1), { ...addedStep, depth }, ...steps.slice(anchorIndex + 1)]
}

const sampleRevisionProgress: BuildProgress[] = [
  { stage: 'understanding', message: 'Reading your change' },
  { stage: 'checking', message: 'Checking the steps again' },
]

function addSampleAgentStep(request: { targetAgentId: string; stepAgentId: string; placement: string | null }, onProgress: (progress: BuildProgress) => void): RevisionResult {
  if (request.targetAgentId === request.stepAgentId) throw new BackendError('invalid_input', 'an agent cannot use itself as a step')
  const stepAgent = findAgentStep(request.stepAgentId)
  if (!stepAgent.usableAsStep) throw new BackendError('invalid_input', `${stepAgent.name} stops to ask you, and ${stepAgent.unusableReason ?? 'cannot run as a step'}`)
  sampleRevisionProgress.forEach((progress) => onProgress({ ...progress }))
  const addedStep: FlowStep = {
    id: `run_${stepAgent.agentId.replace(/-/g, '_')}`,
    nodeType: 'tool',
    title: `Run ${stepAgent.name}`,
    detail: `agents/${stepAgent.agentId}`,
    needsApproval: false,
    depth: 0,
  }
  const steps = insertAgentStep(readCurrentSteps(request.targetAgentId), addedStep, request.placement)
  const agent = saveNewVersion(request.targetAgentId, steps, `Added ${addedStep.title}`)
  return { agent, summary: `Added ${addedStep.title}`, changedStepIds: [addedStep.id], explanation: '' }
}

function toTeamMember(agentStepInfo: AgentStepInfo): TeamMember {
  const sampleMember = teamMembers.find((member) => member.id === agentStepInfo.agentId)
  return {
    agentId: agentStepInfo.agentId,
    name: agentStepInfo.name,
    description: agentStepInfo.description,
    status: agentStepInfo.status,
    currentVersion: agentStepInfo.currentVersion,
    latestRun: sampleMember ? buildSampleMemberRun(sampleMember) : null,
  }
}

function readSampleTeam(agentId: string): TeamOverview {
  const teamAgent = readStoredAgent(agentId)
  const memberIds = agentId === sampleTeamAgentId ? teamMemberIds : []
  return {
    agentId: teamAgent.id,
    name: teamAgent.name,
    description: teamAgent.description,
    status: teamAgent.status,
    coordinatorStepId: 'coordinator',
    members: memberIds.map((memberId) => toTeamMember(findAgentStep(memberId))),
  }
}

function addSampleTeamMember(teamAgentId: string, memberAgentId: string, onProgress: (progress: BuildProgress) => void): RevisionResult {
  const member = findAgentStep(memberAgentId)
  if (teamMemberIds.includes(memberAgentId)) throw new BackendError('invalid_input', `${member.name} is already in the team`)
  const teamAgent = readStoredAgent(teamAgentId)
  sampleRevisionProgress.forEach((progress) => onProgress({ ...progress }))
  if (teamAgentId === sampleTeamAgentId) teamMemberIds = [...teamMemberIds, memberAgentId]
  return { agent: teamAgent, summary: `Added ${member.name} to the team`, changedStepIds: ['coordinator'], explanation: '' }
}

export const sampleChainsBackend = {
  listChains: (): Promise<Chain[]> => respondWith(() => storedChains.map(copyChain)),

  getChain: (chainId: string): Promise<Chain> => respondWith(() => copyChain(storedChains[findChainIndex(chainId)])),

  createChain: (draft: ChainDraft): Promise<Chain> =>
    respondWith(() => {
      const validDraft = validateDraft(draft)
      createdChainCount += 1
      const now = new Date().toISOString()
      const chain: Chain = { id: `chain-${createdChainCount}`, ...validDraft, status: 'paused', createdAt: now, updatedAt: now }
      storedChains = [...storedChains, chain]
      return copyChain(chain)
    }),

  updateChain: (chainId: string, draft: ChainDraft): Promise<Chain> =>
    respondWith(() => {
      const chainIndex = findChainIndex(chainId)
      const validDraft = validateDraft(draft)
      return replaceChain(chainIndex, { ...storedChains[chainIndex], ...validDraft, updatedAt: new Date().toISOString() })
    }),

  deleteChain: (chainId: string): Promise<void> =>
    respondWith(() => {
      findChainIndex(chainId)
      storedChains = storedChains.filter((chain) => chain.id !== chainId)
    }),

  setChainStatus: (chainId: string, status: ChainStatus): Promise<Chain> =>
    respondWith(() => {
      const chainIndex = findChainIndex(chainId)
      return replaceChain(chainIndex, { ...storedChains[chainIndex], status, updatedAt: new Date().toISOString() })
    }),

  testChain: (chainId: string): Promise<Run> =>
    respondWith(() => {
      const chain = storedChains[findChainIndex(chainId)]
      if (chain.steps.length === 0) throw new BackendError('invalid_input', 'add an agent to the chain before testing it')
      return buildStartedRun(chain.steps[0].agentId)
    }),

  listAgentSteps: (): Promise<AgentStepInfo[]> => respondWith(() => copyJson(agentSteps)),

  getTeam: (agentId: string): Promise<TeamOverview> => respondWith(() => readSampleTeam(agentId)),

  addAgentStep: (request: { targetAgentId: string; stepAgentId: string; placement: string | null }, onProgress: (progress: BuildProgress) => void): Promise<RevisionResult> =>
    respondWith(() => addSampleAgentStep(request, onProgress)),

  addTeamMember: (teamAgentId: string, memberAgentId: string, onProgress: (progress: BuildProgress) => void): Promise<RevisionResult> =>
    respondWith(() => addSampleTeamMember(teamAgentId, memberAgentId, onProgress)),
}
