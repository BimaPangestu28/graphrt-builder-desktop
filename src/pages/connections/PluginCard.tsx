import type { InstalledPlugin } from '@/api/pluginTypes'
import { Badge, Button } from '@/components/ui'
import type { PluginsState } from '@/hooks/usePlugins'
import { describeInstallProgress, type PluginListItem } from './pluginDisplay'
import { PluginPermissionList } from './PluginPermissionList'
import { PluginSettings } from './PluginSettings'
import { PluginTrustToggle } from './PluginTrustToggle'
import { WhatsAppWebLinkSection } from './WhatsAppWebLinkSection'

interface PluginCardProps {
  item: PluginListItem
  plugins: PluginsState
  /** The browser runtime (Chromium) is installed, so browser plugins can run actions. */
  isBrowserReady: boolean
}

const operationLabels = { installing: 'Installing…', updating: 'Updating…', removing: 'Removing…', trusting: 'Saving…' } as const

function PluginCardHeader({ item }: { item: PluginListItem }) {
  const { installed } = item
  return (
    <div className="flex flex-wrap items-start justify-between gap-2">
      <span className="flex min-w-0 flex-col gap-0.5">
        <b className="font-semibold">{item.name}</b>
        <span className="text-[13px] text-body">{item.description}</span>
      </span>
      <span className="flex flex-wrap gap-1.5">
        {installed ? <Badge tone="ok">Installed v{installed.version}</Badge> : <Badge>v{item.version}</Badge>}
        {item.updateAvailable && <Badge tone="brand">Update to v{item.version}</Badge>}
        {installed && !installed.trusted && <Badge tone="amber">Not trusted</Badge>}
      </span>
    </div>
  )
}

function PluginActions({ item, plugins }: Pick<PluginCardProps, 'item' | 'plugins'>) {
  const operation = plugins.operationByName[item.name]
  const isBusy = operation !== undefined
  if (!item.installed) {
    return (
      <Button size="sm" aria-label={`Install ${item.name}`} disabled={isBusy} onClick={() => void plugins.install(item.name)}>
        {operation === 'installing' ? operationLabels.installing : 'Install'}
      </Button>
    )
  }
  return (
    <span className="flex flex-wrap gap-2">
      {item.updateAvailable && (
        <Button size="sm" aria-label={`Update ${item.name}`} disabled={isBusy} onClick={() => void plugins.update(item.name)}>
          {operation === 'updating' ? operationLabels.updating : 'Update'}
        </Button>
      )}
      <Button variant="danger" size="sm" aria-label={`Remove ${item.name}`} disabled={isBusy} onClick={() => void plugins.remove(item.name)}>
        {operation === 'removing' ? operationLabels.removing : 'Remove'}
      </Button>
    </span>
  )
}

function PluginLoadNotes({ installed }: { installed: InstalledPlugin }) {
  return (
    <>
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
    </>
  )
}

function InstalledPluginSettings({ installed, plugins, isBrowserReady }: { installed: InstalledPlugin; plugins: PluginsState; isBrowserReady: boolean }) {
  return (
    <>
      <PluginLoadNotes installed={installed} />
      <PluginTrustToggle
        pluginName={installed.name}
        isTrusted={installed.trusted}
        isSaving={plugins.operationByName[installed.name] === 'trusting'}
        onChange={(trusted) => void plugins.setTrusted(installed.name, trusted)}
      />
      <WhatsAppWebLinkSection installed={installed} isBrowserReady={isBrowserReady} />
      <PluginSettings installed={installed} plugins={plugins} />
    </>
  )
}

/**
 * One plugin on Connections → Plugins: what it asks for (shown before install), its steps,
 * install / update / remove with live progress, and once installed the trust toggle,
 * its settings (optional ones folded away), load errors and warnings, and for `whatsapp-web`
 * the QR link panel.
 */
export function PluginCard({ item, plugins, isBrowserReady }: PluginCardProps) {
  const progress = plugins.progressByName[item.name]
  const errorMessage = plugins.errorByName[item.name]
  return (
    <article aria-label={item.name} className="flex flex-col gap-2.5 rounded-xl border border-line p-3.5">
      <PluginCardHeader item={item} />
      <PluginPermissionList pluginName={item.name} permissions={item.permissions} needsBrowser={item.needsBrowser} />
      {item.nodes.length > 0 && <span className="text-[12px] text-muted">Adds steps: {item.nodes.map((node) => node.title).join(', ')}</span>}
      <div className="flex flex-wrap items-center gap-3">
        <PluginActions item={item} plugins={plugins} />
        {progress && (
          <span role="status" className="text-[13px] text-ink-2">
            {describeInstallProgress(progress)}
          </span>
        )}
      </div>
      {errorMessage && (
        <p role="alert" className="m-0 text-[13px] text-danger">
          {errorMessage}
        </p>
      )}
      {item.installed && <InstalledPluginSettings installed={item.installed} plugins={plugins} isBrowserReady={isBrowserReady} />}
    </article>
  )
}
