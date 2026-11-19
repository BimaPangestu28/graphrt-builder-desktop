//! Settings > Privacy and data > Crash reports, the next-launch notice and
//! frontend error reporting. Everything stays on this computer; sharing is
//! a GitHub issue the user opens and submits themselves.

use std::path::PathBuf;
use std::sync::Arc;

use serde::Serialize;
use tauri::State;

use crate::crash_reports::sharing;
use crate::crash_reports::store::{CrashReportExportSummary, CrashReportSummary};
use crate::crash_reports::{CrashReportStore, FrontendErrorInput};
use crate::error::{AppError, AppResult};
use crate::state::AppState;

type CrashReports<'a> = State<'a, Arc<CrashReportStore>>;

/// The "graphrt closed unexpectedly" notice (`src/api/crashReportTypes.ts`).
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CrashNotice {
    pub report: CrashReportSummary,
    /// The user opted in, so the notice offers "Open a GitHub issue".
    pub offers_sharing: bool,
}

/// Every saved report, newest first.
#[tauri::command]
pub fn list_crash_reports(crash_reports: CrashReports<'_>) -> AppResult<Vec<CrashReportSummary>> {
    crash_reports.list()
}

/// One report as pretty JSON, exactly what would be shared.
#[tauri::command]
pub fn get_crash_report(crash_reports: CrashReports<'_>, report_id: String) -> AppResult<String> {
    crash_reports.read_json(&report_id)
}

/// Deletes every saved report; returns how many.
#[tauri::command]
pub fn delete_all_crash_reports(crash_reports: CrashReports<'_>) -> AppResult<usize> {
    crash_reports.delete_all()
}

/// Writes every report into one JSON file (the path comes from the save dialog).
#[tauri::command]
pub fn export_crash_reports(crash_reports: CrashReports<'_>, path: String) -> AppResult<CrashReportExportSummary> {
    crash_reports.export_all(&PathBuf::from(path))
}

/// Saves a report for an error the window caught (error boundary, `window.onerror`,
/// `unhandledrejection`). Scrubbed before it is written.
#[tauri::command]
pub fn report_frontend_error(crash_reports: CrashReports<'_>, error: FrontendErrorInput) -> AppResult<()> {
    crash_reports.record_frontend_error(error)?;
    Ok(())
}

/// The newest panic from an earlier launch the user has not dismissed, if any.
#[tauri::command]
pub fn get_crash_notice(crash_reports: CrashReports<'_>, state: State<'_, AppState>) -> AppResult<Option<CrashNotice>> {
    let dismissed_through = sharing::load_dismissed_through(&state.db)?;
    let Some(report) = crash_reports.latest_unseen_panic(dismissed_through.as_deref())? else {
        return Ok(None);
    };
    Ok(Some(CrashNotice { report, offers_sharing: sharing::load_offers_sharing(&state.db)? }))
}

/// Hides the notice for this report and every older one.
#[tauri::command]
pub fn dismiss_crash_notice(state: State<'_, AppState>, report_id: String) -> AppResult<()> {
    sharing::save_dismissed_through(&state.db, &report_id)
}

/// Whether the user opted in to "offer to share crash reports".
#[tauri::command]
pub fn get_crash_report_sharing(state: State<'_, AppState>) -> AppResult<bool> {
    sharing::load_offers_sharing(&state.db)
}

#[tauri::command]
pub fn set_crash_report_sharing(state: State<'_, AppState>, offers_sharing: bool) -> AppResult<bool> {
    sharing::save_offers_sharing(&state.db, offers_sharing)?;
    Ok(offers_sharing)
}

/// Opens a prefilled GitHub "new issue" page for the report. Only when the user
/// opted in; nothing is submitted.
#[tauri::command]
pub fn open_crash_report_issue(
    crash_reports: CrashReports<'_>,
    state: State<'_, AppState>,
    report_id: String,
) -> AppResult<()> {
    if !sharing::load_offers_sharing(&state.db)? {
        return Err(AppError::InvalidInput("turn on \"offer to share crash reports\" in Settings first".into()));
    }
    let report = crash_reports.load(&report_id)?;
    sharing::open_issue_in_browser(&sharing::build_issue_url(&report))
}
