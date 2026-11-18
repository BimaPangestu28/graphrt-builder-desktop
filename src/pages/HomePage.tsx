import { listConnectionReminders } from '@/api/connectionReminders'
import type { Conversation } from '@/api/conversationTypes'
import { listAgentRunStats } from '@/api/runSummary'
import type { Run } from '@/api/types'
import { getUsageSummary } from '@/api/usageSummary'
import { AppShell } from '@/components/layout'
import type { AttentionItem } from '@/data/homeDashboard'
import { useAgentNames } from '@/hooks/useAgentNames'
import { useAgents } from '@/hooks/useAgents'
import { useAsyncData } from '@/hooks/useAsyncData'
import { useConversationList } from '@/hooks/useConversations'
import { useLoadedData, useRunEventSubscription } from '@/hooks/useRunData'
import { useRuns } from '@/hooks/useRuns'
import { useTriggers } from '@/hooks/useTriggers'
import { AgentSummaryCards } from '@/pages/home-dashboard/AgentSummaryCards'
import { getGreetingForHour } from '@/pages/home-dashboard/greeting'
import { describeNeedsYouCount, describeNextRun } from '@/pages/home-dashboard/homeSummaryLines'
import {
  buildConnectionReminderItems,
  buildInboxAttentionItem,
  buildPausedRunItems,
  buildRecentRunRows,
  type AgentNameLookup,
} from '@/pages/home-dashboard/homeViewModel'
import { MonthlyUsageCard } from '@/pages/home-dashboard/MonthlyUsageCard'
import { startOfLocalMonth } from '@/pages/home-dashboard/monthlyUsage'
import { NeedsYouSection } from '@/pages/home-dashboard/NeedsYouSection'
import { RecentRunsTable } from '@/pages/home-dashboard/RecentRunsTable'

const recentRunLimit = 5

/** Calls `reload` whenever a run changes status (finished, paused or failed). */
function useReloadOnRunStatusChange(reload: () => void) {
  useRunEventSubscription((payload) => {
    if (payload.event.type === 'status_changed') reload()
  })
}

/** This week's stats per agent, reloaded whenever a run changes status. */
function useWeeklyRunStats() {
  const loadedStats = useLoadedData(() => listAgentRunStats(), [])
  useReloadOnRunStatusChange(loadedStats.reload)
  return loadedStats
}

/** Runs and AI tokens since the 1st of this month, reloaded whenever a run changes status. */
function useMonthlyUsage() {
  const loadedUsage = useLoadedData(() => getUsageSummary(startOfLocalMonth(new Date()).toISOString()), [])
  useReloadOnRunStatusChange(loadedUsage.reload)
  return loadedUsage
}

interface AttentionSources {
  pausedRuns: Run[] | null
  waitingChats: Conversation[] | null
  connectionItems: AttentionItem[]
  agentName: AgentNameLookup
}

/** Paused runs first, then the Inbox row and connection reminders; null until paused runs load. */
function combineAttentionItems({ pausedRuns, waitingChats, connectionItems, agentName }: AttentionSources): AttentionItem[] | null {
  if (!pausedRuns) return null
  const inboxItem = waitingChats ? buildInboxAttentionItem(waitingChats, agentName) : null
  return [...buildPausedRunItems(pausedRuns, agentName), ...(inboxItem ? [inboxItem] : []), ...connectionItems]
}

/** "3 things need you · next run tomorrow 07:00"; each half shows once its data is in. */
function GreetingSubtitle({ needsYouCount, nextRunLine }: { needsYouCount: number | null; nextRunLine: string | null }) {
  const parts = [needsYouCount === null ? null : describeNeedsYouCount(needsYouCount), nextRunLine].filter((part): part is string => part !== null)
  return <span className="min-h-[1lh] text-body">{parts.join(' · ')}</span>
}

/**
 * Screen 09 · Home with active agents.
 * The daily landing page: a greeting for the time of day with how many things need the user
 * (paused runs plus chats waiting in Inbox) and the next scheduled run; the "Needs you" list
 * (paused runs, the Inbox, connection reminders); agent cards from `listAgents` with their
 * schedule from `listTriggers` and this week's stats from `listAgentRunStats`; the last few
 * runs; and this month's runs and AI tokens from `getUsageSummary`.
 */
export function HomePage() {
  const greeting = getGreetingForHour(new Date().getHours())
  const agentName = useAgentNames()
  const { data: agents, error: agentsError } = useAgents()
  const { data: runStats } = useWeeklyRunStats()
  const { data: pausedRuns, error: pausedRunsError } = useRuns({ status: 'paused' })
  const { data: recentRuns, error: recentRunsError } = useRuns({ limit: recentRunLimit })
  const { data: waitingChats } = useConversationList({ status: 'waiting_for_you' })
  const { data: connectionReminders } = useAsyncData(listConnectionReminders, [])
  const { triggers, isLoading: areTriggersLoading, error: triggersError } = useTriggers()
  const { data: monthlyUsage, error: monthlyUsageError } = useMonthlyUsage()

  const connectionItems = buildConnectionReminderItems(connectionReminders ?? [])
  const attentionItems = combineAttentionItems({ pausedRuns, waitingChats, connectionItems, agentName })
  const needsYouCount = pausedRuns && waitingChats ? pausedRuns.length + waitingChats.length : null
  const nextRunLine = areTriggersLoading || triggersError ? null : describeNextRun(triggers)

  return (
    <AppShell activeNav="home" agents={{ kind: 'list' }} runnerStatus="Online · 2 agents scheduled" mainClassName="box-border flex flex-col gap-7 p-8">
      <div className="flex flex-col gap-1">
        <h1 className="m-0 text-[28px] font-semibold tracking-[-0.5px]">{greeting}</h1>
        <GreetingSubtitle needsYouCount={needsYouCount} nextRunLine={nextRunLine} />
      </div>
      <NeedsYouSection items={attentionItems} loadError={pausedRunsError} />
      <AgentSummaryCards agents={agents} loadError={agentsError} runStats={runStats} triggers={triggers} />
      <div className="flex flex-wrap gap-4">
        <RecentRunsTable runs={recentRuns ? buildRecentRunRows(recentRuns, agentName) : null} loadError={recentRunsError} />
        <MonthlyUsageCard usageSummary={monthlyUsage} loadError={monthlyUsageError} />
      </div>
    </AppShell>
  )
}
