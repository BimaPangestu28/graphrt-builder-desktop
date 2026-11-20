import { Button, type ButtonSize } from '@/components/ui'
import type { PluginsState } from '@/hooks/usePlugins'
import { describeInstallProgress, type PluginListItem } from './pluginDisplay'

interface PluginActionProps {
  item: PluginListItem
  plugins: PluginsState
  size?: ButtonSize
}

function isBusy(item: PluginListItem, plugins: PluginsState): boolean {
  return plugins.operationByName[item.name] !== undefined
}

/**
 * Installs right away: render it only where what the plugin asks for is on screen next
 * to it (the detail page, or the card's approval step), so the click is an informed OK.
 */
export function PluginInstallButton({ item, plugins, size = 'sm', ariaLabel }: PluginActionProps & { ariaLabel?: string }) {
  const isInstalling = plugins.operationByName[item.name] === 'installing'
  return (
    <Button size={size} aria-label={ariaLabel ?? `Install ${item.displayName}`} disabled={isBusy(item, plugins)} onClick={() => void plugins.install(item.name)}>
      {isInstalling ? 'Installing…' : 'Install'}
    </Button>
  )
}

export function PluginUpdateButton({ item, plugins, size = 'sm' }: PluginActionProps) {
  const isUpdating = plugins.operationByName[item.name] === 'updating'
  return (
    <Button size={size} aria-label={`Update ${item.displayName}`} disabled={isBusy(item, plugins)} onClick={() => void plugins.update(item.name)}>
      {isUpdating ? 'Updating…' : `Update to v${item.version}`}
    </Button>
  )
}

export function PluginRemoveButton({ item, plugins, size = 'sm' }: PluginActionProps) {
  const isRemoving = plugins.operationByName[item.name] === 'removing'
  return (
    <Button variant="danger" size={size} aria-label={`Remove ${item.displayName}`} disabled={isBusy(item, plugins)} onClick={() => void plugins.remove(item.name)}>
      {isRemoving ? 'Removing…' : 'Remove'}
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
