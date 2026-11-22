import { useCallback, useState } from 'react'
import { getBrowserRuntimeStatus, installBrowserRuntime, listenToBrowserRuntimeEvents } from '@/api/plugins'
import { isPluginRuntimeEvent, type BrowserRuntimeEvent, type BrowserRuntimeStatus } from '@/api/pluginTypes'
import { describeError } from '@/lib/agentDisplay'
import { useAsyncData } from './useAsyncData'
import { useBackendSubscription } from './useBackendSubscription'

export interface BrowserRuntimeState {
  /** Null while loading. */
  status: BrowserRuntimeStatus | null
  loadError: Error | null
  isInstalling: boolean
  /** Latest progress text while installing, e.g. "Downloading Chromium · 40%". */
  progressText: string | null
  installError: string | null
  install: () => Promise<void>
}

/**
 * Builds a progress line from a browser `node-runtime-event` payload: its `message` (or the
 * installer output `line`) and `percent`, when present. Plugin runtime (Node.js) events are
 * not about the browser and give null.
 *
 * @returns "message · 40%", one of the two, or null when the event has neither (string | null)
 */
export function describeBrowserRuntimeEvent(runtimeEvent: unknown): string | null {
  if (!runtimeEvent || typeof runtimeEvent !== 'object') return null
  if (isPluginRuntimeEvent(runtimeEvent as BrowserRuntimeEvent)) return null
  const { message: rawMessage, line: rawLine, percent: rawPercent } = runtimeEvent as BrowserRuntimeEvent
  const text = typeof rawMessage === 'string' ? rawMessage : rawLine
  const message = typeof text === 'string' && text.trim() ? text.trim() : null
  const percent = typeof rawPercent === 'number' && Number.isFinite(rawPercent) ? `${Math.round(rawPercent)}%` : null
  if (message && percent) return `${message} · ${percent}`
  return message ?? percent
}

/** The browser runtime (Chromium) browser plugins need: its status and the install action with progress. */
export function useBrowserRuntime(): BrowserRuntimeState {
  const statusState = useAsyncData(getBrowserRuntimeStatus, [])
  const [isInstalling, setIsInstalling] = useState(false)
  const [progressText, setProgressText] = useState<string | null>(null)
  const [installError, setInstallError] = useState<string | null>(null)
  const { reload } = statusState

  const handleRuntimeEvent = useCallback((runtimeEvent: BrowserRuntimeEvent) => {
    const description = describeBrowserRuntimeEvent(runtimeEvent)
    if (description) setProgressText(description)
  }, [])
  useBackendSubscription(listenToBrowserRuntimeEvents, handleRuntimeEvent)

  const install = useCallback(async () => {
    setIsInstalling(true)
    setInstallError(null)
    setProgressText(null)
    try {
      await installBrowserRuntime()
    } catch (installFailure) {
      setInstallError(describeError(installFailure))
    } finally {
      await reload()
      setIsInstalling(false)
      setProgressText(null)
    }
  }, [reload])

  const status = isInstalling ? 'installing' : statusState.data
  return { status, loadError: statusState.error, isInstalling, progressText, installError, install }
}
