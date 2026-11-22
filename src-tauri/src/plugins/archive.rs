//! Checksum verification and safe extraction of plugin tarballs (`.tar.gz`).
//!
//! Extraction never trusts the archive: every entry must be a plain file or a
//! directory under `<plugin name>/`, with a relative path free of `..`; links,
//! devices and anything else are rejected. Files are written by this code (not
//! `tar`'s `unpack`), only below the staging directory, and only with the
//! owner's read/write and executable bits.
//!
//! Memory: `tar` 0.4 reads GNU long-name / long-link entries and pax headers fully into
//! memory. So the decompressed stream is capped ([`MAX_DECOMPRESSED_BYTES`]), and before
//! extracting, a raw pass over the headers ([`check_extension_headers`]) refuses any such
//! extension header over [`MAX_EXTENSION_HEADER_BYTES`] without reading it, and any pax
//! header that overrides an entry's `size` (so the raw pass and the real one see the same
//! entries).

use std::io::Read;
use std::path::{Component, Path, PathBuf};

use sha2::{Digest, Sha256};

use crate::error::{AppError, AppResult};

/// Most bytes all extracted files may take together (also the cap for a sideloaded folder).
pub(super) const MAX_EXTRACTED_BYTES: u64 = 1024 * 1024 * 1024;
/// Most entries an archive may hold (also the cap for a sideloaded folder).
pub(super) const MAX_ENTRIES: usize = 100_000;
/// Largest GNU long-name / long-link entry or pax header accepted (a path is at most a few KiB).
pub(super) const MAX_EXTENSION_HEADER_BYTES: u64 = 64 * 1024;
/// Tar block size: every header and every entry's padding.
const TAR_BLOCK_BYTES: u64 = 512;
/// Most raw entries (files plus extension headers) read by [`check_extension_headers`].
const MAX_RAW_ENTRIES: usize = 4 * MAX_ENTRIES;
/// Most bytes read from the decompressed stream: the file cap plus room for every header,
/// padding and the extension headers allowed.
pub(super) const MAX_DECOMPRESSED_BYTES: u64 =
    MAX_EXTRACTED_BYTES + (MAX_RAW_ENTRIES as u64) * 2 * TAR_BLOCK_BYTES + 16 * 1024 * 1024;

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
    check_extension_headers(bytes)?;
    let mut archive = tar::Archive::new(decompressed(bytes));
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

/// The top-level folder of a plugin tarball (its first entry's first path part), for a
/// sideloaded archive whose plugin name is not known beforehand. The name must be a valid
/// plugin name; [`extract_plugin_tarball`] then checks every entry sits under it.
///
/// # Errors
/// `InvalidInput` when the archive cannot be read, is empty or starts with an unsafe path.
pub fn tarball_top_dir(bytes: &[u8]) -> AppResult<String> {
    check_extension_headers(bytes)?;
    let mut archive = tar::Archive::new(decompressed(bytes));
    let entries = archive.entries().map_err(|error| bad_archive(&error))?;
    for entry in entries {
        let entry = entry.map_err(|error| bad_archive(&error))?;
        let entry_type = entry.header().entry_type();
        if entry_type.is_pax_global_extensions() || entry_type.is_pax_local_extensions() {
            continue;
        }
        let raw_path = entry.path().map_err(|error| bad_archive(&error))?.into_owned();
        let first = raw_path.components().find(|component| !matches!(component, Component::CurDir));
        let Some(Component::Normal(top)) = first else {
            return Err(AppError::InvalidInput(format!(
                "the plugin archive has an unsafe path ({}); nothing was installed",
                raw_path.display()
            )));
        };
        let top = top.to_string_lossy().into_owned();
        if !graphrt_plugin::is_valid_name(&top) {
            return Err(AppError::InvalidInput(format!(
                "the plugin archive's top folder `{top}` is not a valid plugin name"
            )));
        }
        return Ok(top);
    }
    Err(AppError::InvalidInput("the plugin archive is empty".into()))
}

/// The decompressed tar stream, cut off after [`MAX_DECOMPRESSED_BYTES`] (then `tar`
/// reports a truncated archive).
fn decompressed(bytes: &[u8]) -> std::io::Take<flate2::read::GzDecoder<&[u8]>> {
    flate2::read::GzDecoder::new(bytes).take(MAX_DECOMPRESSED_BYTES)
}

/// Walks the raw entries (no long-name / pax processing, so nothing is buffered) and
/// refuses an extension header over [`MAX_EXTENSION_HEADER_BYTES`] before `tar` would read
/// it into memory, or a pax header carrying `size` (it would move the entries `tar` sees
/// away from the ones checked here).
///
/// # Errors
/// `InvalidInput` naming the problem; unreadable archives as in [`extract_plugin_tarball`].
fn check_extension_headers(bytes: &[u8]) -> AppResult<()> {
    let mut archive = tar::Archive::new(decompressed(bytes));
    let entries = archive.entries().map_err(|error| bad_archive(&error))?.raw(true);
    for (index, entry) in entries.enumerate() {
        if index >= MAX_RAW_ENTRIES {
            return Err(AppError::InvalidInput("the plugin archive has too many files".into()));
        }
        let mut entry = entry.map_err(|error| bad_archive(&error))?;
        let entry_type = entry.header().entry_type();
        let is_pax = entry_type.is_pax_local_extensions() || entry_type.is_pax_global_extensions();
        if !(is_pax || entry_type.is_gnu_longname() || entry_type.is_gnu_longlink()) {
            continue;
        }
        if entry.size() > MAX_EXTENSION_HEADER_BYTES {
            return Err(AppError::InvalidInput(format!(
                "the plugin archive has a {} byte long-name or pax header (at most {MAX_EXTENSION_HEADER_BYTES}); nothing was installed",
                entry.size()
            )));
        }
        if is_pax && pax_header_sets_size(&mut entry)? {
            return Err(AppError::InvalidInput(
                "the plugin archive has a pax header that changes an entry size; nothing was installed".into(),
            ));
        }
    }
    Ok(())
}

/// Whether a pax header (already known to be small) has a `size` record.
fn pax_header_sets_size(entry: &mut impl Read) -> AppResult<bool> {
    let mut records = Vec::new();
    entry.take(MAX_EXTENSION_HEADER_BYTES).read_to_end(&mut records).map_err(|error| bad_archive(&error))?;
    Ok(tar::PaxExtensions::new(&records).any(|record| record.is_ok_and(|record| record.key_bytes() == b"size")))
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

/// Writes one file (never through an existing file or link: `create_new`) with the
/// owner's read/write bits, plus executable bits when `mode` has any.
pub(super) fn write_file(entry: &mut impl Read, target: &Path, mode: u32) -> AppResult<()> {
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
