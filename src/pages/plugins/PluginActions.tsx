import { Button, type ButtonSize } from '@/components/ui'
import type { PluginsState } from '@/hooks/usePlugins'
import { describeInstallProgress, type PluginListItem } from './pluginDisplay'
import { useT } from '@/i18n'

interface PluginActionProps {
  item: PluginListItem
  plugins: PluginsState
  size?: ButtonSize
  /** `id` of the note that says why the button is disabled (see `PluginNewerAppNotice`). */
  describedBy?: string
}

/** The plugin needs a newer app: nothing can be installed until the app is updated. */
function waitsForNewerApp(item: PluginListItem): boolean {
  return Boolean(item.needsNewerApp)
}

function isBusy(item: PluginListItem, plugins: PluginsState): boolean {
  return plugins.operationByName[item.name] !== undefined
}

interface PluginInstallButtonProps extends PluginActionProps {
  ariaLabel?: string
  /** The approval next to the button says the plugin runtime downloads too (see `pluginRuntimeInstallNote`). */
  withPluginRuntime?: boolean
}

/**
 * Installs right away: render it only where what the plugin asks for is on screen next
 * to it (the detail page, or the card's approval step), so the click is an informed OK.
 */
export function PluginInstallButton({ item, plugins, size = 'sm', ariaLabel, withPluginRuntime = false, describedBy }: PluginInstallButtonProps) {
  const t = useT().plugins
  const isInstalling = plugins.operationByName[item.name] === 'installing'
  return (
    <Button
      size={size}
      aria-label={ariaLabel ?? t.installPlugin(item.displayName)}
      aria-describedby={describedBy}
      disabled={isBusy(item, plugins) || waitsForNewerApp(item)}
      onClick={() => void plugins.install(item.name, item.permissions, { withPluginRuntime })}
    >
      {isInstalling ? t.installing : t.install}
    </Button>
  )
}

export function PluginUpdateButton({ item, plugins, size = 'sm', describedBy }: PluginActionProps) {
  const t = useT().plugins
  const isUpdating = plugins.operationByName[item.name] === 'updating'
  return (
    <Button
      size={size}
      aria-label={t.updatePlugin(item.displayName)}
      aria-describedby={describedBy}
      disabled={isBusy(item, plugins) || waitsForNewerApp(item)}
      onClick={() => void plugins.update(item.name)}
    >
      {isUpdating ? t.updating : t.updateTo(item.version)}
    </Button>
  )
}

export function PluginRemoveButton({ item, plugins, size = 'sm' }: PluginActionProps) {
  const t = useT().plugins
  const isRemoving = plugins.operationByName[item.name] === 'removing'
  return (
    <Button variant="danger" size={size} aria-label={t.removePlugin(item.displayName)} disabled={isBusy(item, plugins)} onClick={() => void plugins.remove(item.name)}>
      {isRemoving ? t.removing : t.remove}
    </Button>
  )
}

/** Live install / update progress and the last failed action of one plugin. Nothing when idle. */
export function PluginOperationFeedback({ pluginName, plugins }: { pluginName: string; plugins: PluginsState }) {
  const progress = plugins.progressByName[pluginName]
  const errorMessage = plugins.errorByName[pluginName]
  if (!progress && !errorMessage) return null
  return (
    <div className="flex flex-col gap-1">
      {progress && (
        <span role="status" className="text-[13px] text-ink-2">
          {describeInstallProgress(progress)}
        </span>
      )}
      {errorMessage && (
        <p role="alert" className="m-0 text-[13px] leading-normal text-danger">
          {errorMessage}
        </p>
      )}
    </div>
  )
}
