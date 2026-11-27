//! Which builds take the guided path.
//!
//! The guided path covers jobs made of writing steps and public lookups. A job that
//! sends, saves or schedules something, works inside another app, handles files or
//! repeats over a list needs the full workflow format (approvals, plugins, loops), so it
//! goes to the full drafting path. The decision reads the description with fixed word
//! lists (English and Indonesian): asked the same question, a small model answers "it
//! sends something" for plain writing jobs too often to be trusted with it.

use crate::credentials::{ModelChoice, ModelProvider};
use crate::storage::models::AgentKind;

/// Words that mean the agent itself must act outside the app, or work on files or lists.
const OUTSIDE_WORDS: &[&str] = &[
    // sending and publishing
    "send", "sends", "sending", "forward", "forwards", "publish", "publishes", "upload", "uploads", "notify", "notifies",
    "kirim", "kirimkan", "mengirim", "mengirimkan", "terbitkan", "unggah", "beritahu",
    // saving and files
    "save", "saves", "store", "stores", "export", "exports", "file", "files", "pdf", "attachment", "attachments",
    "simpan", "menyimpan", "ekspor", "berkas", "lampiran",
    // schedules
    "schedule", "schedules", "scheduled", "daily", "weekly", "monthly", "hourly", "jadwal", "jadwalkan", "harian",
    "mingguan", "bulanan",
    // money and bookings
    "pay", "pays", "order", "orders", "book", "books", "buy", "bayar", "pesan", "beli",
    // other apps the agent would have to work in
    "whatsapp", "telegram", "slack", "gmail", "outlook", "sms", "spreadsheet", "spreadsheets", "sheet", "sheets", "excel",
    "calendar", "kalender", "notion", "crm", "database", "inbox",
    // repeating over a list
    "each", "setiap", "tiap",
];

/// Phrases with the same meaning, matched as whole words in order.
const OUTSIDE_PHRASES: &[&[&str]] = &[
    &["email", "me"], &["email", "it"], &["email", "them"], &["email", "to"], &["emails", "me"], &["mail", "it"],
    &["post", "to"], &["post", "on"], &["post", "it"], &["posts", "to"], &["posts", "on"],
    &["every", "day"], &["every", "morning"], &["every", "evening"], &["every", "night"], &["every", "week"],
    &["every", "month"], &["every", "hour"], &["for", "every"], &["to", "every"], &["one", "by", "one"],
    &["google", "maps"], &["google", "drive"], &["my", "email"], &["my", "emails"], &["email", "saya"],
    &["satu", "per", "satu"], &["masing", "masing"],
];

/// Whether a new agent of `kind`, described by `description`, is drafted on the guided
/// path when `model` drafts it.
///
/// Only local Ollama models: they read about 4,000 tokens, less than the full drafting
/// prompt, so the full path reaches them cut off. Teams need `agent` steps the guided
/// path does not write.
pub(in crate::agent_builder) fn takes_guided_path(model: &ModelChoice, kind: AgentKind, description: &str) -> bool {
    model.provider == ModelProvider::Ollama && kind != AgentKind::Team && !needs_the_full_format(description)
}

/// Whether the description asks for something only the full workflow format can do.
///
/// @example `needs_the_full_format("Email me a summary every morning") == true`
/// @example `needs_the_full_format("Draft an email reply to a complaint I paste") == false`
pub(super) fn needs_the_full_format(description: &str) -> bool {
    let lowered = description.to_lowercase();
    let words: Vec<&str> = lowered.split(|character: char| !character.is_alphanumeric()).filter(|word| !word.is_empty()).collect();
    words.iter().any(|word| OUTSIDE_WORDS.contains(word))
        || OUTSIDE_PHRASES.iter().any(|phrase| words.windows(phrase.len()).any(|window| window == *phrase))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn writing_and_lookup_jobs_stay_on_the_guided_path() {
        for description in [
            "Look up the Wikipedia page summary for Jakarta and write a two sentence summary of it",
            "Write a polite reply to a customer complaint that I paste in",
            "Translate the text I give into Indonesian and make it sound formal",
            "Take my meeting notes and turn them into a list of action items with owners",
            "Write three Instagram caption ideas for a product I describe",
            "Draft an email reply to a supplier quote that I paste",
            "Check the weather in my city and tell me if I should bring an umbrella",
            "Buatkan balasan sopan untuk keluhan pelanggan yang saya tempel",
            "Ringkas artikel yang saya tempel jadi tiga poin",
            "Explain a contract clause I paste in simple words",
        ] {
            assert!(!needs_the_full_format(description), "{description}");
        }
    }

    #[test]
    fn jobs_that_act_outside_the_app_take_the_full_format() {
        for description in [
            "Find cafes in Bandar Lampung on Google Maps and send each one a WhatsApp message",
            "Every morning email me a summary of yesterday's sales from my spreadsheet",
            "Post a daily motivational quote to our Slack channel",
            "Kirim pesan WhatsApp ke setiap pelanggan yang belum bayar",
            "Add each new customer from the form to my Google Sheet",
            "Create an invoice PDF for a customer and save it to my documents folder",
            "Summarize the file I attach",
            "Jadwalkan ringkasan penjualan harian",
        ] {
            assert!(needs_the_full_format(description), "{description}");
        }
    }

    #[test]
    fn only_local_ollama_models_and_kinds_without_agent_steps_are_guided() {
        let local = ModelChoice { provider: ModelProvider::Ollama, name: "llama3.2".into() };
        let cloud = ModelChoice { provider: ModelProvider::Openai, name: "gpt-4o-mini".into() };
        let job = "Write a polite reply to a complaint I paste";
        assert!(takes_guided_path(&local, AgentKind::Task, job));
        assert!(takes_guided_path(&local, AgentKind::Chatbot, job));
        assert!(takes_guided_path(&local, AgentKind::Chain, job));
        assert!(!takes_guided_path(&local, AgentKind::Team, job));
        assert!(!takes_guided_path(&cloud, AgentKind::Task, job));
        assert!(!takes_guided_path(&local, AgentKind::Task, "Send the reply by WhatsApp"));
    }
}
