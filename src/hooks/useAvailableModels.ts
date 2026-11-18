import { listAvailableModels } from '@/api/credentials'
import type { ProviderModels } from '@/api/modelCatalogTypes'
import { useAsyncData, type AsyncDataState } from './useAsyncData'

/**
 * The chat models of every connected provider (see {@link listAvailableModels}).
 *
 * @returns `{ data: ProviderModels[] | null, error, isLoading, reload }`
 */
export function useAvailableModels(): AsyncDataState<ProviderModels[]> {
  return useAsyncData(() => listAvailableModels(), [])
}
