import { Link, useLocation } from 'react-router-dom'
import { Icon, LogoLockup, StatusDot, joinClassNames } from '@/components/ui'
import { isDesktopApp } from '@/api/client'
import type { Agent } from '@/api/types'
import { useAgents } from '@/hooks/useAgents'
import { useConversationCounts } from '@/hooks/useConversations'
import { useRunnerStatus, type RunnerStatusFacts } from '@/hooks/useRunnerStatus'
import { getKindLabel, getProviderName, getStatusDotTone } from '@/lib/agentDisplay'
import { agentPath, routePaths } from '@/routes'

export type MainNavKey = 'home' | 'inbox' | 'runs' | 'schedule' | 'knowledge' | 'plugins' | 'connections' | 'settings'

/**
 * What the "Agents" section of the sidebar shows:
 * - empty: before the first agent exists (02)
 * - draft: one highlighted agent being built or tested (03 to 08)
 * - list: all agents, optionally with one marked current (09 onward)
 */
export type SidebarAgentsState =
  | { kind: 'empty' }
  | { kind: 'draft'; name: string; status: string; statusTone?: 'brand' | 'amber' | 'danger'; agentId?: string }
  | { kind: 'list'; activeAgentId?: string }

export interface SidebarProps {
  activeNav?: MainNavKey
  agents?: SidebarAgentsState
  /**
   * Second line of the runner card in the browser preview, e.g. "Online · OpenAI connected".
   * Ignored in the desktop app, where the line comes from the default model and the schedules.
   */
  runnerStatus?: string
  /** Shown next to Inbox until the live number of chats waiting for you has loaded. */
  inboxCount?: number
}

const primaryNavItems: Array<{ key: MainNavKey; label: string; path: string }> = [
  { key: 'home', label: 'Home', path: routePaths.home },
  { key: 'inbox', label: 'Inbox', path: routePaths.inbox },
  { key: 'runs', label: 'Runs', path: routePaths.runs },
  { key: 'schedule', label: 'Schedule', path: routePaths.scheduler },
  { key: 'knowledge', label: 'Knowledge', path: routePaths.knowledge },
  { key: 'plugins', label: 'Plugins', path: routePaths.plugins },
]

const navLinkBase = 'flex items-center justify-between rounded-lg px-2.5 py-2 no-underline'

function navLinkClassNames(isActive: boolean) {
  return joinClassNames(navLinkBase, isActive ? 'bg-selected font-semibold !text-ink' : 'font-medium !text-ink-2 hover:bg-selected/60')
}

function SidebarAgentLink({ agent, isActive }: { agent: Agent; isActive: boolean }) {
  const kindLabel = getKindLabel(agent.kind)
  return (
    <Link
      to={agentPath('builder', agent.id)}
      aria-current={isActive ? 'page' : undefined}
      className={joinClassNames('flex items-center gap-2 rounded-lg px-2.5 py-2 no-underline !text-ink', isActive ? 'bg-selected font-semibold' : 'hover:bg-selected/60')}
    >
      <StatusDot tone={getStatusDotTone(agent.status)} />
      <span className="min-w-0 truncate">{agent.name}</span>
      {kindLabel && <span className="ml-auto text-[11px] font-normal text-muted">{kindLabel}</span>}
    </Link>
  )
}

/** Every agent from the backend; quiet text while loading or when the list cannot be read. */
function SidebarAgentList({ activeAgentId }: { activeAgentId?: string }) {
  const { data: agents, error } = useAgents()
  if (error) return <span className="px-2.5 py-2 leading-normal text-muted">Could not load agents</span>
  if (!agents) return <span className="px-2.5 py-2 text-muted">Loading agents…</span>
  if (agents.length === 0) return <span className="px-2.5 py-2 leading-normal text-muted">No agents yet. Your first one will show up here</span>
  return (
    <>
      {agents.map((agent) => (
        <SidebarAgentLink key={agent.id} agent={agent} isActive={agent.id === activeAgentId} />
      ))}
    </>
  )
}

const sidebarStatusToneClassNames: Record<'brand' | 'amber' | 'danger', string> = {
  brand: 'text-brand-strong',
  amber: 'font-medium text-amber-strong',
  danger: 'font-medium text-danger',
}

function SidebarAgentsSection({ agents }: { agents: SidebarAgentsState }) {
  if (agents.kind === 'empty') {
    return <span className="px-2.5 py-2 leading-normal text-muted">No agents yet. Your first one will show up here</span>
  }
  if (agents.kind === 'draft') {
    return (
      <Link to={agents.agentId ? agentPath('builder', agents.agentId) : routePaths.home} className="flex flex-col gap-0.5 rounded-[10px] bg-brand-soft px-3 py-2.5 no-underline !text-ink">
        <span className="font-semibold">{agents.name}</span>
        <span className={joinClassNames('text-[12px]', sidebarStatusToneClassNames[agents.statusTone ?? 'brand'])}>{agents.status}</span>
      </Link>
    )
  }
  return <SidebarAgentList activeAgentId={agents.activeAgentId} />
}

/**
 * "DeepSeek connected · 2 agents scheduled". The scheduled part is left out when nothing is scheduled.
 *
 * @param facts - Default model and scheduled agent count (RunnerStatusFacts)
 * @returns The line, or null when no model is connected (string | null)
 */
export function describeConnectedRunner(facts: RunnerStatusFacts): string | null {
  if (!facts.defaultModel) return null
  const providerLine = `${getProviderName(facts.defaultModel.provider)} connected`
  if (facts.scheduledAgentCount === 0) return providerLine
  const agentWord = facts.scheduledAgentCount === 1 ? 'agent' : 'agents'
  return `${providerLine} · ${facts.scheduledAgentCount} ${agentWord} scheduled`
}

/** Runner card line in the desktop app, from the real default model and enabled schedules. */
function DesktopRunnerStatusLine() {
  const location = useLocation()
  const { data: facts, error } = useRunnerStatus(location.pathname)
  if (!facts) return <span className="text-[12px] text-muted">{error ? 'Could not check the runner' : 'Checking…'}</span>
  const connectedLine = describeConnectedRunner(facts)
  if (connectedLine) return <span className="text-[12px] text-muted">{connectedLine}</span>
  return (
    <span className="text-[12px] text-muted">
      No model connected ·{' '}
      <Link to={routePaths.connections} className="font-medium">
        Add one
      </Link>
    </span>
  )
}

/** Left navigation shared by every in-app screen. The Inbox badge is the live number of chats waiting for you. */
export function Sidebar({ activeNav, agents = { kind: 'list' }, runnerStatus = 'Online · 2 agents scheduled', inboxCount = 0 }: SidebarProps) {
  const { data: conversationCounts } = useConversationCounts()
  const waitingCount = conversationCounts?.waitingForYou ?? inboxCount
  return (
    <nav aria-label="Main" className="box-border flex max-w-full flex-[1_1_232px] flex-col gap-[18px] px-3.5 py-5 md:sticky md:top-0 md:max-h-screen md:max-w-[232px] md:overflow-y-auto">
      <Link to={routePaths.home} className="px-1.5 no-underline" aria-label="graphrt home">
        <LogoLockup />
      </Link>
      <Link to={routePaths.newAgent} className="flex h-10 items-center justify-center gap-2 rounded-[10px] bg-ink font-medium no-underline !text-white hover:bg-ink-2">
        <Icon name="plus" size={16} />
        New agent
      </Link>
      <div className="flex flex-col gap-0.5">
        {primaryNavItems.map((item) => (
          <Link key={item.key} to={item.path} aria-current={activeNav === item.key ? 'page' : undefined} className={navLinkClassNames(activeNav === item.key)}>
            {item.label}
            {item.key === 'inbox' && waitingCount > 0 && (
              <span className="box-border flex h-5 min-w-5 items-center justify-center rounded-full bg-amber-soft px-1.5 text-[11px] font-semibold text-amber-strong">
                {waitingCount}
              </span>
            )}
          </Link>
        ))}
      </div>
      <div className="flex flex-col gap-0.5">
        <span className="px-2.5 pb-1 text-[12px] font-medium text-muted">Agents</span>
        <SidebarAgentsSection agents={agents} />
      </div>
      <div className="mt-auto flex flex-col gap-2.5">
        <div className="flex flex-col gap-1 rounded-[10px] border border-line bg-surface p-3">
          <span className="flex items-center gap-2 font-medium">
            <StatusDot tone="ok" />
            Runner on this computer
          </span>
          {isDesktopApp() ? <DesktopRunnerStatusLine /> : <span className="text-[12px] text-muted">{runnerStatus}</span>}
        </div>
        <Link to={routePaths.connections} aria-current={activeNav === 'connections' ? 'page' : undefined} className={navLinkClassNames(activeNav === 'connections')}>
          Connections
        </Link>
        <Link to={routePaths.settings} aria-current={activeNav === 'settings' ? 'page' : undefined} className={navLinkClassNames(activeNav === 'settings')}>
          Settings
        </Link>
      </div>
    </nav>
  )
}
