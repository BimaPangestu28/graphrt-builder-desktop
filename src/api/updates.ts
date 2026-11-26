import type { Update } from '@tauri-apps/plugin-updater'
import { isDesktopApp } from './client'
import { listRuns } from './runs'
import { sampleAppInfoBackend } from './sampleBackend/appInfo'
import { messages } from '@/i18n'

/**
 * Auto-update through `tauri-plugin-updater` (signed bundles from the latest GitHub
 * release, see `src-tauri/src/desktop/updater.rs`) and the relaunch through
 * `tauri-plugin-process`. The update UI (`src/pages/updates`) talks only to this
 * module, so tests replace it with `vi.mock('@/api/updates')`.
 *
 * The browser preview and tests without a mock have no updater: {@link isUpdaterAvailable}
 * is false there and the other functions are never called.
 */

/** A newer version found by {@link checkForUpdate}. */
export interface AvailableUpdate {
  /** The new version, e.g. "0.2.0". */
  version: string
  /** The version running now. */
  currentVersion: string
  /** The release notes (the CHANGELOG section, Markdown), or null. */
  releaseNotes: string | null
  /** When the release was published (RFC 3339), or null. */
  publishedAt: string | null
}

/** Progress of {@link downloadUpdate}. */
export interface DownloadProgress {
  downloadedBytes: number
  /** Null when the server does not send the size. */
  totalBytes: number | null
}

/** The plugin's handle of the last update found; download and install act on it. */
let foundUpdate: Update | null = null

/** True in the desktop app; false in the browser preview, where nothing can be installed. */
export function isUpdaterAvailable(): boolean {
  return isDesktopApp()
}

/** The version running now (the sample version in the browser preview). */
export async function getCurrentVersion(): Promise<string> {
  if (__SAMPLE_BACKEND__ && !isDesktopApp()) return (await sampleAppInfoBackend.getAppInfo()).version
  const { getVersion } = await import('@tauri-apps/api/app')
  return getVersion()
}

/**
 * Asks the release endpoint whether a newer, signed version exists.
 *
 * @returns The update, or null when this version is the latest (Promise<AvailableUpdate | null>)
 * @throws Error - when the endpoint cannot be reached or its answer is invalid
 */
export async function checkForUpdate(): Promise<AvailableUpdate | null> {
  const { check } = await import('@tauri-apps/plugin-updater')
  const update = await check()
  if (!update) return null
  await foundUpdate?.close().catch(() => undefined)
  foundUpdate = update
  return {
    version: update.version,
    currentVersion: update.currentVersion,
    releaseNotes: update.body?.trim() || null,
    publishedAt: update.date ?? null,
  }
}

/**
 * Downloads the update found by the last {@link checkForUpdate} and verifies its
 * signature. Nothing is installed until {@link installUpdateAndRelaunch}.
 *
 * @param onProgress - Called as bytes arrive ((progress: DownloadProgress) => void)
 * @throws Error - when no update was found, the download fails or the signature is wrong
 */
export async function downloadUpdate(onProgress: (progress: DownloadProgress) => void): Promise<void> {
  const update = requireFoundUpdate()
  let downloadedBytes = 0
  let totalBytes: number | null = null
  await update.download((downloadEvent) => {
    if (downloadEvent.event === 'Started') totalBytes = downloadEvent.data.contentLength ?? null
    if (downloadEvent.event === 'Progress') downloadedBytes += downloadEvent.data.chunkLength
    onProgress({ downloadedBytes, totalBytes })
  })
}

/**
 * Installs the downloaded update and starts the new version. On Windows the installer
 * closes graphrt and opens the new version itself.
 *
 * @throws Error - when nothing was downloaded or the install fails
 */
export async function installUpdateAndRelaunch(): Promise<void> {
  await requireFoundUpdate().install()
  const { relaunch } = await import('@tauri-apps/plugin-process')
  await relaunch()
}

/** How many agent runs are in progress now (a restart would stop them). */
export async function countRunningRuns(): Promise<number> {
  return (await listRuns({ status: 'running' })).length
}

function requireFoundUpdate(): Update {
  if (!foundUpdate) throw new Error(messages().lib.noUpdateWasFoundYetCheck)
  return foundUpdate
}
