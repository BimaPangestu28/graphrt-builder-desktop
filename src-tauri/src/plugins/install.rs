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
use super::models::PluginPermissions;
use crate::error::{AppError, AppResult};

/// A staging folder that is removed when dropped (also on early returns).
pub(super) struct StagingDir {
    pub path: PathBuf,
}

impl StagingDir {
    /// Creates `<plugins_dir>/.staging-<uuid>` (and `plugins_dir` when missing).
    pub fn create(plugins_dir: &Path) -> AppResult<Self> {
        std::fs::create_dir_all(plugins_dir).map_err(|error| io_error(plugins_dir, &error))?;
        let path = plugins_dir.join(format!(".staging-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&path).map_err(|error| io_error(&path, &error))?;
        Ok(Self { path })
    }
}

/// A plugin unpacked into a staging folder, not checked or moved into place yet.
pub(super) struct StagedPlugin {
    /// Removed (with `dir`) when this is dropped without [`finish_install`].
    pub staging: StagingDir,
    /// `<staging>/<name>`.
    pub dir: PathBuf,
    pub name: String,
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

/// What the extracted plugin is checked against before it replaces anything.
pub(super) struct InstallChecks<'registry> {
    /// Node kinds the plugin is registered next to (the built-in ones).
    pub base_registry: &'registry graphrt_core::Registry,
    /// When set, a plugin asking for more than this is refused before it is moved
    /// into place (automatic updates never bring in new permissions; an install the
    /// user approved never brings in more than the card showed).
    pub permission_limit: Option<PermissionLimit>,
    /// For catalog installs and updates: the catalog entry's version, which the downloaded
    /// manifest must state exactly (the name is checked for every install, see [`finish_install`]).
    pub expected_version: Option<String>,
}

/// The most a plugin being installed may ask for, and where that limit comes from.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(super) struct PermissionLimit {
    pub permissions: PluginPermissions,
    pub origin: PermissionLimitOrigin,
}

/// Who set a [`PermissionLimit`] (only changes the refusal message).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) enum PermissionLimitOrigin {
    /// The installed version's permissions (automatic updates, "Update all").
    InstalledVersion,
    /// What the user approved on screen (install card, builder requirement card).
    UserApproval,
}

/// Extracts `tarball` (already checksum-verified) for plugin `name`, checks it
/// loads (and stays within `checks.permission_limit`), and moves it to
/// `<plugins_dir>/<name>`. Returns the installed manifest.
///
/// # Errors
/// `InvalidInput` for unsafe archives, plugins graphrt rejects or a plugin asking
/// for more than the permission limit; `Internal` for I/O errors. Nothing is left
/// behind on error and an existing install stays as it was.
pub(super) fn install_tarball(
    plugins_dir: &Path,
    name: &str,
    tarball: &[u8],
    checks: &InstallChecks<'_>,
) -> AppResult<LoadedManifest> {
    let staging = StagingDir::create(plugins_dir)?;
    let dir = extract_plugin_tarball(tarball, name, &staging.path)?;
    finish_install(StagedPlugin { staging, dir, name: name.to_owned() }, plugins_dir, checks)
}

/// Checks a staged plugin loads (and stays within `checks.permission_limit`), then moves
/// it to `<plugins_dir>/<name>`, replacing an existing install. Returns the installed manifest.
/// Shared by catalog installs and sideloading, so both pass the same checks.
///
/// # Errors
/// As [`install_tarball`]; the staging folder is removed and an existing install stays as it was.
pub(super) fn finish_install(
    staged: StagedPlugin,
    plugins_dir: &Path,
    checks: &InstallChecks<'_>,
) -> AppResult<LoadedManifest> {
    let StagedPlugin { staging, dir, name } = staged;
    check_loads(&dir, &name, checks.base_registry)?;
    check_release(&dir, &name, checks.expected_version.as_deref())?;
    if let Some(limit) = &checks.permission_limit {
        check_permission_limit(&dir, &name, limit)?;
    }
    let target = plugins_dir.join(&name);
    swap_into_place(&dir, &target, &staging.path)?;
    LoadedManifest::from_dir(&target).map_err(|error| AppError::Internal(error.to_string()))
}

/// Loads the extracted plugin the way the app will: manifest, app rules,
/// checksums, then a graphrt host registering it next to the built-in nodes.
fn check_loads(dir: &Path, name: &str, base_registry: &graphrt_core::Registry) -> AppResult<()> {
    let rejected = |message: String| AppError::InvalidInput(format!("plugin {name} cannot be installed: {message}"));
    // A manifest using something this app does not know was made for a newer app: say that, not "unknown field".
    let manifest = read_plugin(dir).map_err(|refusal| {
        super::app_requirement::manifest_refusal(refusal, |message| {
            format!("plugin {name} cannot be installed: {message}")
        })
    })?;
    match &manifest.manifest.runtime {
        graphrt_plugin::Runtime::Process(_) => {}
        // An MCP preset has no code: it must make a server the app can add (name, address, sign-in).
        graphrt_plugin::Runtime::Mcp(runtime) => {
            let server = super::host::PluginMcpServer { spec: runtime.mcp.clone(), guide: None };
            return crate::mcp::plugin_servers::definition_for(name, &server).map(|_| ()).map_err(rejected);
        }
        _ => return Err(rejected("only process plugins and MCP server presets are supported".into())),
    }
    let mut host = graphrt_plugin::PluginHost::new();
    host.add(manifest).map_err(|error| rejected(error.to_string()))?;
    let mut registry = base_registry.clone();
    let mut tools = graphrt_core::tool::ToolRegistry::new();
    host.register(&mut registry, &mut tools).map_err(|error| rejected(error.to_string()))
}

/// Refuses a manifest that does not name `name` or (when given) state `expected_version`:
/// the catalog entry and its tarball must describe the same release.
fn check_release(dir: &Path, name: &str, expected_version: Option<&str>) -> AppResult<()> {
    let manifest = read_plugin(dir).map_err(AppError::InvalidInput)?;
    let (manifest_name, manifest_version) = (&manifest.manifest.name, &manifest.manifest.version);
    if manifest_name != name {
        return Err(AppError::InvalidInput(format!(
            "the downloaded plugin calls itself {manifest_name}, not {name}; nothing was installed"
        )));
    }
    match expected_version {
        Some(expected) if expected != manifest_version => Err(AppError::InvalidInput(format!(
            "the catalog lists plugin {name} {expected} but the download is {manifest_version}; nothing was installed"
        ))),
        _ => Ok(()),
    }
}

/// Refuses a plugin whose manifest asks for more than `limit`. The catalog said it
/// would not, so this guards against a catalog that is out of step with its tarball.
fn check_permission_limit(dir: &Path, name: &str, limit: &PermissionLimit) -> AppResult<()> {
    let manifest = read_plugin(dir).map_err(AppError::InvalidInput)?;
    let requested = PluginPermissions::from(&manifest.manifest.permissions);
    let beyond = requested.requests_beyond(&limit.permissions);
    if beyond.is_empty() {
        return Ok(());
    }
    let version = &manifest.manifest.version;
    let extra = beyond.join(", ");
    Err(AppError::InvalidInput(match limit.origin {
        PermissionLimitOrigin::InstalledVersion => format!(
            "plugin {name} {version} asks for more permissions than the installed version ({extra}); update it yourself to approve them"
        ),
        PermissionLimitOrigin::UserApproval => format!(
            "plugin {name} {version} asks for more than you approved ({extra}); nothing was installed. Look at what it asks for again and approve it"
        ),
    }))
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
