//! What the guided path covers, and the checks that keep it honest.
//!
//! A plan can write, look things up, ask the person, use a plugin operation and carry a
//! schedule. It cannot repeat over a list or work on files, and it can only act outside
//! the app through an operation it was offered. The plan itself is the first signal: a
//! plugin step is there or it is not. Fixed word lists (English and Indonesian) back it
//! up for the two cases where trusting the plan alone would mislead the person: a job
//! that plainly says "send" whose plan sends nothing, and a job the plan cannot express
//! at all. A small model asked "does this job send something?" answers yes for plain
//! writing jobs too often, so it is never asked.

use super::plan::{Plan, PlanStep, Repeat, Schedule};
use crate::credentials::{ModelChoice, ModelProvider};
use crate::storage::models::AgentKind;

/// Words that mean the agent itself must act outside the app.
const ACTING_WORDS: &[&str] = &[
    "send",
    "sends",
    "sending",
    "forward",
    "forwards",
    "publish",
    "publishes",
    "upload",
    "uploads",
    "notify",
    "notifies",
    "kirim",
    "kirimkan",
    "mengirim",
    "mengirimkan",
    "terbitkan",
    "unggah",
    "beritahu",
    "save",
    "saves",
    "store",
    "stores",
    "export",
    "exports",
    "simpan",
    "menyimpan",
    "ekspor",
    "pay",
    "pays",
    "buy",
    "bayar",
    "beli",
    "whatsapp",
    "telegram",
    "slack",
    "gmail",
    "outlook",
    "sms",
    "spreadsheet",
    "spreadsheets",
    "sheet",
    "sheets",
    "excel",
    "calendar",
    "kalender",
    "notion",
    "crm",
    "database",
    "inbox",
];

/// Phrases with the same meaning, matched as whole words in order.
const ACTING_PHRASES: &[&[&str]] = &[
    &["email", "me"],
    &["email", "it"],
    &["email", "them"],
    &["email", "to"],
    &["emails", "me"],
    &["mail", "it"],
    &["by", "email"],
    &["via", "email"],
    &["lewat", "email"],
    &["melalui", "email"],
    &["post", "to"],
    &["post", "on"],
    &["post", "it"],
    &["posts", "to"],
    &["posts", "on"],
    &["google", "maps"],
    &["google", "drive"],
    &["my", "email"],
    &["my", "emails"],
    &["email", "saya"],
];

/// Words for working on files, which a plan has no step for.
const FILE_WORDS: &[&str] = &["file", "files", "pdf", "attachment", "attachments", "berkas", "lampiran"];

/// Words that start "for each one of a list" unless a time word follows ("every morning").
const EACH_WORDS: &[&str] = &["each", "every", "setiap", "tiap"];

/// Phrases for repeating over a list.
const REPEATING_PHRASES: &[&[&str]] = &[&["one", "by", "one"], &["satu", "per", "satu"], &["masing", "masing"]];

const TIME_WORDS: &[&str] = &[
    "day",
    "morning",
    "afternoon",
    "evening",
    "night",
    "week",
    "month",
    "hour",
    "weekday",
    "monday",
    "tuesday",
    "wednesday",
    "thursday",
    "friday",
    "saturday",
    "sunday",
    "hari",
    "pagi",
    "siang",
    "sore",
    "malam",
    "minggu",
    "bulan",
    "jam",
    "senin",
    "selasa",
    "rabu",
    "kamis",
    "jumat",
    "sabtu",
];

/// Words that by themselves say the agent runs on a schedule.
const SCHEDULE_WORDS: &[&str] = &[
    "daily",
    "weekly",
    "hourly",
    "schedule",
    "schedules",
    "scheduled",
    "jadwal",
    "jadwalkan",
    "terjadwal",
    "harian",
    "mingguan",
];

/// Whether a new agent of `kind` is planned on the guided path when `model` drafts it.
///
/// Only local Ollama models: they read about 4,000 tokens, less than the full drafting
/// prompt, so the full path reaches them cut off. Teams need `agent` steps a plan does
/// not have.
pub(in crate::agent_builder) fn takes_guided_path(model: &ModelChoice, kind: AgentKind) -> bool {
    model.provider == ModelProvider::Ollama && kind != AgentKind::Team
}

/// Whether the description asks for something no plan can express: repeating over a
/// list, working on files, or acting outside the app when no plugin operation was offered
/// for the job. Such a job is drafted in full.
///
/// @example `is_out_of_reach("Send each customer a WhatsApp message", true) == true`
/// @example `is_out_of_reach("Email me a summary every morning", true) == false`
pub(super) fn is_out_of_reach(description: &str, has_offered_operations: bool) -> bool {
    let words = words(description);
    repeats_over_a_list(&words)
        || words.iter().any(|word| FILE_WORDS.contains(&word.as_str()))
        || (acts_outside(&words) && !has_offered_operations)
}

/// A sentence for the model when the description plainly says to act outside the app and
/// the plan has no plugin step; `None` when the plan is consistent with the description.
pub(super) fn missing_action(description: &str, plan: &Plan) -> Option<String> {
    let has_plugin_step = plan.steps.iter().any(|step| matches!(step, PlanStep::Use { .. }));
    (acts_outside(&words(description)) && !has_plugin_step).then(|| {
        "the job says to send, save or post something, but no step does it; add a \"use\" step with the operation \
         that does it, after the step that writes what is sent"
            .to_owned()
    })
}

/// The schedule the description's own words give, for a plan that carries none: "every
/// morning" is daily at 08:00. `None` when the description names no schedule.
pub(super) fn schedule_in_words(description: &str) -> Option<Schedule> {
    let words = words(description);
    let follows_each = |time_words: &[&str]| {
        words.windows(2).any(|pair| EACH_WORDS.contains(&pair[0].as_str()) && time_words.contains(&pair[1].as_str()))
    };
    let has = |candidates: &[&str]| words.iter().any(|word| candidates.contains(&word.as_str()));
    let is_scheduled = has(SCHEDULE_WORDS) || follows_each(TIME_WORDS);
    if !is_scheduled {
        return None;
    }
    let repeat = if has(&["hourly"]) || follows_each(&["hour", "jam"]) {
        Repeat::Hourly
    } else if has(&["weekly", "mingguan"]) || follows_each(&["week", "minggu"]) {
        Repeat::Weekly
    } else if follows_each(&["weekday"]) {
        Repeat::Weekdays
    } else {
        Repeat::Daily
    };
    let hour = if has(&["evening", "afternoon", "sore"]) {
        17
    } else if has(&["night", "malam"]) {
        20
    } else {
        Schedule::daily().hour
    };
    Some(Schedule { repeat, hour })
}

fn acts_outside(words: &[String]) -> bool {
    words.iter().any(|word| ACTING_WORDS.contains(&word.as_str())) || has_phrase(words, ACTING_PHRASES)
}

fn repeats_over_a_list(words: &[String]) -> bool {
    let each_of_a_list = words.iter().enumerate().any(|(index, word)| {
        // "every" alone is too common ("every detail"); it counts after "for" or "to".
        let counts = match word.as_str() {
            "every" => index > 0 && matches!(words[index - 1].as_str(), "for" | "to"),
            other => EACH_WORDS.contains(&other),
        };
        counts && words.get(index + 1).is_none_or(|next| !TIME_WORDS.contains(&next.as_str()))
    });
    each_of_a_list || has_phrase(words, REPEATING_PHRASES)
}

fn has_phrase(words: &[String], phrases: &[&[&str]]) -> bool {
    phrases.iter().any(|phrase| {
        words.windows(phrase.len()).any(|window| window.iter().map(String::as_str).eq(phrase.iter().copied()))
    })
}

fn words(text: &str) -> Vec<String> {
    text.to_lowercase()
        .split(|character: char| !character.is_alphanumeric())
        .filter(|word| !word.is_empty())
        .map(str::to_owned)
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::BTreeMap;

    fn plan_with(steps: Vec<PlanStep>) -> Plan {
        Plan { summary: String::new(), name: String::new(), inputs: Vec::new(), steps, schedule: None }
    }

    fn write_step() -> PlanStep {
        PlanStep::Write { title: "Write".into(), instruction: "Write it.".into() }
    }

    #[test]
    fn writing_lookup_sending_and_scheduled_jobs_are_within_reach() {
        for description in [
            "Look up the Wikipedia page summary for Jakarta and write a two sentence summary of it",
            "Write a polite reply to a customer complaint that I paste in",
            "Draft an email reply to a supplier quote that I paste",
            "Buatkan balasan sopan untuk keluhan pelanggan yang saya tempel",
            "Write a thank-you note and send it by email to the address I give",
            "Every morning email me a summary of the weather in Jakarta",
            "Setiap pagi kirim ringkasan cuaca Jakarta lewat email",
            "Check every detail of the contract I paste",
        ] {
            assert!(!is_out_of_reach(description, true), "{description}");
        }
    }

    #[test]
    fn lists_files_and_actions_without_an_operation_are_out_of_reach() {
        for description in [
            "Find cafes on Google Maps and send each one a WhatsApp message",
            "Kirim pesan WhatsApp ke setiap pelanggan yang belum bayar",
            "Send a reminder to every customer in my list",
            "Summarize the file I attach",
            "Create an invoice PDF for a customer",
            "Balas pelanggan satu per satu",
        ] {
            assert!(is_out_of_reach(description, true), "{description}");
        }
        assert!(is_out_of_reach("Post the result to our Slack channel", false));
        assert!(!is_out_of_reach("Post the result to our Slack channel", true));
        assert!(!is_out_of_reach("Write a product description", false));
    }

    #[test]
    fn a_plan_that_does_not_do_what_the_job_says_is_sent_back() {
        let only_writes = plan_with(vec![write_step()]);
        assert!(missing_action("Write a note and send it by email", &only_writes).unwrap().contains("\"use\" step"));
        assert_eq!(missing_action("Write a note for me to read", &only_writes), None);
        let sends = plan_with(vec![
            write_step(),
            PlanStep::Use {
                title: "Send".into(),
                instruction: "Send it".into(),
                operation: "email.send_email".into(),
                fields: BTreeMap::new(),
            },
        ]);
        assert_eq!(missing_action("Write a note and send it by email", &sends), None);
    }

    #[test]
    fn schedules_are_read_from_plain_words() {
        let daily = Schedule::daily();
        assert_eq!(schedule_in_words("Every morning tell me the weather"), Some(daily));
        assert_eq!(schedule_in_words("Setiap pagi ringkas berita"), Some(daily));
        assert_eq!(
            schedule_in_words("Send a daily report in the evening"),
            Some(Schedule { repeat: Repeat::Daily, hour: 17 })
        );
        assert_eq!(schedule_in_words("Check prices every hour"), Some(Schedule { repeat: Repeat::Hourly, hour: 8 }));
        assert_eq!(schedule_in_words("Laporan mingguan penjualan"), Some(Schedule { repeat: Repeat::Weekly, hour: 8 }));
        assert_eq!(schedule_in_words("Write a reply to every complaint I paste"), None);
        assert_eq!(schedule_in_words("Translate a text"), None);
    }

    #[test]
    fn only_local_ollama_models_and_kinds_without_agent_steps_are_guided() {
        let local = ModelChoice { provider: ModelProvider::Ollama, name: "llama3.2".into() };
        let cloud = ModelChoice { provider: ModelProvider::Openai, name: "gpt-4o-mini".into() };
        assert!(takes_guided_path(&local, AgentKind::Task));
        assert!(takes_guided_path(&local, AgentKind::Chatbot));
        assert!(takes_guided_path(&local, AgentKind::Chain));
        assert!(!takes_guided_path(&local, AgentKind::Team));
        assert!(!takes_guided_path(&cloud, AgentKind::Task));
    }
}
