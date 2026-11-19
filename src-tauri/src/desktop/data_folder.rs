//! The app data folder (Settings > Privacy and data): its path and "Show in Finder" (File Explorer on Windows, the default file manager on Linux).

use std::path::{Path, PathBuf};
use std::process::Command;

use tauri::{AppHandle, Manager};

use crate::error::{AppError, AppResult};

/// The folder holding `graphrt.db`, knowledge bases and installed plugins.
///
/// @throws AppError::Internal - when the OS gives no app data folder
pub fn data_folder(app_handle: &AppHandle) -> AppResult<PathBuf> {
    app_handle
        .path()
        .app_data_dir()
        .map_err(|error| AppError::Internal(format!("could not find the data folder: {error}")))
}

/// The platform's "open this folder" program and its arguments.
fn file_manager_command(folder: &Path) -> (&'static str, Vec<String>) {
    let folder_text = folder.display().to_string();
    if cfg!(target_os = "macos") {
        ("open", vec![folder_text])
    } else if cfg!(windows) {
        ("explorer", vec![folder_text])
    } else {
        ("xdg-open", vec![folder_text])
    }
}

/// Opens `folder` in Finder / Explorer / the default file manager. The
/// program is started and not waited for.
///
/// @throws AppError::NotFound - when the folder does not exist
/// @throws AppError::Internal - when the file manager cannot be started
pub fn open_in_file_manager(folder: &Path) -> AppResult<()> {
    if !folder.is_dir() {
        return Err(AppError::NotFound(format!("the folder {}", folder.display())));
    }
    let (program, arguments) = file_manager_command(folder);
    Command::new(program)
        .args(&arguments)
        .spawn()
        // Reap the launcher when it exits so it does not linger as a zombie.
        .map(|mut child| {
            std::thread::spawn(move || child.wait());
        })
        .map_err(|error| AppError::Internal(format!("could not open {}: {error}", folder.display())))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_missing_folder_is_reported_before_starting_anything() {
        let missing = std::env::temp_dir().join("graphrt-no-such-folder-for-tests");
        assert!(matches!(open_in_file_manager(&missing), Err(AppError::NotFound(_))));
    }

    #[test]
    fn the_file_manager_gets_the_folder_path() {
        let (program, arguments) = file_manager_command(Path::new("/data/graphrt"));
        assert!(["open", "explorer", "xdg-open"].contains(&program));
        assert_eq!(arguments, ["/data/graphrt"]);
    }
}
