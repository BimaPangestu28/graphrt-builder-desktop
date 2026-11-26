import { Fragment, useId, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { openPluginReadme, openPluginRepository } from '@/api/plugins'
import type { InstalledPlugin, PluginNodeInfo, PluginSource, PluginTosRisk } from '@/api/pluginTypes'
import { Button, Icon, StatusDot, StrokeIcon } from '@/components/ui'
import type { BrowserRuntimeState } from '@/hooks/useBrowserRuntime'
import type { PluginRuntimeState } from '@/hooks/usePluginRuntime'
import type { PluginsState } from '@/hooks/usePlugins'
import { describeError } from '@/lib/agentDisplay'
import { agentPath } from '@/routes'
import { pluginCategoryLabels } from './pluginCategories'
import { describeMaturity, describeStepCount, type PluginListItem } from './pluginDisplay'
import { buildPluginSetupSteps, PluginSetupChecklist } from './PluginSetupChecklist'
import type { PluginUser } from './usePluginUsers'
import { messages, useT, messages as currentMessages } from '@/i18n'
import { localizedRecord } from '@/i18n/localized'

/** A titled card on the plugin page; the title names the region for screen readers. */
export function DetailSection({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  const headingId = useId()
  return (
    <section aria-labelledby={headingId} className="flex min-w-0 flex-col gap-4 rounded-[14px] border border-line bg-surface p-5">
      <div className="flex flex-col gap-0.5">
        <h2 id={headingId} className="m-0 text-[15px] font-semibold tracking-[-0.1px]">
          {title}
        </h2>
        {hint && <span className="text-[12px] text-muted">{hint}</span>}
      </div>
      {children}
    </section>
  )
}

const tosRiskLabels: Readonly<Record<PluginTosRisk, string>> = localizedRecord(() => messages().plugins.tosRisk)

/** The README's terms-of-service / ban warning, in amber above everything else. */
export function PluginWarningBox({ item }: { item: PluginListItem }) {
  if (!item.warning) return null
  const showsRisk = item.tosRisk === 'medium' || item.tosRisk === 'high'
  return (
    <div role="note" aria-label={messages().plugins.warningAbout(item.displayName)} className="flex gap-3 rounded-[14px] border border-amber-line-2 bg-amber-tint px-4 py-3">
      <Icon name="alert" size={16} className="mt-px shrink-0 text-amber" />
      <div className="flex min-w-0 flex-col gap-0.5">
        <b className="text-[13px] font-semibold text-amber-deep">{showsRisk && item.tosRisk ? messages().plugins.readBeforeRisk(tosRiskLabels[item.tosRisk]) : messages().plugins.readBefore}</b>
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
          {messages().plugins.couldNotLoadPlugin(installed.displayName, installed.loadError)}
        </p>
      )}
      {installed.warnings.length > 0 && (
        <ul aria-label={messages().plugins.warningsFor(installed.displayName)} className="m-0 flex list-none flex-col gap-0.5 p-0 text-[13px] text-amber-deep">
          {installed.warnings.map((warning) => (
            <li key={warning}>{warning}</li>
          ))}
        </ul>
      )}
    </div>
  )
}

/** The node kinds (steps) the plugin adds: title and description, with the kind agents use. */
export function PluginStepsSection({ pluginLabel, nodes }: { pluginLabel: string; nodes: PluginNodeInfo[] }) {
  return (
    <DetailSection title={messages().plugins.whatItAdds} hint={nodes.length > 0 ? messages().plugins.stepsAgentsCanUse(describeStepCount(nodes.length)) : undefined}>
      {nodes.length === 0 ? (
        <p className="m-0 text-[13px] text-muted">{messages().plugins.catalogListsNoSteps}</p>
      ) : (
        <ul aria-label={messages().plugins.stepsPluginAdds(pluginLabel)} className="m-0 flex list-none flex-col overflow-hidden rounded-[10px] border border-line p-0">
          {nodes.map((node) => (
            <li key={node.kind} className="flex flex-wrap items-center gap-x-4 gap-y-1 border-b border-chip px-3.5 py-3 last:border-b-0">
              <span className="flex min-w-0 flex-[1_1_220px] flex-col gap-0.5">
                <span className="text-[13px] font-semibold text-ink">{node.title || node.kind}</span>
                {node.description && <span className="text-[12px] leading-normal text-body">{node.description}</span>}
              </span>
              <code className="max-w-full rounded-md bg-chip px-1.5 py-0.5 font-mono text-[11px] text-ink-2 [overflow-wrap:anywhere]">{node.kind}</code>
            </li>
          ))}
        </ul>
      )}
    </DetailSection>
  )
}

const asksForIconPaths: Record<'network' | 'offline' | 'secrets' | 'settings' | 'browser', ReactNode> = {
  network: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18" />
    </>
  ),
  offline: <path d="M4 12h16" />,
  secrets: (
    <>
      <circle cx="8" cy="15" r="4" />
      <path d="m11 12 9-9M17 6l3 3" />
    </>
  ),
  settings: (
    <>
      <path d="M4 7h9M17 7h3M4 17h3M11 17h9" />
      <circle cx="15" cy="7" r="2" />
      <circle cx="9" cy="17" r="2" />
    </>
  ),
  browser: (
    <>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <path d="M3 9h18" />
    </>
  ),
}

/** `A_LONG_NAME` that may only wrap after an underscore, never in the middle of a word. */
function SettingNameWithBreaks({ settingName }: { settingName: string }) {
  const parts = settingName.split('_')
  return (
    <>
      {parts.map((part, index) => (
        <Fragment key={index}>
          {part}
          {index < parts.length - 1 && (
            <>
              _<wbr />
            </>
          )}
        </Fragment>
      ))}
    </>
  )
}

function AsksForRow({ icon, children }: { icon: keyof typeof asksForIconPaths; children: ReactNode }) {
  return (
    <li className="flex items-start gap-2.5">
      <span aria-hidden="true" className="flex size-6 shrink-0 items-center justify-center rounded-md bg-chip text-ink-2">
        <StrokeIcon size={13}>{asksForIconPaths[icon]}</StrokeIcon>
      </span>
      <span className="flex min-w-0 flex-col gap-1.5 pt-0.5 text-[13px] leading-normal text-body">{children}</span>
    </li>
  )
}

/**
 * What a plugin asks for, one row each with an icon: internet, secrets, the settings it
 * reads (each name its own chip, so long names wrap whole) and the browser runtime.
 */
export function PluginAsksForSection({ item }: { item: PluginListItem }) {
  const { permissions, needsBrowser } = item
  const t = useT().plugins
  return (
    <DetailSection title={t.whatItAsksFor}>
      <ul aria-label={t.whatPluginAsksFor(item.displayName)} className="m-0 flex list-none flex-col gap-3 p-0">
        <AsksForRow icon={permissions.network ? 'network' : 'offline'}>{permissions.network ? t.connectsInternet : t.worksOffline}</AsksForRow>
        {permissions.secrets && <AsksForRow icon="secrets">{t.receivesSecrets}</AsksForRow>}
        {permissions.env.length > 0 && (
          <AsksForRow icon="settings">
            {t.readsSettings}
            <span className="flex flex-wrap gap-1">
              {permissions.env.map((settingName) => (
                <code key={settingName} className="max-w-full rounded-md bg-chip px-1.5 py-0.5 font-mono text-[11px] text-ink-2 [overflow-wrap:anywhere]">
                  <SettingNameWithBreaks settingName={settingName} />
                </code>
              ))}
            </span>
          </AsksForRow>
        )}
        {needsBrowser && <AsksForRow icon="browser">{t.needsBrowser}</AsksForRow>}
      </ul>
    </DetailSection>
  )
}

interface PluginSetupSectionProps {
  installed: InstalledPlugin
  plugins: PluginsState
  browserRuntime: BrowserRuntimeState
  pluginRuntime: PluginRuntimeState
}

/**
 * "Set up" as a numbered checklist: install (done), trust, the browser runtime when the
 * plugin needs it, the plugin's own link step (whatsapp-web: QR code), then settings.
 */
export function PluginSetupSection({ installed, plugins, browserRuntime, pluginRuntime }: PluginSetupSectionProps) {
  const steps = buildPluginSetupSteps({ installed, plugins, browserRuntime, pluginRuntime })
  const doneCount = steps.filter((step) => step.isDone).length
  return (
    <DetailSection title={messages().plugins.setUpSection} hint={messages().plugins.stepsDone(doneCount, steps.length)}>
      <PluginSetupChecklist steps={steps} />
    </DetailSection>
  )
}

function PluginUserRow({ user }: { user: PluginUser }) {
  return (
    <li className="flex items-start gap-2">
      <StatusDot tone={user.isReady ? 'ok' : 'amber'} className="mt-1.5" />
      <span className="flex min-w-0 flex-col">
        <Link to={agentPath('builder', user.agentId)} className="font-medium no-underline !text-ink hover:underline">
          {user.agentName}
        </Link>
        <span className="text-[12px] text-muted">
          {user.usedBySteps.length > 0 ? user.usedBySteps.join(', ') : messages().plugins.usesIt}
          {user.isReady ? '' : messages().plugins.notReadyYet}
        </span>
      </span>
    </li>
  )
}

/** "Used by agents": each agent's builder link with the steps that use the plugin. */
export function PluginUsersSection({ pluginLabel, users, loadError }: { pluginLabel: string; users: PluginUser[] | null; loadError: Error | null }) {
  let body: ReactNode
  if (loadError) body = <p className="m-0 text-[13px] text-muted">{currentMessages().plugins.couldNotCheckTheAgents}{' '}{describeError(loadError)}</p>
  else if (!users) body = <p className="m-0 text-[13px] text-muted">{messages().plugins.checkingAgents}</p>
  else if (users.length === 0) body = <p className="m-0 text-[13px] text-muted">{currentMessages().plugins.noAgentUses}{' '}{pluginLabel} {currentMessages().plugins.yet}</p>
  else
    body = (
      <ul aria-label={messages().plugins.agentsUsing(pluginLabel)} className="m-0 flex list-none flex-col gap-2 p-0">
        {users.map((user) => (
          <PluginUserRow key={user.agentId} user={user} />
        ))}
      </ul>
    )
  return <DetailSection title={messages().plugins.usedByAgents}>{body}</DetailSection>
}

interface ExternalLinkButtonProps {
  label: string
  /** What failed to open, e.g. "the README". */
  target: string
  openLink: () => Promise<void>
}

/** Opens a plugin link in the default browser (a plain link would stay inside the app window). */
function ExternalLinkButton({ label, target, openLink }: ExternalLinkButtonProps) {
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  async function handleOpen() {
    setErrorMessage(null)
    try {
      await openLink()
    } catch (openError) {
      setErrorMessage(messages().plugins.couldNotOpen(target, describeError(openError)))
    }
  }
  return (
    <div className="flex flex-col gap-1">
      <Button variant="secondary" size="sm" onClick={() => void handleOpen()} className="w-full">
        {label}
        <Icon name="arrowRight" size={13} />
      </Button>
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
    <div className="flex justify-between gap-3 border-b border-chip py-2 text-[13px] first:pt-0 last:border-b-0 last:pb-0">
      <dt className="text-muted">{label}</dt>
      <dd className="m-0 text-right text-ink-2">{children}</dd>
    </div>
  )
}

const sourceLabels: Readonly<Record<PluginSource, string>> = localizedRecord(() => messages().plugins.sourceLabels)

/** Category, source and publisher, versions, maturity, and the README and repository links. */
export function PluginAboutSection({ item }: { item: PluginListItem }) {
  const isLocal = item.source === 'local'
  const t = useT().plugins
  return (
    <DetailSection title={t.about}>
      <dl className="m-0 flex flex-col">
        <AboutRow label={t.category}>{pluginCategoryLabels[item.category]}</AboutRow>
        <AboutRow label={t.source}>{sourceLabels[item.source]}</AboutRow>
        {item.publisher && <AboutRow label={t.maintainedBy}>{item.publisher}</AboutRow>}
        {isLocal && item.localPath && (
          <AboutRow label={t.installedFrom}>
            <code className="font-mono text-[12px] [overflow-wrap:anywhere]">{item.localPath}</code>
          </AboutRow>
        )}
        {!isLocal && <AboutRow label={t.catalogVersion}>v{item.version}</AboutRow>}
        {item.installed && <AboutRow label={t.installedVersion}>v{item.installed.version}</AboutRow>}
        {!isLocal && <AboutRow label={t.maturity}>{describeMaturity(item.maturity) ?? (item.maturity === 'stable' ? t.stable : t.notLabelled)}</AboutRow>}
        {item.tosRisk && <AboutRow label={t.tosRiskLabel}>{tosRiskLabels[item.tosRisk]}</AboutRow>}
      </dl>
      {isLocal && <p className="m-0 text-[12px] leading-normal text-muted">{t.localNotReviewedNote}</p>}
      {item.readmeUrl && <ExternalLinkButton label={t.readReadme} target={t.theReadme} openLink={() => openPluginReadme(item.name)} />}
      {item.repositoryUrl && <ExternalLinkButton label={t.viewSource} target={t.theRepository} openLink={() => openPluginRepository(item.name)} />}
    </DetailSection>
  )
}
