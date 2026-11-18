//! Checksum verification and safe extraction of plugin tarballs (`.tar.gz`).
//!
//! Extraction never trusts the archive: every entry must be a plain file or a
//! directory under `<plugin name>/`, with a relative path free of `..`; links,
//! devices and anything else are rejected. Files are written by this code (not
//! `tar`'s `unpack`), only below the staging directory, and only with the
//! owner's read/write and executable bits.

use std::io::Read;
use std::path::{Component, Path, PathBuf};

use sha2::{Digest, Sha256};

use crate::error::{AppError, AppResult};

/// Most bytes all extracted files may take together.
const MAX_EXTRACTED_BYTES: u64 = 1024 * 1024 * 1024;
/// Most entries an archive may hold.
const MAX_ENTRIES: usize = 100_000;

/// Lowercase hex SHA-256 of `bytes`.
pub fn sha256_hex(bytes: &[u8]) -> String {
    Sha256::digest(bytes).iter().map(|byte| format!("{byte:02x}")).collect()
}

/// `InvalidInput` unless `bytes` hash to `expected` (hex, any case).
pub fn verify_sha256(bytes: &[u8], expected: &str) -> AppResult<()> {
    if sha256_hex(bytes).eq_ignore_ascii_case(expected.trim()) {
        Ok(())
    } else {
        Err(AppError::InvalidInput(
            "the downloaded plugin does not match the catalog checksum; nothing was installed".into(),
        ))
    }
}

/// Extracts a gzip-compressed tarball whose single top-level directory is
/// `top_dir` into `destination` (which must exist and be empty). Returns the
/// path of the extracted `destination/<top_dir>`.
///
/// # Errors
/// `InvalidInput` for unsafe or unexpected entries (absolute paths, `..`,
/// links, entries outside `top_dir/`, too large), `Internal` for I/O errors.
/// On error the caller removes `destination`.
pub fn extract_plugin_tarball(bytes: &[u8], top_dir: &str, destination: &Path) -> AppResult<PathBuf> {
    let mut archive = tar::Archive::new(flate2::read::GzDecoder::new(bytes));
    let entries = archive.entries().map_err(|error| bad_archive(&error))?;
    let mut extracted_bytes: u64 = 0;
    for (index, entry) in entries.enumerate() {
        if index >= MAX_ENTRIES {
            return Err(AppError::InvalidInput("the plugin archive has too many files".into()));
        }
        let mut entry = entry.map_err(|error| bad_archive(&error))?;
        let entry_type = entry.header().entry_type();
        if entry_type.is_pax_global_extensions() || entry_type.is_pax_local_extensions() {
            continue;
        }
        let raw_path = entry.path().map_err(|error| bad_archive(&error))?.into_owned();
        let relative = safe_relative_path(&raw_path, top_dir)?;
        let target = destination.join(&relative);
        if entry_type.is_dir() {
            create_dir(&target)?;
        } else if entry_type.is_file() {
            extracted_bytes = extracted_bytes.saturating_add(entry.size());
            if extracted_bytes > MAX_EXTRACTED_BYTES {
                return Err(AppError::InvalidInput("the plugin archive is too large once extracted".into()));
            }
            let mode = entry.header().mode().unwrap_or(0o644);
            write_file(&mut entry, &target, mode)?;
        } else {
            return Err(AppError::InvalidInput(format!(
                "the plugin archive contains a link or special file ({}); nothing was installed",
                raw_path.display()
            )));
        }
    }
    let plugin_dir = destination.join(top_dir);
    if !plugin_dir.is_dir() {
        return Err(AppError::InvalidInput(format!("the plugin archive has no `{top_dir}/` folder")));
    }
    Ok(plugin_dir)
}

/// The entry path as a relative path starting with `top_dir`, or `InvalidInput`
/// for absolute paths, `..`, or entries outside `top_dir/`.
fn safe_relative_path(raw: &Path, top_dir: &str) -> AppResult<PathBuf> {
    let mut clean = PathBuf::new();
    for component in raw.components() {
        match component {
            Component::Normal(part) => clean.push(part),
            Component::CurDir => {}
            Component::ParentDir | Component::RootDir | Component::Prefix(_) => {
                return Err(AppError::InvalidInput(format!(
                    "the plugin archive has an unsafe path ({}); nothing was installed",
                    raw.display()
                )));
            }
        }
    }
    let mut parts = clean.components();
    let top_matches = matches!(parts.next(), Some(Component::Normal(first)) if first == top_dir);
    if !top_matches {
        return Err(AppError::InvalidInput(format!(
            "the plugin archive has a file outside `{top_dir}/` ({}); nothing was installed",
            raw.display()
        )));
    }
    Ok(clean)
}

fn create_dir(path: &Path) -> AppResult<()> {
    std::fs::create_dir_all(path).map_err(|error| io_error(path, &error))
}

/// Writes one file (never through an existing file or link: `create_new`).
fn write_file(entry: &mut impl Read, target: &Path, mode: u32) -> AppResult<()> {
    if let Some(parent) = target.parent() {
        create_dir(parent)?;
    }
    let mut file = std::fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(target)
        .map_err(|error| io_error(target, &error))?;
    std::io::copy(entry, &mut file).map_err(|error| io_error(target, &error))?;
    set_permissions(target, mode)
}

#[cfg(unix)]
fn set_permissions(target: &Path, mode: u32) -> AppResult<()> {
    use std::os::unix::fs::PermissionsExt;
    // Owner read/write, plus executable bits when the archive had any.
    let executable = if mode & 0o111 != 0 { 0o755 } else { 0o644 };
    std::fs::set_permissions(target, std::fs::Permissions::from_mode(executable))
        .map_err(|error| io_error(target, &error))
}

#[cfg(not(unix))]
fn set_permissions(_target: &Path, _mode: u32) -> AppResult<()> {
    Ok(())
}

fn bad_archive(error: &std::io::Error) -> AppError {
    AppError::InvalidInput(format!("the plugin archive could not be read: {error}"))
}

fn io_error(path: &Path, error: &std::io::Error) -> AppError {
    AppError::Internal(format!("could not write {}: {error}", path.display()))
}
