import { useCallback, useEffect, useRef, useState } from 'react'
import { arePluginRequirementsReady } from './pluginRequirementDisplay'
import type { PluginSetupState } from './usePluginSetup'

/** Where the setup card sits in the screen 04 chat: under the opening summary, or under a revision's reply. */
export type PluginSetupAnchor = 'opening' | number

/**
 * Places the single plugin setup card in the builder chat. It shows as the first builder
 * message when the agent opens with plugins not ready, and moves under the reply of a
 * revision that added plugins or left some not ready. Once placed it stays (showing
 * "Ready" when done), so the user sees what changed.
 *
 * @param agentId - Agent in the builder; a new agent starts without a card (string)
 * @param pluginSetup - From `usePluginSetup` (PluginSetupState)
 * @returns The anchor (null: no card) and the handler to call after a revision is saved
 */
export function usePluginSetupPlacement(agentId: string, pluginSetup: PluginSetupState) {
  const [anchor, setAnchor] = useState<PluginSetupAnchor | null>(null)
  const { isReady, requirements, reload } = pluginSetup
  const requirementsRef = useRef(requirements)
  requirementsRef.current = requirements

  useEffect(() => setAnchor(null), [agentId])

  useEffect(() => {
    if (isReady === false) setAnchor((currentAnchor) => currentAnchor ?? 'opening')
  }, [isReady])

  const placeAfterRevision = useCallback(
    async (exchangeId: number) => {
      const previousNames = new Set((requirementsRef.current ?? []).map((requirement) => requirement.name))
      const nextRequirements = await reload()
      if (!nextRequirements || nextRequirements.length === 0) return
      const addsPlugins = nextRequirements.some((requirement) => !previousNames.has(requirement.name))
      if (addsPlugins || !arePluginRequirementsReady(nextRequirements)) setAnchor(exchangeId)
    },
    [reload],
  )

  /** Makes sure the card is in the chat (e.g. Test pressed while not ready). */
  const ensurePlaced = useCallback(() => setAnchor((currentAnchor) => currentAnchor ?? 'opening'), [])

  return { anchor, placeAfterRevision, ensurePlaced }
}
