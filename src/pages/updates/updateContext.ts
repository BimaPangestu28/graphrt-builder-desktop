import { createContext, useContext } from 'react'
import type { AvailableUpdate } from '@/api/updates'
import { messages } from '@/i18n'

/** Where the app is with finding and downloading a new version. */
export type UpdateStatus =
  /** Browser preview: there is no updater. */
  | { kind: 'unavailable' }
  /** Not checked yet in this session. */
  | { kind: 'idle' }
  | { kind: 'checking' }
  | { kind: 'upToDate' }
  /** Found and not downloaded (automatic download off, or the download failed). */
  | { kind: 'available'; update: AvailableUpdate; downloadError: string | null }
  /** Null percent when the download size is unknown. */
  | { kind: 'downloading'; update: AvailableUpdate; percent: number | null }
  /** Downloaded and verified: installs on restart. */
  | { kind: 'ready'; update: AvailableUpdate }
  | { kind: 'checkFailed'; message: string }

/** Where the app is with restarting into a downloaded update. */
export type RestartState =
  | { kind: 'none' }
  /** Restart was asked for while agents run (null: they could not be counted): the user picks now or when idle. */
  | { kind: 'confirmingBusy'; runningCount: number | null }
  /** Restarts by itself once no agent run is in progress. */
  | { kind: 'waitingForIdle' }
  | { kind: 'installing' }
  | { kind: 'installFailed'; message: string }

/** What screens can see and do about updates (from `AppUpdateProvider`). */
export interface AppUpdateControls {
  status: UpdateStatus
  restartState: RestartState
  /** The version running now; null until read. */
  currentVersion: string | null
  /** Checks now (Settings button). Downloads when automatic download is on. */
  checkNow: () => Promise<void>
  /** Downloads an update that was found but not downloaded. */
  downloadNow: () => Promise<void>
  /** Restarts into the update, or asks first when agent runs are in progress. */
  requestRestart: () => Promise<void>
  /** Restarts now even though agent runs are in progress (they stop). */
  restartNow: () => Promise<void>
  /** Restarts by itself once no agent run is in progress. */
  restartWhenIdle: () => void
  /** Forgets a pending restart request. */
  cancelRestart: () => void
}

export const AppUpdateContext = createContext<AppUpdateControls | null>(null)

/**
 * The update controls from `AppUpdateProvider`.
 *
 * @returns The controls, or null outside the provider (a screen rendered on its own in a
 *   test), where the update UI hides (AppUpdateControls | null)
 */
export function useAppUpdates(): AppUpdateControls | null {
  return useContext(AppUpdateContext)
}

/**
 * Whole percent downloaded, or null when the size is unknown.
 *
 * @param downloadedBytes - Bytes received so far (number)
 * @param totalBytes - Download size, or null (number | null)
 * @returns 0–100, or null (number | null)
 */
export function calculateDownloadPercent(downloadedBytes: number, totalBytes: number | null): number | null {
  if (!totalBytes || totalBytes <= 0) return null
  return Math.min(100, Math.floor((downloadedBytes / totalBytes) * 100))
}

/** "1 agent run is in progress" / "3 agent runs are in progress"; null when unknown. */
export function describeRunningRuns(runningCount: number | null): string {
  if (runningCount === null) return messages().misc.agentRunsMayBeInProgress
  return runningCount === 1 ? messages().misc.n1AgentRunIsInProgress : messages().misc.runningcountAgentRunsAreInProgress(runningCount)
}
