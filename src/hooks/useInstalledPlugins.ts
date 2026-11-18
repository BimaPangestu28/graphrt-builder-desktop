import { listInstalledPlugins } from '@/api/plugins'
import type { InstalledPlugin } from '@/api/pluginTypes'
import { useAsyncData, type AsyncDataState } from './useAsyncData'

/**
 * Plugins installed on this computer with their trust and settings status (builder "Needs").
 *
 * @returns `{ data: InstalledPlugin[] | null, error, isLoading, reload }`
 */
export function useInstalledPlugins(): AsyncDataState<InstalledPlugin[]> {
  return useAsyncData(listInstalledPlugins, [])
}
