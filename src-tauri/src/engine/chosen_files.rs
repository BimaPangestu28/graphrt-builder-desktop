//! Files the user chose (picked or dropped) for a run's `file` / `file-list`
//! start inputs on the Test form.
//!
//! The UI sends a file input as its absolute path and a file list as a list of
//! paths. Run inputs are converted as untrusted JSON (they can never forge a
//! graphrt file), so only [`attach_chosen_files`], called for runs the user
//! starts from the app, turns those paths into graphrt files. Every path is
//! checked first: absolute, an existing regular file (symlinks resolved), at
//! most [`MAX_CHOSEN_FILE_BYTES`].
//!
//! Attached paths are remembered in a process-wide allow-list, and
//! [`ChosenFilesResolver`] (the `local_file` resolver of every run) reads only
//! those, so a file reference that did not come from the user cannot read
//! anything from disk.

use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::sync::{Arc, LazyLock, Mutex};

use futures::future::BoxFuture;
use graphrt_core::file::{ChainResolver, FileBytes, FileError, FileResolver};
use graphrt_core::value::{File, FileKind, FileTransfer};
use graphrt_core::{IndexMap, Value};

use crate::error::{AppError, AppResult};
use crate::flow;

/// Largest file a run input takes (graphrt's document reader stops there too).
pub(crate) const MAX_CHOSEN_FILE_BYTES: u64 = 50 * 1024 * 1024;

/// Canonical paths the user chose for run inputs during this session.
static CHOSEN_PATHS: LazyLock<Mutex<HashSet<PathBuf>>> = LazyLock::new(|| Mutex::new(HashSet::new()));

fn remember(path: &Path) {
    if let Ok(mut chosen_paths) = CHOSEN_PATHS.lock() {
        chosen_paths.insert(path.to_path_buf());
    }
}

fn was_chosen(path: &Path) -> bool {
    CHOSEN_PATHS.lock().map(|chosen_paths| chosen_paths.contains(path)).unwrap_or(false)
}

/// Whether a start input type takes one file, a list of files, or neither.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum FileInputKind {
    Single,
    List,
}

fn file_input_kind(input_type: &str) -> Option<FileInputKind> {
    match input_type.to_ascii_lowercase().as_str() {
        "file" => Some(FileInputKind::Single),
        "file-list" | "array[file]" => Some(FileInputKind::List),
        _ => None,
    }
}

/// Replaces the paths given for the flow's file inputs with graphrt files.
///
/// Values of other inputs, and file inputs left empty, are untouched (graphrt
/// reports a missing required input itself).
///
/// # Errors
/// `InvalidInput` naming the input when a value is not a path (or list of
/// paths), or a path is relative, missing, not a regular file or too large.
pub(crate) fn attach_chosen_files(flow_yaml: &str, inputs: &mut IndexMap<String, Value>) -> AppResult<()> {
    for flow_input in flow::summarize_flow(flow_yaml)?.inputs {
        let Some(kind) = file_input_kind(&flow_input.input_type) else { continue };
        let Some(value) = inputs.get(&flow_input.name) else { continue };
        let attached = attach_value(&flow_input.label, kind, value)?;
        if let Some(attached) = attached {
            inputs.insert(flow_input.name, attached);
        }
    }
    Ok(())
}

fn attach_value(label: &str, kind: FileInputKind, value: &Value) -> AppResult<Option<Value>> {
    let paths: Vec<&str> = match value {
        Value::Null => return Ok(None),
        Value::String(path) if path.trim().is_empty() => return Ok(None),
        Value::String(path) => vec![path.as_ref()],
        Value::Array(items) if kind == FileInputKind::List => items
            .iter()
            .map(|item| match item {
                Value::String(path) => Ok(path.as_ref()),
                _ => Err(not_a_path(label)),
            })
            .collect::<AppResult<_>>()?,
        _ => return Err(not_a_path(label)),
    };
    let files = paths.into_iter().map(|path| chosen_file(label, path)).collect::<AppResult<Vec<_>>>()?;
    Ok(Some(match kind {
        FileInputKind::Single => files.into_iter().next().unwrap_or(Value::Null),
        FileInputKind::List => Value::array(files),
    }))
}

fn not_a_path(label: &str) -> AppError {
    AppError::InvalidInput(format!("{label} needs a file chosen on this computer"))
}

/// Checks `path` and returns it as a `local_file` graphrt file.
fn chosen_file(label: &str, path: &str) -> AppResult<Value> {
    let invalid = |reason: String| AppError::InvalidInput(format!("{label}: {reason}"));
    let given_path = Path::new(path.trim());
    if !given_path.is_absolute() {
        return Err(invalid(format!("{path} is not a full path to a file on this computer")));
    }
    let real_path = given_path.canonicalize().map_err(|error| invalid(format!("cannot open {path}: {error}")))?;
    let metadata = std::fs::metadata(&real_path).map_err(|error| invalid(format!("cannot open {path}: {error}")))?;
    if !metadata.is_file() {
        return Err(invalid(format!("{path} is not a file")));
    }
    if metadata.len() > MAX_CHOSEN_FILE_BYTES {
        return Err(invalid(format!("{path} is larger than {} MB", MAX_CHOSEN_FILE_BYTES / (1024 * 1024))));
    }
    remember(&real_path);
    Ok(Value::from(local_file(&real_path, metadata.len())))
}

fn local_file(real_path: &Path, size: u64) -> File {
    let name = real_path.file_name().map(|name| name.to_string_lossy().into_owned()).unwrap_or_default();
    let extension = real_path.extension().map(|extension| extension.to_string_lossy().to_ascii_lowercase());
    let (kind, mime_type) = extension.as_deref().map(kind_and_mime_type).unwrap_or((FileKind::Custom, None));
    File {
        marker: true,
        id: None,
        name,
        kind,
        transfer: FileTransfer::LocalFile,
        url: None,
        reference: Some(real_path.to_string_lossy().into_owned()),
        mime_type: mime_type.map(str::to_owned),
        size: Some(size),
        extension,
    }
}

/// Category and media type of common extensions, so model and document nodes
/// can route the file; others are `custom` with no media type.
fn kind_and_mime_type(extension: &str) -> (FileKind, Option<&'static str>) {
    match extension {
        "png" => (FileKind::Image, Some("image/png")),
        "jpg" | "jpeg" => (FileKind::Image, Some("image/jpeg")),
        "gif" => (FileKind::Image, Some("image/gif")),
        "webp" => (FileKind::Image, Some("image/webp")),
        "pdf" => (FileKind::Document, Some("application/pdf")),
        "docx" => (FileKind::Document, Some("application/vnd.openxmlformats-officedocument.wordprocessingml.document")),
        "xlsx" => (FileKind::Document, Some("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")),
        "pptx" => {
            (FileKind::Document, Some("application/vnd.openxmlformats-officedocument.presentationml.presentation"))
        }
        "csv" => (FileKind::Document, Some("text/csv")),
        "md" | "markdown" => (FileKind::Document, Some("text/markdown")),
        "txt" | "text" => (FileKind::Document, Some("text/plain")),
        "html" | "htm" => (FileKind::Document, Some("text/html")),
        "json" => (FileKind::Document, Some("application/json")),
        "mp3" => (FileKind::Audio, Some("audio/mpeg")),
        "wav" => (FileKind::Audio, Some("audio/wav")),
        "mp4" => (FileKind::Video, Some("video/mp4")),
        "mov" => (FileKind::Video, Some("video/quicktime")),
        _ => (FileKind::Custom, None),
    }
}

/// Allows the files a stored run started with again (resuming after a restart).
///
/// Only the allow-list changes: the run reads its files from its snapshot, and
/// a snapshot holds graphrt files only for inputs [`attach_chosen_files`]
/// attached. Paths that are gone are skipped (reading them fails later).
pub(super) fn remember_stored_file_inputs(flow_yaml: &str, stored_inputs: serde_json::Value) {
    let Ok(mut inputs) = super::preparation::json_object_to_value_map(stored_inputs, "run inputs") else { return };
    if let Err(error) = attach_chosen_files(flow_yaml, &mut inputs) {
        log::info!("some files of a resumed run are no longer readable: {error}");
    }
}

/// The file resolver of every run: data URLs, then `local_file` references the
/// user chose (see [`attach_chosen_files`]).
pub(super) fn run_file_resolver() -> Arc<dyn FileResolver> {
    Arc::new(ChainResolver::with_data_urls().then(Arc::new(ChosenFilesResolver)))
}

/// Reads `local_file` references the user chose for a run input; refuses others.
#[derive(Debug)]
pub(crate) struct ChosenFilesResolver;

impl FileResolver for ChosenFilesResolver {
    fn read<'a>(&'a self, file: &'a File, max_bytes: u64) -> BoxFuture<'a, Result<FileBytes, FileError>> {
        Box::pin(async move {
            let (FileTransfer::LocalFile, Some(reference)) = (file.transfer, file.reference.as_deref()) else {
                return Err(FileError::Unsupported(file.name.clone()));
            };
            let name = file.name.clone();
            let io_error = |error: std::io::Error| match error.kind() {
                std::io::ErrorKind::NotFound => FileError::NotFound { name: name.clone() },
                _ => FileError::Io { name: name.clone(), message: error.to_string() },
            };
            let real_path = tokio::fs::canonicalize(reference).await.map_err(io_error)?;
            if !was_chosen(&real_path) {
                return Err(FileError::Denied { name, reason: "only files chosen in graphrt can be read".into() });
            }
            let metadata = tokio::fs::metadata(&real_path).await.map_err(io_error)?;
            let limit = max_bytes.min(MAX_CHOSEN_FILE_BYTES);
            if !metadata.is_file() {
                return Err(FileError::Denied { name, reason: "not a regular file".into() });
            }
            if metadata.len() > limit {
                return Err(FileError::TooLarge { name, limit });
            }
            // Read with a hard cap: the file may grow between the size check and the read.
            let handle = tokio::fs::File::open(&real_path).await.map_err(io_error)?;
            let mut bytes = Vec::new();
            let mut limited = tokio::io::AsyncReadExt::take(handle, limit.saturating_add(1));
            tokio::io::AsyncReadExt::read_to_end(&mut limited, &mut bytes).await.map_err(io_error)?;
            if u64::try_from(bytes.len()).unwrap_or(u64::MAX) > limit {
                return Err(FileError::TooLarge { name, limit });
            }
            Ok(FileBytes { bytes, mime_type: file.mime_type.clone() })
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const FLOW_WITH_FILES: &str = "version: \"1\"\nname: files\ngraph:\n  nodes:\n    \
        - id: start\n      type: start\n      variables:\n        \
        - { variable: invoice, type: file, required: true, label: Invoice }\n        \
        - { variable: photos, type: file-list, label: Photos }\n        \
        - { variable: note, type: text-input, label: Note }\n    \
        - { id: end, type: end, outputs: [] }\n  edges:\n    - { source: start, target: end }\n";

    fn temp_file(contents: &[u8], name: &str) -> (tempfile::TempDir, PathBuf) {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join(name);
        std::fs::write(&path, contents).unwrap();
        (dir, path)
    }

    fn inputs(pairs: &[(&str, Value)]) -> IndexMap<String, Value> {
        pairs.iter().map(|(name, value)| ((*name).to_owned(), value.clone())).collect()
    }

    #[test]
    fn attaches_a_file_and_a_file_list_and_leaves_text_alone() {
        let (_dir, invoice_path) = temp_file(b"%PDF-1.4", "Invoice.pdf");
        let (_other_dir, photo_path) = temp_file(b"png", "cat.png");
        let mut run_inputs = inputs(&[
            ("invoice", Value::from(invoice_path.to_string_lossy().as_ref())),
            ("photos", Value::array([Value::from(photo_path.to_string_lossy().as_ref())])),
            ("note", Value::from("/not/a/file/but/text")),
        ]);
        attach_chosen_files(FLOW_WITH_FILES, &mut run_inputs).unwrap();

        let Value::File(invoice) = &run_inputs["invoice"] else {
            panic!("invoice is not a file: {:?}", run_inputs["invoice"])
        };
        assert_eq!(invoice.name, "Invoice.pdf");
        assert_eq!(invoice.transfer, FileTransfer::LocalFile);
        assert_eq!(invoice.kind, FileKind::Document);
        assert_eq!(invoice.mime_type.as_deref(), Some("application/pdf"));
        assert_eq!(invoice.size, Some(8));
        let Value::Array(photos) = &run_inputs["photos"] else { panic!("photos is not a list") };
        assert!(matches!(&photos[0], Value::File(photo) if photo.kind == FileKind::Image));
        assert_eq!(run_inputs["note"], Value::from("/not/a/file/but/text"));
    }

    #[test]
    fn refuses_relative_missing_and_folder_paths() {
        let dir = tempfile::tempdir().unwrap();
        for bad_path in [
            "Invoice.pdf".to_owned(),
            dir.path().join("missing.pdf").to_string_lossy().into_owned(),
            dir.path().to_string_lossy().into_owned(),
        ] {
            let mut run_inputs = inputs(&[("invoice", Value::from(bad_path.as_str()))]);
            let error = attach_chosen_files(FLOW_WITH_FILES, &mut run_inputs).unwrap_err();
            assert!(
                matches!(&error, AppError::InvalidInput(message) if message.starts_with("Invoice: ")),
                "{bad_path}: {error:?}"
            );
        }
    }

    #[test]
    fn refuses_a_list_for_a_single_file_and_non_text_values() {
        let mut run_inputs = inputs(&[("invoice", Value::array([Value::from("/a"), Value::from("/b")]))]);
        assert!(matches!(attach_chosen_files(FLOW_WITH_FILES, &mut run_inputs), Err(AppError::InvalidInput(_))));
        let mut run_inputs = inputs(&[("photos", Value::array([Value::from(3)]))]);
        assert!(matches!(attach_chosen_files(FLOW_WITH_FILES, &mut run_inputs), Err(AppError::InvalidInput(_))));
    }

    #[test]
    fn leaves_empty_file_inputs_for_graphrt_to_report() {
        let mut run_inputs = inputs(&[("invoice", Value::from("")), ("photos", Value::Null)]);
        attach_chosen_files(FLOW_WITH_FILES, &mut run_inputs).unwrap();
        assert_eq!(run_inputs["invoice"], Value::from(""));
        assert_eq!(run_inputs["photos"], Value::Null);
    }

    #[tokio::test]
    async fn resolver_reads_chosen_files_only() {
        let (_dir, chosen_path) = temp_file(b"hello", "chosen.txt");
        let (_other_dir, other_path) = temp_file(b"secret", "other.txt");
        let mut run_inputs = inputs(&[("invoice", Value::from(chosen_path.to_string_lossy().as_ref()))]);
        attach_chosen_files(FLOW_WITH_FILES, &mut run_inputs).unwrap();
        let Value::File(chosen) = &run_inputs["invoice"] else { panic!("not a file") };

        let resolver = run_file_resolver();
        assert_eq!(resolver.read(chosen, 1024).await.unwrap().bytes, b"hello");
        assert!(matches!(resolver.read(chosen, 2).await, Err(FileError::TooLarge { .. })));
        let forged = local_file(&other_path.canonicalize().unwrap(), 6);
        assert!(matches!(resolver.read(&forged, 1024).await, Err(FileError::Denied { .. })));
    }
}
