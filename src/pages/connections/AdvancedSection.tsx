import { useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { listMcpServers } from '@/api/mcpServers'
import type { AdvancedConnection } from '@/data/connections'
import { useAsyncData } from '@/hooks/useAsyncData'
import { useBrowserRuntime } from '@/hooks/useBrowserRuntime'
import { usePlugins } from '@/hooks/usePlugins'
import { McpServersPanel } from './McpServersPanel'
import { PluginsSection } from './PluginsSection'
import { SecretRows, type SecretsListState } from './SecretRows'

const sectionHeadingClassNames = 'm-0 text-[13px] font-semibold text-muted'
const manageButtonClassNames =
  'inline-flex h-8 shrink-0 cursor-pointer items-center rounded-lg border border-line-strong bg-surface px-3 text-[13px] font-medium no-underline !text-ink hover:bg-subtle'
const panelIds: Record<AdvancedConnection['kind'], string> = {
  mcp: 'connections-mcp-panel',
  plugins: 'connections-plugins-panel',
}

function describeRow(row: AdvancedConnection, count: number | null, countLabel: string): string {
  return count === null ? row.description : `${row.description} · ${count} ${countLabel}`
}

interface AdvancedSectionProps {
  /** The MCP and plugin rows that match the search. */
  rows: AdvancedConnection[]
  secretsState: SecretsListState
}

/**
 * "Advanced" on screen 21: the workflow secrets every agent uses (add / replace / remove,
 * values go to the keychain), MCP servers and plugins. Manage opens the MCP or Plugins
 * panel; `?section=plugins` or `?section=mcp` opens one from the start.
 */
export function AdvancedSection({ rows, secretsState }: AdvancedSectionProps) {
  const [searchParams] = useSearchParams()
  const [openPanel, setOpenPanel] = useState<AdvancedConnection['kind'] | null>(() => {
    const section = searchParams.get('section')
    return section === 'plugins' || section === 'mcp' ? section : null
  })
  const plugins = usePlugins()
  const browserRuntime = useBrowserRuntime()
  const mcpServers = useAsyncData(listMcpServers, [])
  const counts: Record<AdvancedConnection['kind'], number | null> = {
    mcp: mcpServers.data?.length ?? null,
    plugins: plugins.data?.installed.length ?? null,
  }
  const visiblePanel = openPanel && rows.some((row) => row.kind === openPanel) ? openPanel : null

  function togglePanel(kind: AdvancedConnection['kind']) {
    setOpenPanel((currentPanel) => (currentPanel === kind ? null : kind))
  }

  return (
    <section aria-labelledby="connections-advanced-h" className="flex flex-col gap-2.5">
      <h2 id="connections-advanced-h" className={sectionHeadingClassNames}>
        Advanced
      </h2>
      <div className="rounded-xl border border-line">
        <SecretRows secretsState={secretsState} />
        {rows.map((row, index) => (
          <div key={row.id} className={`flex items-center justify-between gap-3 px-4 py-3 ${index < rows.length - 1 ? 'border-b border-chip' : ''}`}>
            <span className="flex flex-col gap-0.5">
              <span className="font-medium">{row.name}</span>
              <span className="text-[12px] text-muted">{describeRow(row, counts[row.kind], row.kind === 'mcp' ? 'added' : 'installed')}</span>
            </span>
            <button
              type="button"
              aria-label={`Manage ${row.name}`}
              aria-expanded={visiblePanel === row.kind}
              aria-controls={panelIds[row.kind]}
              onClick={() => togglePanel(row.kind)}
              className={manageButtonClassNames}
            >
              {visiblePanel === row.kind ? 'Done' : 'Manage'}
            </button>
          </div>
        ))}
      </div>
      {visiblePanel === 'mcp' && (
        <div id={panelIds.mcp}>
          <McpServersPanel servers={mcpServers} onServersChanged={secretsState.reload} />
        </div>
      )}
      {visiblePanel === 'plugins' && (
        <div id={panelIds.plugins}>
          <PluginsSection plugins={plugins} browserRuntime={browserRuntime} />
        </div>
      )}
    </section>
  )
}
