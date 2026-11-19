import type { Problem } from '@/api/problemTypes'
import { AppShell } from '@/components/layout'
import { useAgentNames } from '@/hooks/useAgentNames'
import { AgentSummaryCards } from '@/pages/home-dashboard/AgentSummaryCards'
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
import { useHomeData, type HomeData } from '@/pages/home-dashboard/useHomeData'

const recentRunLimit = 5

/** "3 things need you · next run tomorrow 07:00"; each half shows once its data is in. */
function GreetingSubtitle({ needsYouCount, nextRunLine }: { needsYouCount: number | null; nextRunLine: string | null }) {
  const parts = [needsYouCount === null ? null : describeNeedsYouCount(needsYouCount), nextRunLine].filter((part): part is string => part !== null)
  return <span className="min-h-[1lh] text-body">{parts.join(' · ')}</span>
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

/**
 * Screen 09 · Home.
 * The daily landing page: a greeting with how many things need the user and the next
 * scheduled run; "Getting started" until the first agent is tested and scheduled; "Needs you"
 * (approvals, waiting chats, failed latest runs, agents not set up, broken schedules, each with
 * one action); agent cards with their status and next step; the last few runs in plain words;
 * and this month's results.
 */
export function HomePage() {
  const greeting = getGreetingForHour(new Date().getHours())
  const agentName = useAgentNames()
  const homeData = useHomeData()
  const { agents, agentsError, runs, runsError, runStats, triggers, areTriggersLoading, triggersError, pluginRequirements } = homeData

  const attentionItems = buildNeedsYouItems({ ...homeData, agentName })
  const nextRunLine = areTriggersLoading || triggersError ? null : describeNextRun(triggers)

  return (
    <AppShell activeNav="home" agents={{ kind: 'list' }} mainClassName="box-border flex flex-col gap-7 p-8">
      <div className="flex flex-col gap-1">
        <h1 className="m-0 text-[28px] font-semibold tracking-[-0.5px]">{greeting}</h1>
        <GreetingSubtitle needsYouCount={attentionItems ? attentionItems.length : null} nextRunLine={nextRunLine} />
      </div>
      <GettingStartedCard steps={buildGettingStartedSteps(homeData)} />
      <NeedsYouSection items={attentionItems} loadError={runsError} />
      <AgentSummaryCards agents={agents} loadError={agentsError} runs={runs} runStats={runStats} triggers={triggers} pluginRequirements={pluginRequirements} />
      <div className="flex flex-wrap gap-4">
        <RecentRunsTable runs={runs ? buildRecentRunRows(runs.slice(0, recentRunLimit), agentName) : null} loadError={runsError} />
        <MonthlyUsageCard monthlyNumbers={buildThisMonth(homeData)} loadError={runsError ?? homeData.monthlyUsageError} />
      </div>
    </AppShell>
  )
}
