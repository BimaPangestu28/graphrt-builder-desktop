import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Button, buttonClassNames, joinClassNames } from '@/components/ui'
import { usePluginUpdates, type PluginUpdatesState } from '@/hooks/usePluginUpdates'
import { RestartControls } from '@/pages/updates/RestartControls'
import { useAppUpdates, type AppUpdateControls } from '@/pages/updates/updateContext'
import { findPluginDisplayName } from '@/lib/pluginDisplayName'
import { pluginDetailPath, routePaths } from '@/routes'
import { buildUpdatesNoticeLines, hasUndismissedLine, readDismissedUpdateKeys, writeDismissedUpdateKeys, type UpdatesNoticeLine } from './updatesNoticeLines'
import { useT } from '@/i18n'

const updatesListPath = `${routePaths.plugins}?tab=updates`
const actionClassNames = '!h-8 shrink-0 !rounded-[9px] !px-3'

interface LineActionProps {
  line: UpdatesNoticeLine
  updateControls: AppUpdateControls | null
  pluginUpdates: PluginUpdatesState
}

/** "Review", named for what it opens so it never reads like Needs you's "Review". */
function ReviewLink({ path, isPrimary, ariaLabel }: { path: string; isPrimary: boolean; ariaLabel: string }) {
  const t = useT().home
  return (
    <Link to={path} aria-label={ariaLabel} className={buttonClassNames(isPrimary ? 'primary' : 'secondary', 'sm', joinClassNames(actionClassNames, isPrimary ? '!text-white' : '!text-ink'))}>
      {t.review}
    </Link>
  )
}

function LineAction({ line, updateControls, pluginUpdates }: LineActionProps) {
  const t = useT().home
  const { action } = line
  switch (action.kind) {
    case 'restart':
      return updateControls ? <RestartControls updateControls={updateControls} /> : null
    case 'download':
      return updateControls ? (
        <Button size="sm" className={actionClassNames} onClick={() => void updateControls.downloadNow()}>
          {t.download}
        </Button>
      ) : null
    case 'updateAll':
      return (
        <div className="flex shrink-0 gap-2">
          <ReviewLink path={action.reviewPath} isPrimary={false} ariaLabel={t.reviewPluginUpdates} />
          <Button size="sm" className={actionClassNames} disabled={pluginUpdates.isUpdatingAll} onClick={() => void pluginUpdates.updateAll()}>
            {pluginUpdates.isUpdatingAll ? t.updating : t.updateAll}
          </Button>
        </div>
      )
    case 'review':
      return <ReviewLink path={action.path} isPrimary ariaLabel={t.reviewApprovalUpdates} />
    case 'none':
      return null
  }
}

/** "Updated 2 plugins" after Update all, and what could not be updated. */
function UpdateAllResult({ pluginUpdates }: { pluginUpdates: PluginUpdatesState }) {
  const t = useT().home
  const { lastSummary, updateAllError } = pluginUpdates
  if (updateAllError) {
    return (
      <p role="alert" className="m-0 px-[18px] pb-3 text-[13px] text-danger">
        {t.couldNotUpdatePlugins(updateAllError)}
      </p>
    )
  }
  if (!lastSummary) return null
  const updatedCount = lastSummary.updated.length
  const catalogPlugins = pluginUpdates.data?.catalogPlugins ?? []
  return (
    <div className="flex flex-col gap-1 px-[18px] pb-3 text-[13px]">
      {updatedCount > 0 && (
        <p role="status" className="m-0 text-body">
          {updatedCount === 1 ? t.updatedOne(findPluginDisplayName(catalogPlugins, lastSummary.updated[0].name)) : t.updatedMany(updatedCount)}
        </p>
      )}
      {lastSummary.failed.map((failure) => (
        <p key={failure.name} role="alert" className="m-0 text-danger">
          {t.couldNotUpdatePlugin(findPluginDisplayName(catalogPlugins, failure.name), failure.message)}
        </p>
      ))}
    </div>
  )
}

/**
 * Compact, dismissible "Updates" notice for Home: the app update (ready → Restart,
 * downloading, or available → Download), plugin updates ready to install (Review /
 * Update all), plugin updates that ask for new permissions (Review), and plugins updated
 * automatically in the last 24 hours. Dismiss hides it until a new line appears.
 * Self-contained, so any Home layout can place it; renders nothing when there is no news.
 */
export function UpdatesNotice() {
  const t = useT().home
  const updateControls = useAppUpdates()
  const pluginUpdates = usePluginUpdates()
  const [dismissedKeys, setDismissedKeys] = useState(readDismissedUpdateKeys)
  const lines = buildUpdatesNoticeLines({
    appStatus: updateControls?.status ?? null,
    pendingUpdates: pluginUpdates.data?.pendingUpdates ?? [],
    autoUpdates: pluginUpdates.data?.autoUpdates ?? [],
    now: new Date(),
    updatesListPath,
    pluginPath: pluginDetailPath,
    knownPlugins: pluginUpdates.data?.catalogPlugins ?? [],
  })
  const hasResult = pluginUpdates.lastSummary !== null || pluginUpdates.updateAllError !== null
  if (!hasResult && (lines.length === 0 || !hasUndismissedLine(lines, dismissedKeys))) return null

  function dismiss() {
    const keys = new Set(lines.map((line) => line.key))
    writeDismissedUpdateKeys(keys)
    setDismissedKeys(keys)
  }

  return (
    <section aria-labelledby="home-updates" className="flex flex-col rounded-[14px] border border-line bg-surface">
      <div className="flex items-center justify-between gap-2 border-b border-chip px-[18px] py-2.5">
        <h2 id="home-updates" className="m-0 flex items-center gap-2 text-[14px] font-semibold">
          <span aria-hidden="true" className="size-2 rounded-full bg-brand" />
          {t.updates}
        </h2>
        <Button variant="ghost" size="sm" aria-label={t.dismissUpdates} onClick={dismiss}>
          {t.dismiss}
        </Button>
      </div>
      <ul className="m-0 list-none p-0">
        {lines.map((line) => (
          <li key={line.key} className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-chip px-[18px] py-3 last:border-b-0">
            <span className={joinClassNames('min-w-0 flex-[1_1_260px]', line.needsApproval ? 'font-medium text-amber-strong' : 'text-ink')}>{line.text}</span>
            <div className="ml-auto">
              <LineAction line={line} updateControls={updateControls} pluginUpdates={pluginUpdates} />
            </div>
          </li>
        ))}
      </ul>
      <UpdateAllResult pluginUpdates={pluginUpdates} />
    </section>
  )
}
