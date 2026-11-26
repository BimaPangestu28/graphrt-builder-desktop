import type { PluginRequirement } from '@/api/pluginRequirementTypes'
import type { Agent, ModelChoice, ProviderStatus, Run, Trigger } from '@/api/types'
import { isModelConnected } from '@/lib/firstLaunch'
import { agentPath, connectionsTabPath, routePaths } from '@/routes'
import { messages } from '@/i18n'

/** The Home "Getting started" checklist (09), each step derived from real data. */

export interface GettingStartedStep {
  id: 'model' | 'agent' | 'plugins' | 'test' | 'schedule'
  label: string
  isDone: boolean
  /** Where the step is done. */
  path: string
}

export interface GettingStartedSources {
  providerStatuses: ProviderStatus[]
  /**
   * The model new agents use. Ollama is always "configured", so it only counts as a
   * connected model when it is the default; a key or a turned-on local CLI always counts.
   */
  defaultModel?: ModelChoice | null
  agents: Agent[]
  runs: Run[]
  triggers: Trigger[]
  /** Agent id → its plugin requirements. */
  pluginRequirements: Map<string, PluginRequirement[]>
  /** Agents with a setup problem (missing key, secret or plugin) from `listProblems`. */
  agentIdsNeedingSetup: Set<string>
}

/** Key in localStorage for "Hide" on the checklist; per viewer, a UI convenience only. */
export const gettingStartedDismissedKey = 'graphrt.home.gettingStartedDismissed'

function isAgentSetUp(agentId: string, sources: GettingStartedSources): boolean {
  if (sources.agentIdsNeedingSetup.has(agentId)) return false
  return (sources.pluginRequirements.get(agentId) ?? []).every((requirement) => requirement.ready)
}

function hasPassedTest(agent: Agent, runs: Run[]): boolean {
  return agent.status === 'tested' || agent.status === 'active' || runs.some((run) => run.agentId === agent.id && run.status === 'succeeded')
}

/**
 * The five steps from a fresh install to a scheduled agent.
 *
 * @param sources - Backend data (GettingStartedSources)
 * @returns The steps in order (GettingStartedStep[])
 *
 * @example
 * deriveGettingStartedSteps(sources).filter((step) => !step.isDone)[0] // the next thing to do
 */
export function deriveGettingStartedSteps(sources: GettingStartedSources): GettingStartedStep[] {
  const { providerStatuses, agents, runs, triggers } = sources
  const firstAgent = agents[0]
  const agentNeedingSetup = agents.find((agent) => !isAgentSetUp(agent.id, sources))
  const untestedAgent = agents.find((agent) => !hasPassedTest(agent, runs)) ?? firstAgent
  const testedAgent = agents.find((agent) => hasPassedTest(agent, runs)) ?? firstAgent
  const t = messages().home.steps
  return [
    { id: 'model', label: t.model, isDone: isModelConnected(providerStatuses, sources.defaultModel ?? null), path: connectionsTabPath('models') },
    { id: 'agent', label: t.agent, isDone: agents.length > 0, path: routePaths.newAgent },
    {
      id: 'plugins',
      label: t.plugins,
      isDone: agents.length > 0 && !agentNeedingSetup,
      path: agentNeedingSetup || firstAgent ? agentPath('builder', (agentNeedingSetup ?? firstAgent).id) : routePaths.newAgent,
    },
    {
      id: 'test',
      label: t.test,
      isDone: agents.some((agent) => hasPassedTest(agent, runs)),
      path: untestedAgent ? agentPath('testRun', untestedAgent.id) : routePaths.newAgent,
    },
    {
      id: 'schedule',
      label: t.schedule,
      isDone: triggers.some((trigger) => trigger.enabled) || agents.some((agent) => agent.kind === 'chatbot' && agent.status === 'active'),
      path: testedAgent ? agentPath('scheduleAgent', testedAgent.id) : routePaths.scheduler,
    },
  ]
}

/** True once every step is done, so the checklist goes away. */
export function isGettingStartedComplete(steps: GettingStartedStep[]): boolean {
  return steps.every((step) => step.isDone)
}
