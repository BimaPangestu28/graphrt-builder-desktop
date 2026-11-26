//! The notetaker's settings, one JSON value under [`SETTINGS_KEY`] in the settings table.

use serde::{Deserialize, Serialize};

use crate::error::AppResult;
use crate::storage::Database;

pub const SETTINGS_KEY: &str = "meeting_notetaker";

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct MeetingSettings {
    /// Watch the microphone and offer to take notes. Off until the user turns it on.
    pub detection_enabled: bool,
    /// Keep the recorded audio after the transcript is made (deleted by default).
    pub keep_audio: bool,
    /// whisper.cpp's `whisper-cli`; `None` looks on PATH, then downloads it on first use.
    /// Not shown in the app: for developers and distributions packaging whisper.cpp.
    pub whisper_cli_path: Option<String>,
    /// A ggml model file; `None` downloads `ggml-base.bin` on first use.
    pub whisper_model_path: Option<String>,
}

impl MeetingSettings {
    /// The saved settings; defaults when none are saved or they cannot be read (logged).
    pub fn load(db: &Database) -> Self {
        match db.get_setting(SETTINGS_KEY) {
            Ok(Some(json)) => serde_json::from_str(&json).unwrap_or_else(|error| {
                log::warn!("ignoring unreadable meeting settings: {error}");
                Self::default()
            }),
            Ok(None) => Self::default(),
            Err(error) => {
                log::warn!("could not read meeting settings: {error}");
                Self::default()
            }
        }
    }

    pub fn save(&self, db: &Database) -> AppResult<()> {
        db.set_setting(SETTINGS_KEY, &serde_json::to_string(self)?)
    }

    /// Blank paths count as not set.
    pub fn normalized(mut self) -> Self {
        let clean =
            |value: Option<String>| value.map(|value| value.trim().to_owned()).filter(|value| !value.is_empty());
        self.whisper_cli_path = clean(self.whisper_cli_path);
        self.whisper_model_path = clean(self.whisper_model_path);
        self
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn saves_and_loads_with_defaults_for_missing_fields() {
        let db = Database::open_in_memory().expect("db");
        assert_eq!(MeetingSettings::load(&db), MeetingSettings::default());
        let settings = MeetingSettings { detection_enabled: true, ..MeetingSettings::default() };
        settings.save(&db).expect("save");
        assert_eq!(MeetingSettings::load(&db), settings);

        db.set_setting(SETTINGS_KEY, r#"{"detectionEnabled": true}"#).expect("set");
        assert!(MeetingSettings::load(&db).detection_enabled);
        db.set_setting(SETTINGS_KEY, "not json").expect("set");
        assert_eq!(MeetingSettings::load(&db), MeetingSettings::default());
    }

    #[test]
    fn blank_paths_are_not_set() {
        let settings = MeetingSettings {
            whisper_cli_path: Some("  ".into()),
            whisper_model_path: Some(" /m.bin ".into()),
            ..Default::default()
        }
        .normalized();
        assert_eq!(settings.whisper_cli_path, None);
        assert_eq!(settings.whisper_model_path.as_deref(), Some("/m.bin"));
    }
}
