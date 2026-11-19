import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { useLocation } from 'react-router-dom'
import { getCurrentVersion } from '@/api/updates'
import { routePaths } from '@/routes'
import { AppUpdateContext, type AppUpdateControls } from './updateContext'
import { UpdateReadyBanner } from './UpdateReadyBanner'
import { useRestartFlow } from './useRestartFlow'
import { useUpdateStatus } from './useUpdateStatus'

/** Background checks run this often while the app is open. */
export const UPDATE_CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000
/** While "Restart when idle" waits, running runs are re-counted this often (and on every status change). */
export const IDLE_POLL_INTERVAL_MS = 15 * 1000

interface AppUpdateProviderProps {
  children: ReactNode
  /** Override for tests. */
  checkIntervalMs?: number
  /** Override for tests. */
  idlePollIntervalMs?: number
}

function useCurrentVersion(): string | null {
  const [currentVersion, setCurrentVersion] = useState<string | null>(null)
  useEffect(() => {
    let isMounted = true
    getCurrentVersion()
      .then((version) => {
        if (isMounted) setCurrentVersion(version)
      })
      .catch((versionError: unknown) => console.warn('Could not read the app version', versionError))
    return () => {
      isMounted = false
    }
  }, [])
  return currentVersion
}

/**
 * Keeps graphrt up to date for the whole app: checks quietly on launch and every six
 * hours, downloads in the background when "Automatically download updates" is on, and
 * shows a small "ready" banner (not on Settings, which has its own Updates section).
 * Nothing restarts without the user, and a restart never cuts running agents short
 * without asking. Screens read the state with `useAppUpdates`. Render inside the router.
 */
export function AppUpdateProvider({ children, checkIntervalMs = UPDATE_CHECK_INTERVAL_MS, idlePollIntervalMs = IDLE_POLL_INTERVAL_MS }: AppUpdateProviderProps) {
  const { status, runCheck, downloadNow } = useUpdateStatus(checkIntervalMs)
  const { restartState, requestRestart, restartNow, restartWhenIdle, cancelRestart } = useRestartFlow(idlePollIntervalMs)
  const currentVersion = useCurrentVersion()
  const { pathname } = useLocation()

  const updateControls = useMemo<AppUpdateControls>(
    () => ({ status, currentVersion, checkNow: () => runCheck(false), downloadNow, restartState, requestRestart, restartNow, restartWhenIdle, cancelRestart }),
    [status, currentVersion, runCheck, downloadNow, restartState, requestRestart, restartNow, restartWhenIdle, cancelRestart],
  )
  return (
    <AppUpdateContext.Provider value={updateControls}>
      {children}
      {pathname !== routePaths.settings && <UpdateReadyBanner updateControls={updateControls} />}
    </AppUpdateContext.Provider>
  )
}
