import type { ConnectionReminder } from '@/api/connectionReminderTypes'
import type { Conversation } from '@/api/conversationTypes'
import type { PluginRequirement } from '@/api/pluginRequirementTypes'
import type { Problem, ProblemKind } from '@/api/problemTypes'
import type { Run } from '@/api/types'
import type { AttentionItem, AttentionKind } from '@/data/homeDashboard'
import { formatRunDay } from '@/pages/agent-run/runResultSummary'
import { getProblemActionPath } from '@/pages/error-states/problemActions'
import { agentPath, routePaths } from '@/routes'
import { failedRunPath, findLatestRunByAgent } from './homeLinks'
import { buildConnectionReminderItems, buildInboxAttentionItem, buildPausedRunItems, describeRunResult, type AgentNameLookup } from './homeViewModel'

/**
 * The Home "Needs you" list (09): everything that blocks the user, most urgent first, one row
 * per agent per kind, each with one action.
 */

/** Order of the list: answers people wait on first, then what stops agents from running. */
export const needsYouKindOrder: AttentionKind[] = ['approval', 'chat', 'failed_run', 'setup', 'schedule', 'connection']

/** Problems that mean an agent cannot run until something is installed, trusted or filled in. */
const setupProblemKinds = new Set<ProblemKind>(['missing_credentials', 'plugin_missing', 'plugin_not_loaded', 'plugin_untrusted', 'browser_missing'])

/** True for a problem that keeps an agent from running until it is set up. */
export function isSetupProblem(problem: Problem): boolean {
  return problem.agentId !== null && setupProblemKinds.has(problem.kind)
}

export interface NeedsYouSources {
  /** Runs newest first (paused runs among them become approval rows); null while loading. */
  runs: Run[] | null
  waitingChats: Conversation[] | null
  problems: Problem[] | null
  /** Agent id → its plugin requirements; agents without an entry are unknown. */
  pluginRequirements: Map<string, PluginRequirement[]>
  connectionReminders: ConnectionReminder[] | null
  agentName: AgentNameLookup
}

/**
 * Why a plugin is not ready yet, in a few words.
 *
 * @example
 * describePluginGap(requirement) // "WhatsApp Cloud API needs ACCESS_TOKEN"
 */
export function describePluginGap(requirement: PluginRequirement): string {
  const pluginLabel = requirement.displayName
  if (!requirement.installed) return `${pluginLabel} isn't installed`
  if (!requirement.trusted && !requirement.trustNotNeeded) return `${pluginLabel} isn't trusted yet`
  if (requirement.missingConfig.length > 0) return `${pluginLabel} needs ${requirement.missingConfig.join(', ')}`
  if (!requirement.browserReady) return `${pluginLabel} needs the browser installed`
  if (requirement.needsSession && !requirement.sessionLinked) return `${pluginLabel} isn't linked yet`
  return `${pluginLabel} isn't ready`
}

/** One row per agent whose latest run failed, with the humanized reason. */
function buildFailedRunItems(runs: Run[], agentName: AgentNameLookup, now: Date): AttentionItem[] {
  return [...findLatestRunByAgent(runs).values()]
    .filter((run) => run.status === 'failed')
    .map((run) => ({
      id: `failed-${run.agentId}`,
      kind: 'failed_run',
      title: run.trigger === 'test' ? `${agentName(run.agentId)} failed its test` : `${agentName(run.agentId)}'s last run failed`,
      detail: `${describeRunResult(run)} · ${formatRunDay(run.startedAt, now)}`,
      actionLabel: 'See what went wrong',
      actionPath: failedRunPath(run.id),
      isPrimaryAction: false,
    }))
}

interface AgentSetupGaps {
  reasons: string[]
  /** Every reason is a model key handled in Connections, not in the build chat. */
  isConnectionsOnly: boolean
}

function collectSetupGaps(problems: Problem[], pluginRequirements: Map<string, PluginRequirement[]>): Map<string, AgentSetupGaps> {
  const gapsByAgent = new Map<string, AgentSetupGaps>()
  const addGap = (agentId: string, reason: string, isConnections: boolean) => {
    const gaps = gapsByAgent.get(agentId) ?? { reasons: [], isConnectionsOnly: true }
    if (!gaps.reasons.includes(reason)) gaps.reasons.push(reason)
    gaps.isConnectionsOnly = gaps.isConnectionsOnly && isConnections
    gapsByAgent.set(agentId, gaps)
  }
  for (const problem of problems) {
    if (!isSetupProblem(problem) || !problem.agentId) continue
    addGap(problem.agentId, problem.title, problem.actions[0]?.kind === 'open_connections')
  }
  for (const [agentId, requirements] of pluginRequirements) {
    requirements.filter((requirement) => !requirement.ready).forEach((requirement) => addGap(agentId, describePluginGap(requirement), false))
  }
  return gapsByAgent
}

/** One "Set up" row per agent whose plugins, secrets or keys are not ready. */
function buildSetupItems(problems: Problem[], pluginRequirements: Map<string, PluginRequirement[]>, agentName: AgentNameLookup): AttentionItem[] {
  return [...collectSetupGaps(problems, pluginRequirements)].map(([agentId, gaps]) => ({
    id: `setup-${agentId}`,
    kind: 'setup',
    title: `${agentName(agentId)} isn't ready to run`,
    detail: gaps.reasons.join(' · '),
    actionLabel: 'Set up',
    // Plugins and secrets are set up in the build chat; model keys and credit in Connections.
    actionPath: gaps.isConnectionsOnly ? routePaths.connections : agentPath('builder', agentId),
    isPrimaryAction: false,
  }))
}

function isBrokenSchedule(problem: Problem): boolean {
  return problem.kind === 'schedule_invalid' || (problem.kind === 'schedule_failing' && problem.needsAttention)
}

/** One row per agent whose schedule cannot fire (or keeps failing and needs the user). */
function buildScheduleItems(problems: Problem[]): AttentionItem[] {
  const seenAgents = new Set<string>()
  return problems.filter(isBrokenSchedule).flatMap((problem): AttentionItem[] => {
    const dedupeKey = problem.agentId ?? problem.id
    if (seenAgents.has(dedupeKey)) return []
    seenAgents.add(dedupeKey)
    const scheduleAction = problem.actions.find((action) => action.kind === 'open_schedule')
    const actionPath = (scheduleAction && getProblemActionPath(scheduleAction)) ?? (problem.agentId ? agentPath('scheduleAgent', problem.agentId) : routePaths.scheduler)
    return [{ id: `schedule-${dedupeKey}`, kind: 'schedule', title: problem.title, detail: problem.detail, actionLabel: 'Fix schedule', actionPath, isPrimaryAction: false }]
  })
}

function sortByUrgency(items: AttentionItem[]): AttentionItem[] {
  return [...items].sort((first, second) => needsYouKindOrder.indexOf(first.kind) - needsYouKindOrder.indexOf(second.kind))
}

/**
 * Everything that blocks the user, most urgent first: runs waiting for approval, chats
 * waiting in Inbox, agents whose latest run failed, agents that are not set up, broken
 * schedules and connection reminders. The first row gets the primary button.
 *
 * @param sources - Data from the backend (NeedsYouSources)
 * @param now - Reference time (Date)
 * @returns The rows, or null until runs have loaded (AttentionItem[] | null)
 *
 * @example
 * buildNeedsYouItems({ runs, waitingChats, problems, pluginRequirements, connectionReminders, agentName })
 * // [{ kind: 'approval', actionLabel: 'Review', … }, { kind: 'failed_run', actionLabel: 'See what went wrong', … }]
 */
export function buildNeedsYouItems(sources: NeedsYouSources, now: Date = new Date()): AttentionItem[] | null {
  const { runs, waitingChats, problems, pluginRequirements, connectionReminders, agentName } = sources
  if (!runs) return null
  const pausedRuns = runs.filter((run) => run.status === 'paused')
  const inboxItem = waitingChats ? buildInboxAttentionItem(waitingChats, agentName, now) : null
  const items = sortByUrgency([
    ...buildPausedRunItems(pausedRuns, agentName, now),
    ...(inboxItem ? [inboxItem] : []),
    ...buildFailedRunItems(runs, agentName, now),
    ...buildSetupItems(problems ?? [], pluginRequirements, agentName),
    ...buildScheduleItems(problems ?? []),
    ...buildConnectionReminderItems(connectionReminders ?? []),
  ])
  return items.map((item, index) => ({ ...item, isPrimaryAction: index === 0 }))
}
