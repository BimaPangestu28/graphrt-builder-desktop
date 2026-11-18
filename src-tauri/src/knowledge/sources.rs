//! Reading knowledge sources: validating what the user adds, listing the
//! documents of a source (one file, every supported file of a folder, or one
//! web page) and loading their bytes and text.
//!
//! Text comes from graphrt-rag's [`DocExtractor`] (graphrt-doc: PDF, Word,
//! PowerPoint, Excel/ODS, CSV, HTML, EPUB, e-mail, Markdown and plain text).
//! Web pages are fetched through graphrt-http's policy-enforcing client with the
//! default egress policy, so a link can never reach the local network.

use std::path::{Path, PathBuf};

use graphrt_core::file::{FileError, FileResolver};
use graphrt_core::value::{File, FileTransfer};
use graphrt_http::{EgressPolicy, HttpClient, HttpFileResolver};
use graphrt_rag::{DocExtractor, Extractor};

use super::models::{KnowledgeSource, SourceKind};
use crate::error::{AppError, AppResult};

/// File extensions indexed from folders (single files are checked the same way).
pub const SUPPORTED_EXTENSIONS: &[&str] = &[
    "pdf", "docx", "pptx", "xlsx", "ods", "csv", "tsv", "md", "markdown", "txt", "text", "html", "htm", "json", "yaml",
    "yml", "xml", "epub", "eml", "srt", "vtt",
];
/// Files larger than this are skipped (and reported).
pub const MAX_FILE_BYTES: u64 = 50 * 1024 * 1024;
/// Largest web page or document downloaded for a link source.
const MAX_DOWNLOAD_BYTES: u64 = 20 * 1024 * 1024;
/// Most files indexed from one folder.
pub const MAX_FOLDER_FILES: usize = 5_000;
const MAX_URL_LENGTH: usize = 2_048;

/// One document of a source.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SourceEntry {
    /// graphrt document id: the source id, plus `/<relative path>` for folder files.
    pub document_id: String,
    /// File name (or path inside the folder, or page address) shown with passages.
    pub display_name: String,
    pub origin: EntryOrigin,
}

/// Where a document's bytes come from.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum EntryOrigin {
    Path(PathBuf),
    Url(String),
}

/// Raw content of one document.
#[derive(Debug, Clone)]
pub struct LoadedDocument {
    pub bytes: Vec<u8>,
    pub mime_type: Option<String>,
    pub file_name: String,
}

/// A source the user is adding, after validation.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ValidatedSource {
    pub location: String,
    pub name: String,
}

fn file_name_of(path: &Path) -> String {
    path.file_name().map_or_else(|| path.display().to_string(), |name| name.to_string_lossy().into_owned())
}

fn has_supported_extension(path: &Path) -> bool {
    path.extension()
        .and_then(|extension| extension.to_str())
        .is_some_and(|extension| SUPPORTED_EXTENSIONS.contains(&extension.to_ascii_lowercase().as_str()))
}

fn validate_absolute_path(location: &str) -> AppResult<PathBuf> {
    let path = PathBuf::from(location.trim());
    if !path.is_absolute() {
        return Err(AppError::InvalidInput("choose the file or folder with the picker (absolute path needed)".into()));
    }
    Ok(path)
}

/// Checks a new source and works out its display name.
///
/// # Errors
/// `InvalidInput` for a relative or missing path, a file type that cannot be
/// read, or a link that is not http(s).
pub fn validate_new_source(kind: SourceKind, location: &str) -> AppResult<ValidatedSource> {
    match kind {
        SourceKind::File => {
            let path = validate_absolute_path(location)?;
            if !path.is_file() {
                return Err(AppError::InvalidInput(format!("{} is not a file", file_name_of(&path))));
            }
            if !has_supported_extension(&path) {
                return Err(AppError::InvalidInput(format!(
                    "{} is not a supported file type (PDF, Word, PowerPoint, Excel, CSV, Markdown, text, HTML, EPUB)",
                    file_name_of(&path)
                )));
            }
            Ok(ValidatedSource { name: file_name_of(&path), location: path.display().to_string() })
        }
        SourceKind::Folder => {
            let path = validate_absolute_path(location)?;
            if !path.is_dir() {
                return Err(AppError::InvalidInput(format!("{} is not a folder", file_name_of(&path))));
            }
            Ok(ValidatedSource { name: file_name_of(&path), location: path.display().to_string() })
        }
        SourceKind::Url => {
            let url = location.trim();
            let is_web_link = url.starts_with("https://") || url.starts_with("http://");
            if !is_web_link || url.len() > MAX_URL_LENGTH || url.chars().any(char::is_whitespace) {
                return Err(AppError::InvalidInput("links must start with https:// or http://".into()));
            }
            Ok(ValidatedSource { name: url_display_name(url), location: url.to_owned() })
        }
    }
}

/// `https://example.com/menu/` -> `example.com/menu`.
fn url_display_name(url: &str) -> String {
    let without_scheme = url.split_once("://").map_or(url, |(_, rest)| rest);
    let without_query = without_scheme.split(['?', '#']).next().unwrap_or(without_scheme);
    without_query.trim_end_matches('/').to_owned()
}

/// Lists the documents of a source. Blocking (walks the file system).
///
/// # Errors
/// `InvalidInput` when a file or folder no longer exists or cannot be read.
pub fn list_entries(source: &KnowledgeSource) -> AppResult<Vec<SourceEntry>> {
    match source.kind {
        SourceKind::File => {
            let path = PathBuf::from(&source.location);
            if !path.is_file() {
                return Err(AppError::InvalidInput(format!("{} was moved or deleted", source.name)));
            }
            Ok(vec![SourceEntry {
                document_id: source.id.clone(),
                display_name: source.name.clone(),
                origin: EntryOrigin::Path(path),
            }])
        }
        SourceKind::Folder => list_folder_entries(source),
        SourceKind::Url => Ok(vec![SourceEntry {
            document_id: source.id.clone(),
            display_name: source.name.clone(),
            origin: EntryOrigin::Url(source.location.clone()),
        }]),
    }
}

fn list_folder_entries(source: &KnowledgeSource) -> AppResult<Vec<SourceEntry>> {
    let root = PathBuf::from(&source.location);
    if !root.is_dir() {
        return Err(AppError::InvalidInput(format!("the folder {} was moved or deleted", source.name)));
    }
    let mut files = Vec::new();
    collect_supported_files(&root, &mut files)?;
    files.sort();
    files.truncate(MAX_FOLDER_FILES);
    Ok(files
        .into_iter()
        .map(|path| {
            let relative = path.strip_prefix(&root).unwrap_or(&path).to_string_lossy().replace('\\', "/");
            SourceEntry {
                document_id: format!("{}/{relative}", source.id),
                display_name: relative,
                origin: EntryOrigin::Path(path),
            }
        })
        .collect())
}

/// Depth-first walk that skips hidden entries and symbolic links (no loops).
fn collect_supported_files(directory: &Path, files: &mut Vec<PathBuf>) -> AppResult<()> {
    let entries = std::fs::read_dir(directory)
        .map_err(|error| AppError::InvalidInput(format!("could not open {}: {error}", file_name_of(directory))))?;
    for entry in entries.flatten() {
        if files.len() >= MAX_FOLDER_FILES {
            return Ok(());
        }
        if entry.file_name().to_string_lossy().starts_with('.') {
            continue;
        }
        let Ok(file_type) = entry.file_type() else { continue };
        let path = entry.path();
        if file_type.is_dir() {
            collect_supported_files(&path, files)?;
        } else if file_type.is_file() && has_supported_extension(&path) {
            files.push(path);
        }
    }
    Ok(())
}

/// Reads a document's bytes. Errors are user-facing messages.
pub async fn load_entry(entry: &SourceEntry, web: &WebFetcher) -> Result<LoadedDocument, String> {
    match &entry.origin {
        EntryOrigin::Path(path) => {
            let path = path.clone();
            let file_name = entry.display_name.clone();
            tokio::task::spawn_blocking(move || read_local_file(&path, file_name))
                .await
                .map_err(|error| format!("reading stopped unexpectedly: {error}"))?
        }
        EntryOrigin::Url(url) => web.fetch(url, &entry.display_name).await,
    }
}

fn read_local_file(path: &Path, file_name: String) -> Result<LoadedDocument, String> {
    let metadata = std::fs::metadata(path).map_err(|error| format!("{file_name}: {error}"))?;
    if metadata.len() > MAX_FILE_BYTES {
        return Err(format!("{file_name} is larger than {} MB", MAX_FILE_BYTES / (1024 * 1024)));
    }
    let bytes = std::fs::read(path).map_err(|error| format!("{file_name}: {error}"))?;
    Ok(LoadedDocument { bytes, mime_type: None, file_name: file_name_of(path) })
}

/// Extracts the text of a document. CPU-heavy, so it runs on the blocking pool.
pub async fn extract_text(document: LoadedDocument) -> Result<String, String> {
    tokio::task::spawn_blocking(move || {
        DocExtractor::new()
            .extract(&document.bytes, document.mime_type.as_deref(), &document.file_name)
            .map_err(|error| error.to_string())
    })
    .await
    .map_err(|error| format!("reading stopped unexpectedly: {error}"))?
}

/// Stable fingerprint of a document's bytes (64-bit FNV-1a, hex), used to skip
/// unchanged documents on re-sync.
pub fn fingerprint(bytes: &[u8]) -> String {
    let mut hash: u64 = 0xcbf2_9ce4_8422_2325;
    for byte in bytes {
        hash ^= u64::from(*byte);
        hash = hash.wrapping_mul(0x0100_0000_01b3);
    }
    format!("{hash:016x}-{}", bytes.len())
}

/// Downloads link sources with graphrt's egress policy (public addresses only).
#[derive(Debug, Clone)]
pub struct WebFetcher {
    resolver: Option<HttpFileResolver>,
}

impl WebFetcher {
    /// A fetcher with graphrt's default (restrictive) egress policy.
    pub fn new() -> Self {
        match HttpClient::new(EgressPolicy::default()) {
            Ok(client) => Self { resolver: Some(HttpFileResolver::new(client)) },
            Err(error) => {
                log::warn!("could not set up the HTTP client for knowledge links: {error}");
                Self { resolver: None }
            }
        }
    }

    async fn fetch(&self, url: &str, display_name: &str) -> Result<LoadedDocument, String> {
        let resolver = self.resolver.as_ref().ok_or_else(|| "web links are unavailable".to_owned())?;
        let file = File {
            name: display_name.to_owned(),
            url: Some(url.to_owned()),
            transfer: FileTransfer::RemoteUrl,
            ..File::default()
        };
        let content = resolver.read(&file, MAX_DOWNLOAD_BYTES).await.map_err(describe_fetch_error)?;
        Ok(LoadedDocument { bytes: content.bytes, mime_type: content.mime_type, file_name: url_file_name(url) })
    }
}

impl Default for WebFetcher {
    fn default() -> Self {
        Self::new()
    }
}

fn describe_fetch_error(error: FileError) -> String {
    match error {
        FileError::Denied { reason, .. } => format!("this link is not allowed: {reason}"),
        FileError::NotFound { .. } => "the page was not found (404)".to_owned(),
        FileError::TooLarge { limit, .. } => format!("the page is larger than {} MB", limit / (1024 * 1024)),
        other => other.to_string(),
    }
}

/// Last path segment of a URL, so the extractor can use its extension (`.pdf`).
fn url_file_name(url: &str) -> String {
    let path = url_display_name(url);
    let last_segment = path.rsplit('/').next().unwrap_or_default();
    if last_segment.contains('.') && path.contains('/') {
        last_segment.to_owned()
    } else {
        "page.html".to_owned()
    }
}
