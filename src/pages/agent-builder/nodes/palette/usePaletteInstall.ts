import { useCallback, useState } from 'react'
import { installPlugin } from '@/api/plugins'
import type { PluginPermissions } from '@/api/pluginTypes'
import { describeError } from '@/lib/agentDisplay'
import type { AddNodeAnchor } from '../contracts'
import type { PaletteAction } from './paletteCatalog'

/** A catalog action waiting for the install OK, with where it will go. */
export interface PendingInstall {
  action: PaletteAction
  anchor: AddNodeAnchor | null
}

export interface PaletteInstallState {
  pending: PendingInstall | null
  isInstalling: boolean
  errorMessage: string | null
  /** Plugins installed from the palette in this session (the library may still say not installed). */
  installedPluginNames: ReadonlySet<string>
  /** Shows the approval step for a not-installed action. Installs nothing by itself. */
  requestInstall: (action: PaletteAction, anchor: AddNodeAnchor | null) => void
  cancel: () => void
  /**
   * The explicit OK: installs within `approvedPermissions` (what the prompt showed), then
   * resolves with what to add (null when the install failed, e.g. the plugin asks for more).
   */
  confirm: (approvedPermissions: PluginPermissions) => Promise<PendingInstall | null>
}

/**
 * Install-with-approval for catalog actions picked in the palette (spec C2: "Catalog plugins
 * install only after you approve what they ask for"). Picking an action only opens the
 * approval; `confirm` (the Install button next to what the plugin asks for) installs it.
 *
 * @param onPluginInstalled - Reloads the node library after an install
 * @returns Pending approval, progress, error and the actions (PaletteInstallState)
 */
export function usePaletteInstall(onPluginInstalled?: (pluginName: string) => void | Promise<void>): PaletteInstallState {
  const [pending, setPending] = useState<PendingInstall | null>(null)
  const [isInstalling, setIsInstalling] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [installedPluginNames, setInstalledPluginNames] = useState<ReadonlySet<string>>(new Set())

  const requestInstall = useCallback((action: PaletteAction, anchor: AddNodeAnchor | null) => {
    setErrorMessage(null)
    setPending({ action, anchor })
  }, [])

  const cancel = useCallback(() => {
    setErrorMessage(null)
    setPending(null)
  }, [])

  const confirm = useCallback(async (approvedPermissions: PluginPermissions) => {
    const plugin = pending?.action.plugin
    if (!pending || !plugin) return null
    setIsInstalling(true)
    setErrorMessage(null)
    try {
      await installPlugin(plugin.name, approvedPermissions)
      setInstalledPluginNames((previous) => new Set([...previous, plugin.name]))
      try {
        await onPluginInstalled?.(plugin.name)
      } catch (reloadError) {
        console.warn('installed, but could not reload the node library', reloadError)
      }
      setPending(null)
      return pending
    } catch (installError) {
      setErrorMessage(`Could not install ${plugin.displayName}: ${describeError(installError)}`)
      return null
    } finally {
      setIsInstalling(false)
    }
  }, [pending, onPluginInstalled])

  return { pending, isInstalling, errorMessage, installedPluginNames, requestInstall, cancel, confirm }
}
