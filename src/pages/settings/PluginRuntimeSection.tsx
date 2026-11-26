import { useState } from 'react'
import { pluginRuntimeDownloadSizeNote, type PluginRuntimeInfo } from '@/api/pluginTypes'
import { Badge } from '@/components/ui'
import { usePluginRuntime, type PluginRuntimeState } from '@/hooks/usePluginRuntime'
import { describeError } from '@/lib/agentDisplay'
import { describePluginRuntimeStatus } from '../plugins/PluginRuntimeCard'
import { ActionRow, SettingsGroup, settingsButtonClassNames } from './SettingRows'
import { messages, useT } from '@/i18n'

const rowButtonClassNames = `${settingsButtonClassNames} h-[34px] rounded-lg px-3 disabled:cursor-default disabled:opacity-60`


/**
 * The plugin runtime row's description, e.g. "Node.js v22.23.5, downloaded from nodejs.org · /…/node".
 *
 * @returns One line for the settings row (string)
 */
export function describePluginRuntimeDetails(info: PluginRuntimeInfo | null): string {
  const t = messages().settings
  if (!info) return t.runtimeWhat
  if (info.status !== 'installed') return t.runtimeNotInstalled(info.pinnedVersion, pluginRuntimeDownloadSizeNote())
  const location = info.path ? ` · ${info.path}` : ''
  return t.runtimeInstalled(info.version ?? `v${info.pinnedVersion}`, t.runtimeSources[info.source], location)
}

function PluginRuntimeAction({ runtime }: { runtime: PluginRuntimeState }) {
  const t = useT().settings
  const [isConfirmingRemove, setIsConfirmingRemove] = useState(false)
  const status = describePluginRuntimeStatus(runtime)
  if (runtime.status === 'not_installed' && runtime.info?.downloadable !== false) {
    return (
      <button type="button" className={rowButtonClassNames} onClick={() => void runtime.install()}>
        {t.install}
      </button>
    )
  }
  if (runtime.status === 'installed' && runtime.info?.removable) {
    if (!isConfirmingRemove) {
      return (
        <button type="button" className={rowButtonClassNames} disabled={runtime.isRemoving} onClick={() => setIsConfirmingRemove(true)}>
          {runtime.isRemoving ? t.removing : t.remove}
        </button>
      )
    }
    return (
      <span role="group" aria-label={t.removeRuntimeQuestion} className="flex shrink-0 items-center gap-2">
        <button type="button" className={rowButtonClassNames} onClick={() => setIsConfirmingRemove(false)}>
          {t.cancel}
        </button>
        <button
          type="button"
          className={rowButtonClassNames}
          onClick={() => {
            setIsConfirmingRemove(false)
            void runtime.remove()
          }}
        >
          {t.removeRuntime}
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
  const t = useT().settings
  const runtime = usePluginRuntime()
  return (
    <SettingsGroup headingId="settings-plugin-runtime-heading" title={t.pluginRuntime}>
      <ActionRow title={t.pluginRuntime} description={describePluginRuntimeDetails(runtime.info)} action={<PluginRuntimeAction runtime={runtime} />} />
      {runtime.status === 'installing' && (
        <p role="status" className="m-0 text-[13px] text-body">
          {runtime.progressText ?? t.installing}
        </p>
      )}
      {runtime.status === 'installed' && runtime.info?.removable && (
        <p className="m-0 text-[13px] text-muted">{t.removeRuntimeHint}</p>
      )}
      {runtime.installError && (
        <p role="alert" className="m-0 text-[13px] text-danger">
          {t.couldNotInstallRuntime(runtime.installError)}
        </p>
      )}
      {runtime.removeError && (
        <p role="alert" className="m-0 text-[13px] text-danger">
          {t.couldNotRemoveRuntime(runtime.removeError)}
        </p>
      )}
      {runtime.loadError && (
        <p role="alert" className="m-0 text-[13px] text-danger">
          {t.couldNotCheckRuntime(describeError(runtime.loadError))}
        </p>
      )}
    </SettingsGroup>
  )
}
