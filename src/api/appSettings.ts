import { callBackend, isDesktopApp, listenToBackend } from './client'
import { sampleAppSettingsBackend } from './sampleBackend/appSettings'
import type { AppSettings, DeletionSummary, ExportSummary, OpenRunRequest } from './appSettingsTypes'

/** Desktop preferences (Settings screen 22), export and delete-all, and notification clicks. */

/** Tauri event sent when the user clicks a "needs approval" / "failed" notification. */
export const OPEN_RUN_EVENT = 'open-run'

export function getAppSettings(): Promise<AppSettings> {
  if (!isDesktopApp()) return sampleAppSettingsBackend.getAppSettings()
  return callBackend('get_app_settings')
}

/** Stores every field and applies launch at login, the menu bar icon and keep awake. */
export function updateAppSettings(settings: AppSettings): Promise<AppSettings> {
  if (!isDesktopApp()) return sampleAppSettingsBackend.updateAppSettings(settings)
  return callBackend('update_app_settings', { settings })
}

/**
 * Writes every agent (workflow, versions, schedules; never keys) as JSON to `path`,
 * an absolute path ending in `.json`.
 */
export function exportAgents(path: string): Promise<ExportSummary> {
  if (!isDesktopApp()) return sampleAppSettingsBackend.exportAgents(path)
  return callBackend('export_agents', { path })
}

/** Deletes agents, runs, schedules and settings; optionally the saved keys too. */
export function deleteAllData(removeKeychainItems: boolean): Promise<DeletionSummary> {
  if (!isDesktopApp()) return sampleAppSettingsBackend.deleteAllData(removeKeychainItems)
  return callBackend('delete_all_data', { removeKeychainItems })
}

/**
 * Where "Export all agents" writes: `~/Downloads/graphrt-agents-YYYY-MM-DD.json`.
 *
 * @param today - Date used in the file name (Date)
 * @returns Absolute path in the desktop app; a display path in the browser (Promise<string>)
 */
export async function defaultExportPath(today: Date = new Date()): Promise<string> {
  const fileName = `graphrt-agents-${today.toISOString().slice(0, 10)}.json`
  if (!isDesktopApp()) return `~/Downloads/${fileName}`
  const { downloadDir, join } = await import('@tauri-apps/api/path')
  return join(await downloadDir(), fileName)
}

/** Calls `onOpenRun` when a run notification is clicked. Returns an unsubscribe function. */
export function subscribeToOpenRunRequests(onOpenRun: (request: OpenRunRequest) => void): Promise<() => void> {
  return listenToBackend(OPEN_RUN_EVENT, onOpenRun)
}
