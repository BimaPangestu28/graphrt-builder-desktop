import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { subscribeToOpenRunRequests } from '@/api/appSettings'
import { agentPath } from '@/routes'

/**
 * Opens the run a clicked system notification is about ("needs your approval" /
 * "failed"): the backend shows the window and sends `open-run`, this navigates to
 * the run on the agent's test-run screen. Mount once, inside the router.
 */
export function useOpenRunNavigation(): void {
  const navigate = useNavigate()
  useEffect(() => {
    let isSubscribed = true
    let unsubscribe: (() => void) | null = null
    void subscribeToOpenRunRequests((request) => {
      navigate(agentPath('testRun', request.agentId, { runId: request.runId }))
    }).then((stopListening) => {
      if (isSubscribed) unsubscribe = stopListening
      else stopListening()
    })
    return () => {
      isSubscribed = false
      unsubscribe?.()
    }
  }, [navigate])
}

/** Renders nothing; lets `main.tsx` mount {@link useOpenRunNavigation} inside the router. */
export function OpenRunNavigation(): null {
  useOpenRunNavigation()
  return null
}
