import { useCallback, useState } from 'react'
import { listPluginAutoUpdates, listPluginCatalog, listenToPluginEvents, updateAllPlugins } from '@/api/plugins'
import type { PluginAutoUpdate, PluginBulkUpdateSummary, PluginCatalogEntry, PluginEvent } from '@/api/pluginTypes'
import { describeError } from '@/lib/agentDisplay'
import { useAsyncData, type AsyncDataState } from './useAsyncData'
import { useBackendSubscription } from './useBackendSubscription'

/** Installed plugins with another catalog version, and what graphrt updated by itself. */
export interface PluginUpdatesData {
  /** Catalog entries with `updateAvailable`, in catalog order. */
  pendingUpdates: PluginCatalogEntry[]
  /** Newest first. */
  autoUpdates: PluginAutoUpdate[]
  /** Every catalog entry, so updates that only carry a name can show its display name. */
  catalogPlugins: PluginCatalogEntry[]
}

async function readAutoUpdates(): Promise<PluginAutoUpdate[]> {
  try {
    return await listPluginAutoUpdates()
  } catch (historyError) {
    console.warn('Could not read the automatic plugin updates', historyError)
    return []
  }
}

async function loadPluginUpdates(): Promise<PluginUpdatesData> {
  const [catalog, autoUpdates] = await Promise.all([listPluginCatalog(false), readAutoUpdates()])
  return { pendingUpdates: catalog.plugins.filter((entry) => entry.updateAvailable), autoUpdates, catalogPlugins: catalog.plugins }
}

/**
 * Pending plugin updates and recent automatic ones, reloaded whenever plugins change
 * (`plugins_changed` / `load_error`, also after a background update).
 *
 * @returns The data with load state (AsyncDataState<PluginUpdatesData>)
 */
export function usePluginUpdateData(): AsyncDataState<PluginUpdatesData> {
  const updatesState = useAsyncData(loadPluginUpdates, [])
  const { reload } = updatesState
  const handlePluginEvent = useCallback(
    (pluginEvent: PluginEvent) => {
      if (pluginEvent.type !== 'install_progress') void reload()
    },
    [reload],
  )
  useBackendSubscription(listenToPluginEvents, handlePluginEvent)
  return updatesState
}

export interface PluginUpdatesState extends AsyncDataState<PluginUpdatesData> {
  isUpdatingAll: boolean
  /** What the last "Update all" did, or null before one. */
  lastSummary: PluginBulkUpdateSummary | null
  /** Why the last "Update all" failed as a whole, or null. */
  updateAllError: string | null
  /** Installs every pending update that asks for no new permissions, then reloads. */
  updateAll: () => Promise<void>
}

/**
 * {@link usePluginUpdateData} plus "Update all" (Home's Updates notice).
 *
 * @returns Data, load state and the Update all action (PluginUpdatesState)
 */
export function usePluginUpdates(): PluginUpdatesState {
  const updatesState = usePluginUpdateData()
  const { reload } = updatesState
  const [isUpdatingAll, setIsUpdatingAll] = useState(false)
  const [lastSummary, setLastSummary] = useState<PluginBulkUpdateSummary | null>(null)
  const [updateAllError, setUpdateAllError] = useState<string | null>(null)

  const updateAll = useCallback(async () => {
    setIsUpdatingAll(true)
    setUpdateAllError(null)
    try {
      setLastSummary(await updateAllPlugins())
      await reload()
    } catch (bulkError) {
      setUpdateAllError(describeError(bulkError))
    } finally {
      setIsUpdatingAll(false)
    }
  }, [reload])

  return { ...updatesState, isUpdatingAll, lastSummary, updateAllError, updateAll }
}
