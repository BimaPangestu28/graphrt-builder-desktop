import { useState } from 'react'
import { pluginRuntimeDownloadSizeNote, type PluginRuntimeInfo } from '@/api/pluginTypes'
import { Badge } from '@/components/ui'
import { usePluginRuntime, type PluginRuntimeState } from '@/hooks/usePluginRuntime'
import { describeError } from '@/lib/agentDisplay'
import { describePluginRuntimeStatus } from '../plugins/PluginRuntimeCard'
import { ActionRow, SettingsGroup, settingsButtonClassNames } from './SettingRows'

const rowButtonClassNames = `${settingsButtonClassNames} h-[34px] rounded-lg px-3 disabled:cursor-default disabled:opacity-60`

const sourceLabels: Record<PluginRuntimeInfo['source'], string> = {
  downloaded: 'downloaded from nodejs.org',
  development: 'development copy (src-tauri/binaries)',
  system: 'Node.js on PATH (debug build)',
  missing: 'not installed',
}

/**
 * The plugin runtime row's description, e.g. "Node.js v22.23.5, downloaded from nodejs.org · /…/node".
 *
 * @returns One line for the settings row (string)
 */
export function describePluginRuntimeDetails(info: PluginRuntimeInfo | null): string {
  if (!info) return 'Node.js, which plugins run on'
  if (info.status !== 'installed') return `Node.js v${info.pinnedVersion}, which plugins run on · ${pluginRuntimeDownloadSizeNote} when a plugin needs it`
  const location = info.path ? ` · ${info.path}` : ''
  return `Node.js ${info.version ?? `v${info.pinnedVersion}`}, ${sourceLabels[info.source]}${location}`
}

function PluginRuntimeAction({ runtime }: { runtime: PluginRuntimeState }) {
  const [isConfirmingRemove, setIsConfirmingRemove] = useState(false)
  const status = describePluginRuntimeStatus(runtime)
  if (runtime.status === 'not_installed' && runtime.info?.downloadable !== false) {
    return (
      <button type="button" className={rowButtonClassNames} onClick={() => void runtime.install()}>
        Install
      </button>
    )
  }
  if (runtime.status === 'installed' && runtime.info?.removable) {
    if (!isConfirmingRemove) {
      return (
        <button type="button" className={rowButtonClassNames} disabled={runtime.isRemoving} onClick={() => setIsConfirmingRemove(true)}>
          {runtime.isRemoving ? 'Removing…' : 'Remove'}
        </button>
      )
    }
    return (
      <span role="group" aria-label="Remove the plugin runtime?" className="flex shrink-0 items-center gap-2">
        <button type="button" className={rowButtonClassNames} onClick={() => setIsConfirmingRemove(false)}>
          Cancel
        </button>
        <button
          type="button"
          className={rowButtonClassNames}
          onClick={() => {
            setIsConfirmingRemove(false)
            void runtime.remove()
          }}
        >
          Remove plugin runtime
        </button>
      </span>
    )
  }
  return (
    <Badge tone={status.tone} className="shrink-0 whitespace-normal">
      {status.label}
    </Badge>
  )
}

/**
 * Settings › Runner › Plugin runtime: whether Node.js (downloaded on demand, never bundled)
 * is installed, its version and folder, Install, and Remove (plugins stop working until it is
 * installed again; it can be downloaded again any time).
 */
export function PluginRuntimeSection() {
  const runtime = usePluginRuntime()
  return (
    <SettingsGroup headingId="settings-plugin-runtime-heading" title="Plugin runtime">
      <ActionRow title="Plugin runtime" description={describePluginRuntimeDetails(runtime.info)} action={<PluginRuntimeAction runtime={runtime} />} />
      {runtime.status === 'installing' && (
        <p role="status" className="m-0 text-[13px] text-body">
          {runtime.progressText ?? 'Installing…'}
        </p>
      )}
      {runtime.status === 'installed' && runtime.info?.removable && (
        <p className="m-0 text-[13px] text-muted">Removing it frees about 110 MB. Plugins stop working until it is installed again</p>
      )}
      {runtime.installError && (
        <p role="alert" className="m-0 text-[13px] text-danger">
          Could not install the plugin runtime: {runtime.installError}
        </p>
      )}
      {runtime.removeError && (
        <p role="alert" className="m-0 text-[13px] text-danger">
          Could not remove the plugin runtime: {runtime.removeError}
        </p>
      )}
      {runtime.loadError && (
        <p role="alert" className="m-0 text-[13px] text-danger">
          Could not check the plugin runtime: {describeError(runtime.loadError)}
        </p>
      )}
    </SettingsGroup>
  )
}
