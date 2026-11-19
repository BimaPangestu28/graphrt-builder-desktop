import { callBackend, isDesktopApp } from './client'
import type { CrashNotice, CrashReportExportSummary, CrashReportSummary, FrontendErrorReport } from './crashReportTypes'
import { sampleCrashReportsBackend } from './sampleBackend/crashReports'

/** Local crash reports: list, view, export, delete, the next-launch notice and the sharing opt-in. */

export function listCrashReports(): Promise<CrashReportSummary[]> {
  if (!isDesktopApp()) return sampleCrashReportsBackend.listCrashReports()
  return callBackend('list_crash_reports')
}

/** The scrubbed report as pretty JSON: exactly what would be shared. */
export function getCrashReport(reportId: string): Promise<string> {
  if (!isDesktopApp()) return sampleCrashReportsBackend.getCrashReport(reportId)
  return callBackend('get_crash_report', { reportId })
}

/** Deletes every saved report; resolves to how many were deleted. */
export function deleteAllCrashReports(): Promise<number> {
  if (!isDesktopApp()) return sampleCrashReportsBackend.deleteAllCrashReports()
  return callBackend('delete_all_crash_reports')
}

/** Writes every report into one JSON file at `path` (absolute, ending in `.json`). */
export function exportCrashReports(path: string): Promise<CrashReportExportSummary> {
  if (!isDesktopApp()) return sampleCrashReportsBackend.exportCrashReports(path)
  return callBackend('export_crash_reports', { path })
}

/** Saves a report for an error the window caught (scrubbed by the backend). */
export function reportFrontendError(error: FrontendErrorReport): Promise<void> {
  if (!isDesktopApp()) return sampleCrashReportsBackend.reportFrontendError(error)
  return callBackend('report_frontend_error', { error })
}

/** The crash from an earlier launch the user has not dismissed, or null. */
export function getCrashNotice(): Promise<CrashNotice | null> {
  if (!isDesktopApp()) return sampleCrashReportsBackend.getCrashNotice()
  return callBackend('get_crash_notice')
}

/** Hides the notice for this report and every older one. */
export function dismissCrashNotice(reportId: string): Promise<void> {
  if (!isDesktopApp()) return sampleCrashReportsBackend.dismissCrashNotice(reportId)
  return callBackend('dismiss_crash_notice', { reportId })
}

/** Whether the user opted in to "offer to share crash reports" (off by default). */
export function getCrashReportSharing(): Promise<boolean> {
  if (!isDesktopApp()) return sampleCrashReportsBackend.getCrashReportSharing()
  return callBackend('get_crash_report_sharing')
}

export function setCrashReportSharing(offersSharing: boolean): Promise<boolean> {
  if (!isDesktopApp()) return sampleCrashReportsBackend.setCrashReportSharing(offersSharing)
  return callBackend('set_crash_report_sharing', { offersSharing })
}

/** Opens a prefilled GitHub "new issue" page in the browser. Nothing is submitted. */
export function openCrashReportIssue(reportId: string): Promise<void> {
  if (!isDesktopApp()) return sampleCrashReportsBackend.openCrashReportIssue(reportId)
  return callBackend('open_crash_report_issue', { reportId })
}

/**
 * Asks where to save "Export all" with the system save dialog (desktop only).
 *
 * @param today - Date used in the suggested file name (Date)
 * @returns The chosen absolute path, or null when the dialog was closed (Promise<string | null>)
 */
export async function pickCrashReportExportPath(today: Date = new Date()): Promise<string | null> {
  const fileName = `graphrt-crash-reports-${today.toISOString().slice(0, 10)}.json`
  if (!isDesktopApp()) return `~/Downloads/${fileName}`
  const [{ save }, { downloadDir, join }] = await Promise.all([import('@tauri-apps/plugin-dialog'), import('@tauri-apps/api/path')])
  const chosenPath = await save({
    title: 'Export crash reports',
    defaultPath: await join(await downloadDir(), fileName),
    filters: [{ name: 'JSON', extensions: ['json'] }],
  })
  return chosenPath ?? null
}
