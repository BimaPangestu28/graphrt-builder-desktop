//! The files a run made, for the Run result screen ("where is my invoice?").
//!
//! Steps that write a file report where: plugin steps output an object with an absolute
//! `path` (for example `data.path` of `document-templates.render_pdf`). A path counts as a
//! file of the run when it is a plain file that was created or changed since the run
//! started, so a file a step only read is not listed. The same list decides what
//! "Open file" and "Open folder" may open: never a path the page made up.

use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime};

use chrono::DateTime;
use serde::Serialize;
use serde_json::Value as Json;

use crate::error::{AppError, AppResult};
use crate::storage::models::Run;
use crate::storage::Database;

/// The output field that holds a file's location.
const PATH_FIELD: &str = "path";
/// How deep step outputs are searched (`outputs.data.files[0].path` is four levels).
const MAX_SEARCH_DEPTH: usize = 5;
const MAX_RUN_FILES: usize = 20;
/// File clocks and run timestamps differ a little; a file this much older than the run's
/// start still counts as made by it.
const CLOCK_SLACK: Duration = Duration::from_secs(2);
/// Files "Open file" hands to the default app: documents, sheets, pictures, sound and video.
/// Anything else (a script, a program) only gets "Open folder".
const OPENABLE_EXTENSIONS: &[&str] = &[
    "pdf", "docx", "doc", "odt", "rtf", "txt", "md", "csv", "tsv", "xlsx", "xls", "ods", "pptx", "ppt", "json", "png",
    "jpg", "jpeg", "gif", "webp", "svg", "mp3", "wav", "m4a", "ogg", "mp4", "mov", "webm", "zip",
];

/// One file a run made. Keep `src/api/runSummaryTypes.ts` in sync.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RunFile {
    /// Absolute path.
    pub path: String,
    /// The file's name, e.g. `INV-2026-0001.pdf`.
    pub name: String,
    /// The folder it is in.
    pub folder: String,
    /// The default app may open it (see [`OPENABLE_EXTENSIONS`]).
    pub can_open: bool,
}

/// The files `run` made, in the order its steps reported them.
pub fn collect_run_files(run: &Run, events: &[Json]) -> Vec<RunFile> {
    let started = DateTime::parse_from_rfc3339(&run.started_at).ok().map(SystemTime::from);
    candidate_paths(events, run.outputs.as_ref())
        .into_iter()
        .filter(|path| was_written_since(path, started))
        .take(MAX_RUN_FILES)
        .filter_map(|path| run_file(&path))
        .collect()
}

/// Opens one of the run's files with its default app.
///
/// # Errors
/// `NotFound` when the run made no such file or it is gone; `InvalidInput` when it is not a
/// kind of file the app opens; `Internal` when the default app cannot be started.
pub fn open_run_file(db: &Database, run_id: &str, path: &str) -> AppResult<()> {
    let file = find_run_file(db, run_id, path)?;
    if !file.can_open {
        return Err(AppError::InvalidInput(format!(
            "{} is not a document the app opens; open its folder instead",
            file.name
        )));
    }
    crate::desktop::data_folder::open_with_default_app(Path::new(&file.path))
}

/// Opens the folder of one of the run's files in the file manager.
///
/// # Errors
/// As [`open_run_file`], without the kind check.
pub fn open_run_file_folder(db: &Database, run_id: &str, path: &str) -> AppResult<()> {
    let file = find_run_file(db, run_id, path)?;
    crate::desktop::data_folder::open_in_file_manager(Path::new(&file.folder))
}

fn find_run_file(db: &Database, run_id: &str, path: &str) -> AppResult<RunFile> {
    let run = db.get_run(run_id)?;
    let events: Vec<Json> = db.list_run_events(run_id)?.into_iter().map(|record| record.event).collect();
    collect_run_files(&run, &events)
        .into_iter()
        .find(|file| file.path == path)
        .ok_or_else(|| AppError::NotFound(format!("the file {path} of this run")))
}

/// Every absolute `path` the steps and the run's own outputs report, without repeats.
fn candidate_paths(events: &[Json], run_outputs: Option<&Json>) -> Vec<PathBuf> {
    let mut paths: Vec<PathBuf> = Vec::new();
    let step_outputs = events
        .iter()
        .filter(|event| event.get("type").and_then(Json::as_str) == Some("node_succeeded"))
        .filter_map(|event| event.get("outputs"));
    for outputs in step_outputs.chain(run_outputs) {
        collect_paths(outputs, MAX_SEARCH_DEPTH, &mut paths);
    }
    paths
}

fn collect_paths(value: &Json, depth_left: usize, paths: &mut Vec<PathBuf>) {
    if depth_left == 0 {
        return;
    }
    match value {
        Json::Object(fields) => {
            if let Some(path) = fields.get(PATH_FIELD).and_then(Json::as_str).map(PathBuf::from) {
                if path.is_absolute() && !paths.contains(&path) {
                    paths.push(path);
                }
            }
            for child in fields.values() {
                collect_paths(child, depth_left - 1, paths);
            }
        }
        Json::Array(items) => {
            for item in items {
                collect_paths(item, depth_left - 1, paths);
            }
        }
        _ => {}
    }
}

/// Whether `path` is a plain file last written after `started` (minus [`CLOCK_SLACK`]).
/// Without a readable start time or modification time, existing is enough.
fn was_written_since(path: &Path, started: Option<SystemTime>) -> bool {
    let Ok(metadata) = std::fs::metadata(path) else { return false };
    if !metadata.is_file() {
        return false;
    }
    match (metadata.modified(), started) {
        (Ok(modified), Some(started)) => modified + CLOCK_SLACK >= started,
        _ => true,
    }
}

fn run_file(path: &Path) -> Option<RunFile> {
    let name = path.file_name()?.to_string_lossy().into_owned();
    let folder = path.parent()?.to_string_lossy().into_owned();
    let extension = path.extension().map(|extension| extension.to_string_lossy().to_ascii_lowercase());
    let can_open = extension.is_some_and(|extension| OPENABLE_EXTENSIONS.contains(&extension.as_str()));
    Some(RunFile { path: path.to_string_lossy().into_owned(), name, folder, can_open })
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;
    use crate::storage::models::RunTrigger;
    use crate::storage::test_support::{create_test_agent, test_database};

    fn step(outputs: Json) -> Json {
        json!({ "type": "node_succeeded", "node_id": "create_pdf", "outputs": outputs })
    }

    #[test]
    fn finds_the_files_steps_report_once_each() {
        let events = vec![
            step(
                json!({ "data": { "path": "/home/me/Invoices/2026/11/INV-1.pdf", "relative_path": "2026/11/INV-1.pdf" } }),
            ),
            json!({ "type": "node_failed", "outputs": { "path": "/home/me/never.pdf" } }),
            step(json!({ "data": { "files": [{ "path": "/home/me/a.csv" }, { "path": "relative/b.csv" }] } })),
        ];
        let run_outputs = json!({ "summary": "Done", "pdf_file": { "path": "/home/me/Invoices/2026/11/INV-1.pdf" } });
        let paths = candidate_paths(&events, Some(&run_outputs));
        assert_eq!(paths, [PathBuf::from("/home/me/Invoices/2026/11/INV-1.pdf"), PathBuf::from("/home/me/a.csv")]);
    }

    #[test]
    fn lists_files_written_during_the_run_and_not_older_ones() {
        let database = test_database();
        let agent = create_test_agent(&database, "Invoices");
        let folder = tempfile::tempdir().unwrap();
        let read_only = folder.path().join("template.json");
        std::fs::write(&read_only, "{}").unwrap();
        let an_hour_ago = SystemTime::now() - Duration::from_secs(3600);
        std::fs::File::options().write(true).open(&read_only).unwrap().set_modified(an_hour_ago).unwrap();

        let run = database.insert_run(&agent.id, 1, RunTrigger::Test).unwrap();
        let invoice = folder.path().join("INV-2026-0001.pdf");
        std::fs::write(&invoice, "%PDF").unwrap();
        let script = folder.path().join("export.sh");
        std::fs::write(&script, "#!/bin/sh").unwrap();
        let events = vec![
            step(json!({ "data": { "path": read_only } })),
            step(json!({ "data": { "path": invoice } })),
            step(json!({ "data": { "path": script } })),
            step(json!({ "data": { "path": folder.path().join("gone.pdf") } })),
        ];

        let files = collect_run_files(&run, &events);
        assert_eq!(files.len(), 2, "{files:?}");
        assert_eq!(files[0].name, "INV-2026-0001.pdf");
        assert_eq!(files[0].folder, folder.path().to_string_lossy());
        assert!(files[0].can_open);
        assert!(!files[1].can_open, "a script only gets Open folder");
    }

    #[test]
    fn only_a_file_of_the_run_can_be_opened() {
        let database = test_database();
        let agent = create_test_agent(&database, "Invoices");
        let run = database.insert_run(&agent.id, 1, RunTrigger::Test).unwrap();
        let outside = tempfile::NamedTempFile::new().unwrap();
        let path = outside.path().to_string_lossy().into_owned();
        assert!(matches!(open_run_file(&database, &run.id, &path), Err(AppError::NotFound(_))));
        assert!(matches!(open_run_file_folder(&database, &run.id, &path), Err(AppError::NotFound(_))));
    }
}
