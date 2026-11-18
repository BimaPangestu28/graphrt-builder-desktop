import type { BrowserRuntimeState } from '@/hooks/useBrowserRuntime'
import type { PluginsState } from '@/hooks/usePlugins'
import { describeError } from '@/lib/agentDisplay'
import { BrowserRuntimeCard } from './BrowserRuntimeCard'
import { PluginCard } from './PluginCard'
import { buildPluginListItems } from './pluginDisplay'

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

/**
 * Connections → Plugins: every catalog plugin with what it asks for, install / update /
 * remove, trust and settings, plus the browser runtime when an installed plugin needs it.
 */
export function PluginsSection({ plugins, browserRuntime }: PluginsSectionProps) {
  const inventory = plugins.data
  const items = inventory ? buildPluginListItems(inventory.catalog, inventory.installed) : []
  const needsBrowserRuntime = inventory?.installed.some((installedPlugin) => installedPlugin.needsBrowser) ?? false

  return (
    <section aria-labelledby="connections-plugins-h" className="flex flex-col gap-2.5">
      <h3 id="connections-plugins-h" className="m-0 text-[13px] font-semibold text-ink-2">
        Plugins
      </h3>
      <p className="m-0 text-[12px] text-muted">Plugins add steps to your agents. They run code on this computer, so install only plugins you know</p>
      {plugins.error && <p role="alert" className="m-0 text-[13px] text-danger">Could not load plugins: {describeError(plugins.error)}</p>}
      {!plugins.error && !inventory && <p className="m-0 text-muted">Loading plugins…</p>}
      <CatalogNotes plugins={plugins} />
      {needsBrowserRuntime && <BrowserRuntimeCard runtime={browserRuntime} />}
      {items.length > 0 && (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(320px,1fr))] gap-2.5">
          {items.map((item) => (
            <PluginCard key={item.name} item={item} plugins={plugins} />
          ))}
        </div>
      )}
    </section>
  )
}
