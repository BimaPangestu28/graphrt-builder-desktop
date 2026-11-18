import { useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import type { AdvancedConnection } from '@/data/connections'
import { useBrowserRuntime } from '@/hooks/useBrowserRuntime'
import { usePlugins } from '@/hooks/usePlugins'
import { routePaths } from '@/routes'
import { PluginsSection } from './PluginsSection'

const sectionHeadingClassNames = 'm-0 text-[13px] font-semibold text-muted'
const manageButtonClassNames =
  'inline-flex h-8 shrink-0 cursor-pointer items-center rounded-lg border border-line-strong bg-surface px-3 text-[13px] font-medium no-underline !text-ink hover:bg-subtle'
const pluginsPanelId = 'connections-plugins-panel'

function describeRow(row: AdvancedConnection, installedPluginCount: number | null): string {
  if (row.kind !== 'plugins' || installedPluginCount === null) return row.description
  return `${row.description} · ${installedPluginCount} installed`
}

interface AdvancedRowActionProps {
  row: AdvancedConnection
  isPluginsPanelOpen: boolean
  onTogglePlugins: () => void
}

function AdvancedRowAction({ row, isPluginsPanelOpen, onTogglePlugins }: AdvancedRowActionProps) {
  if (row.kind === 'status') return <span className="text-[13px] text-ok-strong">Connected</span>
  if (row.kind === 'plugins') {
    return (
      <button type="button" aria-label={`Manage ${row.name}`} aria-expanded={isPluginsPanelOpen} aria-controls={pluginsPanelId} onClick={onTogglePlugins} className={manageButtonClassNames}>
        {isPluginsPanelOpen ? 'Done' : 'Manage'}
      </button>
    )
  }
  return (
    <Link to={routePaths.settings} aria-label={`Manage ${row.name}`} className={manageButtonClassNames}>
      Manage
    </Link>
  )
}

/**
 * "Advanced" on screen 21: API keys, MCP servers and plugins. The plugins row shows the
 * real installed count and its Manage button opens the Plugins panel (open from the start
 * with `?section=plugins`).
 */
export function AdvancedSection({ rows }: { rows: AdvancedConnection[] }) {
  const [searchParams] = useSearchParams()
  const [isPluginsPanelOpen, setIsPluginsPanelOpen] = useState(searchParams.get('section') === 'plugins')
  const plugins = usePlugins()
  const browserRuntime = useBrowserRuntime()
  const installedPluginCount = plugins.data?.installed.length ?? null
  const showsPluginsPanel = isPluginsPanelOpen && rows.some((row) => row.kind === 'plugins')

  return (
    <section aria-labelledby="connections-advanced-h" className="flex flex-col gap-2.5">
      <h2 id="connections-advanced-h" className={sectionHeadingClassNames}>
        Advanced
      </h2>
      <div className="rounded-xl border border-line">
        {rows.map((row, index) => (
          <div key={row.id} className={`flex items-center justify-between gap-3 px-4 py-3 ${index < rows.length - 1 ? 'border-b border-chip' : ''}`}>
            <span className="flex flex-col gap-0.5">
              <span className="font-medium">{row.name}</span>
              <span className="text-[12px] text-muted">{describeRow(row, installedPluginCount)}</span>
            </span>
            <AdvancedRowAction row={row} isPluginsPanelOpen={isPluginsPanelOpen} onTogglePlugins={() => setIsPluginsPanelOpen((isOpen) => !isOpen)} />
          </div>
        ))}
      </div>
      {showsPluginsPanel && (
        <div id={pluginsPanelId}>
          <PluginsSection plugins={plugins} browserRuntime={browserRuntime} />
        </div>
      )}
    </section>
  )
}
