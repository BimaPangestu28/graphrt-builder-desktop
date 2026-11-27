import { Button } from '@/components/ui'
import type { NewerAppNeeded } from '@/api/pluginTypes'
import { RestartControls } from '../updates/RestartControls'
import { useAppUpdates, type AppUpdateControls } from '../updates/updateContext'
import { messages, useT } from '@/i18n'

/** "Needs Graphrt Desktop 0.3.0 or newer", or without a number when the catalog gives none this app can read. */
export function describeNewerAppNeed(needed: NewerAppNeeded): string {
  const t = messages().plugins
  return needed.minVersion ? t.needsAppVersion(needed.minVersion) : t.needsNewerApp
}

/**
 * The way to get the newer app, from the app's own updater (the same one as Settings >
 * Updates and the update toast): check, download, then restart. Nothing in the browser
 * preview, which has no updater.
 */
function AppUpdateAction({ updateControls }: { updateControls: AppUpdateControls }) {
  const t = useT().plugins
  const { status } = updateControls
  switch (status.kind) {
    case 'unavailable':
      return null
    case 'idle':
      return (
        <Button size="sm" variant="secondary" onClick={() => void updateControls.checkNow()}>
          {t.checkForAppUpdate}
        </Button>
      )
    case 'checking':
      return (
        <span role="status" className="text-[12px] text-muted">
          {t.checkingForAppUpdate}
        </span>
      )
    case 'upToDate':
      return (
        <span role="status" className="text-[12px] leading-normal text-muted">
          {t.noNewerAppYet}
        </span>
      )
    case 'available':
      return (
        <Button size="sm" variant="secondary" onClick={() => void updateControls.downloadNow()}>
          {t.updateApp}
        </Button>
      )
    case 'downloading':
      return (
        <span role="status" className="text-[12px] text-muted">
          {t.downloadingAppUpdate(status.percent === null ? '' : ` ${status.percent}%`)}
        </span>
      )
    case 'ready':
      return <RestartControls updateControls={updateControls} />
    case 'checkFailed':
      return (
        <>
          <span role="alert" className="text-[12px] leading-normal text-danger">
            {t.couldNotCheckAppUpdate(status.message)}
          </span>
          <Button size="sm" variant="secondary" onClick={() => void updateControls.checkNow()}>
            {t.checkForAppUpdate}
          </Button>
        </>
      )
  }
}

interface PluginNewerAppNoticeProps {
  /** `id` of the note, so the disabled Install or Update button can point at it (`aria-describedby`). */
  id: string
  pluginLabel: string
  needed: NewerAppNeeded
  /** Set when the plugin is installed and only its update to this version waits for the newer app. */
  waitingUpdateVersion?: string
  /** Lines up with the buttons it explains: right on the plugin page, left on a card. */
  align?: 'start' | 'end'
}

/**
 * Says a plugin needs a newer Graphrt Desktop than this one, in plain words, with the way
 * to update next to it. Shown where Install (or Update) would be; that button is disabled.
 */
export function PluginNewerAppNotice({ id, pluginLabel, needed, waitingUpdateVersion, align = 'start' }: PluginNewerAppNoticeProps) {
  const t = useT().plugins
  const updateControls = useAppUpdates()
  const currentVersion = updateControls?.currentVersion ?? null
  const nextStep = waitingUpdateVersion ? t.pluginUpdateNeedsNewerApp(waitingUpdateVersion) : t.updateAppToInstall
  const alignment = align === 'end' ? 'items-end text-right' : 'items-start text-left'
  return (
    <div id={id} role="note" aria-label={t.newerAppNoticeLabel(pluginLabel)} className={`flex flex-col gap-1.5 ${alignment}`}>
      <span className="text-[13px] font-semibold leading-normal text-amber-deep">{describeNewerAppNeed(needed)}</span>
      <span className="text-[12px] leading-normal text-body">
        {currentVersion ? `${t.youHaveAppVersion(currentVersion)} ` : ''}
        {nextStep}
      </span>
      {updateControls && <AppUpdateAction updateControls={updateControls} />}
    </div>
  )
}
