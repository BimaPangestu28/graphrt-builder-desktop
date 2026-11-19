import type { ConnectionReminder } from '@/api/connectionReminderTypes'
import type { Conversation } from '@/api/conversationTypes'
import type { AgentRunStats } from '@/api/runSummaryTypes'
import type { Run, RunStatus } from '@/api/types'
import type { AgentSummaryStat, AttentionItem, RecentRun, RecentRunStatus } from '@/data/homeDashboard'
import { formatCounterLabel, pickHeadlineCounter } from '@/pages/agent-run/runCounters'
import { formatRunDay } from '@/pages/agent-run/runResultSummary'
import { humanizeRunError } from '@/pages/agent-run/runErrorText'
import { formatRelativeTime, runPathFor } from './homeLinks'
import { agentPath, routePaths, runReviewPath } from '@/routes'

/** Turns backend runs and run stats into what the Home screen (09) shows. */

/** Looks up an agent's display name by id. */
export type AgentNameLookup = (agentId: string) => string

const lastRunWords: Record<RunStatus, string> = {
  succeeded: 'ok',
  failed: 'failed',
  paused: 'waiting for you',
  running: 'running',
  aborted: 'stopped',
}

const recentRunStatuses: Record<RunStatus, RecentRunStatus> = {
  succeeded: 'Done',
  failed: 'Failed',
  paused: 'Needs you',
  running: 'Running',
  aborted: 'Stopped',
}

/**
 * Stats line of a Home agent card: what it did this week (its main counter, else its run
 * count) and how its last run went.
 *
 * @param stats - The agent's weekly stats, or undefined when unknown (AgentRunStats | undefined)
 * @param now - Reference time for "Today"/"Yesterday" (Date)
 * @returns Up to two stats (AgentSummaryStat[])
 *
 * @example
 * describeAgentRunStats(stats) // [{ count: 12, label: 'messages sent this week' }, { label: 'Last run ok · Today 09:00' }]
 */
export function describeAgentRunStats(stats: AgentRunStats | undefined, now: Date = new Date()): AgentSummaryStat[] {
  if (!stats) return []
  if (stats.runsThisWeek === 0 && !stats.lastRunStatus) return [{ label: 'No runs yet' }]
  const headlineCounter = pickHeadlineCounter(stats.counters)
  const weekStat: AgentSummaryStat = headlineCounter
    ? { count: Math.round(headlineCounter.value), label: `${formatCounterLabel(headlineCounter.name).toLowerCase()} this week` }
    : { count: stats.runsThisWeek, label: stats.runsThisWeek === 1 ? 'run this week' : 'runs this week' }
  if (!stats.lastRunStatus || !stats.lastRunAt) return [weekStat]
  return [weekStat, { label: `Last run ${lastRunWords[stats.lastRunStatus]} · ${formatRunDay(stats.lastRunAt, now)}` }]
}

/** The question a paused run asks (human-input `prompt`, or the sample data's `question`). */
export function readPauseQuestion(run: Run): string | null {
  const pauseData = run.pauseReasons?.[0]?.data
  if (typeof pauseData === 'string') return pauseData
  if (!pauseData || typeof pauseData !== 'object') return null
  const { question, prompt } = pauseData as Record<string, unknown>
  if (typeof question === 'string' && question.length > 0) return question
  return typeof prompt === 'string' && prompt.length > 0 ? prompt : null
}

function groupRunsByAgent(runs: Run[]): Run[][] {
  const runsByAgent = new Map<string, Run[]>()
  for (const run of runs) runsByAgent.set(run.agentId, [...(runsByAgent.get(run.agentId) ?? []), run])
  return [...runsByAgent.values()]
}

/**
 * "Needs you" rows for runs paused for approval, one per agent (its newest paused run), each
 * opening the run to answer it: test runs on the test screen (06), others on Review (19).
 *
 * @param pausedRuns - Runs with status `paused`, newest first (Run[])
 * @param agentName - Display name lookup (AgentNameLookup)
 * @param now - Reference time (Date)
 */
export function buildPausedRunItems(pausedRuns: Run[], agentName: AgentNameLookup, now: Date = new Date()): AttentionItem[] {
  return groupRunsByAgent(pausedRuns).map(([newestRun, ...olderRuns], index) => {
    const question = readPauseQuestion(newestRun)
    const moreWaiting = olderRuns.length > 0 ? ` · ${olderRuns.length} more waiting` : ''
    const pausedAtLine = `${formatRunDay(newestRun.startedAt, now)} run · paused for your review${moreWaiting}`
    return {
      id: `paused-${newestRun.id}`,
      kind: 'approval',
      title: `${agentName(newestRun.agentId)} is waiting for you`,
      // The question can be a whole message to send, so it gets its own (clamped) line.
      ...(question ? { detail: question, meta: pausedAtLine } : { detail: pausedAtLine }),
      actionLabel: 'Review',
      actionPath: newestRun.trigger === 'test' ? agentPath('testRun', newestRun.agentId, { runId: newestRun.id }) : runReviewPath(newestRun.id),
      isPrimaryAction: index === 0,
    }
  })
}

/**
 * Plain-language result of a run: the humanized error when it failed, else its summary
 * headline, else what it is doing.
 *
 * @param run - The run (Run)
 * @returns One sentence (string)
 *
 * @example
 * describeRunResult(failedRun) // "Could not reach promo.example.com: that address doesn't exist"
 */
export function describeRunResult(run: Run): string {
  const summary = run.outputs?.summary
  if (run.status === 'failed') return run.errorMessage ? humanizeRunError(run.errorMessage).summary : 'Failed'
  if (typeof summary === 'string' && summary.trim().length > 0) return summary.trim()
  if (run.status === 'paused') return readPauseQuestion(run) ?? 'Waiting for you'
  if (run.status === 'running') return 'Still running'
  if (run.status === 'aborted') return 'Stopped'
  return 'Finished'
}

/**
 * Recent runs table rows: agent (linking to it), relative start time, plain-language result,
 * status and the screen that opens the run.
 *
 * @param runs - Newest first (Run[])
 * @param agentName - Display name lookup (AgentNameLookup)
 * @param now - Reference time (Date)
 */
export function buildRecentRunRows(runs: Run[], agentName: AgentNameLookup, now: Date = new Date()): RecentRun[] {
  return runs.map((run) => ({
    id: run.id,
    agentId: run.agentId,
    agentName: agentName(run.agentId),
    agentPath: agentPath('builder', run.agentId),
    startedAt: formatRelativeTime(run.startedAt, now),
    startedAtTitle: new Date(run.startedAt).toLocaleString('en-GB'),
    resultSummary: describeRunResult(run),
    status: recentRunStatuses[run.status],
    runPath: runPathFor(run),
  }))
}

/** "9 minutes", "2 hours", "3 days" (at least one minute). */
export function formatWaitingTime(sinceIsoTimestamp: string, now: Date = new Date()): string {
  const waitedMinutes = Math.max(1, Math.floor((now.getTime() - new Date(sinceIsoTimestamp).getTime()) / 60_000))
  const pluralize = (count: number, unit: string) => `${count} ${unit}${count === 1 ? '' : 's'}`
  if (waitedMinutes < 60) return pluralize(waitedMinutes, 'minute')
  const waitedHours = Math.floor(waitedMinutes / 60)
  if (waitedHours < 24) return pluralize(waitedHours, 'hour')
  return pluralize(Math.floor(waitedHours / 24), 'day')
}

function describeHandingAgents(waitingConversations: Conversation[], agentName: AgentNameLookup): string {
  const agentNames = Array.from(new Set(waitingConversations.map((conversation) => agentName(conversation.agentId))))
  if (agentNames.length === 1) return agentNames[0]
  if (agentNames.length === 2) return `${agentNames[0]} and ${agentNames[1]}`
  return 'Your chatbots'
}

/**
 * The "customers are waiting in Inbox" row, from the chats a chatbot handed over.
 *
 * @param waitingConversations - Conversations with status `waiting_for_you` (Conversation[])
 * @param agentName - Display name lookup (AgentNameLookup)
 * @param now - Reference time (Date)
 * @returns The row, or null when nobody is waiting (AttentionItem | null)
 *
 * @example
 * buildInboxAttentionItem(chats, agentName) // { title: '2 customers are waiting in Inbox', detail: 'Catering assistant passed them to you · oldest 9 minutes', ... }
 */
export function buildInboxAttentionItem(waitingConversations: Conversation[], agentName: AgentNameLookup, now: Date = new Date()): AttentionItem | null {
  if (waitingConversations.length === 0) return null
  const isSingle = waitingConversations.length === 1
  const oldestUpdate = waitingConversations.reduce((oldest, conversation) => (new Date(conversation.updatedAt) < new Date(oldest) ? conversation.updatedAt : oldest), waitingConversations[0].updatedAt)
  return {
    id: 'inbox-waiting',
    kind: 'chat',
    title: isSingle ? '1 customer is waiting in Inbox' : `${waitingConversations.length} customers are waiting in Inbox`,
    detail: `${describeHandingAgents(waitingConversations, agentName)} passed ${isSingle ? 'it' : 'them'} to you · ${isSingle ? 'waiting' : 'oldest'} ${formatWaitingTime(oldestUpdate, now)}`,
    actionLabel: 'Open Inbox',
    actionPath: routePaths.inbox,
    isPrimaryAction: false,
  }
}

/** "Needs you" rows for connected services that need attention, each opening Connections. */
export function buildConnectionReminderItems(reminders: ConnectionReminder[]): AttentionItem[] {
  return reminders.map((reminder) => ({
    id: `connection-${reminder.id}`,
    kind: 'connection',
    title: reminder.title,
    detail: reminder.detail,
    actionLabel: reminder.actionLabel,
    actionPath: routePaths.connections,
    isPrimaryAction: false,
  }))
}
