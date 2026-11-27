//! An honest look at Ollama on this computer, for the Connections screen.
//!
//! Ollama needs no key, so [`crate::credentials::ProviderStatus::configured`] is always
//! true for it and says nothing about whether it can be used. This check asks the local
//! server (a short wait, see [`crate::model_catalog::ModelCatalog::ask_ollama`]) and, when
//! it does not answer, looks for the installed app.

use std::path::PathBuf;

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
    find_named_binary("ollama", locator).is_some() || AppFolders::from_environment().has_ollama_app()
}

/// The desktop system whose Ollama installer decides where the app lands.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum DesktopSystem {
    MacOs,
    Windows,
    /// Linux and the rest: Ollama is only a command there, found through `PATH`.
    Other,
}

impl DesktopSystem {
    fn current() -> Self {
        if cfg!(target_os = "macos") {
            Self::MacOs
        } else if cfg!(windows) {
            Self::Windows
        } else {
            Self::Other
        }
    }
}

/// The folders the desktop installers put Ollama in when it is not on `PATH`. The folders
/// are fields, not read from the environment where they are used, so the lookup of every
/// system can be tested on any system with folders in a temporary directory.
#[derive(Debug, Clone, PartialEq, Eq)]
struct AppFolders {
    system: DesktopSystem,
    /// macOS: the Applications folder of the whole computer (`/Applications`).
    shared_applications: PathBuf,
    /// The user's home folder, for the macOS `~/Applications`.
    home: Option<PathBuf>,
    /// Windows: `%LOCALAPPDATA%`, where per-user installers put programs.
    local_app_data: Option<PathBuf>,
}

impl AppFolders {
    fn from_environment() -> Self {
        Self {
            system: DesktopSystem::current(),
            shared_applications: PathBuf::from("/Applications"),
            home: std::env::var_os("HOME").map(PathBuf::from),
            local_app_data: std::env::var_os("LOCALAPPDATA").map(PathBuf::from),
        }
    }

    /// Every place the Ollama desktop app may be on this system; empty on [`DesktopSystem::Other`].
    fn ollama_app_paths(&self) -> Vec<PathBuf> {
        match self.system {
            DesktopSystem::MacOs => {
                let user_applications = self.home.as_deref().map(|home| home.join("Applications"));
                std::iter::once(self.shared_applications.clone())
                    .chain(user_applications)
                    .map(|applications| applications.join("Ollama.app"))
                    .collect()
            }
            DesktopSystem::Windows => self
                .local_app_data
                .as_deref()
                .map(|local_app_data| local_app_data.join("Programs").join("Ollama").join("ollama.exe"))
                .into_iter()
                .collect(),
            DesktopSystem::Other => Vec::new(),
        }
    }

    fn has_ollama_app(&self) -> bool {
        self.ollama_app_paths().iter().any(|path| path.exists())
    }
}

#[cfg(test)]
mod tests {
    use std::path::Path;

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

    /// App folders of `system` inside `root`, a temporary directory standing in for the disk.
    fn app_folders(system: DesktopSystem, root: &Path) -> AppFolders {
        AppFolders {
            system,
            shared_applications: root.join("Applications"),
            home: Some(root.join("home")),
            local_app_data: Some(root.join("AppData").join("Local")),
        }
    }

    #[test]
    fn macos_looks_in_the_shared_and_the_user_applications_folders() {
        let root = Path::new("disk");
        assert_eq!(
            app_folders(DesktopSystem::MacOs, root).ollama_app_paths(),
            [root.join("Applications").join("Ollama.app"), root.join("home").join("Applications").join("Ollama.app")]
        );
    }

    #[test]
    fn macos_finds_the_app_in_the_shared_applications_folder() {
        let disk = tempfile::tempdir().unwrap();
        let folders = app_folders(DesktopSystem::MacOs, disk.path());
        assert!(!folders.has_ollama_app());
        std::fs::create_dir_all(disk.path().join("Applications").join("Ollama.app")).unwrap();
        assert!(folders.has_ollama_app());
    }

    #[test]
    fn macos_finds_the_app_in_the_user_applications_folder() {
        let disk = tempfile::tempdir().unwrap();
        std::fs::create_dir_all(disk.path().join("home").join("Applications").join("Ollama.app")).unwrap();
        assert!(app_folders(DesktopSystem::MacOs, disk.path()).has_ollama_app());
    }

    #[test]
    fn macos_without_a_home_folder_still_looks_in_the_shared_one() {
        let disk = tempfile::tempdir().unwrap();
        let folders = AppFolders { home: None, ..app_folders(DesktopSystem::MacOs, disk.path()) };
        assert_eq!(folders.ollama_app_paths(), [disk.path().join("Applications").join("Ollama.app")]);
    }

    #[test]
    fn windows_finds_the_app_under_local_app_data() {
        let disk = tempfile::tempdir().unwrap();
        let folders = app_folders(DesktopSystem::Windows, disk.path());
        let program_folder = disk.path().join("AppData").join("Local").join("Programs").join("Ollama");
        assert_eq!(folders.ollama_app_paths(), [program_folder.join("ollama.exe")]);
        assert!(!folders.has_ollama_app());

        // The folder alone (a removed app leaves it behind) is not the app.
        std::fs::create_dir_all(&program_folder).unwrap();
        assert!(!folders.has_ollama_app());
        std::fs::write(program_folder.join("ollama.exe"), "").unwrap();
        assert!(folders.has_ollama_app());
    }

    #[test]
    fn windows_without_local_app_data_has_nowhere_to_look() {
        let disk = tempfile::tempdir().unwrap();
        let folders = AppFolders { local_app_data: None, ..app_folders(DesktopSystem::Windows, disk.path()) };
        assert!(folders.ollama_app_paths().is_empty());
        assert!(!folders.has_ollama_app());
    }

    #[test]
    fn each_system_ignores_the_folders_of_the_others() {
        let disk = tempfile::tempdir().unwrap();
        let program_folder = disk.path().join("AppData").join("Local").join("Programs").join("Ollama");
        std::fs::create_dir_all(&program_folder).unwrap();
        std::fs::write(program_folder.join("ollama.exe"), "").unwrap();
        assert!(!app_folders(DesktopSystem::MacOs, disk.path()).has_ollama_app());

        std::fs::create_dir_all(disk.path().join("Applications").join("Ollama.app")).unwrap();
        assert!(app_folders(DesktopSystem::Other, disk.path()).ollama_app_paths().is_empty());
        assert!(!app_folders(DesktopSystem::Other, disk.path()).has_ollama_app());
    }
}
