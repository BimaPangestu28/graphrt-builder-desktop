import { useEffect } from 'react'
import { listAgents } from '@/api/agents'
import type { Agent } from '@/api/types'
import { useAsyncData, type AsyncDataState } from './useAsyncData'

const AGENTS_CHANGED_EVENT = 'graphrt:agents-changed'

/** Tells every agent list on screen (sidebar, Home) to reload, e.g. after a rename or delete. */
export function notifyAgentsChanged(): void {
  window.dispatchEvent(new Event(AGENTS_CHANGED_EVENT))
}

/**
 * Every agent, most recently updated first. Reloads when {@link notifyAgentsChanged} is called.
 *
 * @returns `{ data: Agent[] | null, error, isLoading, reload }` (AsyncDataState<Agent[]>)
 */
export function useAgents(): AsyncDataState<Agent[]> {
  const agentsState = useAsyncData(listAgents, [])
  const { reload } = agentsState
  useEffect(() => {
    const handleAgentsChanged = () => void reload()
    window.addEventListener(AGENTS_CHANGED_EVENT, handleAgentsChanged)
    return () => window.removeEventListener(AGENTS_CHANGED_EVENT, handleAgentsChanged)
  }, [reload])
  return agentsState
}
