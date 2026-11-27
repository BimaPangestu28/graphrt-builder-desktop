//! Copying a file a person chose into the agent's workspace, after checking it.
//!
//! The path comes from the system file dialog (opened by Rust) or from a drop the window
//! reported; a path that reached us any other way is refused before the disk is touched.
//! Then, in this order:
//! 1. it must be a regular file of at most [`MAX_ATTACHMENT_BYTES`], read once from one
//!    open handle (so what is checked is what is stored);
//! 2. its type is read from its first bytes, never from its name: documents and text for an
//!    agent that reads files, PNG / JPEG / GIF / WebP for an agent that looks at pictures,
//!    and nothing else (no programs, scripts, HTML, SVG, archives);
//! 3. a picture must declare a canvas the decoder accepts, and is stored without its
//!    metadata (EXIF, GPS position, comments), turned upright first when it needs it;
//! 4. it is stored as `uploads/<safe name>` through graphrt's workspace, which enforces the
//!    quota and refuses programs once more.
//!
//! Reading, checking and re-encoding run on the blocking pool, never on a thread the UI
//! or the async runtime waits on.

use std::io::Read;
use std::path::{Path, PathBuf};

use graphrt_files::{FilesError, MediaClass, StoreError, StoredFile, Workspace, WorkspacePath};
use graphrt_image::{ImageLimits, Transform};
use serde::Serialize;

use super::abilities::FileAbilities;
use super::cards::{card_of, FileCard, PREVIEWABLE_PICTURE_TYPES};
use super::{AgentFiles, FileScope, MAX_ATTACHMENTS_PER_MESSAGE, MAX_ATTACHMENT_BYTES};
use crate::error::{AppError, AppResult};

/// Directory of a workspace that holds what people attached.
pub(super) const UPLOADS_DIR: &str = "uploads";
/// Longest stored file name, in bytes (graphrt allows 128 per name).
const MAX_NAME_BYTES: usize = 96;
/// How many numbered names are tried when a name is taken (`report-2.pdf`...).
const MAX_NAME_ATTEMPTS: usize = 50;

/// How a path reached the backend.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PathOrigin {
    /// Chosen in the system file dialog this process opened.
    PickedInDialog,
    /// Sent by the webview after a drop: taken only when the window reported that drop.
    Dropped,
}

/// Why a file was not attached. The screens translate the code; `Display` is the
/// English sentence for logs.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, thiserror::Error)]
#[serde(rename_all = "snake_case")]
pub enum AttachProblem {
    #[error("this file was not chosen in the app")]
    NotChosen,
    #[error("this is not a file")]
    NotAFile,
    #[error("the file could not be read")]
    Unreadable,
    #[error("the file is empty")]
    Empty,
    #[error("the file is larger than 25 MB")]
    TooLarge,
    #[error("this kind of file is not supported")]
    UnsupportedKind,
    #[error("this kind of picture is not supported: save it as JPG or PNG")]
    UnsupportedPicture,
    #[error("the picture is too large")]
    PictureTooLarge,
    #[error("this agent does not read files")]
    FilesNotRead,
    #[error("this agent does not look at pictures")]
    PicturesNotSeen,
    #[error("too many files for one message")]
    TooMany,
    #[error("there is no room left for this agent's files")]
    NoRoomLeft,
    #[error("the file could not be stored")]
    NotStored,
}

/// What happened to one chosen file. Keep `src/api/agentFileTypes.ts` in sync.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AttachOutcome {
    /// The file's own name (no folder), for the message when it was refused.
    pub name: String,
    /// The stored file; `None` when it was refused.
    pub card: Option<FileCard>,
    /// Why it was refused; `None` when it was stored.
    pub problem: Option<AttachProblem>,
}

impl AttachOutcome {
    fn refused(name: String, problem: AttachProblem) -> Self {
        Self { name, card: None, problem: Some(problem) }
    }
}

/// A file attached to a message, read back from the workspace.
#[derive(Debug, Clone, PartialEq)]
pub struct AttachedFile {
    /// The trusted graphrt file value (for `sys.files`).
    pub value: graphrt_core::value::File,
    pub card: FileCard,
    /// The path the agent's file tools use, e.g. `uploads/invoice.pdf`.
    pub path: String,
}

/// A file read from this computer, not yet checked.
struct HostFile {
    name: String,
    bytes: Vec<u8>,
}

impl AgentFiles {
    /// Stores the files at `paths` for `scope` and says what happened to each, in order.
    /// One refused file does not stop the others.
    ///
    /// `already_attached` is how many files the message holds so far; files beyond
    /// [`MAX_ATTACHMENTS_PER_MESSAGE`] are refused.
    ///
    /// # Errors
    /// `Internal` when the agent's folder cannot be created. A file that cannot be taken
    /// is an [`AttachOutcome`] with a `problem`, not an error.
    pub async fn attach_host_files(
        &self,
        scope: &FileScope,
        abilities: FileAbilities,
        paths: Vec<PathBuf>,
        origin: PathOrigin,
        already_attached: usize,
    ) -> AppResult<Vec<AttachOutcome>> {
        let view = self.view(scope)?;
        let mut outcomes = Vec::with_capacity(paths.len());
        let mut attached = already_attached;
        for path in paths {
            let name = display_name(&path);
            if origin == PathOrigin::Dropped && !self.take_dropped(&path) {
                outcomes.push(AttachOutcome::refused(name, AttachProblem::NotChosen));
                continue;
            }
            if attached >= MAX_ATTACHMENTS_PER_MESSAGE {
                outcomes.push(AttachOutcome::refused(name, AttachProblem::TooMany));
                continue;
            }
            match attach_one(&view, abilities, path).await {
                Ok(card) => {
                    attached += 1;
                    outcomes.push(AttachOutcome { name: card.name.clone(), card: Some(card), problem: None });
                }
                Err(problem) => outcomes.push(AttachOutcome::refused(name, problem)),
            }
        }
        Ok(outcomes)
    }

    /// Removes an attached file that was not sent (the person took it off the message).
    /// Only files below `uploads/` of `scope` can be removed this way.
    ///
    /// # Errors
    /// `InvalidInput` when `reference` names no attached file of `scope`.
    pub async fn discard_attachment(&self, scope: &FileScope, reference: &str) -> AppResult<()> {
        let view = self.view(scope)?;
        let path = uploaded_path(&view, reference)?;
        match view.delete(&path).await {
            Ok(()) | Err(FilesError::Store(StoreError::NotFound(_))) => Ok(()),
            Err(error) => Err(AppError::Internal(format!("could not remove the file: {error}"))),
        }
    }

    /// The attached files `references` name in `scope`, as trusted graphrt file values
    /// (for `sys.files`) with their cards, in order.
    ///
    /// # Errors
    /// `InvalidInput` when there are more than [`MAX_ATTACHMENTS_PER_MESSAGE`], or a
    /// reference names no attached file of `scope` (another conversation's file, a path
    /// outside `uploads/`, a file that is gone).
    pub async fn attached_files(&self, scope: &FileScope, references: &[String]) -> AppResult<Vec<AttachedFile>> {
        if references.len() > MAX_ATTACHMENTS_PER_MESSAGE {
            return Err(AppError::InvalidInput(format!("a message takes at most {MAX_ATTACHMENTS_PER_MESSAGE} files")));
        }
        let view = self.view(scope)?;
        let mut files = Vec::with_capacity(references.len());
        for reference in references {
            let path = uploaded_path(&view, reference)?;
            let stored = view.inspect(&path).await.map_err(|_| not_attached())?;
            files.push(AttachedFile {
                value: view.file_value(&stored),
                card: card_of(&view, &stored),
                path: path.to_string(),
            });
        }
        Ok(files)
    }
}

fn not_attached() -> AppError {
    AppError::InvalidInput("that file is not attached to this chat".into())
}

/// The path `reference` names inside `view`, when it lies below `uploads/`.
fn uploaded_path(view: &Workspace, reference: &str) -> AppResult<WorkspacePath> {
    let path = view.path_of_reference(reference).ok_or_else(not_attached)?;
    if path.components().next() != Some(UPLOADS_DIR) {
        return Err(not_attached());
    }
    Ok(path)
}

/// The path's last part, for messages. Never the folders above it.
fn display_name(path: &Path) -> String {
    path.file_name().map(|name| name.to_string_lossy().into_owned()).unwrap_or_default()
}

async fn attach_one(view: &Workspace, abilities: FileAbilities, path: PathBuf) -> Result<FileCard, AttachProblem> {
    let checked = graphrt_files::blocking(move || {
        let host_file = read_host_file(&path)?;
        check_content(host_file, abilities)
    })
    .await
    .map_err(|_| AttachProblem::NotStored)??;
    let stored = store_upload(view, &checked.name, checked.bytes).await?;
    Ok(card_of(view, &stored))
}

/// Reads a regular file of at most [`MAX_ATTACHMENT_BYTES`] from one open handle.
fn read_host_file(path: &Path) -> Result<HostFile, AttachProblem> {
    if !path.is_absolute() {
        return Err(AttachProblem::NotChosen);
    }
    // Checked before opening: opening a FIFO or a device would block or read without end.
    let is_regular_file = std::fs::metadata(path).map(|metadata| metadata.is_file()).unwrap_or(false);
    if !is_regular_file {
        return Err(AttachProblem::NotAFile);
    }
    let file = std::fs::File::open(path).map_err(|_| AttachProblem::Unreadable)?;
    let metadata = file.metadata().map_err(|_| AttachProblem::Unreadable)?;
    if !metadata.is_file() {
        return Err(AttachProblem::NotAFile);
    }
    if metadata.len() > MAX_ATTACHMENT_BYTES {
        return Err(AttachProblem::TooLarge);
    }
    // The size above is only a hint (the file may still grow): read at most one byte past the limit.
    let mut bytes = Vec::with_capacity(usize::try_from(metadata.len()).unwrap_or(0));
    file.take(MAX_ATTACHMENT_BYTES + 1).read_to_end(&mut bytes).map_err(|_| AttachProblem::Unreadable)?;
    if bytes.is_empty() {
        return Err(AttachProblem::Empty);
    }
    if u64::try_from(bytes.len()).unwrap_or(u64::MAX) > MAX_ATTACHMENT_BYTES {
        return Err(AttachProblem::TooLarge);
    }
    Ok(HostFile { name: display_name(path), bytes })
}

/// Decides from the content whether the agent takes the file, and cleans pictures.
fn check_content(host_file: HostFile, abilities: FileAbilities) -> Result<HostFile, AttachProblem> {
    let HostFile { name, bytes } = host_file;
    let extension = Path::new(&name).extension().map(|extension| extension.to_string_lossy().to_ascii_lowercase());
    // A picture format graphrt-image knows by its first bytes but the workspace does not (HEIC).
    let is_picture = graphrt_image::sniff_format(&bytes).is_some();
    let media = graphrt_files::sniff(&bytes, extension.as_deref());
    match media.class {
        _ if is_picture => {}
        MediaClass::Image => return Err(AttachProblem::UnsupportedPicture),
        _ if is_phone_photo_container(&bytes) => return Err(AttachProblem::UnsupportedPicture),
        MediaClass::Text | MediaClass::Pdf | MediaClass::Document if abilities.reads_files => {
            return Ok(HostFile { name, bytes });
        }
        MediaClass::Text | MediaClass::Pdf | MediaClass::Document => return Err(AttachProblem::FilesNotRead),
        _ => return Err(AttachProblem::UnsupportedKind),
    }
    if !abilities.sees_pictures {
        return Err(AttachProblem::PicturesNotSeen);
    }
    Ok(HostFile { name, bytes: clean_picture(&bytes)? })
}

/// Whether `bytes` start like a HEIC or AVIF picture (what phones save). Neither is
/// decoded here, and saying "save it as JPG or PNG" helps more than "not supported".
fn is_phone_photo_container(bytes: &[u8]) -> bool {
    const BRANDS: [&[u8]; 7] = [b"heic", b"heix", b"hevc", b"heim", b"mif1", b"msf1", b"avif"];
    bytes.get(4..8) == Some(b"ftyp") && bytes.get(8..12).is_some_and(|brand| BRANDS.contains(&brand))
}

/// The picture without metadata, upright. Refuses formats the decoder does not read and
/// canvases above the limits (read from the header, before any decoding).
fn clean_picture(bytes: &[u8]) -> Result<Vec<u8>, AttachProblem> {
    let limits = ImageLimits::default();
    let info = graphrt_image::probe(bytes).map_err(|_| AttachProblem::UnsupportedPicture)?;
    if !PREVIEWABLE_PICTURE_TYPES.contains(&info.format.mime()) {
        return Err(AttachProblem::UnsupportedPicture);
    }
    limits.check_bytes(u64::try_from(bytes.len()).unwrap_or(u64::MAX)).map_err(|_| AttachProblem::PictureTooLarge)?;
    limits.check_dimensions(info.width, info.height).map_err(|_| AttachProblem::PictureTooLarge)?;
    if info.needs_rotation() {
        // Removing the metadata removes the orientation too: turn the pixels first.
        let upright = Transform { max_width: None, max_height: None, format: Some(info.format) };
        return graphrt_image::transform(bytes, &limits, upright)
            .map(|processed| processed.bytes)
            .map_err(|_| AttachProblem::UnsupportedPicture);
    }
    graphrt_image::strip_metadata(bytes).map_err(|_| AttachProblem::UnsupportedPicture)
}

/// Stores `bytes` as `uploads/<safe name>`, numbering the name when it is taken.
async fn store_upload(view: &Workspace, name: &str, bytes: Vec<u8>) -> Result<StoredFile, AttachProblem> {
    let (stem, extension) = safe_name_parts(name);
    for attempt in 1..=MAX_NAME_ATTEMPTS {
        let numbered = if attempt == 1 { stem.clone() } else { format!("{stem}-{attempt}") };
        let file_name = match &extension {
            Some(extension) => format!("{numbered}.{extension}"),
            None => numbered,
        };
        let path = WorkspacePath::parse(&format!("{UPLOADS_DIR}/{file_name}")).map_err(|_| AttachProblem::NotStored)?;
        match view.write(&path, bytes.clone(), false).await {
            Ok(stored) => return Ok(stored),
            Err(FilesError::Store(StoreError::AlreadyExists(_))) => continue,
            Err(FilesError::QuotaExceeded { .. } | FilesError::TooManyFiles { .. }) => {
                return Err(AttachProblem::NoRoomLeft)
            }
            Err(FilesError::TooLarge { .. }) => return Err(AttachProblem::TooLarge),
            Err(FilesError::Refused { .. }) => return Err(AttachProblem::UnsupportedKind),
            Err(error) => {
                log::warn!("could not store an attached file: {error}");
                return Err(AttachProblem::NotStored);
            }
        }
    }
    Err(AttachProblem::NotStored)
}

/// A file name graphrt's workspace accepts, as (stem, extension): letters, digits,
/// spaces, `-`, `_`, `(`, `)` and `.` inside the stem are kept, everything else becomes
/// `_`. Never hidden, never empty, at most [`MAX_NAME_BYTES`] long.
fn safe_name_parts(name: &str) -> (String, Option<String>) {
    let (raw_stem, raw_extension) = match name.rsplit_once('.') {
        Some((stem, extension)) if !stem.is_empty() && !extension.is_empty() => (stem, Some(extension)),
        _ => (name, None),
    };
    let extension = raw_extension
        .map(|extension| extension.chars().filter(char::is_ascii_alphanumeric).take(8).collect::<String>())
        .map(|extension| extension.to_ascii_lowercase())
        .filter(|extension| !extension.is_empty());
    let mut stem = String::new();
    for character in raw_stem.chars() {
        let kept = character.is_alphanumeric() || matches!(character, ' ' | '-' | '_' | '(' | ')' | '.');
        let next = if kept { character } else { '_' };
        if stem.len() + next.len_utf8() > MAX_NAME_BYTES {
            break;
        }
        stem.push(next);
    }
    let stem = stem.trim_matches(|character: char| character == '.' || character.is_whitespace()).to_owned();
    (if stem.is_empty() { "file".to_owned() } else { stem }, extension)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn names_are_made_safe_and_keep_their_extension() {
        assert_eq!(safe_name_parts("Laporan Q3 (final).PDF"), ("Laporan Q3 (final)".into(), Some("pdf".into())));
        assert_eq!(safe_name_parts(".env"), ("env".into(), None));
        assert_eq!(safe_name_parts("..."), ("file".into(), None));
        assert_eq!(safe_name_parts("..hidden.txt"), ("hidden".into(), Some("txt".into())));
        assert_eq!(safe_name_parts("a/b\\c:d.txt"), ("a_b_c_d".into(), Some("txt".into())));
        assert_eq!(safe_name_parts("report\u{202e}txt.exe"), ("report_txt".into(), Some("exe".into())));
        assert_eq!(safe_name_parts("catatan"), ("catatan".into(), None));
        let (long_stem, extension) = safe_name_parts(&format!("{}.pdf", "é".repeat(200)));
        assert!(long_stem.len() <= MAX_NAME_BYTES);
        assert_eq!(extension.as_deref(), Some("pdf"));
    }

    #[test]
    fn a_path_that_is_not_absolute_is_not_read() {
        assert_eq!(read_host_file(Path::new("notes.txt")).err(), Some(AttachProblem::NotChosen));
    }
}
