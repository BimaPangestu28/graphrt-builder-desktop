import { isDesktopApp } from '@/api/client'
import { listAgentRunStats } from '@/api/runSummary'
import { AppShell } from '@/components/layout'
import { monthlyUsage, sampleAttentionItems } from '@/data/homeDashboard'
import { useAgentNames } from '@/hooks/useAgentNames'
import { useAgents } from '@/hooks/useAgents'
import { useLoadedData, useRunEventSubscription } from '@/hooks/useRunData'
import { useRuns } from '@/hooks/useRuns'
import { AgentSummaryCards } from '@/pages/home-dashboard/AgentSummaryCards'
import { getGreetingForHour } from '@/pages/home-dashboard/greeting'
import { buildPausedRunItems, buildRecentRunRows } from '@/pages/home-dashboard/homeViewModel'
import { MonthlyUsageCard } from '@/pages/home-dashboard/MonthlyUsageCard'
import { NeedsYouSection } from '@/pages/home-dashboard/NeedsYouSection'
import { RecentRunsTable } from '@/pages/home-dashboard/RecentRunsTable'

const recentRunLimit = 5

/** This week's stats per agent, reloaded whenever a run changes status. */
function useWeeklyRunStats() {
  const loadedStats = useLoadedData(() => listAgentRunStats(), [])
  useRunEventSubscription((payload) => {
    if (payload.event.type === 'status_changed') loadedStats.reload()
  })
  return loadedStats
}

/**
 * Screen 09 · Home with active agents.
 * The daily landing page: a greeting for the time of day, runs paused for approval (each
 * opening the run to answer it), agent cards from `listAgents` with this week's stats from
 * `listAgentRunStats`, the last few runs with their summary headline, and this month's usage
 * (still sample content). The Inbox and Gmail reminders appear only in the browser preview.
 */
export function HomePage() {
  const greeting = getGreetingForHour(new Date().getHours())
  const agentName = useAgentNames()
  const { data: agents, error: agentsError } = useAgents()
  const { data: runStats } = useWeeklyRunStats()
  const { data: pausedRuns, error: pausedRunsError } = useRuns({ status: 'paused' })
  const { data: recentRuns, error: recentRunsError } = useRuns({ limit: recentRunLimit })

  const previewOnlyItems = isDesktopApp() ? [] : sampleAttentionItems
  const attentionItems = pausedRuns ? [...buildPausedRunItems(pausedRuns, agentName), ...previewOnlyItems] : null
  const needsYouCount = attentionItems?.length ?? 0

  return (
    <AppShell activeNav="home" agents={{ kind: 'list' }} runnerStatus="Online · 2 agents scheduled" mainClassName="box-border flex flex-col gap-7 p-8">
      <div className="flex flex-col gap-1">
        <h1 className="m-0 text-[28px] font-semibold tracking-[-0.5px]">{greeting}</h1>
        <span className="text-body">
          {needsYouCount === 1 ? '1 thing needs you' : `${needsYouCount} things need you`} · next run tomorrow 07:00
        </span>
      </div>
      <NeedsYouSection items={attentionItems} loadError={pausedRunsError} />
      <AgentSummaryCards agents={agents} loadError={agentsError} runStats={runStats} />
      <div className="flex flex-wrap gap-4">
        <RecentRunsTable runs={recentRuns ? buildRecentRunRows(recentRuns, agentName) : null} loadError={recentRunsError} />
        <MonthlyUsageCard usageRows={monthlyUsage} />
      </div>
    </AppShell>
  )
}
