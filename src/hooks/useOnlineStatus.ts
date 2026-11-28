import { useEffect, useState } from 'react'
import { getAgentDeployment } from '@/api/deploy'
import type { DeploymentStatus } from '@/api/deployTypes'

/** Status of the agent's online copy, null while unknown, when it is not online or without an agent. */
export function useOnlineStatus(agentId: string | null): DeploymentStatus | null {
  const [status, setStatus] = useState<DeploymentStatus | null>(null)
  useEffect(() => {
    setStatus(null)
    if (!agentId) return
    let isCurrent = true
    getAgentDeployment(agentId)
      .then((view) => {
        if (isCurrent) setStatus(view?.deployment.status ?? null)
      })
      .catch((loadError: unknown) => {
        // Screens still show what this computer knows; the agent page says what is wrong online.
        console.warn('Could not read the online copy of an agent', loadError)
      })
    return () => {
      isCurrent = false
    }
  }, [agentId])
  return status
}
