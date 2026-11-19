import { useId, useState } from 'react'
import { Icon } from '@/components/ui'
import type { BrowserRuntimeState } from '@/hooks/useBrowserRuntime'
import type { PluginsState } from '@/hooks/usePlugins'
import { describeError } from '@/lib/agentDisplay'
import { BrowserRuntimeCard } from './BrowserRuntimeCard'
import { PluginCard } from './PluginCard'
import { buildPluginListItems, filterPluginListItems, type PluginListItem } from './pluginDisplay'

interface PluginsSectionProps {
  plugins: PluginsState
  browserRuntime: BrowserRuntimeState
}

function CatalogNotes({ plugins }: { plugins: PluginsState }) {
  const inventory = plugins.data
  if (!inventory) return null
  if (inventory.catalogError) {
    return <p className="m-0 text-[13px] text-muted">Could not load the plugin catalog: {describeError(inventory.catalogError)}. Installed plugins still work</p>
  }
  if (inventory.catalog?.fromCache) return <p className="m-0 text-[13px] text-muted">Offline: showing the last saved catalog</p>
  return null
}

function PluginSearchBox({ searchText, onChange }: { searchText: string; onChange: (searchText: string) => void }) {
  return (
    <label className="flex h-9 items-center gap-2 rounded-lg border border-line-strong bg-surface px-3 text-muted focus-within:border-brand">
      <Icon name="search" size={15} />
      <input
        type="search"
        aria-label="Search plugins"
        placeholder="Search plugins"
        value={searchText}
        onChange={(event) => onChange(event.target.value)}
        className="h-full min-w-0 flex-1 bg-transparent text-[13px] text-ink outline-none"
      />
    </label>
  )
}

interface PluginGroupProps {
  title: string
  items: PluginListItem[]
  plugins: PluginsState
  /** The browser runtime (Chromium) is installed, so browser plugins can run actions. */
  isBrowserReady: boolean
}

/** "Installed · 2" heading with its plugin rows in one bordered list. */
function PluginGroup({ title, items, plugins, isBrowserReady }: PluginGroupProps) {
  const headingId = useId()
  if (items.length === 0) return null
  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-1.5">
      <h4 id={headingId} className="m-0 text-[12px] font-semibold text-muted">
        {`${title} · ${items.length}`}
      </h4>
      <div className="divide-y divide-line overflow-hidden rounded-[14px] border border-line bg-surface">
        {items.map((item) => (
          <PluginCard key={item.name} item={item} plugins={plugins} isBrowserReady={isBrowserReady} />
        ))}
      </div>
    </section>
  )
}

function PluginList({ items, plugins, isBrowserReady }: Omit<PluginGroupProps, 'title'>) {
  const [searchText, setSearchText] = useState('')
  const matchingItems = filterPluginListItems(items, searchText)
  return (
    <>
      <PluginSearchBox searchText={searchText} onChange={setSearchText} />
      {matchingItems.length === 0 && <p className="m-0 text-[13px] text-muted">No plugins match “{searchText.trim()}”</p>}
      <PluginGroup title="Installed" items={matchingItems.filter((item) => item.installed)} plugins={plugins} isBrowserReady={isBrowserReady} />
      <PluginGroup title="Available" items={matchingItems.filter((item) => !item.installed)} plugins={plugins} isBrowserReady={isBrowserReady} />
    </>
  )
}

/**
 * Connections → Plugins: the browser runtime when an installed plugin needs it, then a
 * searchable list of plugins grouped into Installed and Available. Each row expands into
 * trust, settings, steps and Remove.
 */
export function PluginsSection({ plugins, browserRuntime }: PluginsSectionProps) {
  const inventory = plugins.data
  const items = inventory ? buildPluginListItems(inventory.catalog, inventory.installed) : []
  const needsBrowserRuntime = inventory?.installed.some((installedPlugin) => installedPlugin.needsBrowser) ?? false

  return (
    <section aria-labelledby="connections-plugins-h" className="flex flex-col gap-3">
      <div className="flex flex-col gap-0.5">
        <h3 id="connections-plugins-h" className="m-0 text-[13px] font-semibold text-ink-2">
          Plugins
        </h3>
        <p className="m-0 text-[12px] text-muted">Plugins add steps to your agents. They run code on this computer, so install only plugins you know</p>
      </div>
      {plugins.error && <p role="alert" className="m-0 text-[13px] text-danger">Could not load plugins: {describeError(plugins.error)}</p>}
      {!plugins.error && !inventory && <p className="m-0 text-muted">Loading plugins…</p>}
      <CatalogNotes plugins={plugins} />
      {needsBrowserRuntime && <BrowserRuntimeCard runtime={browserRuntime} />}
      {items.length > 0 && <PluginList items={items} plugins={plugins} isBrowserReady={browserRuntime.status === 'installed'} />}
    </section>
  )
}
