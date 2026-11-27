//! Files in a chatbot conversation: what the customer attached to a message, and the
//! files the bot's reply hands back (see `crate::agent_files`).
//!
//! A message keeps its files as cards in its metadata: `attachments` on a customer
//! message and on the owner's own reply, `files` on a bot reply. A message that is only files stores their names as
//! its text (a message needs one, and the Inbox list shows it) with `filesOnly: true`, so
//! the chat shows the cards and not the names twice.

use std::sync::LazyLock;

use graphrt_core::value::File;
use regex::Regex;
use serde_json::{json, Map, Value as Json};

use crate::agent_files::cards::FileCardKind;
use crate::agent_files::{AttachedFile, FileCard};

/// Metadata key of the files a customer attached.
pub const ATTACHMENTS_KEY: &str = "attachments";
/// Metadata key of the files a bot reply hands back.
pub const FILES_KEY: &str = "files";
/// Metadata flag of a message whose text is only the names of its files.
pub const FILES_ONLY_KEY: &str = "filesOnly";

/// One customer message as it is stored and as the bot's workflow gets it. The owner's own
/// reply is stored the same way (`stored_text` and `metadata`); no workflow reads it.
#[derive(Debug, Clone, PartialEq)]
pub(super) struct CustomerTurn {
    /// The text kept with the message.
    pub stored_text: String,
    /// The message's metadata (JSON object).
    pub metadata: Json,
    /// The text the workflow gets: the customer's words, then where the attached files are.
    pub model_text: String,
    /// The customer's own words, for looking up knowledge.
    pub knowledge_query: String,
    /// The attached files as `sys.files`.
    pub files: Vec<File>,
}

impl CustomerTurn {
    /// A message of `text` with the files the customer attached (none for a plain message).
    pub(super) fn new(text: &str, attached: Vec<AttachedFile>) -> Self {
        let text = text.trim();
        if attached.is_empty() {
            return Self {
                stored_text: text.to_owned(),
                metadata: json!({}),
                model_text: text.to_owned(),
                knowledge_query: text.to_owned(),
                files: Vec::new(),
            };
        }
        let cards: Vec<&FileCard> = attached.iter().map(|file| &file.card).collect();
        let mut metadata = Map::new();
        metadata.insert(ATTACHMENTS_KEY.into(), json!(cards));
        let stored_text = if text.is_empty() {
            metadata.insert(FILES_ONLY_KEY.into(), json!(true));
            file_names(attached.iter().map(|file| &file.card))
        } else {
            text.to_owned()
        };
        let words = if text.is_empty() { "(The customer sent files without a message.)" } else { text };
        let note = attachment_note(&attached);
        Self {
            stored_text,
            metadata: Json::Object(metadata),
            model_text: format!("{words}\n\n{note}"),
            knowledge_query: text.to_owned(),
            files: attached.into_iter().map(|file| file.value).collect(),
        }
    }
}

/// What the workflow is told about the files of a message: one line per file with the path
/// its tools take and what kind of file it is. Small models overlooked a bare list of paths
/// and asked the customer where the file was; a line that says the file is already saved
/// and to use exactly this path is acted on (`real_model_tests.rs`).
fn attachment_note(attached: &[AttachedFile]) -> String {
    let mut note = String::from("[Attached files, already saved for you. Use these exact paths with your tools:");
    for file in attached {
        note.push_str(&format!("\n- {} ({})", file.path, kind_words(&file.card)));
    }
    note.push(']');
    note
}

/// The kind of a file in the words a model reads, e.g. `picture, image/png`.
fn kind_words(card: &FileCard) -> String {
    let kind = match card.kind {
        FileCardKind::Picture => "picture",
        FileCardKind::Pdf => "PDF document",
        FileCardKind::Document => "document",
        FileCardKind::Spreadsheet => "spreadsheet",
        FileCardKind::Slides => "slides",
        FileCardKind::Text => "text file",
        FileCardKind::WebPage | FileCardKind::Other => "file",
    };
    format!("{kind}, {}", card.mime_type)
}

/// The text and metadata of a bot reply with `citations` and the files it hands back.
/// `None` when the reply has neither text nor files.
pub(super) fn bot_reply(reply_text: &str, citations: &[String], files: &[FileCard]) -> Option<(String, Json)> {
    if reply_text.is_empty() && files.is_empty() {
        return None;
    }
    let mut metadata = Map::new();
    if !citations.is_empty() {
        metadata.insert("citations".into(), json!(citations));
    }
    if !files.is_empty() {
        metadata.insert(FILES_KEY.into(), json!(files));
    }
    // A reply that hands files back is shown with their cards: a link the model wrote to a file leads nowhere.
    let reply_text = if files.is_empty() { reply_text.to_owned() } else { without_dead_links(reply_text) };
    let text = if reply_text.is_empty() {
        metadata.insert(FILES_ONLY_KEY.into(), json!(true));
        file_names(files.iter())
    } else {
        reply_text
    };
    Some((text, Json::Object(metadata)))
}

/// `text` with every Markdown link or picture that does not lead to a web address reduced to
/// its words: `[Download](sandbox:/reports/q3.pdf)` becomes `Download`, `![chart](out/c.png)`
/// becomes `chart`. Web links (`http://`, `https://`) are left as they are.
///
/// Models are told the app shows a file they made, and most then write none of these; the
/// small ones still do now and then (qwen2.5:3b, one answer in five). This makes the result
/// the same whatever the model wrote.
fn without_dead_links(text: &str) -> String {
    static LINK: LazyLock<Option<Regex>> = LazyLock::new(|| Regex::new(r"!?\[([^\]\n]*)\]\(([^)\n]*)\)").ok());
    let Some(link) = LINK.as_ref() else { return text.to_owned() };
    let cleaned = link.replace_all(text, |found: &regex::Captures<'_>| {
        let target = found.get(2).map_or("", |target| target.as_str()).trim().to_ascii_lowercase();
        if target.starts_with("http://") || target.starts_with("https://") {
            found.get(0).map_or("", |whole| whole.as_str()).to_owned()
        } else {
            found.get(1).map_or("", |words| words.as_str()).to_owned()
        }
    });
    cleaned.trim().to_owned()
}

fn file_names<'a>(cards: impl Iterator<Item = &'a FileCard>) -> String {
    cards.map(|card| card.name.as_str()).collect::<Vec<_>>().join(", ")
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::agent_files::cards::PreviewKind;

    fn pdf_card() -> FileCard {
        FileCard {
            reference: "workspace:reports/q3.pdf".into(),
            name: "q3.pdf".into(),
            size_bytes: 1200,
            mime_type: "application/pdf".into(),
            kind: FileCardKind::Pdf,
            preview: PreviewKind::None,
        }
    }

    #[test]
    fn a_link_to_a_file_becomes_its_words_and_a_web_link_stays() {
        // What real models wrote after making a file.
        let written = "Gambar sudah diperkecil. Unduh di sini: [Unduh Gambar](sandbox:/uploads/poster_resized.png)";
        assert_eq!(without_dead_links(written), "Gambar sudah diperkecil. Unduh di sini: Unduh Gambar");
        assert_eq!(
            without_dead_links("Ini hasilnya: ![Lihat Gambar](uploads/poster-400x250.png)"),
            "Ini hasilnya: Lihat Gambar"
        );
        assert_eq!(
            without_dead_links("[Rangkuman](reports/pesanan.pdf) dan [situs](https://example.com/menu)"),
            "Rangkuman dan [situs](https://example.com/menu)"
        );
        // Text that is not a link is not touched.
        let plain = "Harga [per box] (minimal 30) adalah 28.000";
        assert_eq!(without_dead_links(plain), plain);
    }

    #[test]
    fn only_a_reply_that_hands_files_back_is_cleaned() {
        let written = "Lihat [menu](menu.pdf)";
        let (with_files, _) = bot_reply(written, &[], &[pdf_card()]).unwrap();
        assert_eq!(with_files, "Lihat menu");
        let (without_files, _) = bot_reply(written, &[], &[]).unwrap();
        assert_eq!(without_files, written, "a reply without files is the workflow's own text");
        // A reply that was nothing but the link is shown as its words, next to the card.
        let (only_link, metadata) = bot_reply("[q3.pdf](sandbox:/reports/q3.pdf)", &[], &[pdf_card()]).unwrap();
        assert_eq!(only_link, "q3.pdf");
        assert!(metadata.get(FILES_ONLY_KEY).is_none());
    }
}
