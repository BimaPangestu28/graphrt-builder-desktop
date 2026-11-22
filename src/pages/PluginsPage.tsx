import { useSearchParams } from 'react-router-dom'
import { AppShell, PageFrame, PageTitleBlock } from '@/components/layout'
import { useBrowserRuntime } from '@/hooks/useBrowserRuntime'
import { usePluginRuntime } from '@/hooks/usePluginRuntime'
import { usePluginCatalogRefresh, type PluginCatalogRefreshState } from '@/hooks/usePluginCatalogRefresh'
import { usePlugins, type PluginsState } from '@/hooks/usePlugins'
import { Button, Spinner } from '@/components/ui'
import { describeError } from '@/lib/agentDisplay'
import { BrowserRuntimeBanner } from './plugins/BrowserRuntimeBanner'
import { describeCatalogFreshness } from './plugins/catalogFreshness'
import { LocalPluginInstall } from './plugins/LocalPluginInstall'
import { PluginAutoUpdateToggle } from './plugins/PluginAutoUpdateToggle'
import { PluginCatalogCard } from './plugins/PluginCatalogCard'
import { PluginCategoryChips, PluginSearchBox, PluginTabs } from './plugins/PluginFilterBar'
import { PluginRuntimeBanner } from './plugins/PluginRuntimeCard'
import { buildPluginListItems, countPluginsByTab, type PluginFilter, type PluginListItem } from './plugins/pluginDisplay'
import { applyTabAndSearch, countPluginCategories, readPluginListFilters, writePluginListFilters, type PluginListFilters } from './plugins/pluginListFilters'

const emptyTabMessages: Record<PluginFilter, string> = {
  all: 'The plugin catalog is empty',
  installed: 'No plugins installed yet. Pick one under All',
  updates: 'Every installed plugin is up to date',
  attention: 'Nothing needs attention: every installed plugin is ready',
}

/** Why a saved copy of the catalog is shown: offline, or the online one was refused (e.g. its signature). */
export function describeSavedCatalogReason(fetchError: string | null): string {
  if (fetchError && fetchError.includes('signature')) return `The online catalog was refused (${fetchError}): showing the last saved catalog`
  return 'Offline: showing the last saved catalog'
}

function CatalogNotes({ plugins }: { plugins: PluginsState }) {
  const inventory = plugins.data
  if (!inventory) return null
  if (inventory.catalogError) {
    return <p className="m-0 text-[13px] text-muted">Could not load the plugin catalog: {describeError(inventory.catalogError)}. Installed plugins still work</p>
  }
  if (inventory.catalog?.fromCache) return <p className="m-0 text-[13px] text-muted">{describeSavedCatalogReason(inventory.catalog.fetchError)}</p>
  if (inventory.catalog) return <p className="m-0 text-[13px] text-muted">{describeCatalogFreshness(inventory.catalog, Date.now())}</p>
  return null
}

/** "Check for updates" with the catalog's freshness (or why it is missing) and the last refresh error. */
function CatalogStatus({ plugins, catalogRefresh }: { plugins: PluginsState; catalogRefresh: PluginCatalogRefreshState }) {
  if (!plugins.data) return null
  const { isRefreshing, refreshError, refresh } = catalogRefresh
  return (
    <div className="flex flex-col gap-1">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5" role="status" aria-live="polite">
          <CatalogNotes plugins={plugins} />
          {isRefreshing && (
            <span className="inline-flex items-center gap-1.5 text-[13px] text-muted">
              <Spinner />
              Checking for updates…
            </span>
          )}
        </div>
        <Button variant="secondary" size="sm" onClick={() => void refresh()} disabled={isRefreshing}>
          Check for updates
        </Button>
      </div>
      {refreshError && (
        <p role="alert" className="m-0 text-[13px] text-danger">
          Could not check for updates: {refreshError}
        </p>
      )}
    </div>
  )
}

function PluginsHeader() {
  return (
    <PageTitleBlock
      title="Plugins"
      subtitle="Plugins add steps your agents can use, like sending WhatsApp messages or reading a spreadsheet. Nothing installs without your OK, and a plugin gets its settings and secrets only once you trust it."
    />
  )
}

function EmptyResults({ filters }: { filters: PluginListFilters }) {
  const trimmedSearch = filters.searchText.trim()
  const message = trimmedSearch ? `No plugins match “${trimmedSearch}”` : filters.category ? 'No plugins in this category here' : emptyTabMessages[filters.tab]
  return <p className="m-0 rounded-[14px] border border-dashed border-line-strong px-4 py-8 text-center text-muted">{message}</p>
}

interface PluginCatalogProps {
  items: PluginListItem[]
  plugins: PluginsState
}

/** Tabs, search and category chips over the card grid; the filters live in the URL. */
function PluginCatalog({ items, plugins }: PluginCatalogProps) {
  const [searchParams, setSearchParams] = useSearchParams()
  const filters = readPluginListFilters(searchParams)
  const tabAndSearchItems = applyTabAndSearch(items, filters)
  const visibleItems = filters.category ? tabAndSearchItems.filter((item) => item.category === filters.category) : tabAndSearchItems
  const categoryCounts = countPluginCategories(tabAndSearchItems)
  const shownCategoryCounts =
    filters.category && !categoryCounts.some((categoryCount) => categoryCount.category === filters.category)
      ? [...categoryCounts, { category: filters.category, count: 0 }]
      : categoryCounts
  const listSearch = searchParams.toString() ? `?${searchParams.toString()}` : ''

  function updateFilters(changes: Partial<PluginListFilters>) {
    setSearchParams(writePluginListFilters({ ...filters, ...changes }), { replace: true })
  }

  return (
    <>
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <PluginTabs activeFilter={filters.tab} counts={countPluginsByTab(items)} onChange={(tab) => updateFilters({ tab })} />
          <div className="flex flex-wrap items-start gap-3">
            <PluginAutoUpdateToggle />
            <PluginSearchBox searchText={filters.searchText} onChange={(searchText) => updateFilters({ searchText })} />
          </div>
        </div>
        <PluginCategoryChips categoryCounts={shownCategoryCounts} activeCategory={filters.category} onChange={(category) => updateFilters({ category })} />
      </div>
      {visibleItems.length === 0 ? (
        <EmptyResults filters={filters} />
      ) : (
        <div aria-label="Plugin catalog" role="list" className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
          {visibleItems.map((item) => (
            <div key={item.name} role="listitem" className="min-w-0">
              <PluginCatalogCard item={item} plugins={plugins} listSearch={listSearch} />
            </div>
          ))}
        </div>
      )}
    </>
  )
}

/**
 * Screen 26 · Plugins (its own sidebar item; it used to live under Connections → Advanced).
 * The graphrt-plugins catalog merged with what is installed, as an equal-height card grid
 * with All / Installed / Updates / Needs attention tabs, search and category chips. Each
 * card links to the plugin's page (`/plugins/:pluginName`) for trust, settings and Remove.
 * The plugin runtime banner shows while installed plugins need Node.js and it is missing (after
 * updating from a version that bundled it), the browser runtime banner while an installed
 * plugin needs Chromium. "Check for
 * updates" fetches the catalog again; a catalog fetched over 10 minutes ago is refetched
 * in the background when the page opens (the saved list shows meanwhile). With Settings ›
 * About › Developer mode on, "Install from folder or archive…" sideloads a plugin.
 */
export function PluginsPage() {
  const plugins = usePlugins()
  const catalogRefresh = usePluginCatalogRefresh(plugins)
  const browserRuntime = useBrowserRuntime()
  const pluginRuntime = usePluginRuntime()
  const inventory = plugins.data
  const items = inventory ? buildPluginListItems(inventory.catalog, inventory.installed) : []
  const browserPluginLabels = inventory?.installed.filter((installedPlugin) => installedPlugin.needsBrowser).map((installedPlugin) => installedPlugin.displayName) ?? []
  const runtimePluginLabels = inventory?.installed.filter((installedPlugin) => installedPlugin.needsNodeRuntime).map((installedPlugin) => installedPlugin.displayName) ?? []

  return (
    <AppShell activeNav="plugins">
      <PageFrame>
        <PluginsHeader />
        {plugins.error && (
          <p role="alert" className="m-0 text-[13px] text-danger">
            Could not load plugins: {describeError(plugins.error)}
          </p>
        )}
        {!plugins.error && !inventory && <p className="m-0 text-muted">Loading plugins…</p>}
        <CatalogStatus plugins={plugins} catalogRefresh={catalogRefresh} />
        {inventory && <LocalPluginInstall onInstalled={plugins.reload} />}
        {runtimePluginLabels.length > 0 && <PluginRuntimeBanner runtime={pluginRuntime} pluginLabels={runtimePluginLabels} />}
        {browserPluginLabels.length > 0 && <BrowserRuntimeBanner runtime={browserRuntime} pluginLabels={browserPluginLabels} />}
        {inventory && <PluginCatalog items={items} plugins={plugins} />}
      </PageFrame>
    </AppShell>
  )
}
