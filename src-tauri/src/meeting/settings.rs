//! The notetaker's settings, one JSON value under [`SETTINGS_KEY`] in the settings table.

use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use crate::error::AppResult;
use crate::storage::Database;

pub const SETTINGS_KEY: &str = "meeting_notetaker";
/// Folder under the meetings folder searched for a `ggml-*.bin` whisper model.
pub const MODELS_DIR_NAME: &str = "models";

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct MeetingSettings {
    /// Watch the microphone and offer to take notes. Off until the user turns it on.
    pub detection_enabled: bool,
    /// whisper.cpp's `whisper-cli`; `None` looks it up on PATH.
    pub whisper_cli_path: Option<String>,
    /// A ggml model file; `None` takes the first `ggml-*.bin` in the models folder.
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

/// The whisper-cli program to run: the configured path, else `whisper-cli` on PATH.
pub fn resolve_whisper_cli(settings: &MeetingSettings, search_path: Option<&str>) -> Option<PathBuf> {
    if let Some(path) = &settings.whisper_cli_path {
        return Some(PathBuf::from(path));
    }
    let search_path = search_path?;
    std::env::split_paths(search_path).map(|dir| dir.join("whisper-cli")).find(|candidate| candidate.is_file())
}

/// The model to use: the configured path, else the first `ggml-*.bin` (by name) in `models_dir`.
pub fn resolve_whisper_model(settings: &MeetingSettings, models_dir: &Path) -> Option<PathBuf> {
    if let Some(path) = &settings.whisper_model_path {
        return Some(PathBuf::from(path));
    }
    let mut models: Vec<PathBuf> = std::fs::read_dir(models_dir)
        .ok()?
        .flatten()
        .map(|entry| entry.path())
        .filter(|path| {
            let name = path.file_name().map(|name| name.to_string_lossy().into_owned()).unwrap_or_default();
            name.starts_with("ggml-") && name.ends_with(".bin") && !name.starts_with("ggml-silero")
        })
        .collect();
    models.sort();
    models.into_iter().next()
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

    #[test]
    fn finds_whisper_on_path_and_the_first_model() {
        let dir = tempfile::tempdir().expect("temp dir");
        let bin = dir.path().join("bin");
        let models = dir.path().join("models");
        std::fs::create_dir_all(&bin).expect("bin");
        std::fs::create_dir_all(&models).expect("models");
        std::fs::write(bin.join("whisper-cli"), "").expect("write");
        for name in ["ggml-small.bin", "ggml-base.bin", "ggml-silero-v5.bin", "notes.txt"] {
            std::fs::write(models.join(name), "").expect("write");
        }
        let defaults = MeetingSettings::default();
        let search_path = std::env::join_paths([dir.path().join("empty"), bin.clone()]).expect("join");
        assert_eq!(resolve_whisper_cli(&defaults, search_path.to_str()), Some(bin.join("whisper-cli")));
        assert_eq!(resolve_whisper_cli(&defaults, None), None);
        assert_eq!(resolve_whisper_model(&defaults, &models), Some(models.join("ggml-base.bin")));
        assert_eq!(resolve_whisper_model(&defaults, &dir.path().join("none")), None);

        let configured = MeetingSettings {
            whisper_cli_path: Some("/opt/w".into()),
            whisper_model_path: Some("/m.bin".into()),
            ..defaults
        };
        assert_eq!(resolve_whisper_cli(&configured, None), Some(PathBuf::from("/opt/w")));
        assert_eq!(resolve_whisper_model(&configured, &models), Some(PathBuf::from("/m.bin")));
    }
}
