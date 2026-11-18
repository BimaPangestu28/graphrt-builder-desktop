//! Installing a downloaded, checksum-verified tarball into the plugin folder.
//!
//! Steps: extract into a fresh staging folder inside the plugin folder (same
//! file system, so the final move is a rename), load the extracted plugin with
//! graphrt (manifest validation, entrypoint checksums, namespace rules), then
//! swap it into `<plugins>/<name>`. Any failure removes the staging folder and
//! leaves an existing install as it was.

use std::path::{Path, PathBuf};

use graphrt_plugin::LoadedManifest;

use super::archive::extract_plugin_tarball;
use super::host::read_plugin;
use crate::error::{AppError, AppResult};

/// A staging folder that is removed when dropped (also on early returns).
struct StagingDir {
    path: PathBuf,
}

impl StagingDir {
    fn create(plugins_dir: &Path) -> AppResult<Self> {
        let path = plugins_dir.join(format!(".staging-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&path).map_err(|error| io_error(&path, &error))?;
        Ok(Self { path })
    }
}

impl Drop for StagingDir {
    fn drop(&mut self) {
        if self.path.exists() {
            if let Err(error) = std::fs::remove_dir_all(&self.path) {
                log::warn!("could not remove the plugin staging folder {}: {error}", self.path.display());
            }
        }
    }
}

/// Extracts `tarball` (already checksum-verified) for plugin `name`, checks it
/// loads, and moves it to `<plugins_dir>/<name>`. Returns the installed manifest.
///
/// # Errors
/// `InvalidInput` for unsafe archives or plugins graphrt rejects; `Internal`
/// for I/O errors. Nothing is left behind on error.
pub(super) fn install_tarball(
    plugins_dir: &Path,
    name: &str,
    tarball: &[u8],
    base_registry: &graphrt_core::Registry,
) -> AppResult<LoadedManifest> {
    std::fs::create_dir_all(plugins_dir).map_err(|error| io_error(plugins_dir, &error))?;
    let staging = StagingDir::create(plugins_dir)?;
    let extracted = extract_plugin_tarball(tarball, name, &staging.path)?;
    check_loads(&extracted, name, base_registry)?;
    let target = plugins_dir.join(name);
    swap_into_place(&extracted, &target, &staging.path)?;
    LoadedManifest::from_dir(&target).map_err(|error| AppError::Internal(error.to_string()))
}

/// Loads the extracted plugin the way the app will: manifest, app rules,
/// checksums, then a graphrt host registering it next to the built-in nodes.
fn check_loads(dir: &Path, name: &str, base_registry: &graphrt_core::Registry) -> AppResult<()> {
    let rejected = |message: String| AppError::InvalidInput(format!("plugin {name} cannot be installed: {message}"));
    let manifest = read_plugin(dir).map_err(rejected)?;
    if !matches!(manifest.manifest.runtime, graphrt_plugin::Runtime::Process(_)) {
        return Err(rejected("only process plugins are supported".into()));
    }
    let mut host = graphrt_plugin::PluginHost::new();
    host.add(manifest).map_err(|error| rejected(error.to_string()))?;
    let mut registry = base_registry.clone();
    let mut tools = graphrt_core::tool::ToolRegistry::new();
    host.register(&mut registry, &mut tools).map_err(|error| rejected(error.to_string()))
}

/// Moves `extracted` to `target`, keeping the previous install until the new
/// one is in place (restored if the move fails).
fn swap_into_place(extracted: &Path, target: &Path, staging: &Path) -> AppResult<()> {
    let previous = staging.join("previous");
    let had_previous = target.exists();
    if had_previous {
        std::fs::rename(target, &previous).map_err(|error| io_error(target, &error))?;
    }
    if let Err(error) = std::fs::rename(extracted, target) {
        if had_previous {
            if let Err(restore_error) = std::fs::rename(&previous, target) {
                log::error!("could not restore the previous plugin at {}: {restore_error}", target.display());
            }
        }
        return Err(io_error(target, &error));
    }
    Ok(())
}

/// Removes an installed plugin folder (moved aside first, so a half-removed
/// folder is never loaded).
pub(super) fn remove_plugin_dir(plugins_dir: &Path, name: &str) -> AppResult<()> {
    let target = plugins_dir.join(name);
    if !target.exists() {
        return Err(AppError::NotFound(format!("plugin {name}")));
    }
    let doomed = plugins_dir.join(format!(".removing-{}", uuid::Uuid::new_v4()));
    std::fs::rename(&target, &doomed).map_err(|error| io_error(&target, &error))?;
    std::fs::remove_dir_all(&doomed).map_err(|error| io_error(&doomed, &error))
}

/// Removes staging / removal leftovers from an interrupted install.
pub(super) fn clean_leftovers(plugins_dir: &Path) {
    let Ok(entries) = std::fs::read_dir(plugins_dir) else { return };
    for entry in entries.filter_map(Result::ok) {
        let file_name = entry.file_name().to_string_lossy().into_owned();
        if file_name.starts_with(".staging-") || file_name.starts_with(".removing-") {
            if let Err(error) = std::fs::remove_dir_all(entry.path()) {
                log::warn!("could not remove {file_name}: {error}");
            }
        }
    }
}

fn io_error(path: &Path, error: &std::io::Error) -> AppError {
    AppError::Internal(format!("could not update {}: {error}", path.display()))
}
