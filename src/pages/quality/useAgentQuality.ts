import { useEffect, useState } from 'react'
import { getAgentQuality, subscribeToCheckProgress } from '@/api/quality'
import type { CheckProgress, QualityOverview } from '@/api/qualityTypes'
import { useAsyncData, type AsyncDataState } from '@/hooks/useAsyncData'

export interface AgentQualityState extends AsyncDataState<QualityOverview> {
  /** Progress of this agent's running check, null when none runs. */
  progress: CheckProgress | null
}

/**
 * The agent's tests, latest check and releases. Follows a running check: progress comes
 * from `agent-check-event`, and the page reloads when the check finishes.
 */
export function useAgentQuality(agentId: string): AgentQualityState {
  const loaded = useAsyncData(() => getAgentQuality(agentId), [agentId])
  const [progress, setProgress] = useState<CheckProgress | null>(null)
  const { reload } = loaded

  useEffect(() => {
    let isActive = true
    let unsubscribe: (() => void) | null = null
    void subscribeToCheckProgress((event) => {
      if (!isActive || event.agentId !== agentId) return
      setProgress(event.finished ? null : event)
      if (event.finished) void reload()
    }).then((stop) => {
      if (isActive) unsubscribe = stop
      else stop()
    })
    return () => {
      isActive = false
      unsubscribe?.()
    }
  }, [agentId, reload])

  return { ...loaded, progress }
}
