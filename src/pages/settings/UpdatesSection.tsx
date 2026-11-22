import type { ReactNode } from 'react'
import type { AppSettings } from '@/api/appSettingsTypes'
import type { AvailableUpdate } from '@/api/updates'
import { RestartControls } from '../updates/RestartControls'
import { useAppUpdates, type AppUpdateControls, type UpdateStatus } from '../updates/updateContext'
import { ActionRow, SettingsGroup, ToggleRow, settingsButtonClassNames } from './SettingRows'
import type { UpdateAppSetting } from './useAppSettings'

interface UpdatesSectionProps {
  /** Null while the stored preferences load (the toggle waits for them). */
  appSettings: AppSettings | null
  updateAppSetting: UpdateAppSetting
  /** Shown when the updater has not read the version yet. */
  fallbackVersion: string | null
}

const busyStatusKinds: ReadonlyArray<UpdateStatus['kind']> = ['checking', 'downloading', 'ready']

/** One line saying where the update check is. */
function UpdateStatusLine({ status }: { status: UpdateStatus }) {
  switch (status.kind) {
    case 'unavailable':
    case 'idle':
      return null
    case 'checking':
      return <StatusText>Checking for updates…</StatusText>
    case 'upToDate':
      return <StatusText>Up to date</StatusText>
    case 'available':
      return <StatusText>Version {status.update.version} is available</StatusText>
    case 'downloading':
      return <DownloadProgressLine update={status.update} percent={status.percent} />
    case 'ready':
      return <StatusText>Version {status.update.version} is ready. Restart graphrt to update</StatusText>
    case 'checkFailed':
      return (
        <p role="alert" className="m-0 text-[13px] text-danger">
          Could not check for updates: {status.message}
        </p>
      )
  }
}

function StatusText({ children }: { children: ReactNode }) {
  return (
    <p role="status" className="m-0 text-[13px] text-body">
      {children}
    </p>
  )
}

function DownloadProgressLine({ update, percent }: { update: AvailableUpdate; percent: number | null }) {
  const label = `Downloading version ${update.version}…${percent === null ? '' : ` ${percent}%`}`
  return (
    <div className="flex flex-col gap-1.5">
      <StatusText>{label}</StatusText>
      <progress aria-label="Update download" max={100} value={percent ?? undefined} className="h-1.5 w-full accent-ink" />
    </div>
  )
}

function ReleaseNotes({ update }: { update: AvailableUpdate }) {
  if (!update.releaseNotes) return null
  return (
    <details className="text-[13px] text-body">
      <summary className="cursor-pointer font-medium text-ink">What's new in {update.version}</summary>
      <p className="m-0 mt-2 max-h-48 overflow-y-auto whitespace-pre-wrap">{update.releaseNotes}</p>
    </details>
  )
}

/** Status, release notes and the action that fits it (download or restart). */
function UpdateDetails({ updateControls }: { updateControls: AppUpdateControls }) {
  const { status, downloadNow } = updateControls
  const hasUpdate = status.kind === 'available' || status.kind === 'downloading' || status.kind === 'ready'
  return (
    <div className="flex flex-col gap-2.5 py-3.5">
      <UpdateStatusLine status={status} />
      {status.kind === 'available' && status.downloadError && (
        <p role="alert" className="m-0 text-[13px] text-danger">
          Could not download the update: {status.downloadError}
        </p>
      )}
      {hasUpdate && <ReleaseNotes update={status.update} />}
      {status.kind === 'available' && (
        <button type="button" onClick={() => void downloadNow()} className={`${settingsButtonClassNames} h-[34px] self-start`}>
          Download version {status.update.version}
        </button>
      )}
      {status.kind === 'ready' && <RestartControls updateControls={updateControls} />}
    </div>
  )
}

/** "Automatically update plugins" (also on the Plugins page); waits for the stored preferences. */
function PluginAutoUpdateRow({ appSettings, updateAppSetting }: Pick<UpdatesSectionProps, 'appSettings' | 'updateAppSetting'>) {
  if (!appSettings) return null
  return (
    <ToggleRow
      title="Automatically update plugins"
      description="New plugin versions install by themselves when no agent is running. Versions asking for new permissions, and community plugins, wait for your approval"
      isChecked={appSettings.autoUpdatePlugins}
      onToggle={(isChecked) => void updateAppSetting('autoUpdatePlugins', isChecked)}
      hasDivider={false}
    />
  )
}

/**
 * Updates group: the running version, "Check for updates", what the last check found
 * (with release notes and the download / restart that follows) and "Automatically
 * download updates". The browser preview cannot update, so it says where updates happen.
 */
export function UpdatesSection({ appSettings, updateAppSetting, fallbackVersion }: UpdatesSectionProps) {
  const updateControls = useAppUpdates()
  const version = updateControls?.currentVersion ?? fallbackVersion
  const versionText = version ? `Version ${version}` : 'Loading…'
  if (!updateControls || updateControls.status.kind === 'unavailable') {
    return (
      <SettingsGroup headingId="settings-updates-heading" title="Updates">
        <ActionRow title="graphrt" description={versionText} action={null} />
        <p className="m-0 py-3.5 text-[13px] text-body">Updates are available in the desktop app</p>
        <PluginAutoUpdateRow appSettings={appSettings} updateAppSetting={updateAppSetting} />
      </SettingsGroup>
    )
  }
  const isBusy = busyStatusKinds.includes(updateControls.status.kind)
  return (
    <SettingsGroup headingId="settings-updates-heading" title="Updates">
      <ActionRow
        title="graphrt"
        description={versionText}
        hasDivider={false}
        action={
          <button type="button" disabled={isBusy} onClick={() => void updateControls.checkNow()} className={`${settingsButtonClassNames} h-[34px] disabled:cursor-not-allowed disabled:opacity-50`}>
            Check for updates
          </button>
        }
      />
      <UpdateDetails updateControls={updateControls} />
      {appSettings && (
        <ToggleRow
          title="Automatically download updates"
          description="New versions download in the background and install when you restart"
          isChecked={appSettings.autoDownloadUpdates}
          onToggle={(isChecked) => void updateAppSetting('autoDownloadUpdates', isChecked)}
          hasDivider={false}
        />
      )}
      <PluginAutoUpdateRow appSettings={appSettings} updateAppSetting={updateAppSetting} />
    </SettingsGroup>
  )
}
