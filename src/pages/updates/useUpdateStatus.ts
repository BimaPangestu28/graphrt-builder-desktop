import { useCallback, useEffect, useRef, useState } from 'react'
import { getAppSettings } from '@/api/appSettings'
import { checkForUpdate, downloadUpdate, isUpdaterAvailable, type AvailableUpdate } from '@/api/updates'
import { describeError } from '@/lib/agentDisplay'
import { calculateDownloadPercent, type UpdateStatus } from './updateContext'

/** Reads "Automatically download updates"; on by default, also when settings cannot be read. */
async function readAutoDownloadSetting(): Promise<boolean> {
  try {
    return (await getAppSettings()).autoDownloadUpdates
  } catch (settingsError) {
    console.warn('Could not read the automatic download setting; downloading the update', settingsError)
    return true
  }
}

export interface UpdateStatusControls {
  status: UpdateStatus
  /** Checks for a newer version; `isQuiet` keeps the current status on screen while checking. */
  runCheck: (isQuiet: boolean) => Promise<void>
  downloadNow: () => Promise<void>
}

/**
 * Finds and downloads new versions: checks once on launch and every `checkIntervalMs`
 * while the app runs, and downloads right away when automatic download is on. One check
 * or download runs at a time; nothing is checked once an update is downloaded.
 *
 * @param checkIntervalMs - Time between background checks (number)
 * @returns The status and the check / download actions (UpdateStatusControls)
 */
export function useUpdateStatus(checkIntervalMs: number): UpdateStatusControls {
  const [status, setStatus] = useState<UpdateStatus>(() => (isUpdaterAvailable() ? { kind: 'idle' } : { kind: 'unavailable' }))
  const statusRef = useRef(status)
  statusRef.current = status
  const isWorkingRef = useRef(false)

  const download = useCallback(async (update: AvailableUpdate) => {
    setStatus({ kind: 'downloading', update, percent: null })
    try {
      await downloadUpdate((progress) =>
        setStatus({ kind: 'downloading', update, percent: calculateDownloadPercent(progress.downloadedBytes, progress.totalBytes) }),
      )
      setStatus({ kind: 'ready', update })
    } catch (downloadError) {
      setStatus({ kind: 'available', update, downloadError: describeError(downloadError) })
    }
  }, [])

  const runCheck = useCallback(
    async (isQuiet: boolean) => {
      if (!isUpdaterAvailable() || isWorkingRef.current || statusRef.current.kind === 'ready') return
      isWorkingRef.current = true
      if (!isQuiet) setStatus({ kind: 'checking' })
      try {
        const update = await checkForUpdate()
        if (!update) setStatus({ kind: 'upToDate' })
        else if (await readAutoDownloadSetting()) await download(update)
        else setStatus({ kind: 'available', update, downloadError: null })
      } catch (checkError) {
        console.warn('Could not check for updates', checkError)
        setStatus({ kind: 'checkFailed', message: describeError(checkError) })
      } finally {
        isWorkingRef.current = false
      }
    },
    [download],
  )

  const downloadNow = useCallback(async () => {
    const currentStatus = statusRef.current
    if (currentStatus.kind !== 'available' || isWorkingRef.current) return
    isWorkingRef.current = true
    try {
      await download(currentStatus.update)
    } finally {
      isWorkingRef.current = false
    }
  }, [download])

  useEffect(() => {
    void runCheck(true)
    const checkTimer = window.setInterval(() => void runCheck(true), checkIntervalMs)
    return () => window.clearInterval(checkTimer)
  }, [runCheck, checkIntervalMs])

  return { status, runCheck, downloadNow }
}
