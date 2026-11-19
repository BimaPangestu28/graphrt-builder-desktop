import { useCallback, useEffect, useState } from 'react'
import { subscribeToRunEvents } from '@/api/runs'
import { countRunningRuns, installUpdateAndRelaunch } from '@/api/updates'
import { describeError } from '@/lib/agentDisplay'
import type { RestartState } from './updateContext'

/** Running agent runs, or null when they cannot be counted (treated as "maybe busy"). */
async function countRunningRunsOrNull(): Promise<number | null> {
  try {
    return await countRunningRuns()
  } catch (countError) {
    console.warn('Could not count running agent runs before restarting', countError)
    return null
  }
}

export interface RestartFlowControls {
  restartState: RestartState
  requestRestart: () => Promise<void>
  restartNow: () => Promise<void>
  restartWhenIdle: () => void
  cancelRestart: () => void
}

/**
 * Restarting into a downloaded update without cutting agent runs short: when runs are in
 * progress the user chooses "Restart now" (they stop) or "Restart when idle", which
 * re-counts on every run status change and every `idlePollIntervalMs` and restarts once
 * none is running.
 *
 * @param idlePollIntervalMs - Time between re-counts while waiting for idle (number)
 * @returns The restart state and actions (RestartFlowControls)
 */
export function useRestartFlow(idlePollIntervalMs: number): RestartFlowControls {
  const [restartState, setRestartState] = useState<RestartState>({ kind: 'none' })

  const restartNow = useCallback(async () => {
    setRestartState({ kind: 'installing' })
    try {
      await installUpdateAndRelaunch()
    } catch (installError) {
      setRestartState({ kind: 'installFailed', message: describeError(installError) })
    }
  }, [])

  const requestRestart = useCallback(async () => {
    const runningCount = await countRunningRunsOrNull()
    if (runningCount === 0) await restartNow()
    else setRestartState({ kind: 'confirmingBusy', runningCount })
  }, [restartNow])

  const restartWhenIdle = useCallback(() => setRestartState({ kind: 'waitingForIdle' }), [])
  const cancelRestart = useCallback(() => setRestartState({ kind: 'none' }), [])

  useRestartOnceIdle(restartState.kind === 'waitingForIdle', idlePollIntervalMs, restartNow)

  return { restartState, requestRestart, restartNow, restartWhenIdle, cancelRestart }
}

/** While `isWaiting`, calls `restart` once no agent run is in progress. */
function useRestartOnceIdle(isWaiting: boolean, idlePollIntervalMs: number, restart: () => Promise<void>): void {
  useEffect(() => {
    if (!isWaiting) return
    let isActive = true
    let unsubscribe: (() => void) | null = null
    async function restartIfIdle() {
      const runningCount = await countRunningRunsOrNull()
      if (!isActive || runningCount !== 0) return
      isActive = false
      await restart()
    }
    const pollTimer = window.setInterval(() => void restartIfIdle(), idlePollIntervalMs)
    subscribeToRunEvents((payload) => {
      if (payload.event.type === 'status_changed') void restartIfIdle()
    })
      .then((unsubscribeFromRuns) => {
        if (isActive) unsubscribe = unsubscribeFromRuns
        else unsubscribeFromRuns()
      })
      .catch((subscribeError: unknown) => console.warn('Could not listen to run events; checking on a timer only', subscribeError))
    void restartIfIdle()
    return () => {
      isActive = false
      window.clearInterval(pollTimer)
      unsubscribe?.()
    }
  }, [isWaiting, idlePollIntervalMs, restart])
}
