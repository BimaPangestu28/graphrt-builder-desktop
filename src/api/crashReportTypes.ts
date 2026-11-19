/**
 * Local crash reports (Settings > Privacy and data > Crash reports, the next-launch
 * notice). Mirrors the serde types in `src-tauri/src/crash_reports/` and
 * `src-tauri/src/commands/crash_reports.rs`. Reports never leave the computer unless
 * the user exports them or opens a GitHub issue themselves.
 */

/** `panic`: the backend crashed (the app closed); `frontend`: an error in the window. */
export type CrashReportKind = 'panic' | 'frontend'

/** How the window caught an error it reports. */
export type FrontendErrorSource = 'window_error' | 'unhandled_rejection' | 'error_boundary'

/** One row of the crash report list, newest first. */
export interface CrashReportSummary {
  /** `<UTC timestamp>-<8 hex>`; also the file name. */
  id: string
  kind: CrashReportKind
  /** ISO 8601 timestamp. */
  createdAt: string
  /** First line of the (already scrubbed) message, shortened. */
  message: string
}

/** Shown on the launch after a crash. */
export interface CrashNotice {
  report: CrashReportSummary
  /** The user opted in, so the notice also offers "Open a GitHub issue". */
  offersSharing: boolean
}

export interface CrashReportExportSummary {
  path: string
  reportCount: number
}

/** What the window sends with `report_frontend_error`; the backend scrubs it. */
export interface FrontendErrorReport {
  message: string
  stack: string | null
  componentStack: string | null
  /** The in-app route without its query string. */
  route: string | null
  source: FrontendErrorSource
}
