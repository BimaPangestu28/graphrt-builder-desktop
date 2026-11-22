import { useEffect, useState } from 'react'
import { getAgentEditState, listenToAgentEditState } from '@/api/agentGraph'

/**
 * Whether the builder chat is changing `agentId` right now: the initial state, then every
 * change the backend announces. While it is, the canvas is read-only and saves wait.
 *
 * @param agentId - Agent to follow (string)
 * @returns `[builderBusy, setBuilderBusy]`; the setter records a `builder_busy` save refusal
 *
 * @example
 * const [builderBusy, setBuilderBusy] = useBuilderLock(agent.id)
 */
export function useBuilderLock(agentId: string): [boolean, (builderBusy: boolean) => void] {
  const [builderBusy, setBuilderBusy] = useState(false)
  useEffect(() => {
    let isActive = true
    let unsubscribe: (() => void) | null = null
    getAgentEditState(agentId)
      .then((editState) => isActive && setBuilderBusy(editState.builderBusy))
      .catch(() => undefined)
    void listenToAgentEditState((change) => {
      if (change.agentId === agentId) setBuilderBusy(change.builderBusy)
    }).then((stop) => {
      if (isActive) unsubscribe = stop
      else stop()
    })
    return () => {
      isActive = false
      unsubscribe?.()
    }
  }, [agentId])
  return [builderBusy, setBuilderBusy]
}
