import type { ConnectionReminder } from '@/api/connectionReminderTypes'
import type { Conversation } from '@/api/conversationTypes'
import type { AgentRunStats } from '@/api/runSummaryTypes'
import type { Run, RunStatus } from '@/api/types'
import type { AgentSummaryStat, AttentionItem, RecentRun, RecentRunStatus } from '@/pages/home-dashboard/homeDashboardTypes'
import { formatCounterLabel, pickHeadlineCounter } from '@/pages/agent-run/runCounters'
import { formatRunDay } from '@/pages/agent-run/runResultSummary'
import { humanizeRunError } from '@/pages/agent-run/runErrorText'
import { readPauseDeadline, readPauseQuestion } from '@/pages/agent-run/runPauseQuestion'
import { formatRelativeTime, runPathFor } from './homeLinks'
import { agentPath, connectionsTabPath, routePaths, runReviewPath } from '@/routes'
import { formatDateTime, messages } from '@/i18n'

/** Turns backend runs and run stats into what the Home screen (09) shows. */

/** Looks up an agent's display name by id. */
export type AgentNameLookup = (agentId: string) => string

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
  const t = messages().home
  if (stats.runsThisWeek === 0 && !stats.lastRunStatus) return [{ label: t.noRunsYetStat }]
  const headlineCounter = pickHeadlineCounter(stats.counters)
  const weekStat: AgentSummaryStat = headlineCounter
    ? { count: Math.round(headlineCounter.value), label: t.counterThisWeek(formatCounterLabel(headlineCounter.name)) }
    : { count: stats.runsThisWeek, label: t.runsThisWeek(stats.runsThisWeek) }
  if (!stats.lastRunStatus || !stats.lastRunAt) return [weekStat]
  return [weekStat, { label: t.lastRun(t.lastRunWords[stats.lastRunStatus], formatRunDay(stats.lastRunAt, now)) }]
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
    const t = messages().home
    const question = readPauseQuestion(newestRun)
    const moreWaiting = olderRuns.length > 0 ? t.moreWaiting(olderRuns.length) : ''
    const deadline = readPauseDeadline(newestRun, now.getTime())
    const pausedAtLine = t.pausedForReview(formatRunDay(newestRun.startedAt, now), deadline ?? null, moreWaiting)
    return {
      id: `paused-${newestRun.id}`,
      kind: 'approval',
      title: t.waitingForYou(agentName(newestRun.agentId)),
      // The question can be a whole message to send, so it gets its own (clamped) line.
      ...(question ? { detail: question, meta: pausedAtLine } : { detail: pausedAtLine }),
      actionLabel: t.review,
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
  const t = messages().home
  if (run.status === 'failed') return run.errorMessage ? humanizeRunError(run.errorMessage).summary : t.resultFailed
  if (typeof summary === 'string' && summary.trim().length > 0) return summary.trim()
  if (run.status === 'paused') return readPauseQuestion(run) ?? t.resultWaiting
  if (run.status === 'running') return t.resultRunning
  if (run.status === 'aborted') return t.resultStopped
  return t.resultFinished
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
    startedAtTitle: formatDateTime(new Date(run.startedAt)),
    resultSummary: describeRunResult(run),
    status: recentRunStatuses[run.status],
    runPath: runPathFor(run),
  }))
}

/** "9 minutes", "2 hours", "3 days" (at least one minute). */
export function formatWaitingTime(sinceIsoTimestamp: string, now: Date = new Date()): string {
  const waitedMinutes = Math.max(1, Math.floor((now.getTime() - new Date(sinceIsoTimestamp).getTime()) / 60_000))
  const t = messages().home
  if (waitedMinutes < 60) return t.waitMinutes(waitedMinutes)
  const waitedHours = Math.floor(waitedMinutes / 60)
  if (waitedHours < 24) return t.waitHours(waitedHours)
  return t.waitDays(Math.floor(waitedHours / 24))
}

function describeHandingAgents(waitingConversations: Conversation[], agentName: AgentNameLookup): string {
  const agentNames = Array.from(new Set(waitingConversations.map((conversation) => agentName(conversation.agentId))))
  if (agentNames.length === 1) return agentNames[0]
  if (agentNames.length === 2) return messages().home.twoAgents(agentNames[0], agentNames[1])
  return messages().home.yourChatbots
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
    title: isSingle ? messages().home.oneCustomerWaiting : messages().home.customersWaiting(waitingConversations.length),
    detail: messages().home.passedToYou(describeHandingAgents(waitingConversations, agentName), isSingle, formatWaitingTime(oldestUpdate, now)),
    actionLabel: messages().home.action.openInbox,
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
    actionPath: connectionsTabPath('apps'),
    isPrimaryAction: false,
  }))
}
