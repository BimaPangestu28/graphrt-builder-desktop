//! The UI language (English or Indonesian) and the few strings the Rust side
//! shows by itself: the tray menu and the system notifications. Everything
//! else is translated in the frontend (`src/i18n`).
//!
//! The language is stored in the settings (`app.language`). The frontend writes
//! the system language there on first launch, so until then English is used.

use serde::{Deserialize, Serialize};

/// Language of the tray menu and notifications.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum UiLanguage {
    #[default]
    En,
    Id,
}

impl UiLanguage {
    /// The stored value (`en` / `id`).
    pub fn as_str(self) -> &'static str {
        match self {
            Self::En => "en",
            Self::Id => "id",
        }
    }

    /// Reads a stored value; anything else is `None`.
    pub fn parse(text: &str) -> Option<Self> {
        match text {
            "en" => Some(Self::En),
            "id" => Some(Self::Id),
            _ => None,
        }
    }
}

/// Strings of the tray menu and notifications in one language.
#[derive(Debug, Clone, Copy)]
pub struct UiStrings {
    language: UiLanguage,
}

impl UiStrings {
    pub fn new(language: UiLanguage) -> Self {
        Self { language }
    }

    fn pick(self, english: &'static str, indonesian: &'static str) -> &'static str {
        match self.language {
            UiLanguage::En => english,
            UiLanguage::Id => indonesian,
        }
    }

    // Tray menu

    pub fn runner_online(self) -> String {
        self.pick("Runner online", "Runner aktif").to_owned()
    }

    pub fn paused_until(self, clock: &str) -> String {
        match self.language {
            UiLanguage::En => format!("Paused until {clock}"),
            UiLanguage::Id => format!("Dijeda sampai {clock}"),
        }
    }

    pub fn agents_scheduled(self, count: usize) -> String {
        match self.language {
            UiLanguage::En => format!("{count} {}", if count == 1 { "agent scheduled" } else { "agents scheduled" }),
            UiLanguage::Id => format!("{count} agent terjadwal"),
        }
    }

    pub fn runs_waiting(self, count: usize) -> String {
        match self.language {
            UiLanguage::En => format!("{count} {}", if count == 1 { "run waiting for you" } else { "runs waiting for you" }),
            UiLanguage::Id => format!("{count} run menunggu kamu"),
        }
    }

    pub fn open_app(self) -> &'static str {
        self.pick("Open graphrt", "Buka Graphrt")
    }

    pub fn resume_agents(self) -> &'static str {
        self.pick("Resume agents", "Lanjutkan agent")
    }

    pub fn pause_agents(self) -> &'static str {
        self.pick("Pause all agents for 1 hour", "Jeda semua agent selama 1 jam")
    }

    pub fn quit_app(self) -> &'static str {
        self.pick("Quit graphrt", "Keluar dari Graphrt")
    }

    // Run notifications

    pub fn unknown_agent(self) -> &'static str {
        self.pick("An agent", "Sebuah agent")
    }

    pub fn needs_approval_title(self, agent_name: &str) -> String {
        match self.language {
            UiLanguage::En => format!("{agent_name} needs your approval"),
            UiLanguage::Id => format!("{agent_name} butuh persetujuan kamu"),
        }
    }

    pub fn items_waiting_body(self, waiting_count: usize) -> String {
        match self.language {
            UiLanguage::En => format!("{waiting_count} items are waiting for you. Click to review them"),
            UiLanguage::Id => format!("{waiting_count} item menunggu kamu. Klik untuk memeriksanya"),
        }
    }

    pub fn review_before_sending_body(self) -> &'static str {
        self.pick("Click to review it before anything is sent", "Klik untuk memeriksa sebelum ada yang dikirim")
    }

    pub fn failed_title(self, agent_name: &str) -> String {
        match self.language {
            UiLanguage::En => format!("{agent_name} failed"),
            UiLanguage::Id => format!("{agent_name} gagal"),
        }
    }

    pub fn see_what_went_wrong_body(self) -> &'static str {
        self.pick("Click to see what went wrong", "Klik untuk melihat apa yang salah")
    }

    // Chat hand-over notifications

    pub fn unknown_chatbot(self) -> &'static str {
        self.pick("A chatbot", "Sebuah chatbot")
    }

    pub fn chat_needs_you_title(self, agent_name: &str) -> String {
        match self.language {
            UiLanguage::En => format!("{agent_name} needs you in a chat"),
            UiLanguage::Id => format!("{agent_name} butuh kamu di sebuah chat"),
        }
    }

    pub fn customer_waiting_body(self, customer_name: &str) -> String {
        match self.language {
            UiLanguage::En => format!("{customer_name} is waiting for your reply"),
            UiLanguage::Id => format!("{customer_name} menunggu balasan kamu"),
        }
    }

    // Daily summary

    pub fn daily_summary_title(self) -> &'static str {
        self.pick("Your agents today", "Agent kamu hari ini")
    }

    /// "2 runs in the last 24 hours: 1 succeeded, 1 failed" / "2 run dalam 24 jam terakhir, 1 berhasil dan 1 gagal".
    pub fn daily_summary_body(self, run_count: usize, parts: &[(usize, DailyStatus)]) -> String {
        let labelled: Vec<String> =
            parts.iter().map(|(count, status)| format!("{count} {}", self.daily_status_label(*status))).collect();
        match self.language {
            UiLanguage::En => {
                let runs_text = if run_count == 1 { "1 run".to_owned() } else { format!("{run_count} runs") };
                format!("{runs_text} in the last 24 hours: {}", labelled.join(", "))
            }
            UiLanguage::Id => format!("{run_count} run dalam 24 jam terakhir, {}", join_indonesian(&labelled)),
        }
    }

    fn daily_status_label(self, status: DailyStatus) -> &'static str {
        match status {
            DailyStatus::Succeeded => self.pick("succeeded", "berhasil"),
            DailyStatus::Failed => self.pick("failed", "gagal"),
            DailyStatus::Waiting => self.pick("waiting for you", "menunggu kamu"),
            DailyStatus::Running => self.pick("still running", "masih berjalan"),
            DailyStatus::Stopped => self.pick("stopped", "dihentikan"),
        }
    }
}

/// Run outcomes counted by the daily summary.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DailyStatus {
    Succeeded,
    Failed,
    Waiting,
    Running,
    Stopped,
}

/// "a", "a dan b", "a, b dan c".
fn join_indonesian(items: &[String]) -> String {
    match items {
        [] => String::new(),
        [only] => only.clone(),
        [rest @ .., last] => format!("{} dan {last}", rest.join(", ")),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_and_prints_the_stored_value() {
        assert_eq!(UiLanguage::parse("id"), Some(UiLanguage::Id));
        assert_eq!(UiLanguage::parse("en"), Some(UiLanguage::En));
        assert_eq!(UiLanguage::parse("fr"), None);
        assert_eq!(UiLanguage::Id.as_str(), "id");
        assert_eq!(serde_json::to_value(UiLanguage::Id).unwrap(), "id");
    }

    #[test]
    fn tray_lines_in_both_languages() {
        let english = UiStrings::new(UiLanguage::En);
        let indonesian = UiStrings::new(UiLanguage::Id);
        assert_eq!(english.agents_scheduled(1), "1 agent scheduled");
        assert_eq!(english.runs_waiting(2), "2 runs waiting for you");
        assert_eq!(indonesian.agents_scheduled(3), "3 agent terjadwal");
        assert_eq!(indonesian.paused_until("14:05"), "Dijeda sampai 14:05");
        assert_eq!(indonesian.open_app(), "Buka Graphrt");
    }

    #[test]
    fn daily_summary_in_both_languages() {
        let parts = [(1, DailyStatus::Succeeded), (1, DailyStatus::Failed)];
        assert_eq!(
            UiStrings::new(UiLanguage::En).daily_summary_body(2, &parts),
            "2 runs in the last 24 hours: 1 succeeded, 1 failed"
        );
        assert_eq!(
            UiStrings::new(UiLanguage::Id).daily_summary_body(2, &parts),
            "2 run dalam 24 jam terakhir, 1 berhasil dan 1 gagal"
        );
        let three = [(1, DailyStatus::Succeeded), (2, DailyStatus::Failed), (1, DailyStatus::Waiting)];
        assert_eq!(
            UiStrings::new(UiLanguage::Id).daily_summary_body(4, &three),
            "4 run dalam 24 jam terakhir, 1 berhasil, 2 gagal dan 1 menunggu kamu"
        );
    }
}
