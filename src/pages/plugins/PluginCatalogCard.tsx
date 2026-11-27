import { useId, useState } from 'react'
import { Link } from 'react-router-dom'
import { Badge, Button, buttonClassNames } from '@/components/ui'
import type { PluginsState } from '@/hooks/usePlugins'
import { isPluginRuntimeMissing, usePluginRuntime } from '@/hooks/usePluginRuntime'
import { pluginDetailPath } from '@/routes'
import { PluginInstallButton, PluginOperationFeedback, PluginUpdateButton } from './PluginActions'
import { pluginCategoryLabels } from './pluginCategories'
import { describeCommunityInstallNote, describeMaturity, pluginInstallTrustNote, describePermissionChips, describePluginSource, describePluginStatus, describeStepCount, itemNeedsAttention, type PluginListItem } from './pluginDisplay'
import { PluginIcon } from './PluginIcon'
import { PluginNewerAppNotice } from './PluginNewerAppNotice'
import { PluginPermissionChips } from './PluginPermissionList'
import { pluginRuntimeInstallNote } from './PluginRuntimeCard'
import { messages, useT } from '@/i18n'

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
 * While the plugin runtime (Node.js) is missing it says the same click downloads it too.
 */
function InstallApproval({ item, plugins, onCancel }: { item: PluginListItem; plugins: PluginsState; onCancel: () => void }) {
  const asksFor = [...(item.mcpServer ? [messages().plugins.mcpServerBadge] : []), ...describePermissionChips(item.permissions, item.needsBrowser)]
  const isInstalling = plugins.operationByName[item.name] === 'installing'
  const communityNote = describeCommunityInstallNote(item)
  const needsPluginRuntime = isPluginRuntimeMissing(usePluginRuntime())
  const t = useT().plugins
  return (
    <div role="group" aria-label={t.installQuestion(item.displayName)} className="flex flex-col gap-2 rounded-lg bg-subtle p-2.5">
      <p className="m-0 text-[12px] leading-normal text-body">{t.runsCode(communityNote ? `${communityNote} ` : '', asksFor.length > 0 ? asksFor.join(', ') : null)}</p>
      {needsPluginRuntime && <p className="m-0 text-[12px] leading-normal text-body">{pluginRuntimeInstallNote()}</p>}
      <p className="m-0 text-[12px] font-medium leading-normal text-ink-2">{pluginInstallTrustNote()}</p>
      <div className="flex justify-end gap-2">
        {!isInstalling && (
          <Button variant="ghost" size="sm" onClick={onCancel}>
            {t.cancel}
          </Button>
        )}
        <PluginInstallButton item={item} plugins={plugins} ariaLabel={t.confirmInstall(item.displayName)} withPluginRuntime={needsPluginRuntime} />
      </div>
    </div>
  )
}

function OpenLink({ item, listSearch, label, isPrimary }: { item: PluginListItem; listSearch: string; label: string; isPrimary: boolean }) {
  return (
    <Link
      to={pluginDetailPath(item.name)}
      state={{ listSearch }}
      aria-label={`${label} ${item.displayName}`}
      className={buttonClassNames(isPrimary ? 'primary' : 'secondary', 'sm', isPrimary ? '!text-inverse' : '!text-ink')}
    >
      {label}
    </Link>
  )
}

interface CardActionsProps extends PluginCatalogCardProps {
  onStartInstall: () => void
  /** `id` of the card's "needs a newer app" note, when it shows one. */
  newerAppNoticeId: string | undefined
}

function CardActions({ item, plugins, listSearch, onStartInstall, newerAppNoticeId }: CardActionsProps) {
  const t = useT().plugins
  if (!item.installed) {
    return (
      <>
        <OpenLink item={item} listSearch={listSearch} label={t.details} isPrimary={false} />
        <Button size="sm" aria-label={t.installPlugin(item.displayName)} aria-describedby={newerAppNoticeId} disabled={Boolean(item.needsNewerApp)} onClick={onStartInstall}>
          {t.install}
        </Button>
      </>
    )
  }
  if (item.updateAvailable && item.needsNewerApp) {
    // The update waits for a newer app; the installed version is opened as usual.
    return <OpenLink item={item} listSearch={listSearch} label={t.open} isPrimary={false} />
  }
  if (item.updateAvailable && item.updateNeedsApproval) {
    return <OpenLink item={item} listSearch={listSearch} label={t.reviewUpdate} isPrimary />
  }
  if (item.updateAvailable) {
    return (
      <>
        <OpenLink item={item} listSearch={listSearch} label={t.open} isPrimary={false} />
        <PluginUpdateButton item={item} plugins={plugins} />
      </>
    )
  }
  const needsSetup = itemNeedsAttention(item)
  return <OpenLink item={item} listSearch={listSearch} label={needsSetup ? t.setUp : t.open} isPrimary={needsSetup} />
}

/**
 * One plugin in the Plugins grid. Every card has the same shape so rows line up: icon,
 * name and status, a two-line description, what it asks for, then the step count and the
 * main action pinned to the bottom (Install → approval, Update, Set up or Open).
 */
export function PluginCatalogCard({ item, plugins, listSearch }: PluginCatalogCardProps) {
  const [isApproving, setIsApproving] = useState(false)
  const status = describePluginStatus(item)
  const sourceBadge = describePluginSource(item.source)
  const noticeId = useId()
  // Too old an app only matters for what the catalog offers: an install, or an update of an installed plugin.
  const newerAppNeeded = (!item.installed || item.updateAvailable) && item.needsNewerApp ? item.needsNewerApp : null
  const showsApproval = isApproving && !item.installed && !newerAppNeeded
  return (
    <article aria-label={item.displayName} className="flex h-full flex-col gap-3 rounded-[14px] border border-line bg-surface p-4 transition-shadow hover:shadow-[0_2px_8px_rgba(0,0,0,0.06)]">
      <div className="flex items-start gap-3">
        <PluginIcon name={item.name} iconUrl={item.iconUrl} category={item.category} />
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <h3 className="m-0 truncate text-[14px] font-semibold">
            <Link to={pluginDetailPath(item.name)} state={{ listSearch }} className="no-underline !text-ink hover:underline">
              {item.displayName}
            </Link>
          </h3>
          <span className="flex min-w-0 items-center gap-1.5">
            {sourceBadge && (
              <Badge tone={sourceBadge.tone} className="shrink-0 !px-2 !text-[11px]">
                {sourceBadge.label}
              </Badge>
            )}
            <span className="truncate text-[12px] text-muted">{describeCardMeta(item)}</span>
          </span>
        </div>
        <Badge tone={status.tone} className="shrink-0">
          {status.label}
        </Badge>
      </div>
      <p title={item.description} className="m-0 line-clamp-2 min-h-[38px] text-[13px] leading-[19px] text-body">
        {item.description}
      </p>
      <div className="min-h-[18px]">
        <PluginPermissionChips pluginLabel={item.displayName} permissions={item.permissions} needsBrowser={item.needsBrowser} />
      </div>
      <div className="mt-auto flex flex-col gap-2 border-t border-chip pt-3">
        <PluginOperationFeedback pluginName={item.name} plugins={plugins} />
        {newerAppNeeded && (
          <PluginNewerAppNotice id={noticeId} pluginLabel={item.displayName} needed={newerAppNeeded} waitingUpdateVersion={item.installed ? item.version : undefined} />
        )}
        {showsApproval ? (
          <InstallApproval item={item} plugins={plugins} onCancel={() => setIsApproving(false)} />
        ) : (
          <div className="flex items-center justify-between gap-2">
            <span className="text-[12px] text-muted">{item.nodes.length > 0 ? describeStepCount(item.nodes.length) : messages().plugins.noStepsListed}</span>
            <div className="flex items-center gap-2">
              <CardActions item={item} plugins={plugins} listSearch={listSearch} onStartInstall={() => setIsApproving(true)} newerAppNoticeId={newerAppNeeded ? noticeId : undefined} />
            </div>
          </div>
        )}
      </div>
    </article>
  )
}
