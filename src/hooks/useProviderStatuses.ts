import { isBackendErrorWithCode } from '@/api/client'
import { getDefaultModel, listProviderStatuses } from '@/api/credentials'
import type { ModelChoice, ProviderStatus } from '@/api/types'
import { useAsyncData, type AsyncDataState } from './useAsyncData'

/** Which model providers have a key, and which model new agents use. */
export interface ModelProviderSetup {
  statuses: ProviderStatus[]
  /** null until a model is connected (nothing to default to yet). */
  defaultModel: ModelChoice | null
}

/** The default model, or null when no model is connected yet (that is not an error here). */
async function loadDefaultModel(): Promise<ModelChoice | null> {
  try {
    return await getDefaultModel()
  } catch (error) {
    if (isBackendErrorWithCode(error, 'missing_credentials')) return null
    throw error
  }
}

async function loadModelProviderSetup(): Promise<ModelProviderSetup> {
  const [statuses, defaultModel] = await Promise.all([listProviderStatuses(), loadDefaultModel()])
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
