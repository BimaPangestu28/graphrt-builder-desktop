import { useEffect, useState } from 'react'
import { getAgentDeployment } from '@/api/deploy'
import type { DeploymentStatus, DeploymentView } from '@/api/deployTypes'

/** The agent's online copy, null while unknown, when it is not online or without an agent. */
export function useOnlineDeployment(agentId: string | null): DeploymentView | null {
  const [view, setView] = useState<DeploymentView | null>(null)
  useEffect(() => {
    setView(null)
    if (!agentId) return
    let isCurrent = true
    getAgentDeployment(agentId)
      .then((loaded) => {
        if (isCurrent) setView(loaded)
      })
      .catch((loadError: unknown) => {
        // Screens still show what this computer knows; the agent page says what is wrong online.
        console.warn('Could not read the online copy of an agent', loadError)
      })
    return () => {
      isCurrent = false
    }
  }, [agentId])
  return view
}

/** Status of the agent's online copy, null while unknown, when it is not online or without an agent. */
export function useOnlineStatus(agentId: string | null): DeploymentStatus | null {
  return useOnlineDeployment(agentId)?.deployment.status ?? null
}
