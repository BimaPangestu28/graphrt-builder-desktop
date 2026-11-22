import { useCallback, useState } from 'react'
import { getPluginRuntimeInfo, installPluginRuntime, listenToBrowserRuntimeEvents, listenToPluginEvents, removePluginRuntime } from '@/api/plugins'
import { isPluginRuntimeEvent, type BrowserRuntimeEvent, type PluginEvent, type PluginRuntimeInfo, type PluginRuntimeStatus } from '@/api/pluginTypes'
import { describeError } from '@/lib/agentDisplay'
import { useAsyncData } from './useAsyncData'
import { useBackendSubscription } from './useBackendSubscription'

export interface PluginRuntimeState {
  /** Null while loading. */
  info: PluginRuntimeInfo | null
  /** Null while loading; `installing` while this or another screen downloads it. */
  status: PluginRuntimeStatus | null
  loadError: Error | null
  isInstalling: boolean
  /** Latest progress text while installing, e.g. "Downloading Node.js · 40%". */
  progressText: string | null
  installError: string | null
  /** Downloads and installs it. Call only for an explicit user action. */
  install: () => Promise<void>
  isRemoving: boolean
  removeError: string | null
  remove: () => Promise<void>
}

/**
 * Builds a progress line from a `node_install_progress` event.
 *
 * @returns "Downloading Node.js · 40%", the message alone, or null when the event has neither (string | null)
 *
 * @example
 * describePluginRuntimeEvent({ type: 'node_install_progress', message: 'Downloading Node.js', percent: 40.4 }) // "Downloading Node.js · 40%"
 */
export function describePluginRuntimeEvent(runtimeEvent: BrowserRuntimeEvent): string | null {
  if (runtimeEvent.type !== 'node_install_progress') return null
  const message = typeof runtimeEvent.message === 'string' && runtimeEvent.message.trim() ? runtimeEvent.message.trim() : null
  const percent = typeof runtimeEvent.percent === 'number' && Number.isFinite(runtimeEvent.percent) ? `${Math.round(runtimeEvent.percent)}%` : null
  if (message && percent) return `${message} · ${percent}`
  return message ?? percent
}

/** Follows `node_install_*` events, also of installs another screen started. */
function useRuntimeInstallEvents(reload: () => Promise<void>) {
  const [isInstallingElsewhere, setIsInstallingElsewhere] = useState(false)
  const [progressText, setProgressText] = useState<string | null>(null)

  const handleRuntimeEvent = useCallback(
    (runtimeEvent: BrowserRuntimeEvent) => {
      if (!isPluginRuntimeEvent(runtimeEvent)) return
      if (runtimeEvent.type === 'node_install_started') setIsInstallingElsewhere(true)
      const description = describePluginRuntimeEvent(runtimeEvent)
      if (description) setProgressText(description)
      if (runtimeEvent.type === 'node_install_finished' || runtimeEvent.type === 'node_install_failed') {
        setIsInstallingElsewhere(false)
        setProgressText(null)
        void reload()
      }
    },
    [reload],
  )
  useBackendSubscription(listenToBrowserRuntimeEvents, handleRuntimeEvent)

  const handlePluginEvent = useCallback(
    (pluginEvent: PluginEvent) => {
      if (pluginEvent.type === 'plugins_changed') void reload()
    },
    [reload],
  )
  useBackendSubscription(listenToPluginEvents, handlePluginEvent)

  return { isInstallingElsewhere, progressText, setProgressText }
}

/**
 * The plugin runtime (Node.js) every plugin runs on: its status, version, the install action
 * with progress, and Remove. The app downloads it only when the user asks, from an Install
 * button or by installing a plugin with the download shown in the same approval.
 *
 * @returns Status, progress, errors and actions (PluginRuntimeState)
 */
export function usePluginRuntime(): PluginRuntimeState {
  const infoState = useAsyncData(getPluginRuntimeInfo, [])
  const { reload } = infoState
  const { isInstallingElsewhere, progressText, setProgressText } = useRuntimeInstallEvents(reload)
  const [isInstalling, setIsInstalling] = useState(false)
  const [installError, setInstallError] = useState<string | null>(null)
  const [isRemoving, setIsRemoving] = useState(false)
  const [removeError, setRemoveError] = useState<string | null>(null)

  const install = useCallback(async () => {
    setIsInstalling(true)
    setInstallError(null)
    setProgressText(null)
    try {
      await installPluginRuntime()
    } catch (installFailure) {
      setInstallError(describeError(installFailure))
    } finally {
      await reload()
      setIsInstalling(false)
      setProgressText(null)
    }
  }, [reload, setProgressText])

  const remove = useCallback(async () => {
    setIsRemoving(true)
    setRemoveError(null)
    try {
      await removePluginRuntime()
    } catch (removeFailure) {
      setRemoveError(describeError(removeFailure))
    } finally {
      await reload()
      setIsRemoving(false)
    }
  }, [reload])

  const isBusyInstalling = isInstalling || isInstallingElsewhere
  const status = isBusyInstalling ? 'installing' : (infoState.data?.status ?? null)
  return {
    info: infoState.data,
    status,
    loadError: infoState.error,
    isInstalling: isBusyInstalling,
    progressText,
    installError,
    install,
    isRemoving,
    removeError,
    remove,
  }
}

/** True once the runtime is known to be missing (not while loading or installing). */
export function isPluginRuntimeMissing(runtime: Pick<PluginRuntimeState, 'status'>): boolean {
  return runtime.status === 'not_installed'
}
