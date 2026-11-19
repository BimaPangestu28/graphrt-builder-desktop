import { listBuilderMessages } from '@/api/builder'
import { useAsyncData } from '@/hooks/useAsyncData'
import { splitBuilderHistory, type BuilderHistory } from './builderHistory'

const emptyHistory: BuilderHistory = { openingExplanation: null, laterMessages: [] }

/**
 * The builder chat saved before this visit, loaded once when the builder opens (and again
 * for another agent). Changes made during the visit stay live exchanges in
 * `useAgentRevisions` (where Undo works), so they are never shown twice; the next visit
 * reads them from here.
 *
 * @param agentId - Agent whose chat to load (string)
 * @returns The opening explanation and later saved messages; empty while loading or when loading fails (BuilderHistory)
 */
export function useBuilderHistory(agentId: string): BuilderHistory {
  const { data: savedMessages } = useAsyncData(() => listBuilderMessages(agentId), [agentId])
  return savedMessages ? splitBuilderHistory(savedMessages) : emptyHistory
}
