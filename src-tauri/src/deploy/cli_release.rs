//! The pinned graphrt CLI release "Put it online" downloads on demand, and installing it safely.
//!
//! Same rules as the Node runtime (`crate::node_runtime::release`):
//! - **Pin**: the version (`scripts/graphrt-cli-version`) and each archive's SHA-256 and size
//!   (`scripts/graphrt-cli-checksums.txt`) are compiled in by `build.rs`. While the version is
//!   the placeholder `unreleased`, [`GRAPHRT_CLI_VERSION`] is `None` and nothing can be
//!   downloaded: the UI says online deploy is not available yet.
//! - **Source**: only `https://github.com/BimaPangestu28/graphrt/releases/download/v<pinned>/<pinned
//!   archive>` is fetched ([`is_allowed_download_url`]), capped at [`MAX_ARCHIVE_BYTES`].
//! - **Extraction**: only the `graphrt` executable (`graphrt.exe` on Windows), at the archive
//!   root or in its `graphrt-<version>-<triple>/` folder, compared as raw paths, regular files
//!   only, at most [`MAX_EXECUTABLE_BYTES`]. It is written to a path this module chooses.
//! - **Install**: a fresh staging folder under `<app data>/runtime`, chmod 0755, a check run,
//!   then one rename to `<app data>/runtime/graphrt-<version>`. A failed install leaves nothing.

use std::io::{Read, Write};
use std::path::{Path, PathBuf};

use crate::error::{AppError, AppResult};
use crate::node_runtime::release::{clear_quarantine, make_executable};

/// One graphrt CLI release archive and its pinned SHA-256 (lowercase hex) and size.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct CliArchive {
    /// Rust target triple, e.g. `aarch64-apple-darwin`.
    pub triple: &'static str,
    /// e.g. `graphrt-0.9.0-aarch64-apple-darwin.tar.gz`.
    pub file_name: &'static str,
    pub sha256: &'static str,
    pub size_bytes: u64,
}

include!(concat!(env!("OUT_DIR"), "/graphrt_cli_release.rs"));

/// The only host the CLI is downloaded from (GitHub redirects to its asset host over HTTPS).
pub const DOWNLOAD_HOST: &str = "github.com";
/// The repository whose releases hold the CLI.
pub const RELEASE_REPOSITORY: &str = "BimaPangestu28/graphrt";
/// Largest archive accepted.
pub const MAX_ARCHIVE_BYTES: u64 = 128 * 1024 * 1024;
/// Largest `graphrt` executable accepted from an archive.
pub const MAX_EXECUTABLE_BYTES: u64 = 256 * 1024 * 1024;
/// Prefix of a staging folder; never a finished install.
const STAGING_PREFIX: &str = ".graphrt-";
/// Prefix of a finished install folder.
const INSTALL_PREFIX: &str = "graphrt-";

#[cfg(windows)]
pub const CLI_EXECUTABLE_NAME: &str = "graphrt.exe";
#[cfg(not(windows))]
pub const CLI_EXECUTABLE_NAME: &str = "graphrt";

/// The target triple the CLI is downloaded for on an OS / CPU pair (`std::env::consts` values).
pub fn cli_platform(os: &str, arch: &str) -> Option<&'static str> {
    match (os, arch) {
        ("macos", "aarch64") => Some("aarch64-apple-darwin"),
        ("macos", "x86_64") => Some("x86_64-apple-darwin"),
        ("linux", "aarch64") => Some("aarch64-unknown-linux-gnu"),
        ("linux", "x86_64") => Some("x86_64-unknown-linux-gnu"),
        ("windows", "aarch64") => Some("aarch64-pc-windows-msvc"),
        ("windows", "x86_64") => Some("x86_64-pc-windows-msvc"),
        _ => None,
    }
}

/// The pinned archive for this computer; `None` while no release is pinned or none is offered here.
pub fn archive_for_this_computer() -> Option<&'static CliArchive> {
    let triple = cli_platform(std::env::consts::OS, std::env::consts::ARCH)?;
    GRAPHRT_CLI_ARCHIVES.iter().find(|archive| archive.triple == triple)
}

/// `https://github.com/<repo>/releases/download/v<version>/<archive>`.
pub fn download_url(version: &str, archive: &CliArchive) -> String {
    format!("https://{DOWNLOAD_HOST}/{RELEASE_REPOSITORY}/releases/download/v{version}/{}", archive.file_name)
}

/// Whether `url` is exactly the download URL of one pinned archive (https, `github.com`, no
/// port, credentials, query or fragment). Always false while no release is pinned.
pub fn is_allowed_download_url(url: &str) -> bool {
    let Some(version) = GRAPHRT_CLI_VERSION else { return false };
    let Ok(parsed) = reqwest::Url::parse(url) else { return false };
    parsed.scheme() == "https"
        && parsed.host_str() == Some(DOWNLOAD_HOST)
        && parsed.port().is_none()
        && parsed.username().is_empty()
        && parsed.password().is_none()
        && parsed.query().is_none()
        && parsed.fragment().is_none()
        && GRAPHRT_CLI_ARCHIVES.iter().any(|archive| parsed.as_str() == download_url(version, archive))
}

/// `InvalidInput` unless `bytes` hash to the archive's pinned SHA-256.
pub fn verify_archive_checksum(bytes: &[u8], archive: &CliArchive) -> AppResult<()> {
    let actual = crate::plugins::archive::sha256_hex(bytes);
    if actual == archive.sha256 {
        return Ok(());
    }
    log::warn!("{} has SHA-256 {actual}, expected {}", archive.file_name, archive.sha256);
    Err(AppError::InvalidInput(format!(
        "the downloaded graphrt tools ({}) do not match their pinned checksum; nothing was installed",
        archive.file_name
    )))
}

/// The two archive paths the executable may have: root, or inside the release folder.
fn executable_members(version: &str, archive: &CliArchive) -> [String; 2] {
    let name = if archive.triple.contains("windows") { "graphrt.exe" } else { "graphrt" };
    [name.to_owned(), format!("graphrt-{version}-{}/{name}", archive.triple)]
}

fn bad_archive(detail: impl std::fmt::Display) -> AppError {
    AppError::InvalidInput(format!("the graphrt tools archive is not usable: {detail}"))
}

/// Copies the archive's `graphrt` executable (only that member) into `destination`.
///
/// # Errors
/// `InvalidInput` when the archive cannot be read, lacks the member, or the member is not a
/// regular file or is larger than [`MAX_EXECUTABLE_BYTES`].
pub fn extract_cli_executable(
    archive_bytes: &[u8],
    version: &str,
    archive: &CliArchive,
    destination: &mut dyn Write,
) -> AppResult<u64> {
    let members = executable_members(version, archive);
    if archive.file_name.ends_with(".zip") {
        extract_from_zip(archive_bytes, &members, destination)
    } else if archive.file_name.ends_with(".tar.gz") {
        extract_from_tar_gz(archive_bytes, &members, destination)
    } else {
        Err(AppError::InvalidInput(format!("unsupported archive {}", archive.file_name)))
    }
}

fn extract_from_tar_gz(archive_bytes: &[u8], members: &[String], destination: &mut dyn Write) -> AppResult<u64> {
    let mut tarball = tar::Archive::new(flate2::read::GzDecoder::new(archive_bytes));
    for entry in tarball.entries().map_err(bad_archive)? {
        let entry = entry.map_err(bad_archive)?;
        // Raw path comparison: `x/../graphrt` never matches.
        let raw_path = entry.path_bytes().into_owned();
        let Some(member) = members.iter().find(|member| member.as_bytes() == raw_path.as_slice()) else { continue };
        if !entry.header().entry_type().is_file() {
            return Err(bad_archive(format!("{member} is not a regular file")));
        }
        let member = member.clone();
        return copy_limited(entry, destination, &member);
    }
    Err(bad_archive("the graphrt executable is missing"))
}

fn extract_from_zip(archive_bytes: &[u8], members: &[String], destination: &mut dyn Write) -> AppResult<u64> {
    let mut zip_archive = zip::ZipArchive::new(std::io::Cursor::new(archive_bytes)).map_err(bad_archive)?;
    for member in members {
        let Ok(file) = zip_archive.by_name(member) else { continue };
        if !file.is_file() || file.is_symlink() {
            return Err(bad_archive(format!("{member} is not a regular file")));
        }
        if file.size() > MAX_EXECUTABLE_BYTES {
            return Err(bad_archive(format!("{member} is larger than {MAX_EXECUTABLE_BYTES} bytes")));
        }
        return copy_limited(file, destination, member);
    }
    Err(bad_archive("the graphrt executable is missing"))
}

fn copy_limited(source: impl Read, destination: &mut dyn Write, member: &str) -> AppResult<u64> {
    let mut limited = source.take(MAX_EXECUTABLE_BYTES + 1);
    let copied = std::io::copy(&mut limited, destination).map_err(bad_archive)?;
    if copied > MAX_EXECUTABLE_BYTES {
        return Err(bad_archive(format!("{member} is larger than {MAX_EXECUTABLE_BYTES} bytes")));
    }
    if copied == 0 {
        return Err(bad_archive(format!("{member} is empty")));
    }
    Ok(copied)
}

/// `<runtime_root>/graphrt-<version>`.
pub fn install_dir(runtime_root: &Path, version: &str) -> PathBuf {
    runtime_root.join(format!("{INSTALL_PREFIX}{version}"))
}

/// `<runtime_root>/graphrt-<version>/graphrt[.exe]`.
pub fn installed_executable(runtime_root: &Path, version: &str) -> PathBuf {
    install_dir(runtime_root, version).join(CLI_EXECUTABLE_NAME)
}

fn io_error(action: &str, path: &Path, error: std::io::Error) -> AppError {
    AppError::Internal(format!("could not {action} {}: {error}", path.display()))
}

/// Installs the executable from a verified archive: staging folder, extract, chmod 0755, `check`,
/// then one rename to [`install_dir`]. Other graphrt CLI versions are removed afterwards.
///
/// # Errors
/// `InvalidInput` for an unusable archive or a failed `check`; `Internal` for I/O errors.
/// Nothing is left in `runtime_root` on error.
pub fn install_from_archive(
    runtime_root: &Path,
    archive_bytes: &[u8],
    version: &str,
    archive: &CliArchive,
    check: &dyn Fn(&Path) -> AppResult<()>,
) -> AppResult<PathBuf> {
    verify_archive_checksum(archive_bytes, archive)?;
    std::fs::create_dir_all(runtime_root).map_err(|error| io_error("create", runtime_root, error))?;
    let staging = runtime_root.join(format!("{STAGING_PREFIX}{version}-{}", uuid::Uuid::new_v4().simple()));
    let result = stage_and_move(&staging, runtime_root, archive_bytes, version, archive, check);
    if staging.exists() {
        if let Err(error) = std::fs::remove_dir_all(&staging) {
            log::warn!("could not remove {}: {error}", staging.display());
        }
    }
    let executable = result?;
    remove_other_versions(runtime_root, version);
    Ok(executable)
}

fn stage_and_move(
    staging: &Path,
    runtime_root: &Path,
    archive_bytes: &[u8],
    version: &str,
    archive: &CliArchive,
    check: &dyn Fn(&Path) -> AppResult<()>,
) -> AppResult<PathBuf> {
    std::fs::create_dir(staging).map_err(|error| io_error("create", staging, error))?;
    let staged_executable = staging.join(CLI_EXECUTABLE_NAME);
    let mut file = std::fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&staged_executable)
        .map_err(|error| io_error("create", &staged_executable, error))?;
    extract_cli_executable(archive_bytes, version, archive, &mut file)?;
    file.sync_all().map_err(|error| io_error("write", &staged_executable, error))?;
    drop(file);
    make_executable(&staged_executable)?;
    clear_quarantine(&staged_executable);
    check(&staged_executable)?;
    let final_dir = install_dir(runtime_root, version);
    if final_dir.exists() {
        std::fs::remove_dir_all(&final_dir).map_err(|error| io_error("replace", &final_dir, error))?;
    }
    std::fs::rename(staging, &final_dir).map_err(|error| io_error("move into", &final_dir, error))?;
    Ok(final_dir.join(CLI_EXECUTABLE_NAME))
}

/// Removes `graphrt-*` folders other than `version`'s, and staging leftovers.
fn remove_other_versions(runtime_root: &Path, version: &str) {
    let keep = install_dir(runtime_root, version);
    let Ok(entries) = std::fs::read_dir(runtime_root) else { return };
    for entry in entries.flatten() {
        let name = entry.file_name().to_string_lossy().into_owned();
        let path = entry.path();
        let is_ours = name.starts_with(INSTALL_PREFIX) || name.starts_with(STAGING_PREFIX);
        if is_ours && path != keep && entry.file_type().is_ok_and(|kind| kind.is_dir()) {
            if let Err(error) = std::fs::remove_dir_all(&path) {
                log::warn!("could not remove the old graphrt tools {}: {error}", path.display());
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const VERSION_FILE: &str = include_str!("../../../scripts/graphrt-cli-version");

    fn fake_archive(file_name: &'static str, bytes: &[u8]) -> CliArchive {
        let sha256: &'static str = Box::leak(crate::plugins::archive::sha256_hex(bytes).into_boxed_str());
        CliArchive { triple: "aarch64-apple-darwin", file_name, sha256, size_bytes: bytes.len() as u64 }
    }

    fn tar_gz(members: &[(&str, &[u8], tar::EntryType)]) -> Vec<u8> {
        let mut builder = tar::Builder::new(Vec::new());
        for (path, contents, entry_type) in members {
            let mut header = tar::Header::new_gnu();
            header.set_size(contents.len() as u64);
            header.set_mode(0o755);
            header.set_entry_type(*entry_type);
            let name = &mut header.as_old_mut().name;
            name[..path.len()].copy_from_slice(path.as_bytes());
            header.set_cksum();
            builder.append(&header, *contents).unwrap();
        }
        let tar_bytes = builder.into_inner().unwrap();
        let mut encoder = flate2::write::GzEncoder::new(Vec::new(), flate2::Compression::fast());
        encoder.write_all(&tar_bytes).unwrap();
        encoder.finish().unwrap()
    }

    #[test]
    fn the_placeholder_pin_offers_nothing_to_download() {
        if VERSION_FILE.trim() == "unreleased" {
            assert_eq!(GRAPHRT_CLI_VERSION, None);
            assert!(GRAPHRT_CLI_ARCHIVES.is_empty());
            assert!(archive_for_this_computer().is_none());
            let url = "https://github.com/BimaPangestu28/graphrt/releases/download/vunreleased/graphrt.tar.gz";
            assert!(!is_allowed_download_url(url));
        } else {
            assert_eq!(GRAPHRT_CLI_VERSION, Some(VERSION_FILE.trim()));
            assert!(!GRAPHRT_CLI_ARCHIVES.is_empty());
        }
    }

    #[test]
    fn every_supported_computer_has_a_triple() {
        assert_eq!(cli_platform("macos", "aarch64"), Some("aarch64-apple-darwin"));
        assert_eq!(cli_platform("windows", "x86_64"), Some("x86_64-pc-windows-msvc"));
        assert_eq!(cli_platform("freebsd", "x86_64"), None);
    }

    #[test]
    fn download_urls_name_the_pinned_github_release() {
        let archive = fake_archive("graphrt-0.9.0-aarch64-apple-darwin.tar.gz", b"x");
        assert_eq!(
            download_url("0.9.0", &archive),
            "https://github.com/BimaPangestu28/graphrt/releases/download/v0.9.0/graphrt-0.9.0-aarch64-apple-darwin.tar.gz"
        );
        assert!(!is_allowed_download_url("http://github.com/x"));
        assert!(!is_allowed_download_url("not a url"));
    }

    #[test]
    fn extracts_only_the_executable_and_refuses_links_and_traversal() {
        let good = tar_gz(&[
            ("graphrt-0.9.0-aarch64-apple-darwin/README.md", b"readme", tar::EntryType::Regular),
            ("graphrt-0.9.0-aarch64-apple-darwin/graphrt", b"the cli", tar::EntryType::Regular),
        ]);
        let archive = fake_archive("fake.tar.gz", &good);
        let mut extracted = Vec::new();
        assert_eq!(extract_cli_executable(&good, "0.9.0", &archive, &mut extracted).unwrap(), 7);
        assert_eq!(extracted, b"the cli");

        let at_root = tar_gz(&[("graphrt", b"root cli", tar::EntryType::Regular)]);
        let mut extracted = Vec::new();
        extract_cli_executable(&at_root, "0.9.0", &fake_archive("fake.tar.gz", &at_root), &mut extracted).unwrap();
        assert_eq!(extracted, b"root cli");

        let traversal = tar_gz(&[("x/../graphrt", b"evil", tar::EntryType::Regular)]);
        let error =
            extract_cli_executable(&traversal, "0.9.0", &fake_archive("fake.tar.gz", &traversal), &mut Vec::new())
                .unwrap_err();
        assert!(error.to_string().contains("missing"), "{error}");

        let linked = tar_gz(&[("graphrt", b"", tar::EntryType::Symlink)]);
        let error = extract_cli_executable(&linked, "0.9.0", &fake_archive("fake.tar.gz", &linked), &mut Vec::new())
            .unwrap_err();
        assert!(error.to_string().contains("not a regular file"), "{error}");
    }

    #[test]
    fn installs_atomically_verifies_the_checksum_and_cleans_up() {
        let temp = tempfile::tempdir().unwrap();
        let runtime_root = temp.path().join("runtime");
        let old_version = runtime_root.join("graphrt-0.1.0");
        let node_runtime = runtime_root.join("node-22.0.0");
        std::fs::create_dir_all(&old_version).unwrap();
        std::fs::create_dir_all(&node_runtime).unwrap();
        let bytes = tar_gz(&[("graphrt", b"#!/bin/sh\necho ok\n", tar::EntryType::Regular)]);
        let mut archive = fake_archive("fake.tar.gz", &bytes);

        let failing = install_from_archive(&runtime_root, &bytes, "0.9.0", &archive, &|_| {
            Err(AppError::InvalidInput("does not run".into()))
        });
        assert!(failing.is_err());
        assert!(!install_dir(&runtime_root, "0.9.0").exists());

        let executable = install_from_archive(&runtime_root, &bytes, "0.9.0", &archive, &|_| Ok(())).unwrap();
        assert_eq!(executable, installed_executable(&runtime_root, "0.9.0"));
        assert!(!old_version.exists(), "older CLI versions are removed");
        assert!(node_runtime.exists(), "the Node runtime is left alone");

        archive.sha256 = Box::leak("0".repeat(64).into_boxed_str());
        let error = install_from_archive(&runtime_root, &bytes, "0.9.1", &archive, &|_| Ok(())).unwrap_err();
        assert!(error.to_string().contains("pinned checksum"), "{error}");
        assert!(!install_dir(&runtime_root, "0.9.1").exists());
    }
}
