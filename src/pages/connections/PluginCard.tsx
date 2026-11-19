import { useId, useState } from 'react'
import { Badge, Button, Icon, joinClassNames } from '@/components/ui'
import type { PluginsState } from '@/hooks/usePlugins'
import { PluginDetails } from './PluginDetails'
import { describeInstallProgress, pluginNeedsAttention, type PluginListItem } from './pluginDisplay'
import { PluginPermissionChips } from './PluginPermissionList'

interface PluginCardProps {
  item: PluginListItem
  plugins: PluginsState
  /** The browser runtime (Chromium) is installed, so browser plugins can run actions. */
  isBrowserReady: boolean
}

/**
 * Open / closed state of a plugin's details. Starts open when the plugin needs attention
 * and opens again whenever it starts needing attention (e.g. right after install), but
 * never closes on its own so the panel does not jump while someone is working in it.
 */
function useDetailsOpenState(needsAttention: boolean) {
  const [isOpen, setIsOpen] = useState(needsAttention)
  const [previousNeedsAttention, setPreviousNeedsAttention] = useState(needsAttention)
  if (needsAttention !== previousNeedsAttention) {
    setPreviousNeedsAttention(needsAttention)
    if (needsAttention) setIsOpen(true)
  }
  return [isOpen, () => setIsOpen((wasOpen) => !wasOpen)] as const
}

function PluginStatusBadges({ item }: { item: PluginListItem }) {
  const { installed } = item
  return (
    <span className="flex flex-wrap items-center gap-1.5">
      {installed ? <Badge tone="ok">Installed v{installed.version}</Badge> : <Badge>v{item.version}</Badge>}
      {item.updateAvailable && <Badge tone="brand">Update to v{item.version}</Badge>}
      {installed && !installed.trusted && <Badge tone="amber">Not trusted</Badge>}
      {installed?.loadError && <Badge tone="danger">Failed to load</Badge>}
    </span>
  )
}

function PluginPrimaryAction({ item, plugins }: Pick<PluginCardProps, 'item' | 'plugins'>) {
  const operation = plugins.operationByName[item.name]
  const isBusy = operation !== undefined
  if (!item.installed) {
    return (
      <Button size="sm" aria-label={`Install ${item.name}`} disabled={isBusy} onClick={() => void plugins.install(item.name)}>
        {operation === 'installing' ? 'Installing…' : 'Install'}
      </Button>
    )
  }
  if (!item.updateAvailable) return null
  return (
    <Button size="sm" aria-label={`Update ${item.name}`} disabled={isBusy} onClick={() => void plugins.update(item.name)}>
      {operation === 'updating' ? 'Updating…' : 'Update'}
    </Button>
  )
}

interface DetailsToggleProps {
  item: PluginListItem
  isOpen: boolean
  detailsId: string
  onToggle: () => void
}

function DetailsToggle({ item, isOpen, detailsId, onToggle }: DetailsToggleProps) {
  const verb = item.installed ? 'Manage' : 'Details'
  return (
    <Button
      variant="secondary"
      size="sm"
      aria-label={item.installed ? `Manage ${item.name}` : `Details for ${item.name}`}
      aria-expanded={isOpen}
      aria-controls={detailsId}
      onClick={onToggle}
      className="w-[104px]"
    >
      {verb}
      <Icon name="chevronDown" size={14} className={joinClassNames('transition-transform', isOpen && 'rotate-180')} />
    </Button>
  )
}

function PluginRowSummary({ item }: { item: PluginListItem }) {
  return (
    <div className="flex min-w-0 flex-1 flex-col gap-1">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <b className="font-semibold text-ink">{item.name}</b>
        <PluginStatusBadges item={item} />
      </div>
      <p title={item.description} className="m-0 line-clamp-1 text-[13px] text-body">
        {item.description}
      </p>
      <PluginPermissionChips pluginName={item.name} permissions={item.permissions} needsBrowser={item.needsBrowser} />
    </div>
  )
}

/**
 * One plugin row on Connections → Plugins: name, status, a one-line description and
 * permission chips, with the main action (Install / Update) and a Manage / Details toggle
 * aligned right. Install progress and errors show under the row; everything else (trust,
 * settings, steps, full permissions, Remove) is in the expandable details.
 */
export function PluginCard({ item, plugins, isBrowserReady }: PluginCardProps) {
  const detailsId = useId()
  const [isOpen, toggleDetails] = useDetailsOpenState(item.installed ? pluginNeedsAttention(item.installed) : false)
  const progress = plugins.progressByName[item.name]
  const errorMessage = plugins.errorByName[item.name]
  return (
    <article aria-label={item.name}>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3">
        <PluginRowSummary item={item} />
        <div className="ml-auto flex shrink-0 items-center gap-2">
          <PluginPrimaryAction item={item} plugins={plugins} />
          <DetailsToggle item={item} isOpen={isOpen} detailsId={detailsId} onToggle={toggleDetails} />
        </div>
        {(progress || errorMessage) && (
          <div className="flex basis-full flex-col gap-1">
            {progress && (
              <span role="status" className="text-[13px] text-ink-2">
                {describeInstallProgress(progress)}
              </span>
            )}
            {errorMessage && (
              <p role="alert" className="m-0 text-[13px] text-danger">
                {errorMessage}
              </p>
            )}
          </div>
        )}
      </div>
      {isOpen && <PluginDetails id={detailsId} item={item} plugins={plugins} isBrowserReady={isBrowserReady} />}
    </article>
  )
}
