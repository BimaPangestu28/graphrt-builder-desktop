import { useId, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { openPluginReadme } from '@/api/plugins'
import type { InstalledPlugin, PluginNodeInfo, PluginTosRisk } from '@/api/pluginTypes'
import { Icon, StatusDot } from '@/components/ui'
import type { BrowserRuntimeState } from '@/hooks/useBrowserRuntime'
import type { PluginsState } from '@/hooks/usePlugins'
import { describeError } from '@/lib/agentDisplay'
import { agentPath } from '@/routes'
import { BrowserRuntimeCard } from './BrowserRuntimeCard'
import { pluginCategoryLabels } from './pluginCategories'
import { describeMaturity, describeStepCount, type PluginListItem } from './pluginDisplay'
import { PluginPermissionList } from './PluginPermissionList'
import { PluginSettings } from './PluginSettings'
import { PluginTrustToggle } from './PluginTrustToggle'
import type { PluginUser } from './usePluginUsers'
import { WhatsAppWebLinkSection } from './WhatsAppWebLinkSection'

/** A titled card on the plugin page; the title names the region for screen readers. */
export function DetailSection({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  const headingId = useId()
  return (
    <section aria-labelledby={headingId} className="flex min-w-0 flex-col gap-3 rounded-[14px] border border-line bg-surface p-4">
      <div className="flex flex-col gap-0.5">
        <h2 id={headingId} className="m-0 text-[14px] font-semibold">
          {title}
        </h2>
        {hint && <span className="text-[12px] text-muted">{hint}</span>}
      </div>
      {children}
    </section>
  )
}

const tosRiskLabels: Record<PluginTosRisk, string> = { none: 'None', low: 'Low', medium: 'Medium', high: 'High' }

/** The README's terms-of-service / ban warning, in amber above everything else. */
export function PluginWarningBox({ item }: { item: PluginListItem }) {
  if (!item.warning) return null
  const showsRisk = item.tosRisk === 'medium' || item.tosRisk === 'high'
  return (
    <div role="note" aria-label={`Warning about ${item.displayName}`} className="flex gap-3 rounded-xl border border-amber-line-2 bg-amber-tint px-4 py-3">
      <Icon name="alert" size={18} className="mt-0.5 shrink-0 text-amber" />
      <div className="flex flex-col gap-1">
        <b className="font-semibold text-amber-deep">{showsRisk && item.tosRisk ? `Read before using · ${tosRiskLabels[item.tosRisk]} terms-of-service risk` : 'Read before using'}</b>
        <p className="m-0 text-[13px] leading-normal text-amber-deep">{item.warning}</p>
      </div>
    </div>
  )
}

/** Why an installed plugin could not load, and graphrt's notes about it. */
export function PluginLoadNotes({ installed }: { installed: InstalledPlugin }) {
  if (!installed.loadError && installed.warnings.length === 0) return null
  return (
    <div className="flex flex-col gap-1">
      {installed.loadError && (
        <p role="alert" className="m-0 rounded-xl border border-danger-line bg-danger-tint px-4 py-3 text-[13px] text-danger">
          Could not load {installed.displayName}: {installed.loadError}
        </p>
      )}
      {installed.warnings.length > 0 && (
        <ul aria-label={`Warnings for ${installed.displayName}`} className="m-0 flex list-none flex-col gap-0.5 p-0 text-[13px] text-amber-deep">
          {installed.warnings.map((warning) => (
            <li key={warning}>{warning}</li>
          ))}
        </ul>
      )}
    </div>
  )
}

/** The node kinds (steps) the plugin adds, each with its description. */
export function PluginStepsSection({ pluginLabel, nodes }: { pluginLabel: string; nodes: PluginNodeInfo[] }) {
  return (
    <DetailSection title="What it adds" hint={nodes.length > 0 ? `${describeStepCount(nodes.length)} your agents can use` : undefined}>
      {nodes.length === 0 ? (
        <p className="m-0 text-[13px] text-muted">The catalog does not list its steps</p>
      ) : (
        <ul aria-label={`Steps ${pluginLabel} adds`} className="m-0 grid list-none grid-cols-1 gap-2 p-0 @xl:grid-cols-2">
          {nodes.map((node) => (
            <li key={node.kind} className="flex flex-col gap-0.5 rounded-lg border border-line bg-subtle px-3 py-2">
              <span className="text-[13px] font-medium text-ink">{node.title || node.kind}</span>
              {node.description && <span className="text-[12px] leading-normal text-body">{node.description}</span>}
              <code className="text-[11px] text-muted">{node.kind}</code>
            </li>
          ))}
        </ul>
      )}
    </DetailSection>
  )
}

/** Plain-language permissions plus the names of the settings it reads. */
export function PluginAsksForSection({ item }: { item: PluginListItem }) {
  return (
    <DetailSection title="What it asks for">
      <PluginPermissionList pluginLabel={item.displayName} permissions={item.permissions} needsBrowser={item.needsBrowser} />
    </DetailSection>
  )
}

interface PluginSetupSectionProps {
  installed: InstalledPlugin
  plugins: PluginsState
  browserRuntime: BrowserRuntimeState
}

/**
 * What a person does after installing, top to bottom: trust, the browser runtime when the
 * plugin needs it, the plugin's own panel (whatsapp-web: link by QR code), then settings
 * with required ones first and optional ones folded.
 */
export function PluginSetupSection({ installed, plugins, browserRuntime }: PluginSetupSectionProps) {
  return (
    <DetailSection title="Set up" hint="Trust it, then fill in what it needs">
      <PluginTrustToggle
        pluginLabel={installed.displayName}
        isTrusted={installed.trusted}
        isSaving={plugins.operationByName[installed.name] === 'trusting'}
        onChange={(trusted) => void plugins.setTrusted(installed.name, trusted)}
      />
      {installed.needsBrowser && <BrowserRuntimeCard runtime={browserRuntime} />}
      <WhatsAppWebLinkSection installed={installed} isBrowserReady={browserRuntime.status === 'installed'} />
      {installed.config.length > 0 && (
        <div className="flex flex-col gap-2">
          <span className="text-[11px] font-semibold tracking-wide text-muted uppercase">Settings</span>
          <PluginSettings installed={installed} plugins={plugins} />
        </div>
      )}
    </DetailSection>
  )
}

function PluginUserRow({ user }: { user: PluginUser }) {
  return (
    <li className="flex items-start gap-2">
      <StatusDot tone={user.isReady ? 'ok' : 'amber'} className="mt-1.5" />
      <span className="flex min-w-0 flex-col">
        <Link to={agentPath('builder', user.agentId)} className="font-medium">
          {user.agentName}
        </Link>
        <span className="text-[12px] text-muted">
          {user.usedBySteps.length > 0 ? user.usedBySteps.join(', ') : 'Uses it'}
          {user.isReady ? '' : ' · not ready yet'}
        </span>
      </span>
    </li>
  )
}

/** "Used by agents": each agent's builder link with the steps that use the plugin. */
export function PluginUsersSection({ pluginLabel, users, loadError }: { pluginLabel: string; users: PluginUser[] | null; loadError: Error | null }) {
  let body: ReactNode
  if (loadError) body = <p className="m-0 text-[13px] text-muted">Could not check the agents: {describeError(loadError)}</p>
  else if (!users) body = <p className="m-0 text-[13px] text-muted">Checking your agents…</p>
  else if (users.length === 0) body = <p className="m-0 text-[13px] text-muted">No agent uses {pluginLabel} yet</p>
  else
    body = (
      <ul aria-label={`Agents using ${pluginLabel}`} className="m-0 flex list-none flex-col gap-2 p-0">
        {users.map((user) => (
          <PluginUserRow key={user.agentId} user={user} />
        ))}
      </ul>
    )
  return <DetailSection title="Used by agents">{body}</DetailSection>
}

/** Opens the README in the default browser (a plain link would stay inside the app window). */
function ReadmeButton({ pluginName }: { pluginName: string }) {
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  async function openReadme() {
    setErrorMessage(null)
    try {
      await openPluginReadme(pluginName)
    } catch (openError) {
      setErrorMessage(`Could not open the README: ${describeError(openError)}`)
    }
  }
  return (
    <div className="flex flex-col gap-1">
      <button type="button" onClick={() => void openReadme()} className="inline-flex cursor-pointer items-center gap-1 self-start border-0 bg-transparent p-0 text-[13px] font-medium text-brand hover:underline">
        Read the README
        <Icon name="arrowRight" size={13} />
      </button>
      {errorMessage && (
        <p role="alert" className="m-0 text-[12px] text-danger">
          {errorMessage}
        </p>
      )}
    </div>
  )
}

function AboutRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex justify-between gap-3 text-[13px]">
      <dt className="text-muted">{label}</dt>
      <dd className="m-0 text-right text-ink-2">{children}</dd>
    </div>
  )
}

/** Category, versions, maturity and the README link. */
export function PluginAboutSection({ item }: { item: PluginListItem }) {
  return (
    <DetailSection title="About">
      <dl className="m-0 flex flex-col gap-1.5">
        <AboutRow label="Category">{pluginCategoryLabels[item.category]}</AboutRow>
        <AboutRow label="Catalog version">v{item.version}</AboutRow>
        {item.installed && <AboutRow label="Installed">v{item.installed.version}</AboutRow>}
        <AboutRow label="Maturity">{describeMaturity(item.maturity) ?? (item.maturity === 'stable' ? 'Stable' : 'Not labelled')}</AboutRow>
        {item.tosRisk && <AboutRow label="Terms-of-service risk">{tosRiskLabels[item.tosRisk]}</AboutRow>}
      </dl>
      {item.readmeUrl && <ReadmeButton pluginName={item.name} />}
    </DetailSection>
  )
}
