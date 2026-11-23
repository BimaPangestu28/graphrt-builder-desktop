import { useCallback, useEffect, useState } from 'react'
import { addTrustedLookupHost, listTrustedLookupHosts, removeTrustedLookupHost, subscribeToTrustedHostChanges } from '@/api/trustedHosts'
import { toError } from '@/lib/errors'

export interface TrustedLookupHostsState {
  /** Null until the first load. */
  hosts: string[] | null
  loadError: Error | null
  /** The last add or remove that failed (e.g. an invalid host), cleared by the next one. */
  changeError: Error | null
  isChanging: boolean
  /** Trusts a host; resolves true when it was added. */
  addHost: (host: string) => Promise<boolean>
  removeHost: (host: string) => Promise<void>
}

/**
 * An agent's trusted lookup hosts, kept in step with every other view of them (an add in
 * the Nodes view shows in the Builder's list and the chatbot setup right away).
 *
 * @param agentId - Agent (string)
 * @returns The list and the add / remove actions (TrustedLookupHostsState)
 */
export function useTrustedLookupHosts(agentId: string): TrustedLookupHostsState {
  const [hosts, setHosts] = useState<string[] | null>(null)
  const [loadError, setLoadError] = useState<Error | null>(null)
  const [changeError, setChangeError] = useState<Error | null>(null)
  const [isChanging, setIsChanging] = useState(false)

  useEffect(() => {
    let isCurrent = true
    setHosts(null)
    listTrustedLookupHosts(agentId)
      .then((loadedHosts) => {
        if (isCurrent) setHosts(loadedHosts)
      })
      .catch((rawError: unknown) => {
        if (isCurrent) setLoadError(toError(rawError))
      })
    const unsubscribe = subscribeToTrustedHostChanges((changedAgentId, changedHosts) => {
      if (isCurrent && changedAgentId === agentId) setHosts(changedHosts)
    })
    return () => {
      isCurrent = false
      unsubscribe()
    }
  }, [agentId])

  const runChange = useCallback(async (change: () => Promise<string[]>) => {
    setIsChanging(true)
    setChangeError(null)
    try {
      await change()
      return true
    } catch (rawError) {
      setChangeError(toError(rawError))
      return false
    } finally {
      setIsChanging(false)
    }
  }, [])

  const addHost = useCallback((host: string) => runChange(() => addTrustedLookupHost(agentId, host)), [agentId, runChange])
  const removeHost = useCallback(
    async (host: string) => {
      await runChange(() => removeTrustedLookupHost(agentId, host))
    },
    [agentId, runChange],
  )

  return { hosts, loadError, changeError, isChanging, addHost, removeHost }
}
