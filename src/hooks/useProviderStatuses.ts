import { getDefaultModel, listProviderStatuses } from '@/api/credentials'
import type { ModelChoice, ProviderStatus } from '@/api/types'
import { useAsyncData, type AsyncDataState } from './useAsyncData'

/** Which model providers have a key, and which model new agents use. */
export interface ModelProviderSetup {
  statuses: ProviderStatus[]
  defaultModel: ModelChoice
}

async function loadModelProviderSetup(): Promise<ModelProviderSetup> {
  const [statuses, defaultModel] = await Promise.all([listProviderStatuses(), getDefaultModel()])
  return { statuses, defaultModel }
}

/**
 * Provider statuses together with the default model (Connections, Builder "Needs").
 *
 * @returns `{ data: ModelProviderSetup | null, error, isLoading, reload }` (AsyncDataState<ModelProviderSetup>)
 */
export function useProviderStatuses(): AsyncDataState<ModelProviderSetup> {
  return useAsyncData(loadModelProviderSetup, [])
}
