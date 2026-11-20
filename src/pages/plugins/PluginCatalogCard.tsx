import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Badge, Button, buttonClassNames } from '@/components/ui'
import type { PluginsState } from '@/hooks/usePlugins'
import { pluginDetailPath } from '@/routes'
import { PluginInstallButton, PluginOperationFeedback, PluginUpdateButton } from './PluginActions'
import { pluginCategoryLabels } from './pluginCategories'
import { describeMaturity, describePermissionChips, describePluginStatus, describeStepCount, itemNeedsAttention, type PluginListItem } from './pluginDisplay'
import { PluginMonogram } from './PluginMonogram'
import { PluginPermissionChips } from './PluginPermissionList'

interface PluginCatalogCardProps {
  item: PluginListItem
  plugins: PluginsState
  /** Search string of the Plugins page, so the detail page's back link returns to the same filters. */
  listSearch: string
}

function describeCardMeta(item: PluginListItem): string {
  const versionText = item.installed && item.updateAvailable ? `v${item.installed.version} installed` : `v${item.version}`
  return [pluginCategoryLabels[item.category], versionText, describeMaturity(item.maturity)].filter(Boolean).join(' · ')
}

/**
 * "Install" on a card first asks: it names what the plugin gets, says it starts untrusted,
 * and installs only after the second click. Nothing installs from a single stray click.
 */
function InstallApproval({ item, plugins, onCancel }: { item: PluginListItem; plugins: PluginsState; onCancel: () => void }) {
  const asksFor = describePermissionChips(item.permissions, item.needsBrowser)
  const isInstalling = plugins.operationByName[item.name] === 'installing'
  return (
    <div role="group" aria-label={`Install ${item.name}?`} className="flex flex-col gap-2 rounded-lg bg-subtle p-2.5">
      <p className="m-0 text-[12px] leading-normal text-body">
        Runs its code on this computer{asksFor.length > 0 ? ` and asks for: ${asksFor.join(', ')}` : ''}. It starts untrusted, without settings or secrets.
      </p>
      <div className="flex justify-end gap-2">
        {!isInstalling && (
          <Button variant="ghost" size="sm" onClick={onCancel}>
            Cancel
          </Button>
        )}
        <PluginInstallButton item={item} plugins={plugins} ariaLabel={`Confirm install ${item.name}`} />
      </div>
    </div>
  )
}

function OpenLink({ item, listSearch, label, isPrimary }: { item: PluginListItem; listSearch: string; label: string; isPrimary: boolean }) {
  return (
    <Link
      to={pluginDetailPath(item.name)}
      state={{ listSearch }}
      aria-label={`${label} ${item.name}`}
      className={buttonClassNames(isPrimary ? 'primary' : 'secondary', 'sm', isPrimary ? '!text-white' : '!text-ink')}
    >
      {label}
    </Link>
  )
}

function CardActions({ item, plugins, listSearch, onStartInstall }: PluginCatalogCardProps & { onStartInstall: () => void }) {
  if (!item.installed) {
    return (
      <>
        <OpenLink item={item} listSearch={listSearch} label="Details" isPrimary={false} />
        <Button size="sm" aria-label={`Install ${item.name}`} onClick={onStartInstall}>
          Install
        </Button>
      </>
    )
  }
  if (item.updateAvailable) {
    return (
      <>
        <OpenLink item={item} listSearch={listSearch} label="Open" isPrimary={false} />
        <PluginUpdateButton item={item} plugins={plugins} />
      </>
    )
  }
  const needsSetup = itemNeedsAttention(item)
  return <OpenLink item={item} listSearch={listSearch} label={needsSetup ? 'Set up' : 'Open'} isPrimary={needsSetup} />
}

/**
 * One plugin in the Plugins grid. Every card has the same shape so rows line up: monogram,
 * name and status, a two-line description, what it asks for, then the step count and the
 * main action pinned to the bottom (Install → approval, Update, Set up or Open).
 */
export function PluginCatalogCard({ item, plugins, listSearch }: PluginCatalogCardProps) {
  const [isApproving, setIsApproving] = useState(false)
  const status = describePluginStatus(item)
  const showsApproval = isApproving && !item.installed
  return (
    <article aria-label={item.name} className="flex h-full flex-col gap-3 rounded-[14px] border border-line bg-surface p-4 transition-shadow hover:shadow-[0_2px_8px_rgba(0,0,0,0.06)]">
      <div className="flex items-start gap-3">
        <PluginMonogram name={item.name} category={item.category} />
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <h3 className="m-0 truncate text-[14px] font-semibold">
            <Link to={pluginDetailPath(item.name)} state={{ listSearch }} className="no-underline !text-ink hover:underline">
              {item.name}
            </Link>
          </h3>
          <span className="truncate text-[12px] text-muted">{describeCardMeta(item)}</span>
        </div>
        <Badge tone={status.tone} className="shrink-0">
          {status.label}
        </Badge>
      </div>
      <p title={item.description} className="m-0 line-clamp-2 min-h-[38px] text-[13px] leading-[19px] text-body">
        {item.description}
      </p>
      <div className="min-h-[18px]">
        <PluginPermissionChips pluginName={item.name} permissions={item.permissions} needsBrowser={item.needsBrowser} />
      </div>
      <div className="mt-auto flex flex-col gap-2 border-t border-chip pt-3">
        <PluginOperationFeedback pluginName={item.name} plugins={plugins} />
        {showsApproval ? (
          <InstallApproval item={item} plugins={plugins} onCancel={() => setIsApproving(false)} />
        ) : (
          <div className="flex items-center justify-between gap-2">
            <span className="text-[12px] text-muted">{item.nodes.length > 0 ? describeStepCount(item.nodes.length) : 'No steps listed'}</span>
            <div className="flex items-center gap-2">
              <CardActions item={item} plugins={plugins} listSearch={listSearch} onStartInstall={() => setIsApproving(true)} />
            </div>
          </div>
        )}
      </div>
    </article>
  )
}
