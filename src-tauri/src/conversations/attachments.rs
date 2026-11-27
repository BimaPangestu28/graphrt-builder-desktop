//! Files in a chatbot conversation: what the customer attached to a message, and the
//! files the bot's reply hands back (see `crate::agent_files`).
//!
//! A message keeps its files as cards in its metadata: `attachments` on a customer
//! message and on the owner's own reply, `files` on a bot reply. A message that is only files stores their names as
//! its text (a message needs one, and the Inbox list shows it) with `filesOnly: true`, so
//! the chat shows the cards and not the names twice.

use graphrt_core::value::File;
use serde_json::{json, Map, Value as Json};

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
        let paths: Vec<&str> = attached.iter().map(|file| file.path.as_str()).collect();
        let words = if text.is_empty() { "(The customer sent files without a message.)" } else { text };
        Self {
            stored_text,
            metadata: Json::Object(metadata),
            model_text: format!("{words}\n\n[Files attached to this message: {}]", paths.join(", ")),
            knowledge_query: text.to_owned(),
            files: attached.into_iter().map(|file| file.value).collect(),
        }
    }
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
    let text = if reply_text.is_empty() {
        metadata.insert(FILES_ONLY_KEY.into(), json!(true));
        file_names(files.iter())
    } else {
        reply_text.to_owned()
    };
    Some((text, Json::Object(metadata)))
}

fn file_names<'a>(cards: impl Iterator<Item = &'a FileCard>) -> String {
    cards.map(|card| card.name.as_str()).collect::<Vec<_>>().join(", ")
}
