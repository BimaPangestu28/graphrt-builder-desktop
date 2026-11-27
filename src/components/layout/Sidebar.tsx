import { Link, useLocation } from 'react-router-dom'
import { Icon, LogoLockup, StatusDot, joinClassNames, type IconName } from '@/components/ui'
import { isDesktopApp } from '@/api/client'
import type { Agent } from '@/api/types'
import { useAgents } from '@/hooks/useAgents'
import { useConversationCounts } from '@/hooks/useConversations'
import { usePluginUpdateData } from '@/hooks/usePluginUpdates'
import { useRunnerStatus, type RunnerStatusFacts } from '@/hooks/useRunnerStatus'
import { getKindLabel, getProviderName, getStatusDotTone } from '@/lib/agentDisplay'
import { agentOpenPath, agentPath, connectionsTabPath, routePaths } from '@/routes'
import { messages, useT } from '@/i18n'

export type MainNavKey = 'home' | 'inbox' | 'runs' | 'schedule' | 'knowledge' | 'skills' | 'plugins' | 'connections' | 'settings'

/**
 * What the "Agents" section of the sidebar shows:
 * - empty: no agents to list (the sidebar's own tests)
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

const primaryNavItems: Array<{ key: 'home' | 'inbox' | 'runs' | 'schedule' | 'knowledge' | 'skills' | 'plugins'; path: string; icon: IconName }> = [
  { key: 'home', path: routePaths.home, icon: 'home' },
  { key: 'inbox', path: routePaths.inbox, icon: 'inbox' },
  { key: 'runs', path: routePaths.runs, icon: 'activity' },
  { key: 'schedule', path: routePaths.scheduler, icon: 'calendar' },
  { key: 'knowledge', path: routePaths.knowledge, icon: 'book' },
  { key: 'plugins', path: routePaths.plugins, icon: 'puzzle' },
  { key: 'skills', path: routePaths.skills, icon: 'lightbulb' },
]

const navLinkBase = 'group flex items-center justify-between gap-2 rounded-lg px-2.5 py-2 no-underline'

function navLinkClassNames(isActive: boolean) {
  return joinClassNames(navLinkBase, isActive ? 'bg-selected font-semibold !text-ink' : 'font-medium !text-ink-2 hover:bg-selected/60')
}

/**
 * Icon and label of a sidebar item. The icon is decorative (the label names the link); it is
 * muted until the item is hovered or current.
 */
function NavLabel({ icon, label, isActive }: { icon: IconName; label: string; isActive: boolean }) {
  return (
    <span className="flex min-w-0 items-center gap-2.5">
      <Icon name={icon} size={18} strokeWidth={1.75} className={joinClassNames('shrink-0', isActive ? 'text-ink' : 'text-muted group-hover:text-ink-2')} />
      <span className="truncate">{label}</span>
    </span>
  )
}

function SidebarAgentLink({ agent, isActive }: { agent: Agent; isActive: boolean }) {
  const kindLabel = getKindLabel(agent.kind)
  return (
    <Link
      to={agentOpenPath(agent.id, agent.kind)}
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
  const t = useT().shell.nav
  const { data: agents, error } = useAgents()
  if (error) return <span className="px-2.5 py-2 leading-normal text-muted">{t.couldNotLoadAgents}</span>
  if (!agents) return <span className="px-2.5 py-2 text-muted">{t.loadingAgents}</span>
  if (agents.length === 0) return <span className="px-2.5 py-2 leading-normal text-muted">{t.noAgentsYet}</span>
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
  const t = useT().shell.nav
  if (agents.kind === 'empty') {
    return <span className="px-2.5 py-2 leading-normal text-muted">{t.noAgentsYet}</span>
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
  const t = messages().shell.nav
  const providerLine = t.providerConnected(getProviderName(facts.defaultModel.provider))
  if (facts.scheduledAgentCount === 0) return providerLine
  return `${providerLine} · ${t.agentsScheduled(facts.scheduledAgentCount)}`
}

/** Runner card line in the desktop app, from the real default model and enabled schedules. */
function DesktopRunnerStatusLine() {
  const t = useT().shell.nav
  const location = useLocation()
  const { data: facts, error } = useRunnerStatus(location.pathname)
  if (!facts) return <span className="text-[12px] text-muted">{error ? t.couldNotCheckRunner : t.checking}</span>
  const connectedLine = describeConnectedRunner(facts)
  if (connectedLine) return <span className="text-[12px] text-muted">{connectedLine}</span>
  return (
    <span className="text-[12px] text-muted">
      {t.noModelConnected}{' '}
      <Link to={connectionsTabPath('models')} className="font-medium">
        {t.addOne}
      </Link>
    </span>
  )
}

/**
 * Number of plugin updates waiting, next to Plugins. Hidden from the link's accessible name
 * (it stays "Plugins") and described by its title instead.
 */
function PluginUpdateBadge() {
  const t = useT().shell.nav
  const { data: pluginUpdates } = usePluginUpdateData()
  const updateCount = pluginUpdates?.pendingUpdates.length ?? 0
  if (updateCount === 0) return null
  const description = t.pluginUpdatesAvailable(updateCount)
  return (
    <span
      aria-hidden="true"
      title={description}
      data-testid="plugin-update-badge"
      className="box-border flex h-5 min-w-5 items-center justify-center rounded-full bg-brand-soft px-1.5 text-[11px] font-semibold text-brand-strong"
    >
      {updateCount}
    </span>
  )
}

/** Left navigation shared by every in-app screen. The Inbox badge is the live number of chats waiting for you. */
export function Sidebar({ activeNav, agents = { kind: 'list' }, runnerStatus, inboxCount = 0 }: SidebarProps) {
  const t = useT().shell.nav
  const { data: conversationCounts } = useConversationCounts()
  const waitingCount = conversationCounts?.waitingForYou ?? inboxCount
  return (
    <nav aria-label={t.main} className="box-border flex max-w-full flex-[1_1_232px] flex-col gap-[18px] px-3.5 py-5 md:sticky md:top-0 md:max-h-screen md:max-w-[232px] md:overflow-y-auto">
      <Link to={routePaths.home} className="px-1.5 no-underline" aria-label={t.logoHome}>
        <LogoLockup />
      </Link>
      <Link to={routePaths.newAgent} className="flex h-10 items-center justify-center gap-2 rounded-[10px] bg-ink font-medium no-underline !text-inverse hover:bg-ink-2">
        <Icon name="plus" size={16} />
        {t.newAgent}
      </Link>
      <div className="flex flex-col gap-0.5">
        {primaryNavItems.map((item) => (
          <Link key={item.key} to={item.path} aria-current={activeNav === item.key ? 'page' : undefined} className={navLinkClassNames(activeNav === item.key)}>
            <NavLabel icon={item.icon} label={t[item.key]} isActive={activeNav === item.key} />
            {item.key === 'plugins' && <PluginUpdateBadge />}
            {item.key === 'inbox' && waitingCount > 0 && (
              <span className="box-border flex h-5 min-w-5 items-center justify-center rounded-full bg-amber-soft px-1.5 text-[11px] font-semibold text-amber-strong">
                {waitingCount}
              </span>
            )}
          </Link>
        ))}
      </div>
      <div className="flex flex-col gap-0.5">
        <span className="px-2.5 pb-1 text-[12px] font-medium text-muted">{t.agents}</span>
        <SidebarAgentsSection agents={agents} />
      </div>
      <div className="mt-auto flex flex-col gap-2.5">
        <div className="flex flex-col gap-1 rounded-[10px] border border-line bg-surface p-3">
          <span className="flex items-center gap-2 font-medium">
            <StatusDot tone="ok" />
            {t.runnerOnThisComputer}
          </span>
          {isDesktopApp() ? <DesktopRunnerStatusLine /> : <span className="text-[12px] text-muted">{runnerStatus ?? t.previewRunnerStatus}</span>}
        </div>
        <Link to={connectionsTabPath('models')} aria-current={activeNav === 'connections' ? 'page' : undefined} className={navLinkClassNames(activeNav === 'connections')}>
          <NavLabel icon="plug" label={t.connections} isActive={activeNav === 'connections'} />
        </Link>
        <Link to={routePaths.settings} aria-current={activeNav === 'settings' ? 'page' : undefined} className={navLinkClassNames(activeNav === 'settings')}>
          <NavLabel icon="settings" label={t.settings} isActive={activeNav === 'settings'} />
        </Link>
      </div>
    </nav>
  )
}
