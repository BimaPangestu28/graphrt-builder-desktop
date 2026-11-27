import { chainAgents, chainName, initialChainLinks, type ChainLink } from '@/api/sampleBackend/fixtures/chain'
import { stepCatalogItems, type StepCatalogItem } from '@/api/sampleBackend/fixtures/stepCatalog'
import { teamMembers, type TeamMember as TeamMemberSample, type TeamMemberState } from '@/api/sampleBackend/fixtures/team'
import type { AgentInput, AgentStepInfo, Chain, ChainInputMapping, ChainStep } from '../chainTypes'
import type { Run, RunStatus } from '../types'
import { sampleTimestamp } from './sampleAgentCatalog'

/**
 * Seed data of the sample chains backend, converted from the mock data of screens
 * 11 (`data/chain.ts`), 12 (`data/agentAsStep.ts`) and 13 (`data/team.ts`).
 */

export const sampleChainId = 'leads-recap'
export const sampleTeamAgentId = 'sales-team'

function textInput(name: string): AgentInput {
  return { name, label: name.replace(/_/g, ' '), required: true, valueType: 'string', options: [] }
}

function agentStep(fields: Pick<AgentStepInfo, 'agentId' | 'name' | 'description' | 'outputs' | 'stepCount'> & Partial<AgentStepInfo>): AgentStepInfo {
  return {
    kind: 'task',
    status: 'active',
    currentVersion: 1,
    inputs: [],
    usableAsStep: true,
    unusableReason: null,
    usedByCount: 0,
    ...fields,
  }
}

/** Inputs of each chain agent, read from the links that feed it. */
function chainAgentInputs(agentIndex: number): AgentInput[] {
  const incomingLink = initialChainLinks.find((link) => link.fromIndex === agentIndex - 1)
  return incomingLink ? incomingLink.inputs.map((input) => textInput(input.name)) : [textInput('keyword'), textInput('city'), textInput('offer')]
}

function chainAgentSteps(): AgentStepInfo[] {
  return chainAgents.map((chainAgent, agentIndex) =>
    agentStep({
      agentId: chainAgent.id,
      name: chainAgent.name,
      description: chainAgent.description ?? '',
      outputs: chainAgent.outputs,
      stepCount: chainAgent.stepCount,
      inputs: chainAgentInputs(agentIndex),
      // The first agent asks before sending, like the real "Maps leads to WhatsApp".
      ...(agentIndex === 0 ? { usableAsStep: false, unusableReason: 'agents used as steps cannot ask for approval yet' } : {}),
    }),
  )
}

function readUsageCount(item: StepCatalogItem): number {
  const usageMatch = item.usageNote?.match(/\d+/)
  return usageMatch ? Number(usageMatch[0]) : 0
}

function catalogAgentSteps(): AgentStepInfo[] {
  return stepCatalogItems
    .filter((item) => item.category === 'myAgents')
    .map((item) =>
      agentStep({
        agentId: item.id,
        name: item.name,
        description: item.description,
        outputs: item.getsBack,
        stepCount: 3,
        inputs: item.sends.map(textInput),
        currentVersion: item.version ?? 1,
        usedByCount: readUsageCount(item),
      }),
    )
}

/** Team members are agents too; their progress line is their description. */
function teamAgentSteps(): AgentStepInfo[] {
  return teamMembers.map((member) =>
    agentStep({ agentId: member.id, name: member.name, description: member.progress, outputs: [], stepCount: 3, inputs: [textInput('task')] }),
  )
}

/** Every sample agent usable in chains, as steps and as team members. */
export function buildSampleAgentSteps(): AgentStepInfo[] {
  const agentSteps = [...chainAgentSteps(), ...catalogAgentSteps(), ...teamAgentSteps()]
  return agentSteps.filter((agentStepInfo, index) => agentSteps.findIndex((candidate) => candidate.agentId === agentStepInfo.agentId) === index)
}

function toChainStep(link: ChainLink): ChainStep {
  const inputs: ChainInputMapping[] = link.inputs.map((input) =>
    input.kind === 'output'
      ? { input: input.name, source: { kind: 'output', outputKey: input.selectedField } }
      : { input: input.name, source: { kind: 'constant', value: input.value } },
  )
  return {
    agentId: chainAgents[link.fromIndex + 1].id,
    inputs,
    runCondition: link.runCondition === 'Always' ? 'always' : 'on_success',
    onFailure: link.failurePolicy.startsWith('Skip') ? 'continue' : 'stop',
  }
}

/** The "Leads to sales recap" chain of screen 11, paused like a draft. */
export function buildSampleChain(): Chain {
  const firstStep: ChainStep = {
    agentId: chainAgents[0].id,
    inputs: [
      { input: 'keyword', source: { kind: 'constant', value: 'cafe' } },
      { input: 'city', source: { kind: 'constant', value: 'Bandar Lampung' } },
    ],
    runCondition: 'on_success',
    onFailure: 'stop',
  }
  const createdAt = sampleTimestamp(4, 11, 15)
  return { id: sampleChainId, name: chainName, status: 'paused', steps: [firstStep, ...initialChainLinks.map(toChainStep)], createdAt, updatedAt: createdAt }
}

const runStatusByMemberState: Record<TeamMemberState, RunStatus | null> = {
  done: 'succeeded',
  working: 'running',
  needsYou: 'paused',
  waiting: null,
}

/** A plausible latest run for a team member in the given state. */
export function buildSampleMemberRun(member: TeamMemberSample): Run | null {
  const status = runStatusByMemberState[member.state]
  if (!status) return null
  const isFinished = status === 'succeeded'
  return {
    id: `sample-run-${member.id}`,
    agentId: member.id,
    agentVersion: 1,
    trigger: 'manual',
    status,
    startedAt: sampleTimestamp(0, 12, 30),
    finishedAt: isFinished ? sampleTimestamp(0, 12, 31) : null,
    outputs: isFinished ? {} : null,
    errorMessage: null,
    errorType: null,
    pauseReasons: null,
  }
}
