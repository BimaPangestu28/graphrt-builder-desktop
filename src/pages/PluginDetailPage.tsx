import { Link, useLocation, useParams } from 'react-router-dom'
import { AppShell, PageFrame, pageTitleClassName } from '@/components/layout'
import { listPluginCatalogSteps } from '@/api/plugins'
import type { PluginMaturity, PluginNodeInfo } from '@/api/pluginTypes'
import { Badge, Icon, type BadgeTone } from '@/components/ui'
import { useAsyncData } from '@/hooks/useAsyncData'
import { useBrowserRuntime } from '@/hooks/useBrowserRuntime'
import { usePlugins, type PluginsState } from '@/hooks/usePlugins'
import { isPluginRuntimeMissing, usePluginRuntime, type PluginRuntimeState } from '@/hooks/usePluginRuntime'
import { describeError } from '@/lib/agentDisplay'
import { humanizePluginName } from '@/lib/pluginDisplayName'
import { routePaths } from '@/routes'
import { PluginInstallButton, PluginOperationFeedback, PluginRemoveButton, PluginUpdateButton } from './plugins/PluginActions'
import { pluginCategoryLabels } from './plugins/pluginCategories'
import {
  PluginAboutSection,
  PluginAsksForSection,
  PluginLoadNotes,
  PluginSetupSection,
  PluginStepsSection,
  PluginUsersSection,
  PluginWarningBox,
} from './plugins/PluginDetailSections'
import { buildPluginListItems, describeCommunityInstallNote, pluginInstallTrustNote, describeMaturity, describePluginSource, describePluginStatus, type PluginListItem } from './plugins/pluginDisplay'
import { PluginIcon } from './plugins/PluginIcon'
import { pluginRuntimeInstallNote } from './plugins/PluginRuntimeCard'
import { usePluginUsers } from './plugins/usePluginUsers'
import { messages } from '@/i18n'

/** The back link returns to the Plugins page with the filters it was opened from. */
function BackLink() {
  const location = useLocation()
  const listSearch = (location.state as { listSearch?: unknown } | null)?.listSearch
  const backPath = typeof listSearch === 'string' && listSearch.startsWith('?') ? `${routePaths.plugins}${listSearch}` : routePaths.plugins
  return (
    <Link to={backPath} className="inline-flex items-center gap-1.5 self-start text-[13px] font-medium no-underline !text-ink-2 hover:!text-ink">
      <Icon name="arrowLeft" size={14} />
      {messages().plugins.allPlugins}
    </Link>
  )
}

function HeaderActions({ item, plugins, pluginRuntime }: { item: PluginListItem; plugins: PluginsState; pluginRuntime: PluginRuntimeState }) {
  if (!item.installed) {
    const communityNote = describeCommunityInstallNote(item)
    const needsPluginRuntime = isPluginRuntimeMissing(pluginRuntime)
    return (
      <div className="ml-auto flex max-w-[260px] flex-col items-end gap-1.5">
        <PluginInstallButton item={item} plugins={plugins} size="md" withPluginRuntime={needsPluginRuntime} />
        <span className="text-right text-[12px] leading-normal text-muted">
          {messages().plugins.runsCodeShort(communityNote ? `${communityNote} ` : '')}
        </span>
        {needsPluginRuntime && <span className="text-right text-[12px] leading-normal text-muted">{pluginRuntimeInstallNote()}</span>}
        <span className="text-right text-[12px] font-medium leading-normal text-ink-2">{pluginInstallTrustNote()}</span>
      </div>
    )
  }
  return (
    <div className="ml-auto flex max-w-[320px] flex-col items-end gap-1.5">
      <div className="flex flex-wrap items-center justify-end gap-2">
        {item.updateAvailable && <PluginUpdateButton item={item} plugins={plugins} size="md" />}
        <PluginRemoveButton item={item} plugins={plugins} size="md" />
      </div>
      {item.updateAvailable && item.updateNeedsApproval && (
        <span className="text-right text-[12px] leading-normal text-amber-strong">
          {messages().plugins.updateNeedsApproval(item.version)}
        </span>
      )}
    </div>
  )
}

const maturityBadgeTones: Record<PluginMaturity, BadgeTone> = { stable: 'neutral', beta: 'neutral', experimental: 'amber' }

/** Icon, name, status and maturity badges, category and version, the description, then the actions on the right. */
function PluginHeader({ item, plugins, pluginRuntime }: { item: PluginListItem; plugins: PluginsState; pluginRuntime: PluginRuntimeState }) {
  const status = describePluginStatus(item)
  const sourceBadge = describePluginSource(item.source)
  const maturityLabel = describeMaturity(item.maturity)
  return (
    <header className="flex flex-wrap items-start gap-x-5 gap-y-4">
      <PluginIcon name={item.name} iconUrl={item.iconUrl} category={item.category} size="lg" />
      <div className="flex min-w-0 flex-[1_1_300px] flex-col gap-2">
        <h1 className={`${pageTitleClassName} [overflow-wrap:anywhere]`}>{item.displayName}</h1>
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5">
          <Badge tone={status.tone}>{status.label}</Badge>
          {sourceBadge && <Badge tone={sourceBadge.tone}>{sourceBadge.label}</Badge>}
          {maturityLabel && item.maturity && <Badge tone={maturityBadgeTones[item.maturity]}>{maturityLabel}</Badge>}
          <span className="text-[13px] text-muted">
            <code aria-label={messages().plugins.pluginName} className="font-mono text-[12px]">
              {item.name}
            </code>
            {' · '}
            {pluginCategoryLabels[item.category]} · v{item.version}
          </span>
          {item.publisher && <span className="text-[13px] text-muted">{messages().plugins.byPublisher(item.publisher)}</span>}
        </div>
        <p className="m-0 max-w-[640px] leading-normal text-body">{item.description}</p>
      </div>
      <HeaderActions item={item} plugins={plugins} pluginRuntime={pluginRuntime} />
    </header>
  )
}

/**
 * The steps to list: an installed plugin's own; for a catalog plugin, the ones the app
 * fetches on demand (newer catalogs keep descriptions in a per-version detail file),
 * showing the catalog list meanwhile or when that fails.
 */
function usePluginSteps(item: PluginListItem): PluginNodeInfo[] {
  const isInstalled = item.installed !== null
  const catalogSteps = useAsyncData(() => (isInstalled ? Promise.resolve(null) : listPluginCatalogSteps(item.name)), [item.name, isInstalled])
  return !isInstalled && catalogSteps.data && catalogSteps.data.length > 0 ? catalogSteps.data : item.nodes
}

function PluginDetailBody({ item, plugins }: { item: PluginListItem; plugins: PluginsState }) {
  const browserRuntime = useBrowserRuntime()
  const pluginRuntime = usePluginRuntime()
  const steps = usePluginSteps(item)
  const { installed } = item
  const refreshKey = installed ? `${installed.version}:${installed.trusted}:${installed.config.filter((setting) => setting.configured).length}` : 'not-installed'
  const users = usePluginUsers(item.name, refreshKey)
  return (
    <>
      <PluginHeader item={item} plugins={plugins} pluginRuntime={pluginRuntime} />
      <PluginOperationFeedback pluginName={item.name} plugins={plugins} />
      <PluginWarningBox item={item} />
      {installed && <PluginLoadNotes installed={installed} />}
      <div className="@container grid grid-cols-1 items-start gap-5 lg:grid-cols-[minmax(0,1fr)_300px] xl:grid-cols-[minmax(0,1fr)_320px]">
        <div className="flex min-w-0 flex-col gap-5">
          {installed && <PluginSetupSection installed={installed} plugins={plugins} browserRuntime={browserRuntime} pluginRuntime={pluginRuntime} />}
          <PluginStepsSection pluginLabel={item.displayName} nodes={steps} />
        </div>
        <aside aria-label={messages().plugins.aboutPlugin(item.displayName)} className="grid min-w-0 grid-cols-1 items-start gap-5 max-lg:@2xl:grid-cols-2">
          <PluginAsksForSection item={item} />
          <PluginUsersSection pluginLabel={item.displayName} users={users.data} loadError={users.error} />
          <PluginAboutSection item={item} />
        </aside>
      </div>
    </>
  )
}

function PluginDetailContent({ pluginName }: { pluginName: string }) {
  const plugins = usePlugins()
  const inventory = plugins.data
  if (plugins.error) {
    return (
      <p role="alert" className="m-0 text-[13px] text-danger">
        {messages().plugins.couldNotLoadPlugins(describeError(plugins.error))}
      </p>
    )
  }
  if (!inventory) return <p className="m-0 text-muted">{messages().plugins.loadingPlugin(humanizePluginName(pluginName))}</p>
  const item = buildPluginListItems(inventory.catalog, inventory.installed).find((candidate) => candidate.name === pluginName)
  if (!item) {
    const t = messages().plugins
    const reason = inventory.catalogError ? t.catalogNotLoaded(describeError(inventory.catalogError)) : t.catalogDoesNotList
    return <p className="m-0 text-muted">{t.noPluginNamed(pluginName, reason)}</p>
  }
  return <PluginDetailBody item={item} plugins={plugins} />
}

/**
 * Plugin page (`/plugins/:pluginName`), opened from the Plugins grid, the builder's
 * "Needs" box and Home. Header with status and Install / Update / Remove, the README
 * warning, then set up (trust, plugin and browser runtimes, the WhatsApp QR link, settings) and the
 * steps it adds; the side column says what it asks for, which agents use it and links
 * the README.
 */
export function PluginDetailPage() {
  const { pluginName = '' } = useParams()
  return (
    <AppShell activeNav="plugins">
      <PageFrame>
        <BackLink />
        <PluginDetailContent pluginName={pluginName} />
      </PageFrame>
    </AppShell>
  )
}
