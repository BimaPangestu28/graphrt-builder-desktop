import { Link } from 'react-router-dom'
import type { Agent } from '@/api/types'
import { agentActivityById, type AgentSummaryStat } from '@/data/homeDashboard'
import { getKindLabel, getStatusLabel } from '@/lib/agentDisplay'
import { StatusPill } from '@/pages/agent-run/StatusPill'
import { agentPath } from '@/routes'

/** What one Home card shows for an agent. */
interface AgentCardContent {
  subtitle: string
  stats: AgentSummaryStat[]
}

/**
 * Card content for an agent: its schedule and run stats when known (mock until runs and
 * triggers are wired to Home), otherwise its kind and description.
 */
function describeAgentCard(agent: Agent): AgentCardContent {
  const activity = agentActivityById[agent.id]
  if (activity) return { subtitle: activity.scheduleSummary, stats: activity.stats }
  const kindLabel = getKindLabel(agent.kind)
  return { subtitle: kindLabel ? `${kindLabel} · ${agent.description}` : agent.description, stats: [] }
}

function AgentSummaryCard({ agent }: { agent: Agent }) {
  const { subtitle, stats } = describeAgentCard(agent)
  return (
    <Link
      to={agentPath('builder', agent.id)}
      className="flex flex-col gap-3 rounded-[14px] border border-line bg-surface p-[18px] no-underline !text-ink hover:border-line-heavy"
    >
      <div className="flex items-center justify-between gap-2">
        <span className="font-semibold">{agent.name}</span>
        <StatusPill tone={agent.status === 'active' ? 'ok' : 'neutral'} size="card">
          {getStatusLabel(agent.status)}
        </StatusPill>
      </div>
      <span className="line-clamp-2 text-body">{subtitle}</span>
      {stats.length > 0 && (
        <div className="flex gap-4 text-[13px] text-ink-2">
          {stats.map((stat) => (
            <span key={stat.label}>
              {stat.count !== undefined && <b className="font-semibold">{stat.count}</b>} {stat.label}
            </span>
          ))}
        </div>
      )}
    </Link>
  )
}

interface AgentSummaryCardsProps {
  agents: Agent[] | null
  loadError: Error | null
}

function AgentCardsBody({ agents, loadError }: AgentSummaryCardsProps) {
  if (loadError) return <p className="m-0 text-muted">Could not load your agents: {loadError.message}</p>
  if (!agents) return <p className="m-0 text-muted">Loading agents…</p>
  if (agents.length === 0) return <p className="m-0 text-muted">No agents yet. Build one with New agent</p>
  return (
    <div className="grid grid-cols-[repeat(auto-fill,minmax(280px,1fr))] gap-3">
      {agents.map((agent) => (
        <AgentSummaryCard key={agent.id} agent={agent} />
      ))}
    </div>
  )
}

/** Grid of agent cards (from `listAgents`), each linking to that agent's builder. */
export function AgentSummaryCards({ agents, loadError }: AgentSummaryCardsProps) {
  return (
    <section aria-labelledby="home-agents" className="flex flex-col gap-3">
      <h2 id="home-agents" className="m-0 text-[16px] font-semibold">
        Agents
      </h2>
      <AgentCardsBody agents={agents} loadError={loadError} />
    </section>
  )
}
