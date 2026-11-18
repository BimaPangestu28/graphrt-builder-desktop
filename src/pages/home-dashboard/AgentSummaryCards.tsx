import { Link } from 'react-router-dom'
import type { AgentSummary } from '@/data/homeDashboard'
import { StatusPill } from '@/pages/agent-run/StatusPill'

function AgentSummaryCard({ agent }: { agent: AgentSummary }) {
  return (
    <Link
      to={agent.path}
      className="flex flex-col gap-3 rounded-[14px] border border-line bg-surface p-[18px] no-underline !text-ink hover:border-line-heavy"
    >
      <div className="flex items-center justify-between gap-2">
        <span className="font-semibold">{agent.name}</span>
        <StatusPill tone={agent.isActive ? 'ok' : 'neutral'} size="card">
          {agent.isActive ? 'Active' : 'Paused'}
        </StatusPill>
      </div>
      <span className="text-body">{agent.scheduleSummary}</span>
      <div className="flex gap-4 text-[13px] text-ink-2">
        {agent.stats.map((stat) => (
          <span key={stat.label}>
            {stat.count !== undefined && <b className="font-semibold">{stat.count}</b>} {stat.label}
          </span>
        ))}
      </div>
    </Link>
  )
}

/** Grid of agent cards, each linking to that agent. */
export function AgentSummaryCards({ agents }: { agents: AgentSummary[] }) {
  return (
    <section aria-labelledby="home-agents" className="flex flex-col gap-3">
      <h2 id="home-agents" className="m-0 text-[16px] font-semibold">
        Agents
      </h2>
      <div className="grid grid-cols-[repeat(auto-fill,minmax(280px,1fr))] gap-3">
        {agents.map((agent) => (
          <AgentSummaryCard key={agent.id} agent={agent} />
        ))}
      </div>
    </section>
  )
}
