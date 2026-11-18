import { BackendError } from '@/api/client'
import { getDefaultModel } from '@/api/credentials'
import type { ModelChoice } from '@/api/types'
import { useAsyncData, type AsyncDataState } from './useAsyncData'

/**
 * The model new agents use, or null when no provider is connected (the backend answers
 * `missing_credentials`). Other failures are passed on.
 *
 * @returns The default model or null (Promise<ModelChoice | null>)
 * @throws BackendError - for any failure other than `missing_credentials`
 */
export async function readDefaultModelOrNull(): Promise<ModelChoice | null> {
  try {
    return await getDefaultModel()
  } catch (modelError) {
    if (modelError instanceof BackendError && modelError.code === 'missing_credentials') return null
    throw modelError
  }
}

/**
 * Loads the default model once on mount; `data` is null while loading and when none is set,
 * so check `isLoading` to tell them apart.
 *
 * @returns `{ data: ModelChoice | null, error, isLoading, reload }` (AsyncDataState<ModelChoice | null>)
 */
export function useDefaultModel(): AsyncDataState<ModelChoice | null> {
  return useAsyncData(readDefaultModelOrNull, [])
}
