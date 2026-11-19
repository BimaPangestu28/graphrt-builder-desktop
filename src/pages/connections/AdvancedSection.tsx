import { useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { listMcpServers } from '@/api/mcpServers'
import type { AdvancedConnection } from '@/data/connections'
import { useAsyncData } from '@/hooks/useAsyncData'
import { useBrowserRuntime } from '@/hooks/useBrowserRuntime'
import { usePlugins } from '@/hooks/usePlugins'
import { McpServersPanel } from './McpServersPanel'
import { PluginsSection } from './PluginsSection'
import { summarizeSecrets } from './secretDisplay'
import { SecretsPanel, type SecretsListState } from './SecretRows'

type AdvancedPanel = AdvancedConnection['kind'] | 'secrets'

const sectionHeadingClassNames = 'm-0 text-[13px] font-semibold text-muted'
const manageButtonClassNames =
  'inline-flex h-8 shrink-0 cursor-pointer items-center rounded-lg border border-line-strong bg-surface px-3 text-[13px] font-medium no-underline !text-ink hover:bg-subtle'
const panelIds: Record<AdvancedPanel, string> = {
  secrets: 'connections-secrets-panel',
  mcp: 'connections-mcp-panel',
  plugins: 'connections-plugins-panel',
}
const secretsRowDescription = 'Server logins, API tokens and passwords your agents use'

function describeRow(row: AdvancedConnection, count: number | null, countLabel: string): string {
  return count === null ? row.description : `${row.description} · ${count} ${countLabel}`
}

function readInitialPanel(section: string | null): AdvancedPanel | null {
  return section === 'plugins' || section === 'mcp' || section === 'secrets' ? section : null
}

interface AdvancedRowProps {
  name: string
  description: string
  panel: AdvancedPanel
  isOpen: boolean
  hasBorder: boolean
  onToggle: (panel: AdvancedPanel) => void
}

function AdvancedRow({ name, description, panel, isOpen, hasBorder, onToggle }: AdvancedRowProps) {
  return (
    <div className={`flex items-center justify-between gap-3 px-4 py-3 ${hasBorder ? 'border-b border-chip' : ''}`}>
      <span className="flex flex-col gap-0.5">
        <span className="font-medium">{name}</span>
        <span className="text-[12px] text-muted">{description}</span>
      </span>
      <button
        type="button"
        aria-label={`Manage ${name}`}
        aria-expanded={isOpen}
        aria-controls={panelIds[panel]}
        onClick={() => onToggle(panel)}
        className={manageButtonClassNames}
      >
        {isOpen ? 'Done' : 'Manage'}
      </button>
    </div>
  )
}

interface AdvancedSectionProps {
  /** The MCP and plugin rows that match the search. */
  rows: AdvancedConnection[]
  secretsState: SecretsListState
}

/**
 * "Advanced" on screen 21: Secrets (add your own, replace or remove values; they go to the
 * keychain), MCP servers and plugins. Manage opens each panel; `?section=secrets`,
 * `?section=plugins` or `?section=mcp` opens one from the start. While searching, the
 * Secrets panel opens by itself when a secret matches.
 */
export function AdvancedSection({ rows, secretsState }: AdvancedSectionProps) {
  const [searchParams] = useSearchParams()
  const [openPanel, setOpenPanel] = useState<AdvancedPanel | null>(() => readInitialPanel(searchParams.get('section')))
  const plugins = usePlugins()
  const browserRuntime = useBrowserRuntime()
  const mcpServers = useAsyncData(listMcpServers, [])
  const counts: Record<AdvancedConnection['kind'], number | null> = {
    mcp: mcpServers.data?.length ?? null,
    plugins: plugins.data?.installed.length ?? null,
  }
  const { allSecrets, visibleSecrets, isSearching } = secretsState
  const hasMatchingSecrets = (visibleSecrets?.length ?? 0) > 0
  const showsSecretsRow = !isSearching || hasMatchingSecrets
  const showsSecretsPanel = showsSecretsRow && (openPanel === 'secrets' || (isSearching && hasMatchingSecrets))
  const visiblePanel = openPanel && rows.some((row) => row.kind === openPanel) ? openPanel : null
  const secretsDescription = allSecrets ? `${secretsRowDescription} · ${summarizeSecrets(allSecrets)}` : secretsRowDescription

  function togglePanel(panel: AdvancedPanel) {
    setOpenPanel((currentPanel) => (currentPanel === panel ? null : panel))
  }

  return (
    <section aria-labelledby="connections-advanced-h" className="flex flex-col gap-2.5">
      <h2 id="connections-advanced-h" className={sectionHeadingClassNames}>
        Advanced
      </h2>
      <div className="rounded-xl border border-line">
        {showsSecretsRow && (
          <AdvancedRow name="Secrets" description={secretsDescription} panel="secrets" isOpen={showsSecretsPanel} hasBorder={rows.length > 0} onToggle={togglePanel} />
        )}
        {rows.map((row, index) => (
          <AdvancedRow
            key={row.id}
            name={row.name}
            description={describeRow(row, counts[row.kind], row.kind === 'mcp' ? 'added' : 'installed')}
            panel={row.kind}
            isOpen={visiblePanel === row.kind}
            hasBorder={index < rows.length - 1}
            onToggle={togglePanel}
          />
        ))}
      </div>
      {showsSecretsPanel && (
        <div id={panelIds.secrets}>
          <SecretsPanel secretsState={secretsState} />
        </div>
      )}
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
