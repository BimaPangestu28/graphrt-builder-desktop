import { useCallback, useEffect, useRef, useState } from 'react'
import { listPluginCatalog } from '@/api/plugins'
import type { PluginCatalog } from '@/api/pluginTypes'
import { describeError } from '@/lib/agentDisplay'
import type { PluginsState } from './usePlugins'

/** The Plugins page refetches a catalog the app fetched longer ago than this. */
export const CATALOG_STALE_AFTER_MS = 10 * 60 * 1000

export interface PluginCatalogRefreshState {
  /** A refresh (button or automatic) is running; the current list stays on screen. */
  isRefreshing: boolean
  /** Why the last refresh failed, as text to show, or null. */
  refreshError: string | null
  /** Fetches the catalog again ("Check for updates"), then reloads the page's data. */
  refresh: () => Promise<void>
}

/**
 * Whether the app fetched `catalog` more than {@link CATALOG_STALE_AFTER_MS} before `nowMs`.
 * A saved copy (`fetchedAt` null: the fetch already failed) is never "stale": refetching
 * it on open would only fail again.
 *
 * @param catalog - The catalog shown, or null (PluginCatalog | null)
 * @param nowMs - Current time in ms since the epoch (number)
 * @returns True when it should be fetched again (boolean)
 */
export function isCatalogStale(catalog: PluginCatalog | null, nowMs: number): boolean {
  if (!catalog?.fetchedAt) return false
  const fetchedAtMs = Date.parse(catalog.fetchedAt)
  return Number.isFinite(fetchedAtMs) && nowMs - fetchedAtMs > CATALOG_STALE_AFTER_MS
}

/**
 * "Check for updates" for the Plugins page, plus the automatic refetch: when the page opens
 * with a catalog the app fetched more than 10 minutes ago, the cached list shows at once
 * and a fresh one is fetched in the background (once per visit).
 *
 * @param plugins - From {@link usePlugins}: its data and `reload` (PluginsState)
 * @returns Refresh state and the action (PluginCatalogRefreshState)
 *
 * @example
 * const catalogRefresh = usePluginCatalogRefresh(plugins)
 * <button onClick={() => void catalogRefresh.refresh()} disabled={catalogRefresh.isRefreshing}>Check for updates</button>
 */
export function usePluginCatalogRefresh(plugins: PluginsState): PluginCatalogRefreshState {
  const { reload, data: inventory } = plugins
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [refreshError, setRefreshError] = useState<string | null>(null)
  const isMountedRef = useRef(true)
  const hasCheckedStalenessRef = useRef(false)

  useEffect(() => {
    isMountedRef.current = true
    return () => {
      isMountedRef.current = false
    }
  }, [])

  const refresh = useCallback(async () => {
    setIsRefreshing(true)
    setRefreshError(null)
    try {
      const refreshedCatalog = await listPluginCatalog(true)
      if (refreshedCatalog.fromCache && isMountedRef.current) setRefreshError('the catalog could not be reached, so the last saved copy is shown')
      await reload()
    } catch (refreshFailure) {
      if (isMountedRef.current) setRefreshError(describeError(refreshFailure))
    } finally {
      if (isMountedRef.current) setIsRefreshing(false)
    }
  }, [reload])

  useEffect(() => {
    if (!inventory || hasCheckedStalenessRef.current) return
    hasCheckedStalenessRef.current = true
    if (isCatalogStale(inventory.catalog, Date.now())) void refresh()
  }, [inventory, refresh])

  return { isRefreshing, refreshError, refresh }
}
