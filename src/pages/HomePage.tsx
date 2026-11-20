import type { Problem } from '@/api/problemTypes'
import { AppShell, PageFrame, PageTitleBlock } from '@/components/layout'
import { useAgentNames } from '@/hooks/useAgentNames'
import { AgentSummaryCards } from '@/pages/home-dashboard/AgentSummaryCards'
import { DescribeAgentCard } from '@/pages/home-dashboard/DescribeAgentCard'
import { deriveGettingStartedSteps, type GettingStartedStep } from '@/pages/home-dashboard/gettingStarted'
import { GettingStartedCard } from '@/pages/home-dashboard/GettingStartedCard'
import { getGreetingForHour } from '@/pages/home-dashboard/greeting'
import { describeNeedsYouCount, describeNextRun } from '@/pages/home-dashboard/homeSummaryLines'
import { buildRecentRunRows } from '@/pages/home-dashboard/homeViewModel'
import { MonthlyUsageCard } from '@/pages/home-dashboard/MonthlyUsageCard'
import { buildMonthlyNumbers, startOfLocalMonth, type MonthlyNumbers } from '@/pages/home-dashboard/monthlyUsage'
import { buildNeedsYouItems, isSetupProblem } from '@/pages/home-dashboard/needsYou'
import { NeedsYouSection } from '@/pages/home-dashboard/NeedsYouSection'
import { RecentRunsTable } from '@/pages/home-dashboard/RecentRunsTable'
import { UpdatesNotice } from '@/pages/home-dashboard/UpdatesNotice'
import { useHomeData, type HomeData } from '@/pages/home-dashboard/useHomeData'

const recentRunLimit = 5

/** "3 things need you · next run tomorrow 07:00"; each half shows once its data is in. */
function describeGreetingSubtitle(needsYouCount: number | null, nextRunLine: string | null): string {
  return [needsYouCount === null ? null : describeNeedsYouCount(needsYouCount), nextRunLine].filter((part): part is string => part !== null).join(' · ')
}

function collectAgentsNeedingSetup(problems: Problem[]): Set<string> {
  return new Set(problems.filter(isSetupProblem).map((problem) => problem.agentId as string))
}

/** The checklist steps once the data they need is in; null before. */
function buildGettingStartedSteps(homeData: HomeData): GettingStartedStep[] | null {
  const { providerStatuses, agents, runs, triggers, areTriggersLoading, pluginRequirements, problems } = homeData
  if (!providerStatuses || !agents || !runs || areTriggersLoading) return null
  return deriveGettingStartedSteps({ providerStatuses, agents, runs, triggers, pluginRequirements, agentIdsNeedingSetup: collectAgentsNeedingSetup(problems ?? []) })
}

function buildThisMonth({ runs, monthlyUsage }: HomeData): MonthlyNumbers | null {
  if (!runs) return null
  return buildMonthlyNumbers(monthlyUsage, runs, startOfLocalMonth(new Date()))
}

/** Two columns once the dashboard area is this wide (container query); one column below. */
const dashboardGridClassName = 'grid grid-cols-1 items-start gap-8 @min-[920px]:grid-cols-[minmax(0,1fr)_minmax(300px,340px)]'

/**
 * Screen 09 · Home.
 * A desktop dashboard in the shared page frame: a greeting with how many things need the
 * user and the next scheduled run, then two columns. The main column starts with a
 * dismissible "Updates" notice while the app or plugins have news (see `UpdatesNotice`), then "Needs you"
 * (approvals, waiting chats, failed latest runs, agents not set up, broken schedules, each
 * with one action) first while anything is waiting, the agent cards with their status and
 * next step, and the last few runs in plain words. The right rail has a compact box to
 * describe a new agent and start building it, "Getting started" until the first agent is
 * tested and scheduled, and this month's results. Below ~920px of width the rail stacks
 * under the main column.
 */
export function HomePage() {
  const greeting = getGreetingForHour(new Date().getHours())
  const agentName = useAgentNames()
  const homeData = useHomeData()
  const { agents, agentsError, runs, runsError, runStats, triggers, areTriggersLoading, triggersError, pluginRequirements } = homeData

  const attentionItems = buildNeedsYouItems({ ...homeData, agentName })
  const nextRunLine = areTriggersLoading || triggersError ? null : describeNextRun(triggers)
  // Things waiting on the user come first; once nothing is waiting the list drops to the end of the column.
  const isNeedsYouFirst = attentionItems === null || attentionItems.length > 0 || runsError !== null
  const needsYouSection = <NeedsYouSection items={attentionItems} loadError={runsError} />

  return (
    <AppShell activeNav="home" agents={{ kind: 'list' }}>
      <PageFrame>
        <PageTitleBlock title={greeting} subtitle={describeGreetingSubtitle(attentionItems ? attentionItems.length : null, nextRunLine)} />
        <div className="@container">
          <div className={dashboardGridClassName}>
            <section aria-label="Overview" className="flex min-w-0 flex-col gap-8">
              <UpdatesNotice />
              {isNeedsYouFirst && needsYouSection}
              <AgentSummaryCards agents={agents} loadError={agentsError} runs={runs} runStats={runStats} triggers={triggers} pluginRequirements={pluginRequirements} />
              <RecentRunsTable runs={runs ? buildRecentRunRows(runs.slice(0, recentRunLimit), agentName) : null} loadError={runsError} />
              {!isNeedsYouFirst && needsYouSection}
            </section>
            <aside aria-label="New agent and this month" className="flex min-w-0 flex-col gap-6">
              <DescribeAgentCard />
              <GettingStartedCard steps={buildGettingStartedSteps(homeData)} />
              <MonthlyUsageCard monthlyNumbers={buildThisMonth(homeData)} loadError={runsError ?? homeData.monthlyUsageError} />
            </aside>
          </div>
        </div>
      </PageFrame>
    </AppShell>
  )
}
