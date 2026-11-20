import { Link, useLocation, useParams } from 'react-router-dom'
import { AppShell } from '@/components/layout'
import { Badge, Icon } from '@/components/ui'
import { useBrowserRuntime } from '@/hooks/useBrowserRuntime'
import { usePlugins, type PluginsState } from '@/hooks/usePlugins'
import { describeError } from '@/lib/agentDisplay'
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
import { buildPluginListItems, describeMaturity, describePluginStatus, type PluginListItem } from './plugins/pluginDisplay'
import { PluginIcon } from './plugins/PluginIcon'
import { usePluginUsers } from './plugins/usePluginUsers'

/** The back link returns to the Plugins page with the filters it was opened from. */
function BackLink() {
  const location = useLocation()
  const listSearch = (location.state as { listSearch?: unknown } | null)?.listSearch
  const backPath = typeof listSearch === 'string' && listSearch.startsWith('?') ? `${routePaths.plugins}${listSearch}` : routePaths.plugins
  return (
    <Link to={backPath} className="inline-flex items-center gap-1.5 self-start text-[13px] font-medium no-underline !text-ink-2 hover:!text-ink">
      <Icon name="arrowLeft" size={14} />
      All plugins
    </Link>
  )
}

function HeaderActions({ item, plugins }: { item: PluginListItem; plugins: PluginsState }) {
  if (!item.installed) {
    return (
      <div className="flex max-w-[280px] flex-col items-end gap-1.5">
        <PluginInstallButton item={item} plugins={plugins} size="md" />
        <span className="text-right text-[12px] leading-normal text-muted">Runs its code on this computer. It starts untrusted, without settings or secrets.</span>
      </div>
    )
  }
  return (
    <div className="flex flex-wrap items-center justify-end gap-2">
      {item.updateAvailable && <PluginUpdateButton item={item} plugins={plugins} size="md" />}
      <PluginRemoveButton item={item} plugins={plugins} size="md" />
    </div>
  )
}

function PluginHeader({ item, plugins }: { item: PluginListItem; plugins: PluginsState }) {
  const status = describePluginStatus(item)
  const meta = [pluginCategoryLabels[item.category], `v${item.version}`, describeMaturity(item.maturity)].filter(Boolean).join(' · ')
  return (
    <header className="flex flex-wrap items-start gap-4">
      <PluginIcon name={item.name} iconUrl={item.iconUrl} category={item.category} size="lg" />
      <div className="flex min-w-0 flex-[1_1_320px] flex-col gap-1">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="m-0 text-[24px] font-semibold tracking-[-0.4px] [overflow-wrap:anywhere]">{item.name}</h1>
          <Badge tone={status.tone}>{status.label}</Badge>
        </div>
        <span className="text-[13px] text-muted">{meta}</span>
        <p className="m-0 max-w-[640px] leading-normal text-body">{item.description}</p>
      </div>
      <HeaderActions item={item} plugins={plugins} />
    </header>
  )
}

function PluginDetailBody({ item, plugins }: { item: PluginListItem; plugins: PluginsState }) {
  const browserRuntime = useBrowserRuntime()
  const { installed } = item
  const refreshKey = installed ? `${installed.version}:${installed.trusted}:${installed.config.filter((setting) => setting.configured).length}` : 'not-installed'
  const users = usePluginUsers(item.name, refreshKey)
  return (
    <>
      <PluginHeader item={item} plugins={plugins} />
      <PluginOperationFeedback pluginName={item.name} plugins={plugins} />
      <PluginWarningBox item={item} />
      {installed && <PluginLoadNotes installed={installed} />}
      <div className="@container grid grid-cols-1 items-start gap-4 lg:grid-cols-[minmax(0,1fr)_300px]">
        <div className="flex min-w-0 flex-col gap-4">
          {installed && <PluginSetupSection installed={installed} plugins={plugins} browserRuntime={browserRuntime} />}
          <PluginStepsSection pluginName={item.name} nodes={item.nodes} />
        </div>
        <aside aria-label={`About ${item.name}`} className="flex min-w-0 flex-col gap-4">
          <PluginAsksForSection item={item} />
          <PluginUsersSection pluginName={item.name} users={users.data} loadError={users.error} />
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
        Could not load plugins: {describeError(plugins.error)}
      </p>
    )
  }
  if (!inventory) return <p className="m-0 text-muted">Loading {pluginName}…</p>
  const item = buildPluginListItems(inventory.catalog, inventory.installed).find((candidate) => candidate.name === pluginName)
  if (!item) {
    const reason = inventory.catalogError ? `the catalog could not be loaded (${describeError(inventory.catalogError)}) and it is not installed` : 'the catalog does not list it'
    return <p className="m-0 text-muted">No plugin named “{pluginName}”: {reason}</p>
  }
  return <PluginDetailBody item={item} plugins={plugins} />
}

/**
 * Plugin page (`/plugins/:pluginName`), opened from the Plugins grid, the builder's
 * "Needs" box and Home. Header with status and Install / Update / Remove, the README
 * warning, then set up (trust, browser runtime, the WhatsApp QR link, settings) and the
 * steps it adds; the side column says what it asks for, which agents use it and links
 * the README.
 */
export function PluginDetailPage() {
  const { pluginName = '' } = useParams()
  return (
    <AppShell activeNav="plugins" mainClassName="box-border flex flex-col gap-5 px-8 py-7">
      <BackLink />
      <PluginDetailContent pluginName={pluginName} />
    </AppShell>
  )
}
