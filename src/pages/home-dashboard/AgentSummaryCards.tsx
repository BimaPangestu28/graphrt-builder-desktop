import { useState } from 'react'
import { Link } from 'react-router-dom'
import type { PluginRequirement } from '@/api/pluginRequirementTypes'
import type { AgentRunStats } from '@/api/runSummaryTypes'
import type { Agent, Run, Trigger } from '@/api/types'
import { LinkButton, StatusDot } from '@/components/ui'
import { getKindLabel } from '@/lib/agentDisplay'
import { StatusPill } from '@/pages/agent-run/StatusPill'
import { agentPath, pluginDetailPath, routePaths } from '@/routes'
import { describeAgentCardState, type AgentCardAction } from './agentCardState'
import { HomeSectionHeader } from './HomeSectionHeader'
import { describeAgentSchedule } from './homeSummaryLines'
import { describeAgentRunStats } from './homeViewModel'
import { describePluginGap } from './needsYou'
import { DeleteConfirmation, RenameForm } from '@/pages/agent-builder/AgentIdentityHeader'
import { AgentCardMenu } from './AgentCardMenu'
import { RunNowButton } from './RunNowButton'

interface AgentCardData {
  agent: Agent
  agentTriggers: Trigger[]
  latestRun: Run | undefined
  runStats: AgentRunStats | undefined
  /** Undefined while unknown. */
  pluginRequirements: PluginRequirement[] | undefined
}

/** "Chatbot · Weekdays 09:00 · 12 messages sent this week": kind, schedule and this week. */
function describeFacts({ agent, agentTriggers, runStats }: AgentCardData): string[] {
  const statsLine = describeAgentRunStats(runStats)
    .map((stat) => (stat.count === undefined ? stat.label : `${stat.count} ${stat.label}`))
    .slice(0, 1)
  return [getKindLabel(agent.kind), describeAgentSchedule(agentTriggers), ...statsLine].filter((fact): fact is string => Boolean(fact))
}

/** One chip per plugin the agent uses, each opening that plugin's page. */
function PluginChips({ requirements }: { requirements: PluginRequirement[] }) {
  if (requirements.length === 0) return null
  return (
    <ul aria-label="Plugins" className="m-0 flex list-none flex-wrap gap-1.5 p-0">
      {requirements.map((requirement) => (
        <li key={requirement.name}>
          <Link
            to={pluginDetailPath(requirement.name)}
            title={requirement.ready ? `${requirement.displayName} is ready` : describePluginGap(requirement)}
            className="flex items-center gap-1.5 rounded-full bg-canvas px-2 py-0.5 text-[12px] no-underline !text-ink-2 hover:bg-selected"
          >
            <StatusDot tone={requirement.ready ? 'ok' : 'amber'} />
            {requirement.displayName}
            <span className="sr-only">{requirement.ready ? ' (ready)' : ' (not ready)'}</span>
          </Link>
        </li>
      ))}
    </ul>
  )
}

function PrimaryAction({ action, agentId, agentTriggers }: { action: AgentCardAction; agentId: string; agentTriggers: Trigger[] }) {
  if (action.kind === 'run_now') return <RunNowButton agentId={agentId} agentTriggers={agentTriggers} label={action.label} />
  return (
    <LinkButton to={action.path} size="sm" className="!text-white">
      {action.label}
    </LinkButton>
  )
}

function AgentSummaryCard(cardData: AgentCardData) {
  const { agent, agentTriggers, latestRun, pluginRequirements } = cardData
  const cardState = describeAgentCardState(agent, agentTriggers, latestRun)
  const facts = describeFacts(cardData)
  const [cardMode, setCardMode] = useState<'view' | 'rename' | 'delete'>('view')
  return (
    <article aria-label={agent.name} className="flex flex-col gap-3 rounded-[14px] border border-line bg-surface p-[18px]">
      {cardMode === 'rename' ? (
        // The agent list reloads after a rename (notifyAgentsChanged), so nothing else to refresh here.
        <RenameForm agent={agent} variant="card" onDone={() => setCardMode('view')} onRenamed={() => undefined} />
      ) : (
        // The name gets the full width on one line (full name on hover); the status chip sits on its own row under it.
        <div className="flex flex-col items-start gap-1.5">
          <div className="flex w-full items-center justify-between gap-2">
            <Link to={agentPath('builder', agent.id)} title={agent.name} className="min-w-0 truncate font-semibold !text-ink no-underline hover:underline">
              {agent.name}
            </Link>
            <AgentCardMenu agent={agent} onRename={() => setCardMode('rename')} onDelete={() => setCardMode('delete')} />
          </div>
          <StatusPill tone={cardState.chipTone} size="card">
            {cardState.chipLabel}
          </StatusPill>
        </div>
      )}
      {cardMode === 'delete' && (
        // The card disappears once the agent list reloads after deleting.
        <DeleteConfirmation agent={agent} onCancel={() => setCardMode('view')} onDeleted={() => setCardMode('view')} />
      )}
      {agent.description && (
        <p title={agent.description} className="m-0 line-clamp-2 text-body">
          {agent.description}
        </p>
      )}
      {facts.length > 0 && <span className="text-[13px] text-ink-2">{facts.join(' · ')}</span>}
      {pluginRequirements && <PluginChips requirements={pluginRequirements} />}
      <div className="mt-auto flex flex-wrap items-center gap-x-4 gap-y-2 pt-1">
        <PrimaryAction action={cardState.primaryAction} agentId={agent.id} agentTriggers={agentTriggers} />
        {cardState.secondaryLinks.map((link) => (
          <Link key={link.label} to={link.path} className="text-[13px] font-medium">
            {link.label}
          </Link>
        ))}
      </div>
    </article>
  )
}

interface AgentSummaryCardsProps {
  agents: Agent[] | null
  loadError: Error | null
  /** Runs newest first, for each agent's latest run; null while loading. */
  runs: Run[] | null
  /** Weekly run stats per agent from `listAgentRunStats`; null while loading or when unavailable. */
  runStats: AgentRunStats[] | null
  /** Every trigger, for schedules; empty while loading or when unavailable. */
  triggers: Trigger[]
  /** Agent id → plugin requirements. */
  pluginRequirements: Map<string, PluginRequirement[]>
}

function AgentCardsBody({ agents, loadError, runs, runStats, triggers, pluginRequirements }: AgentSummaryCardsProps) {
  if (loadError) return <p className="m-0 text-muted">Could not load your agents: {loadError.message}</p>
  if (!agents) return <p className="m-0 text-muted">Loading agents…</p>
  if (agents.length === 0) {
    return (
      <p className="m-0 text-muted">
        No agents yet. <Link to={routePaths.newAgent}>Build one with New agent</Link>
      </p>
    )
  }
  return (
    <div className="grid grid-cols-[repeat(auto-fill,minmax(280px,1fr))] gap-3">
      {agents.map((agent) => (
        <AgentSummaryCard
          key={agent.id}
          agent={agent}
          agentTriggers={triggers.filter((trigger) => trigger.agentId === agent.id)}
          latestRun={runs?.find((run) => run.agentId === agent.id)}
          runStats={runStats?.find((stats) => stats.agentId === agent.id)}
          pluginRequirements={pluginRequirements.get(agent.id)}
        />
      ))}
    </div>
  )
}

/**
 * Agent cards: a status chip that says where each agent stands, its one next step (test it,
 * see what went wrong, schedule it, run now), links to its steps and runs, its description
 * and the plugins it uses (ready or not).
 */
export function AgentSummaryCards(props: AgentSummaryCardsProps) {
  return (
    <section aria-labelledby="home-agents" className="flex flex-col gap-3">
      <HomeSectionHeader headingId="home-agents" heading="Agents" />
      <AgentCardsBody {...props} />
    </section>
  )
}
