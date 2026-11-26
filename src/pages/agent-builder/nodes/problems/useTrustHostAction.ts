import { useCallback, useEffect, useRef, useState } from 'react'
import { addTrustedLookupHost, subscribeToTrustedHostChanges } from '@/api/trustedHosts'
import { toErrorMessage } from '@/lib/errors'
import type { AgentGraphController } from '../useAgentGraph'
import type { GraphValidation } from './useGraphValidation'
import { messages } from '@/i18n'

export interface TrustHostAction {
  /** "Trust <host>" on a problem: trusts it for the agent's lookups (the user clicked it). */
  trustHost: (host: string) => Promise<void>
  /** Why the last Trust failed; null after a success. */
  trustError: string | null
}

/**
 * The Nodes view's side of trusted hosts: the problem's Trust action, and fresh problems and
 * request checks whenever the agent's trusted hosts change (here, in the inspector, or in the
 * Builder's list). Without local edits the graph is loaded again (its "runs without asking"
 * lines come from the backend); with edits, only the problems are checked again.
 *
 * @param agentId - Agent (string)
 * @param controller - The Nodes view's graph controller (AgentGraphController)
 * @param validation - Its validation (GraphValidation)
 * @returns The Trust action and its last error (TrustHostAction)
 */
export function useTrustHostAction(agentId: string, controller: AgentGraphController, validation: GraphValidation): TrustHostAction {
  const [trustError, setTrustError] = useState<string | null>(null)
  const refreshRef = useRef<() => void>(() => undefined)
  refreshRef.current = () => {
    if (controller.isDirty) void validation.validate()
    else void controller.reload()
  }

  useEffect(
    () =>
      subscribeToTrustedHostChanges((changedAgentId) => {
        if (changedAgentId === agentId) refreshRef.current()
      }),
    [agentId],
  )

  const trustHost = useCallback(
    async (host: string) => {
      try {
        await addTrustedLookupHost(agentId, host)
        setTrustError(null)
      } catch (rawError) {
        setTrustError(messages().nodes.couldNotTrustHostReason(host, toErrorMessage(rawError)))
      }
    },
    [agentId],
  )

  return { trustHost, trustError }
}
