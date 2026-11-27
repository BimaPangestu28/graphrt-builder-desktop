//! An honest look at Ollama on this computer, for the Connections screen.
//!
//! Ollama needs no key, so [`crate::credentials::ProviderStatus::configured`] is always
//! true for it and says nothing about whether it can be used. This check asks the local
//! server (a short wait, see [`crate::model_catalog::ModelCatalog::ask_ollama`]) and, when
//! it does not answer, looks for the installed app.

use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use crate::local_cli::detect::{find_named_binary, Locator};
use crate::model_catalog::AvailableModel;

/// What was found, from best to worst.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum OllamaState {
    /// The server answered.
    Running,
    /// The app is on this computer, but its server did not answer.
    InstalledNotRunning,
    /// No server and no app.
    NotFound,
}

/// The result of one check.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OllamaCheck {
    pub state: OllamaState,
    /// The address that was asked, e.g. `http://localhost:11434`.
    pub base_url: String,
    /// Models already downloaded in Ollama that agents can think with (embedding models
    /// are left out); empty unless it is running.
    pub models: Vec<String>,
}

/// Turns the server's answer and the app lookup into a check result.
///
/// `server_models` is `None` when the server did not answer in time.
pub fn summarize(base_url: &str, server_models: Option<Vec<AvailableModel>>, is_installed: bool) -> OllamaCheck {
    let (state, models) = match server_models {
        Some(models) => {
            let chat_models = models.into_iter().map(|model| model.id).filter(|id| !is_embedding_model(id)).collect();
            (OllamaState::Running, chat_models)
        }
        None if is_installed => (OllamaState::InstalledNotRunning, Vec::new()),
        None => (OllamaState::NotFound, Vec::new()),
    };
    OllamaCheck { state, base_url: base_url.to_owned(), models }
}

/// Embedding models (e.g. `nomic-embed-text`) turn text into numbers for search; they
/// cannot answer, so they do not count as a model an agent can think with.
fn is_embedding_model(model_id: &str) -> bool {
    model_id.to_ascii_lowercase().contains("embed")
}

/// Whether the Ollama app is on this computer: the `ollama` command in the usual folders,
/// or the desktop app where its installer puts it.
pub fn is_installed(locator: &Locator) -> bool {
    find_named_binary("ollama", locator).is_some() || app_install_paths().iter().any(|path| path.exists())
}

/// Where the desktop installers put Ollama when it is not on `PATH`.
fn app_install_paths() -> Vec<PathBuf> {
    let mut paths = Vec::new();
    if cfg!(target_os = "macos") {
        paths.push(PathBuf::from("/Applications/Ollama.app"));
        if let Some(home) = std::env::var_os("HOME") {
            paths.push(Path::new(&home).join("Applications").join("Ollama.app"));
        }
    }
    if cfg!(windows) {
        if let Some(local_app_data) = std::env::var_os("LOCALAPPDATA") {
            paths.push(Path::new(&local_app_data).join("Programs").join("Ollama").join("ollama.exe"));
        }
    }
    paths
}

#[cfg(test)]
mod tests {
    use super::*;

    const BASE_URL: &str = "http://localhost:11434";

    fn model(id: &str) -> AvailableModel {
        AvailableModel { id: id.to_owned(), display_name: None }
    }

    #[test]
    fn an_answering_server_is_running_with_its_models() {
        let check = summarize(BASE_URL, Some(vec![model("llama3.2:latest"), model("qwen2.5:14b")]), false);
        assert_eq!(check.state, OllamaState::Running);
        assert_eq!(check.models, ["llama3.2:latest", "qwen2.5:14b"]);
        assert_eq!(check.base_url, BASE_URL);
    }

    #[test]
    fn embedding_models_do_not_count_as_models_to_think_with() {
        let check = summarize(BASE_URL, Some(vec![model("nomic-embed-text:latest"), model("mxbai-embed-large")]), true);
        assert_eq!(check.state, OllamaState::Running);
        assert!(check.models.is_empty());
    }

    #[test]
    fn a_running_server_without_models_is_still_running() {
        let check = summarize(BASE_URL, Some(Vec::new()), true);
        assert_eq!(check.state, OllamaState::Running);
        assert!(check.models.is_empty());
    }

    #[test]
    fn a_silent_server_with_the_app_installed_is_installed_not_running() {
        assert_eq!(summarize(BASE_URL, None, true).state, OllamaState::InstalledNotRunning);
    }

    #[test]
    fn a_silent_server_without_the_app_is_not_found() {
        assert_eq!(summarize(BASE_URL, None, false).state, OllamaState::NotFound);
    }

    #[test]
    fn states_are_sent_in_snake_case() {
        let json = serde_json::to_value(summarize(BASE_URL, None, true)).unwrap();
        assert_eq!(json["state"], "installed_not_running");
        assert_eq!(json["baseUrl"], BASE_URL);
    }

    #[cfg(unix)]
    #[test]
    fn finds_the_ollama_command_in_a_searched_folder() {
        use std::os::unix::fs::PermissionsExt;

        let folder = tempfile::tempdir().unwrap();
        let empty = Locator { extra_dirs: vec![folder.path().to_path_buf()], ..Locator::default() };
        assert!(find_named_binary("ollama", &empty).is_none());

        let binary = folder.path().join("ollama");
        std::fs::write(&binary, "#!/bin/sh\n").unwrap();
        std::fs::set_permissions(&binary, std::fs::Permissions::from_mode(0o755)).unwrap();
        assert_eq!(find_named_binary("ollama", &empty), Some(binary));
    }
}
