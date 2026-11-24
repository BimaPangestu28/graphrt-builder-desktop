import { useCallback, useEffect, useState } from 'react'
import { getAgentDeployment, refreshAgentDeployment } from '@/api/deploy'
import type { DeploymentView } from '@/api/deployTypes'

/** How often the builder checks an online agent while it is open (design: every 60 s). */
export const deploymentPollMs = 60_000

/**
 * The agent's online copy (null when it only runs on this computer), checked once on open and
 * then every {@link deploymentPollMs} while the screen is open. `agentVersion` reloads it after
 * an edit, so "You changed this agent" appears at once.
 */
export function useAgentDeployment(agentId: string, agentVersion: number | null) {
  const [view, setView] = useState<DeploymentView | null>(null)
  const [isLoaded, setIsLoaded] = useState(false)

  const reload = useCallback(async () => {
    try {
      setView(await getAgentDeployment(agentId))
    } finally {
      setIsLoaded(true)
    }
  }, [agentId])

  useEffect(() => {
    void reload().catch(() => setView(null))
  }, [reload, agentVersion])

  const hasDeployment = view !== null
  useEffect(() => {
    if (!hasDeployment) return
    const check = () => void refreshAgentDeployment(agentId).then(setView).catch(() => undefined)
    check()
    const timer = window.setInterval(check, deploymentPollMs)
    return () => window.clearInterval(timer)
  }, [agentId, hasDeployment])

  return { view, isLoaded, reload, setView }
}
