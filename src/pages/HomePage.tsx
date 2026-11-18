import { AppShell } from '@/components/layout'
import { attentionItems, monthlyUsage, recentRuns } from '@/data/homeDashboard'
import { useAgents } from '@/hooks/useAgents'
import { AgentSummaryCards } from '@/pages/home-dashboard/AgentSummaryCards'
import { getGreetingForHour } from '@/pages/home-dashboard/greeting'
import { MonthlyUsageCard } from '@/pages/home-dashboard/MonthlyUsageCard'
import { NeedsYouSection } from '@/pages/home-dashboard/NeedsYouSection'
import { RecentRunsTable } from '@/pages/home-dashboard/RecentRunsTable'

/**
 * Screen 09 · Home with active agents.
 * The daily landing page: a greeting for the time of day, the things waiting on the user
 * (each linking to where it gets resolved), agent cards from `listAgents`, recent runs and
 * this month's usage. "Needs you", runs and usage are still mock data.
 */
export function HomePage() {
  const greeting = getGreetingForHour(new Date().getHours())
  const needsYouCount = attentionItems.length
  const { data: agents, error: agentsError } = useAgents()

  return (
    <AppShell activeNav="home" agents={{ kind: 'list' }} runnerStatus="Online · 2 agents scheduled" inboxCount={3} mainClassName="box-border flex flex-col gap-7 p-8">
      <div className="flex flex-col gap-1">
        <h1 className="m-0 text-[28px] font-semibold tracking-[-0.5px]">{greeting}</h1>
        <span className="text-body">{needsYouCount} things need you · next run tomorrow 07:00</span>
      </div>
      <NeedsYouSection items={attentionItems} />
      <AgentSummaryCards agents={agents} loadError={agentsError} />
      <div className="flex flex-wrap gap-4">
        <RecentRunsTable runs={recentRuns} />
        <MonthlyUsageCard usageRows={monthlyUsage} />
      </div>
    </AppShell>
  )
}
