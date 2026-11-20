//! Sideloading: installing a plugin from a folder or a `.tar.gz` on this computer
//! (Settings › Developer mode, "Install from folder or archive…" on the Plugins page).
//!
//! A sideloaded plugin goes through the same checks as a catalog install, only its bytes
//! come from disk instead of the catalog:
//!
//! - An archive is unpacked by `archive::extract_plugin_tarball` (size and entry caps; no
//!   links, devices, absolute paths or `..`). Its top folder names the plugin.
//! - A folder is copied by this module with the same caps. Links (symlinks, Windows
//!   junctions) and special files anywhere inside are refused, never followed, so nothing
//!   outside the chosen folder is read. `.git` folders are skipped. Each file is checked to
//!   be the one listed (same device and inode on Unix) before it is copied, and copied with
//!   `create_new` into a fresh staging folder.
//! - The staged copy is then loaded exactly like a catalog plugin (`install::finish_install`:
//!   manifest rules, the manifest's `checksums` verified by graphrt, node kind registration)
//!   and swapped into `<plugins>/<name>`. A folder inside the plugins folder (or one that
//!   contains it) is refused.
//! - The install record says `source: local` with the chosen path (display only). Local
//!   plugins start untrusted (also on reinstall), are never auto-updated and are never
//!   matched against catalog updates. Replacing a plugin installed from the catalog needs
//!   the user's confirmation (`replace`), and then also drops its stored settings, which
//!   were given to the reviewed code.
//! - The backend refuses to sideload while Developer mode is off.

use std::io::Read;
use std::path::{Path, PathBuf};

use graphrt_plugin::LoadedManifest;

use super::archive::{self, MAX_ENTRIES, MAX_EXTRACTED_BYTES};
use super::install::{self, StagedPlugin, StagingDir};
use super::models::{InstallRecord, InstalledPlugin, PluginEvent, PluginSource};
use super::{settings, PluginService, MAX_TARBALL_BYTES};
use crate::desktop::app_settings::AppSettings;
use crate::error::{AppError, AppResult};

/// Deepest folder nesting copied from a sideloaded folder.
const MAX_FOLDER_DEPTH: usize = 64;
/// Folder names skipped when copying (version control data, never part of a plugin).
const SKIPPED_FOLDER_NAMES: &[&str] = &[".git"];

/// What the user picked.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(super) enum LocalPluginSource {
    /// A plugin folder (holding `graphrt-plugin.json`), resolved to its real path.
    Folder(PathBuf),
    /// A `.tar.gz` / `.tgz` plugin archive, resolved to its real path.
    Archive(PathBuf),
}

/// Resolves the path the user picked to a folder or an archive. The picked path itself
/// may be a link (the user chose it); nothing inside it is ever followed.
///
/// # Errors
/// `InvalidInput` for a relative path, something that is neither a folder nor a `.tar.gz`,
/// or a folder inside (or containing) `plugins_dir`; `NotFound` when it does not exist.
pub(super) fn resolve_local_source(raw_path: &str, plugins_dir: &Path) -> AppResult<LocalPluginSource> {
    let trimmed = raw_path.trim();
    let path = Path::new(trimmed);
    if trimmed.is_empty() || !path.is_absolute() {
        return Err(AppError::InvalidInput("choose a plugin folder or a .tar.gz archive by its full path".into()));
    }
    let resolved = std::fs::canonicalize(path).map_err(|error| AppError::NotFound(format!("{trimmed} ({error})")))?;
    let metadata = std::fs::metadata(&resolved).map_err(|error| io_error(&resolved, &error))?;
    if metadata.is_dir() {
        refuse_plugins_dir_overlap(&resolved, plugins_dir)?;
        return Ok(LocalPluginSource::Folder(resolved));
    }
    if metadata.is_file() && is_archive_name(&resolved) {
        return Ok(LocalPluginSource::Archive(resolved));
    }
    Err(AppError::InvalidInput(format!("{trimmed} is not a plugin folder or a .tar.gz archive")))
}

fn is_archive_name(path: &Path) -> bool {
    let file_name = path.file_name().map(|name| name.to_string_lossy().to_ascii_lowercase()).unwrap_or_default();
    file_name.ends_with(".tar.gz") || file_name.ends_with(".tgz")
}

/// Refuses a folder inside the app's plugins folder, or one that contains it.
fn refuse_plugins_dir_overlap(folder: &Path, plugins_dir: &Path) -> AppResult<()> {
    std::fs::create_dir_all(plugins_dir).map_err(|error| io_error(plugins_dir, &error))?;
    let plugins_dir = std::fs::canonicalize(plugins_dir).map_err(|error| io_error(plugins_dir, &error))?;
    if folder.starts_with(&plugins_dir) || plugins_dir.starts_with(folder) {
        return Err(AppError::InvalidInput("choose a plugin folder outside graphrt's own plugins folder".into()));
    }
    Ok(())
}

/// Copies or unpacks `source` into a new staging folder under `plugins_dir`.
///
/// # Errors
/// `InvalidInput` for links, special files, unsafe archives, too much data or a folder
/// that is not a graphrt plugin; `Internal` for I/O errors. Nothing is left behind.
pub(super) fn stage_local_plugin(plugins_dir: &Path, source: &LocalPluginSource) -> AppResult<StagedPlugin> {
    let staging = StagingDir::create(plugins_dir)?;
    match source {
        LocalPluginSource::Folder(folder) => {
            let copy = staging.path.join(".copy");
            copy_folder(folder, &copy)?;
            let name = manifest_name(&copy)?;
            let dir = staging.path.join(&name);
            std::fs::rename(&copy, &dir).map_err(|error| io_error(&dir, &error))?;
            Ok(StagedPlugin { staging, dir, name })
        }
        LocalPluginSource::Archive(archive_path) => {
            let bytes = read_archive(archive_path)?;
            log::info!("sideloading {} (sha256 {})", archive_path.display(), archive::sha256_hex(&bytes));
            let name = archive::tarball_top_dir(&bytes)?;
            let dir = archive::extract_plugin_tarball(&bytes, &name, &staging.path)?;
            Ok(StagedPlugin { staging, dir, name })
        }
    }
}

/// The plugin name from a staged folder's manifest.
fn manifest_name(dir: &Path) -> AppResult<String> {
    let manifest = LoadedManifest::from_dir(dir)
        .map_err(|error| AppError::InvalidInput(format!("the folder is not a graphrt plugin: {error}")))?;
    let name = manifest.manifest.name;
    if !graphrt_plugin::is_valid_name(&name) {
        return Err(AppError::InvalidInput(format!("`{name}` is not a valid plugin name")));
    }
    Ok(name)
}

/// Reads an archive of at most [`MAX_TARBALL_BYTES`].
fn read_archive(path: &Path) -> AppResult<Vec<u8>> {
    let file = std::fs::File::open(path).map_err(|error| io_error(path, &error))?;
    let size = file.metadata().map_err(|error| io_error(path, &error))?.len();
    if size > MAX_TARBALL_BYTES {
        return Err(AppError::InvalidInput("the plugin archive is larger than the install limit".into()));
    }
    let mut bytes = Vec::new();
    file.take(MAX_TARBALL_BYTES + 1).read_to_end(&mut bytes).map_err(|error| io_error(path, &error))?;
    if bytes.len() as u64 > MAX_TARBALL_BYTES {
        return Err(AppError::InvalidInput("the plugin archive is larger than the install limit".into()));
    }
    Ok(bytes)
}

/// Entries and bytes copied so far, against the archive caps.
#[derive(Debug, Default)]
struct CopyBudget {
    entries: usize,
    bytes: u64,
}

/// Copies the plain files and folders of `source_root` into the new folder `destination_root`.
fn copy_folder(source_root: &Path, destination_root: &Path) -> AppResult<()> {
    std::fs::create_dir(destination_root).map_err(|error| io_error(destination_root, &error))?;
    copy_folder_contents(source_root, destination_root, Path::new(""), &mut CopyBudget::default())
}

fn copy_folder_contents(
    source_dir: &Path,
    destination_dir: &Path,
    relative: &Path,
    budget: &mut CopyBudget,
) -> AppResult<()> {
    if relative.components().count() > MAX_FOLDER_DEPTH {
        return Err(AppError::InvalidInput("the plugin folder is nested too deeply".into()));
    }
    let mut entries = std::fs::read_dir(source_dir)
        .and_then(|entries| entries.collect::<Result<Vec<_>, _>>())
        .map_err(|error| io_error(source_dir, &error))?;
    entries.sort_by_key(std::fs::DirEntry::file_name);
    for entry in entries {
        budget.entries += 1;
        if budget.entries > MAX_ENTRIES {
            return Err(AppError::InvalidInput("the plugin folder has too many files".into()));
        }
        let file_name = entry.file_name();
        let relative_path = relative.join(&file_name);
        // `DirEntry::file_type` does not follow links.
        let file_type = entry.file_type().map_err(|error| io_error(&entry.path(), &error))?;
        let target = destination_dir.join(&file_name);
        if file_type.is_symlink() {
            return Err(refused(&relative_path, "a link"));
        } else if file_type.is_dir() {
            if SKIPPED_FOLDER_NAMES.iter().any(|skipped| file_name == *skipped) {
                continue;
            }
            std::fs::create_dir(&target).map_err(|error| io_error(&target, &error))?;
            copy_folder_contents(&entry.path(), &target, &relative_path, budget)?;
        } else if file_type.is_file() {
            copy_file(&entry.path(), &target, &relative_path, budget)?;
        } else {
            return Err(refused(&relative_path, "a special file"));
        }
    }
    Ok(())
}

/// Copies one file after checking the opened file is the plain file that was listed.
fn copy_file(source: &Path, target: &Path, relative: &Path, budget: &mut CopyBudget) -> AppResult<()> {
    let listed = std::fs::symlink_metadata(source).map_err(|error| io_error(source, &error))?;
    let mut file = std::fs::File::open(source).map_err(|error| io_error(source, &error))?;
    let opened = file.metadata().map_err(|error| io_error(source, &error))?;
    if !listed.is_file() || !opened.is_file() || !is_same_file(&listed, &opened) {
        return Err(refused(relative, "a file that changed while it was copied"));
    }
    budget.bytes = budget.bytes.saturating_add(opened.len());
    if budget.bytes > MAX_EXTRACTED_BYTES {
        return Err(AppError::InvalidInput("the plugin folder is too large".into()));
    }
    archive::write_file(&mut file.by_ref().take(opened.len()), target, file_mode(&opened))
}

#[cfg(unix)]
fn is_same_file(listed: &std::fs::Metadata, opened: &std::fs::Metadata) -> bool {
    use std::os::unix::fs::MetadataExt;
    listed.dev() == opened.dev() && listed.ino() == opened.ino()
}

#[cfg(not(unix))]
fn is_same_file(_listed: &std::fs::Metadata, _opened: &std::fs::Metadata) -> bool {
    true
}

#[cfg(unix)]
fn file_mode(metadata: &std::fs::Metadata) -> u32 {
    use std::os::unix::fs::PermissionsExt;
    metadata.permissions().mode()
}

#[cfg(not(unix))]
fn file_mode(_metadata: &std::fs::Metadata) -> u32 {
    0o644
}

fn refused(relative: &Path, what: &str) -> AppError {
    AppError::InvalidInput(format!("the plugin folder contains {what} ({}); nothing was installed", relative.display()))
}

fn io_error(path: &Path, error: &std::io::Error) -> AppError {
    AppError::Internal(format!("could not read {}: {error}", path.display()))
}

impl PluginService {
    /// Installs a plugin from a folder or `.tar.gz` on this computer (see the module docs).
    ///
    /// @param path - Absolute path the user picked (string)
    /// @param replace - The user confirmed replacing a plugin of the same name installed from the catalog
    ///
    /// # Errors
    /// `InvalidInput` while Developer mode is off, for unsafe or invalid plugins;
    /// `Conflict` when a catalog plugin of the same name is installed and `replace` is false;
    /// `NotFound` when the path does not exist. Nothing changes on error.
    pub async fn install_local(&self, path: &str, replace: bool) -> AppResult<InstalledPlugin> {
        if !AppSettings::load(&self.db)?.developer_mode {
            return Err(AppError::InvalidInput(
                "turn on Settings › About › Developer mode to install plugins from this computer".into(),
            ));
        }
        let _change = self.changes.lock().await;
        let plugins_dir = self.plugins_dir.clone();
        let raw_path = path.trim().to_owned();
        let staged = tokio::task::spawn_blocking(move || {
            let source = resolve_local_source(&raw_path, &plugins_dir)?;
            stage_local_plugin(&plugins_dir, &source)
        })
        .await
        .map_err(|error| AppError::Internal(format!("the install task stopped: {error}")))??;
        let name = staged.name.clone();
        let replaces_catalog_plugin = self.check_local_name_is_free(&name, replace)?;
        let replaced_settings =
            self.snapshot().plugin(&name).map(|plugin| plugin.permissions.env.clone()).unwrap_or_default();
        let plugins_dir = self.plugins_dir.clone();
        let manifest = tokio::task::spawn_blocking(move || {
            let base_registry = crate::flow::builtin_node_registry();
            let checks = install::InstallChecks { base_registry: &base_registry, permission_limit: None };
            install::finish_install(staged, &plugins_dir, &checks)
        })
        .await
        .map_err(|error| AppError::Internal(format!("the install task stopped: {error}")))??;
        if replaces_catalog_plugin {
            self.forget_replaced_settings(&name, &replaced_settings);
        }
        settings::set_trusted(&self.db, &name, false)?;
        let record = InstallRecord {
            version: manifest.manifest.version.clone(),
            source: PluginSource::Local,
            local_path: Some(path.trim().to_owned()),
            ..InstallRecord::default()
        };
        settings::save_install_record(&self.db, &name, Some(record))?;
        log::info!("installed plugin {name} {} from {}", manifest.manifest.version, path.trim());
        self.reload();
        self.events.send(PluginEvent::PluginsChanged);
        self.installed(&name)
    }

    /// `Ok(false)` when `name` is free or sideloaded already (reinstalled freely),
    /// `Ok(true)` when it replaces a catalog install the user confirmed.
    ///
    /// # Errors
    /// `Conflict` when a catalog install would be replaced without `replace`;
    /// `Database` when the install records cannot be read.
    fn check_local_name_is_free(&self, name: &str, replace: bool) -> AppResult<bool> {
        let is_installed = self.snapshot().plugin(name).is_some() || self.plugins_dir.join(name).exists();
        if !is_installed {
            return Ok(false);
        }
        let records = settings::install_records(&self.db)?;
        if records.get(name).is_some_and(InstallRecord::is_local) {
            return Ok(false);
        }
        if !replace {
            return Err(AppError::Conflict(format!(
                "plugin {name} is already installed from the catalog; confirm to replace it with the copy from this computer"
            )));
        }
        Ok(true)
    }

    /// Drops the stored settings of the catalog plugin a sideloaded one replaced.
    fn forget_replaced_settings(&self, name: &str, variables: &[String]) {
        for variable in variables {
            if let Err(error) = self.credentials.delete_plugin_config(name, variable) {
                log::warn!("could not delete the {variable} setting of plugin {name}: {error}");
            }
        }
    }
}
