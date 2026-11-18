import { listWorkflowSecrets } from '@/api/credentials'
import type { WorkflowSecretStatus } from '@/api/types'
import { useAsyncData, type AsyncDataState } from './useAsyncData'

/**
 * The `env.*` values an agent's workflow needs (API keys, tokens) and whether each is set.
 *
 * @param agentId - Agent whose current version is read (string)
 * @returns `{ data: WorkflowSecretStatus[] | null, error, isLoading, reload }`
 */
export function useWorkflowSecrets(agentId: string): AsyncDataState<WorkflowSecretStatus[]> {
  return useAsyncData(() => listWorkflowSecrets(agentId), [agentId])
}
