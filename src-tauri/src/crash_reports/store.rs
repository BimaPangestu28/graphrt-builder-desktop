//! The `crash-reports` folder in the app data folder: one JSON file per report,
//! at most [`MAX_STORED_REPORTS`] (the oldest are deleted), plus listing,
//! reading, exporting and deleting them for Settings > Privacy and data.

use std::fs;
use std::path::{Path, PathBuf};

use chrono::{DateTime, Utc};
use serde::Serialize;

use super::report::{CrashReport, CrashReportKind, FrontendErrorInput, PanicDetails, ReportEnvironment};
use crate::error::{AppError, AppResult};

/// Folder name inside the app data folder.
pub const CRASH_REPORTS_DIR_NAME: &str = "crash-reports";
/// Reports kept on disk; writing one more deletes the oldest.
pub const MAX_STORED_REPORTS: usize = 50;
/// Characters of the message shown in the list and the notice.
const SUMMARY_MESSAGE_CHARS: usize = 160;
const REPORT_EXTENSION: &str = "json";

/// One row of the Settings list (`src/api/crashReportTypes.ts`).
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CrashReportSummary {
    pub id: String,
    pub kind: CrashReportKind,
    pub created_at: DateTime<Utc>,
    /// First line of the (already scrubbed) message, shortened.
    pub message: String,
}

/// Result of "Export all".
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CrashReportExportSummary {
    pub path: String,
    pub report_count: usize,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct CrashReportExport<'a> {
    exported_at: DateTime<Utc>,
    reports: &'a [CrashReport],
}

/// Writes and reads the crash reports of one app data folder.
#[derive(Debug)]
pub struct CrashReportStore {
    directory: PathBuf,
    environment: ReportEnvironment,
    /// When this launch started: the next-launch notice only shows older panics.
    launched_at: DateTime<Utc>,
}

impl CrashReportStore {
    /// @param directory - The `crash-reports` folder (created on the first write)
    pub fn new(directory: PathBuf, environment: ReportEnvironment) -> Self {
        Self { directory, environment, launched_at: Utc::now() }
    }

    pub fn directory(&self) -> &Path {
        &self.directory
    }

    pub fn launched_at(&self) -> DateTime<Utc> {
        self.launched_at
    }

    /// Writes a report for a backend panic; returns the file written.
    ///
    /// @throws AppError::Internal - when the folder or file cannot be written
    pub fn record_panic(&self, details: PanicDetails) -> AppResult<PathBuf> {
        self.write(&CrashReport::from_panic(details, &self.environment, Utc::now()))
    }

    /// Writes a report for an error the frontend caught; returns the file written.
    ///
    /// @throws AppError::InvalidInput - when the message is empty
    /// @throws AppError::Internal - when the folder or file cannot be written
    pub fn record_frontend_error(&self, input: FrontendErrorInput) -> AppResult<PathBuf> {
        if input.message.trim().is_empty() {
            return Err(AppError::InvalidInput("the error message must not be empty".into()));
        }
        self.write(&CrashReport::from_frontend(input, &self.environment, Utc::now()))
    }

    /// Writes `report` as `<id>.json`, then deletes the oldest beyond [`MAX_STORED_REPORTS`].
    ///
    /// @throws AppError::Internal - when the folder or file cannot be written
    pub fn write(&self, report: &CrashReport) -> AppResult<PathBuf> {
        fs::create_dir_all(&self.directory).map_err(|error| io_error("create the crash reports folder", error))?;
        let path = self.report_path(&report.id)?;
        fs::write(&path, report.to_pretty_json()).map_err(|error| io_error("write a crash report", error))?;
        self.delete_oldest_beyond(MAX_STORED_REPORTS)?;
        Ok(path)
    }

    /// Every readable report, newest first. Unreadable files are skipped and logged.
    ///
    /// @throws AppError::Internal - when the folder cannot be listed
    pub fn load_all(&self) -> AppResult<Vec<CrashReport>> {
        let mut reports: Vec<CrashReport> =
            self.report_files()?.iter().filter_map(|path| read_report_file(path)).collect();
        reports.sort_by(|first, second| second.id.cmp(&first.id));
        Ok(reports)
    }

    /// The list shown in Settings, newest first.
    ///
    /// @throws AppError::Internal - when the folder cannot be listed
    pub fn list(&self) -> AppResult<Vec<CrashReportSummary>> {
        Ok(self.load_all()?.iter().map(summarize).collect())
    }

    /// One report, parsed.
    ///
    /// @throws AppError::InvalidInput - when the id is not a report id
    /// @throws AppError::NotFound - when there is no such report
    pub fn load(&self, report_id: &str) -> AppResult<CrashReport> {
        let path = self.report_path(report_id)?;
        if !path.is_file() {
            return Err(AppError::NotFound(format!("crash report {report_id}")));
        }
        read_report_file(&path).ok_or_else(|| AppError::Internal(format!("crash report {report_id} is unreadable")))
    }

    /// The report exactly as stored and as it would be shared (pretty JSON).
    ///
    /// @throws AppError::InvalidInput - when the id is not a report id
    /// @throws AppError::NotFound - when there is no such report
    pub fn read_json(&self, report_id: &str) -> AppResult<String> {
        Ok(self.load(report_id)?.to_pretty_json())
    }

    /// Deletes every report; returns how many were deleted.
    ///
    /// @throws AppError::Internal - when a file cannot be deleted
    pub fn delete_all(&self) -> AppResult<usize> {
        let files = self.report_files()?;
        for path in &files {
            fs::remove_file(path).map_err(|error| io_error("delete a crash report", error))?;
        }
        Ok(files.len())
    }

    /// Writes every report into one JSON file at `destination` (absolute, ending in `.json`).
    ///
    /// @throws AppError::InvalidInput - when the path is relative or not a `.json` file
    /// @throws AppError::Internal - when the file cannot be written
    pub fn export_all(&self, destination: &Path) -> AppResult<CrashReportExportSummary> {
        let has_json_extension =
            destination.extension().is_some_and(|extension| extension.eq_ignore_ascii_case(REPORT_EXTENSION));
        if !destination.is_absolute() || !has_json_extension {
            return Err(AppError::InvalidInput("export to an absolute path ending in .json".into()));
        }
        let reports = self.load_all()?;
        let export = CrashReportExport { exported_at: Utc::now(), reports: &reports };
        let json = serde_json::to_string_pretty(&export)?;
        fs::write(destination, json).map_err(|error| io_error("write the exported crash reports", error))?;
        Ok(CrashReportExportSummary { path: destination.display().to_string(), report_count: reports.len() })
    }

    /// The newest panic written before this launch and after the last dismissed one,
    /// for the "graphrt closed unexpectedly" notice.
    ///
    /// @param dismissed_through - Id of the newest report the user already dismissed
    /// @throws AppError::Internal - when the folder cannot be listed
    pub fn latest_unseen_panic(&self, dismissed_through: Option<&str>) -> AppResult<Option<CrashReportSummary>> {
        Ok(self
            .load_all()?
            .iter()
            .filter(|report| report.kind == CrashReportKind::Panic && report.created_at < self.launched_at)
            .find(|report| dismissed_through.is_none_or(|dismissed_id| report.id.as_str() > dismissed_id))
            .map(summarize))
    }

    fn report_path(&self, report_id: &str) -> AppResult<PathBuf> {
        if !is_valid_report_id(report_id) {
            return Err(AppError::InvalidInput(format!("{report_id:?} is not a crash report id")));
        }
        Ok(self.directory.join(format!("{report_id}.{REPORT_EXTENSION}")))
    }

    /// Report files sorted oldest first (names start with the UTC timestamp).
    fn report_files(&self) -> AppResult<Vec<PathBuf>> {
        let entries = match fs::read_dir(&self.directory) {
            Ok(entries) => entries,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(Vec::new()),
            Err(error) => return Err(io_error("list the crash reports", error)),
        };
        let mut files: Vec<PathBuf> = entries
            .filter_map(Result::ok)
            .map(|entry| entry.path())
            .filter(|path| {
                let is_json = path.extension().is_some_and(|extension| extension == REPORT_EXTENSION);
                let has_report_name = path.file_stem().and_then(|stem| stem.to_str()).is_some_and(is_valid_report_id);
                is_json && has_report_name && path.is_file()
            })
            .collect();
        files.sort();
        Ok(files)
    }

    fn delete_oldest_beyond(&self, max_reports: usize) -> AppResult<()> {
        let files = self.report_files()?;
        let excess_count = files.len().saturating_sub(max_reports);
        for path in &files[..excess_count] {
            fs::remove_file(path).map_err(|error| io_error("delete an old crash report", error))?;
        }
        Ok(())
    }
}

/// Ids are `<timestamp>-<hex>`: letters, digits and dashes only, so they can never leave the folder.
fn is_valid_report_id(report_id: &str) -> bool {
    !report_id.is_empty()
        && report_id.len() <= 64
        && report_id.chars().all(|character| character.is_ascii_alphanumeric() || character == '-')
}

fn read_report_file(path: &Path) -> Option<CrashReport> {
    let parsed = fs::read_to_string(path)
        .map_err(|error| error.to_string())
        .and_then(|text| serde_json::from_str::<CrashReport>(&text).map_err(|error| error.to_string()));
    match parsed {
        Ok(report) => Some(report),
        Err(error) => {
            log::warn!("skipping unreadable crash report {}: {error}", path.display());
            None
        }
    }
}

fn summarize(report: &CrashReport) -> CrashReportSummary {
    let first_line = report.message.lines().next().unwrap_or_default();
    let message = match first_line.char_indices().nth(SUMMARY_MESSAGE_CHARS) {
        Some((cut_index, _)) => format!("{}…", &first_line[..cut_index]),
        None => first_line.to_owned(),
    };
    CrashReportSummary { id: report.id.clone(), kind: report.kind, created_at: report.created_at, message }
}

fn io_error(action: &str, error: std::io::Error) -> AppError {
    AppError::Internal(format!("could not {action}: {error}"))
}

#[cfg(test)]
mod tests {
    use chrono::Duration;

    use super::super::report::FrontendErrorSource;
    use super::super::scrub::Scrubber;
    use super::*;

    fn test_store(directory: &Path) -> CrashReportStore {
        let environment =
            ReportEnvironment { app_version: "0.1.0".into(), scrubber: Scrubber::new(Some("/Users/janedoe")) };
        CrashReportStore::new(directory.join(CRASH_REPORTS_DIR_NAME), environment)
    }

    fn panic_details(message: &str) -> PanicDetails {
        PanicDetails {
            message: message.into(),
            location: Some("src/lib.rs:1:1".into()),
            thread_name: Some("main".into()),
            backtrace: "0: graphrt_lib::run".into(),
        }
    }

    fn report_at(store: &CrashReportStore, message: &str, created_at: DateTime<Utc>) -> CrashReport {
        CrashReport::from_panic(panic_details(message), &store.environment, created_at)
    }

    #[test]
    fn writes_a_scrubbed_report_file_in_the_crash_reports_folder() {
        let temporary = tempfile::tempdir().unwrap();
        let store = test_store(temporary.path());
        let path =
            store.record_panic(panic_details("failed reading /Users/janedoe/notes.txt with sk-abcdef123456")).unwrap();
        assert_eq!(path.parent().unwrap(), temporary.path().join("crash-reports"));
        let written = fs::read_to_string(&path).unwrap();
        assert!(written.contains("failed reading ~/notes.txt with [redacted]"));
        assert!(!written.contains("janedoe"));
        let report: CrashReport = serde_json::from_str(&written).unwrap();
        assert_eq!(path.file_stem().unwrap().to_str().unwrap(), report.id);
    }

    #[test]
    fn lists_reports_newest_first_with_a_short_message() {
        let temporary = tempfile::tempdir().unwrap();
        let store = test_store(temporary.path());
        let now = Utc::now();
        store.write(&report_at(&store, "older", now - Duration::minutes(5))).unwrap();
        store.write(&report_at(&store, &format!("newer\nsecond line {}", "x".repeat(10)), now)).unwrap();
        let summaries = store.list().unwrap();
        assert_eq!(summaries.iter().map(|summary| summary.message.as_str()).collect::<Vec<_>>(), ["newer", "older"]);
    }

    #[test]
    fn keeps_only_the_newest_fifty_reports() {
        let temporary = tempfile::tempdir().unwrap();
        let store = test_store(temporary.path());
        let start = Utc::now() - Duration::hours(2);
        for index in 0..(MAX_STORED_REPORTS + 5) {
            store
                .write(&report_at(&store, &format!("crash {index}"), start + Duration::seconds(index as i64)))
                .unwrap();
        }
        let summaries = store.list().unwrap();
        assert_eq!(summaries.len(), MAX_STORED_REPORTS);
        assert_eq!(summaries.first().unwrap().message, format!("crash {}", MAX_STORED_REPORTS + 4));
        assert_eq!(summaries.last().unwrap().message, "crash 5");
    }

    #[test]
    fn records_frontend_errors_and_refuses_empty_ones() {
        let temporary = tempfile::tempdir().unwrap();
        let store = test_store(temporary.path());
        let input = |message: &str| FrontendErrorInput {
            message: message.into(),
            stack: None,
            component_stack: None,
            route: Some("/home?x=1".into()),
            source: FrontendErrorSource::WindowError,
        };
        assert!(matches!(store.record_frontend_error(input("  ")), Err(AppError::InvalidInput(_))));
        store.record_frontend_error(input("TypeError")).unwrap();
        let report = store.load(&store.list().unwrap()[0].id).unwrap();
        assert_eq!(report.kind, CrashReportKind::Frontend);
        assert_eq!(report.route.as_deref(), Some("/home"));
    }

    #[test]
    fn reads_one_report_and_rejects_ids_that_leave_the_folder() {
        let temporary = tempfile::tempdir().unwrap();
        let store = test_store(temporary.path());
        store.record_panic(panic_details("boom")).unwrap();
        let report_id = store.list().unwrap()[0].id.clone();
        assert!(store.read_json(&report_id).unwrap().contains("\"message\": \"boom\""));
        assert!(matches!(store.read_json("../graphrt"), Err(AppError::InvalidInput(_))));
        assert!(matches!(store.read_json("20990101T000000000Z-deadbeef"), Err(AppError::NotFound(_))));
    }

    #[test]
    fn deletes_every_report_and_ignores_other_files() {
        let temporary = tempfile::tempdir().unwrap();
        let store = test_store(temporary.path());
        store.record_panic(panic_details("one")).unwrap();
        store.record_panic(panic_details("two")).unwrap();
        fs::write(store.directory().join("notes.txt"), "keep me").unwrap();
        assert_eq!(store.delete_all().unwrap(), 2);
        assert!(store.list().unwrap().is_empty());
        assert!(store.directory().join("notes.txt").exists());
    }

    #[test]
    fn exports_every_report_to_one_json_file() {
        let temporary = tempfile::tempdir().unwrap();
        let store = test_store(temporary.path());
        store.record_panic(panic_details("one")).unwrap();
        let destination = temporary.path().join("graphrt-crash-reports.json");
        let summary = store.export_all(&destination).unwrap();
        assert_eq!(summary.report_count, 1);
        let exported: serde_json::Value = serde_json::from_str(&fs::read_to_string(&destination).unwrap()).unwrap();
        assert_eq!(exported["reports"][0]["message"], "one");
        assert!(matches!(store.export_all(Path::new("relative.json")), Err(AppError::InvalidInput(_))));
        assert!(matches!(store.export_all(&temporary.path().join("x.txt")), Err(AppError::InvalidInput(_))));
    }

    #[test]
    fn the_notice_shows_the_newest_panic_from_before_this_launch_until_dismissed() {
        let temporary = tempfile::tempdir().unwrap();
        let store = test_store(temporary.path());
        let before_launch = store.launched_at() - Duration::minutes(1);
        assert!(store.latest_unseen_panic(None).unwrap().is_none());
        let older = report_at(&store, "older", before_launch - Duration::minutes(1));
        let newest = report_at(&store, "newest", before_launch);
        store.write(&older).unwrap();
        store.write(&newest).unwrap();
        store.write(&report_at(&store, "during this launch", store.launched_at() + Duration::seconds(1))).unwrap();
        assert_eq!(store.latest_unseen_panic(None).unwrap().unwrap().message, "newest");
        assert!(store.latest_unseen_panic(Some(&newest.id)).unwrap().is_none());
        assert_eq!(store.latest_unseen_panic(Some(&older.id)).unwrap().unwrap().id, newest.id);
    }

    #[test]
    fn listing_a_missing_folder_is_empty() {
        let temporary = tempfile::tempdir().unwrap();
        assert!(test_store(temporary.path()).list().unwrap().is_empty());
        assert_eq!(test_store(temporary.path()).delete_all().unwrap(), 0);
    }
}
