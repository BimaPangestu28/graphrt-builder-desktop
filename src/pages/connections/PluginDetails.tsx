import type { ReactNode } from 'react'
import type { InstalledPlugin, PluginNodeInfo } from '@/api/pluginTypes'
import { Button } from '@/components/ui'
import type { PluginsState } from '@/hooks/usePlugins'
import { describeStepCount, type PluginListItem } from './pluginDisplay'
import { PluginPermissionList } from './PluginPermissionList'
import { PluginSettings } from './PluginSettings'
import { PluginTrustToggle } from './PluginTrustToggle'
import { WhatsAppWebLinkSection } from './WhatsAppWebLinkSection'

interface PluginDetailsProps {
  id: string
  item: PluginListItem
  plugins: PluginsState
  /** The browser runtime (Chromium) is installed, so browser plugins can run actions. */
  isBrowserReady: boolean
}

interface InstalledPluginControlsProps {
  installed: InstalledPlugin
  plugins: PluginsState
  isBrowserReady: boolean
}

/** Small caption above each block of the details panel. */
function DetailsBlock({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <span className="text-[11px] font-semibold tracking-wide text-muted uppercase">{title}</span>
      {children}
    </div>
  )
}

function PluginStepChips({ pluginName, nodes }: { pluginName: string; nodes: PluginNodeInfo[] }) {
  return (
    <DetailsBlock title={describeStepCount(nodes.length)}>
      <ul aria-label={`Steps ${pluginName} adds`} className="m-0 flex list-none flex-wrap gap-1 p-0">
        {nodes.map((node) => (
          <li key={node.kind} title={node.description} className="rounded-md border border-line bg-surface px-2 py-0.5 text-[12px] text-ink-2">
            {node.title}
          </li>
        ))}
      </ul>
    </DetailsBlock>
  )
}

function PluginLoadNotes({ installed }: { installed: InstalledPlugin }) {
  if (!installed.loadError && installed.warnings.length === 0) return null
  return (
    <div className="flex flex-col gap-1">
      {installed.loadError && (
        <p role="alert" className="m-0 text-[13px] text-danger">
          Could not load {installed.name}: {installed.loadError}
        </p>
      )}
      {installed.warnings.length > 0 && (
        <ul aria-label={`Warnings for ${installed.name}`} className="m-0 flex list-none flex-col gap-0.5 p-0 text-[12px] text-amber-deep">
          {installed.warnings.map((warning) => (
            <li key={warning}>{warning}</li>
          ))}
        </ul>
      )}
    </div>
  )
}

/**
 * The column a person acts in: load notes, trust, plugin-specific actions (the
 * `whatsapp-web` QR link), then settings with optional ones folded away.
 */
function InstalledPluginControls({ installed, plugins, isBrowserReady }: InstalledPluginControlsProps) {
  return (
    <div className="flex min-w-0 flex-col gap-3">
      <PluginLoadNotes installed={installed} />
      <PluginTrustToggle
        pluginName={installed.name}
        isTrusted={installed.trusted}
        isSaving={plugins.operationByName[installed.name] === 'trusting'}
        onChange={(trusted) => void plugins.setTrusted(installed.name, trusted)}
      />
      <WhatsAppWebLinkSection installed={installed} isBrowserReady={isBrowserReady} />
      {installed.config.length > 0 && (
        <DetailsBlock title="Settings">
          <PluginSettings installed={installed} plugins={plugins} />
        </DetailsBlock>
      )}
    </div>
  )
}

function RemovePluginButton({ item, plugins }: { item: PluginListItem; plugins: PluginsState }) {
  const operation = plugins.operationByName[item.name]
  return (
    <Button variant="danger" size="sm" aria-label={`Remove ${item.name}`} disabled={operation !== undefined} onClick={() => void plugins.remove(item.name)}>
      {operation === 'removing' ? 'Removing…' : 'Remove'}
    </Button>
  )
}

/**
 * The expandable part of a plugin row. Installed plugins get their controls (load notes,
 * trust, settings) on the left and what they ask for / the steps they add on the right,
 * with Remove at the bottom. Plugins not installed yet show only what they ask for and
 * their steps, so a person can decide before installing.
 */
export function PluginDetails({ id, item, plugins, isBrowserReady }: PluginDetailsProps) {
  const { installed } = item
  const facts = (
    <div className="flex min-w-0 flex-col gap-3">
      <DetailsBlock title="Asks for">
        <PluginPermissionList pluginName={item.name} permissions={item.permissions} needsBrowser={item.needsBrowser} />
      </DetailsBlock>
      {item.nodes.length > 0 && <PluginStepChips pluginName={item.name} nodes={item.nodes} />}
    </div>
  )
  return (
    <div id={id} className="@container border-t border-line bg-subtle px-4 py-3.5">
      {installed ? (
        <div className="flex flex-col gap-3.5">
          <div className="grid grid-cols-1 gap-4 @2xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)] @2xl:gap-6">
            <InstalledPluginControls installed={installed} plugins={plugins} isBrowserReady={isBrowserReady} />
            {facts}
          </div>
          <div className="flex justify-end border-t border-line pt-3">
            <RemovePluginButton item={item} plugins={plugins} />
          </div>
        </div>
      ) : (
        facts
      )}
    </div>
  )
}
