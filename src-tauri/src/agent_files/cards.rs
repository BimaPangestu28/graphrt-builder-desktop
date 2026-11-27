//! What the screens show about a file: a card with its name, size and kind.
//!
//! A card is always built from the stored file ([`card_of`]): its type comes from the
//! file's first bytes and its size from the store. Nothing a model or the webview wrote
//! about a file (a name, a media type) reaches a card, only the `reference` that names it.

use graphrt_files::{MediaClass, StoredFile, Workspace, WorkspacePath, REFERENCE_SCHEME};
use serde::{Deserialize, Serialize};
use serde_json::Value as Json;

use super::MAX_FILE_CARDS;

/// Key that marks a graphrt file value in JSON.
const FILE_MARKER_KEY: &str = "$file";
/// How deep [`workspace_references_in`] looks into nested values.
const MAX_SEARCH_DEPTH: usize = 12;

/// The kind of a file, in the words a person uses. It picks the icon and the label.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum FileCardKind {
    Picture,
    Pdf,
    /// Word and other text documents.
    Document,
    /// Excel and CSV.
    Spreadsheet,
    Slides,
    Text,
    /// HTML and SVG: offered as a download, never opened in the app.
    WebPage,
    Other,
}

/// Whether a card may show its content.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PreviewKind {
    /// A raster picture graphrt-image can decode: the card shows a small copy.
    Picture,
    /// Download only.
    None,
}

/// One file of an agent. Keep `src/api/agentFileTypes.ts` in sync.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FileCard {
    /// `workspace:<path>`: names the file in its agent's workspace, for preview and download.
    pub reference: String,
    pub name: String,
    pub size_bytes: u64,
    /// Detected from the content, e.g. `application/pdf`.
    pub mime_type: String,
    pub kind: FileCardKind,
    pub preview: PreviewKind,
}

/// The card of a stored file of `view`.
pub fn card_of(view: &Workspace, stored: &StoredFile) -> FileCard {
    let file_value = view.file_value(stored);
    let mime_type = stored.media.mime;
    FileCard {
        reference: file_value.reference.unwrap_or_default(),
        name: file_value.name,
        size_bytes: stored.entry.size,
        mime_type: mime_type.to_owned(),
        kind: card_kind(stored.media.class, mime_type),
        preview: preview_kind(stored.media.class, mime_type),
    }
}

fn card_kind(class: MediaClass, mime_type: &str) -> FileCardKind {
    match class {
        MediaClass::Image => FileCardKind::Picture,
        MediaClass::Pdf => FileCardKind::Pdf,
        MediaClass::ActiveText => FileCardKind::WebPage,
        MediaClass::Text if mime_type == "text/csv" => FileCardKind::Spreadsheet,
        MediaClass::Text => FileCardKind::Text,
        MediaClass::Document if mime_type.contains("spreadsheet") || mime_type.contains("excel") => {
            FileCardKind::Spreadsheet
        }
        MediaClass::Document if mime_type.contains("presentation") || mime_type.contains("powerpoint") => {
            FileCardKind::Slides
        }
        MediaClass::Document if mime_type.contains("word") || mime_type.contains("opendocument.text") => {
            FileCardKind::Document
        }
        _ => FileCardKind::Other,
    }
}

/// Media types of the pictures graphrt-image decodes (and so can make a preview of).
pub(super) const PREVIEWABLE_PICTURE_TYPES: &[&str] = &["image/png", "image/jpeg", "image/gif", "image/webp"];

fn preview_kind(class: MediaClass, mime_type: &str) -> PreviewKind {
    if class == MediaClass::Image && PREVIEWABLE_PICTURE_TYPES.contains(&mime_type) {
        PreviewKind::Picture
    } else {
        PreviewKind::None
    }
}

/// The `workspace:` references of the graphrt file values inside `value`, in order,
/// each once. Other references (a path on this computer, a URL) are left out.
pub fn workspace_references_in(value: &Json) -> Vec<String> {
    let mut references = Vec::new();
    collect_references(value, MAX_SEARCH_DEPTH, &mut references);
    references
}

fn collect_references(value: &Json, depth_left: usize, references: &mut Vec<String>) {
    if depth_left == 0 {
        return;
    }
    match value {
        Json::Array(items) => items.iter().for_each(|item| collect_references(item, depth_left - 1, references)),
        Json::Object(fields) if fields.get(FILE_MARKER_KEY) == Some(&Json::Bool(true)) => {
            let reference = fields.get("reference").and_then(Json::as_str);
            if let Some(reference) = reference.filter(|reference| reference.starts_with(REFERENCE_SCHEME)) {
                if !references.iter().any(|known| known == reference) {
                    references.push(reference.to_owned());
                }
            }
        }
        Json::Object(fields) => {
            fields.values().for_each(|field| collect_references(field, depth_left - 1, references));
        }
        _ => {}
    }
}

/// The cards of the files `references` name inside `view`, in order, at most
/// [`MAX_FILE_CARDS`]. A reference that names nothing in `view` (a file of another
/// conversation or agent, a path that leaves the workspace, a file that is gone) is skipped.
pub async fn cards_for_references(view: &Workspace, references: &[String]) -> Vec<FileCard> {
    let mut cards: Vec<FileCard> = Vec::new();
    for reference in references {
        if cards.len() >= MAX_FILE_CARDS {
            break;
        }
        let Some(path) = view.path_of_reference(reference) else { continue };
        let Some(card) = card_at(view, &path).await else { continue };
        if !cards.iter().any(|known| known.reference == card.reference) {
            cards.push(card);
        }
    }
    cards
}

/// The card of the file at `path`, when it exists.
pub(super) async fn card_at(view: &Workspace, path: &WorkspacePath) -> Option<FileCard> {
    let stored = view.inspect(path).await.ok()?;
    Some(card_of(view, &stored))
}
