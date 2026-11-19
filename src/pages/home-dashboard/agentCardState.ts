import type { Agent, Run, Trigger } from '@/api/types'
import { formatClockTime } from '@/pages/agent-run/runResultSummary'
import type { StatusPillTone } from '@/pages/agent-run/StatusPill'
import { agentPath, routePaths } from '@/routes'
import { failedRunPath } from './homeLinks'

/**
 * Where an agent stands on its Home card (09) and the one next step that moves it forward:
 * Draft → test it, test failed → see what went wrong, tested → schedule it, active → run it.
 */

export type AgentCardStage = 'draft' | 'test_failed' | 'tested' | 'active' | 'failing' | 'paused'

/** The card's main button: a link, or "Run now" which starts a run from Home. */
export type AgentCardAction = { kind: 'link'; label: string; path: string } | { kind: 'run_now'; label: string }

export interface AgentCardLink {
  label: string
  path: string
}

export interface AgentCardState {
  stage: AgentCardStage
  chipLabel: string
  chipTone: StatusPillTone
  primaryAction: AgentCardAction
  secondaryLinks: AgentCardLink[]
}

const millisecondsPerDay = 24 * 60 * 60 * 1000

function isSameLocalDay(first: Date, second: Date): boolean {
  return first.toDateString() === second.toDateString()
}

/**
 * Short time of an upcoming run: "today 09:00", "tomorrow 09:00", "Mon 09:00" within a week,
 * else "3 Dec 09:00".
 */
export function formatNextRunTime(isoTimestamp: string, now: Date = new Date()): string {
  const instant = new Date(isoTimestamp)
  const clockTime = formatClockTime(isoTimestamp)
  const tomorrow = new Date(now.getTime() + millisecondsPerDay)
  if (isSameLocalDay(instant, now)) return `today ${clockTime}`
  if (isSameLocalDay(instant, tomorrow)) return `tomorrow ${clockTime}`
  if (instant.getTime() - now.getTime() < 7 * millisecondsPerDay) return `${instant.toLocaleString('en-GB', { weekday: 'short' })} ${clockTime}`
  return `${instant.getDate()} ${instant.toLocaleString('en-GB', { month: 'short' })} ${clockTime}`
}

function findNextFireAt(agentTriggers: Trigger[]): string | null {
  const upcomingTimes = agentTriggers
    .filter((trigger) => trigger.enabled && trigger.nextFireAt)
    .map((trigger) => trigger.nextFireAt as string)
    .sort((first, second) => new Date(first).getTime() - new Date(second).getTime())
  return upcomingTimes[0] ?? null
}

/**
 * The agent's stage from its status, schedule and latest run.
 *
 * @param agent - The agent (Agent)
 * @param agentTriggers - Its triggers (Trigger[])
 * @param latestRun - Its newest run, if any (Run | undefined)
 */
export function deriveAgentCardStage(agent: Agent, agentTriggers: Trigger[], latestRun: Run | undefined): AgentCardStage {
  if (agent.status === 'paused') return 'paused'
  const isLive = agent.status === 'active' || agentTriggers.some((trigger) => trigger.enabled)
  const lastRunFailed = latestRun?.status === 'failed'
  if (isLive) return lastRunFailed ? 'failing' : 'active'
  if (lastRunFailed) return 'test_failed'
  if (agent.status === 'tested' || latestRun?.status === 'succeeded') return 'tested'
  return 'draft'
}

function describeChip(stage: AgentCardStage, agent: Agent, agentTriggers: Trigger[], now: Date): { chipLabel: string; chipTone: StatusPillTone } {
  if (stage === 'draft') return { chipLabel: 'Draft · not tested', chipTone: 'neutral' }
  if (stage === 'test_failed') return { chipLabel: 'Test failed', chipTone: 'danger' }
  if (stage === 'tested') return { chipLabel: 'Tested · not scheduled', chipTone: 'amber' }
  if (stage === 'failing') return { chipLabel: 'Active · last run failed', chipTone: 'danger' }
  if (stage === 'paused') return { chipLabel: 'Paused', chipTone: 'neutral' }
  const nextFireAt = findNextFireAt(agentTriggers)
  if (nextFireAt) return { chipLabel: `Active · next run ${formatNextRunTime(nextFireAt, now)}`, chipTone: 'ok' }
  return { chipLabel: agent.kind === 'chatbot' ? 'Active · answering chats' : 'Active', chipTone: 'ok' }
}

function chatbotSetupPath(agentId: string): string {
  return `${routePaths.chatbotSetup}?${new URLSearchParams({ agentId })}`
}

function choosePrimaryAction(stage: AgentCardStage, agent: Agent, latestRun: Run | undefined): AgentCardAction {
  const isChatbot = agent.kind === 'chatbot'
  if ((stage === 'test_failed' || stage === 'failing') && latestRun) return { kind: 'link', label: 'See what went wrong', path: failedRunPath(latestRun.id) }
  if (stage === 'draft') return isChatbot ? { kind: 'link', label: 'Try it', path: chatbotSetupPath(agent.id) } : { kind: 'link', label: 'Test it', path: agentPath('testRun', agent.id) }
  if (stage === 'tested') return isChatbot ? { kind: 'link', label: 'Turn it on', path: chatbotSetupPath(agent.id) } : { kind: 'link', label: 'Schedule it', path: agentPath('scheduleAgent', agent.id) }
  if (stage === 'paused') return { kind: 'link', label: 'Resume', path: isChatbot ? chatbotSetupPath(agent.id) : agentPath('scheduleAgent', agent.id) }
  return isChatbot ? { kind: 'link', label: 'Open Inbox', path: routePaths.inbox } : { kind: 'run_now', label: 'Run now' }
}

/**
 * Chip, main button and secondary links of an agent's Home card.
 *
 * @param agent - The agent (Agent)
 * @param agentTriggers - Its triggers (Trigger[])
 * @param latestRun - Its newest run, if any (Run | undefined)
 * @param now - Reference time for the next-run chip (Date)
 * @returns What the card shows (AgentCardState)
 *
 * @example
 * describeAgentCardState(draftAgent, [], undefined).primaryAction // { kind: 'link', label: 'Test it', path: '/agents/a1/test' }
 */
export function describeAgentCardState(agent: Agent, agentTriggers: Trigger[], latestRun: Run | undefined, now: Date = new Date()): AgentCardState {
  const stage = deriveAgentCardStage(agent, agentTriggers, latestRun)
  return {
    stage,
    ...describeChip(stage, agent, agentTriggers, now),
    primaryAction: choosePrimaryAction(stage, agent, latestRun),
    secondaryLinks: [
      { label: 'Edit steps', path: agentPath('builder', agent.id) },
      { label: 'Runs', path: routePaths.runs },
    ],
  }
}

/**
 * Inputs for "Run now": the agent's last run inputs, else its schedule's inputs, else null
 * (the test screen asks for them instead).
 *
 * @param lastRunInputs - From `getLastRunInputs` (Record<string, unknown> | null)
 * @param agentTriggers - The agent's triggers (Trigger[])
 */
export function chooseRunNowInputs(lastRunInputs: Record<string, unknown> | null, agentTriggers: Trigger[]): Record<string, unknown> | null {
  if (lastRunInputs) return lastRunInputs
  const scheduledTrigger = agentTriggers.find((trigger) => trigger.enabled) ?? agentTriggers[0]
  return scheduledTrigger ? scheduledTrigger.inputs : null
}
