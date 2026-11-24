//! The pinned Node.js release the app downloads on demand, and installing it safely.
//!
//! - **Pin**: the version (`scripts/node-version`) and each platform's archive SHA-256
//!   (`scripts/node-checksums.txt`, generated from Node's GPG-verified `SHASUMS256.txt`) are
//!   compiled in by `build.rs`, so a tampered mirror or a swapped release cannot install.
//! - **Source**: only `https://nodejs.org/dist/v<pinned>/<pinned archive>` is ever fetched
//!   ([`is_allowed_download_url`]), with [`MAX_ARCHIVE_BYTES`] as the size cap.
//! - **Extraction**: only the one member `node-v<version>-<platform>/bin/node` (`node.exe`
//!   on Windows) is read, and only when it is a regular file of at most
//!   [`MAX_EXECUTABLE_BYTES`]; it is written to a path this module chooses, so archive
//!   paths (`..`, absolute paths, links) can never place a file anywhere.
//! - **Install**: into a fresh staging folder under `<app data>/runtime`, made executable,
//!   run once (`node --version` must print the pinned version), then renamed to
//!   `<app data>/runtime/node-<version>` in one step. A failed install leaves nothing behind.
//!
//! macOS: Node's release binaries are signed with the Node.js project's Developer ID and
//! hardened runtime, with their own `allow-jit` / `disable-library-validation` entitlements, so
//! JIT and native addons (sharp, canvas...) work regardless of graphrt's own entitlements: a
//! separately signed executable started by a hardened app runs under its own signature. Our
//! HTTP client sets no quarantine attribute; one is still removed defensively.

use std::io::{Read, Write};
use std::path::{Path, PathBuf};

use crate::error::{AppError, AppResult};

/// One official Node.js archive and its pinned SHA-256 (lowercase hex).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct NodeArchive {
    /// Node's platform name, e.g. `darwin-arm64`, `win-x64`.
    pub platform: &'static str,
    /// e.g. `node-v22.23.5-darwin-arm64.tar.xz`.
    pub file_name: &'static str,
    pub sha256: &'static str,
}

include!(concat!(env!("OUT_DIR"), "/node_release.rs"));

/// The only host the runtime is downloaded from.
pub const DOWNLOAD_HOST: &str = "nodejs.org";
/// Largest archive accepted (the official ones are 26-36 MB).
pub const MAX_ARCHIVE_BYTES: u64 = 96 * 1024 * 1024;
/// Largest `node` executable accepted from an archive (about 110 MB on macOS).
pub const MAX_EXECUTABLE_BYTES: u64 = 256 * 1024 * 1024;
/// Folder under the app data folder holding downloaded runtimes.
pub const RUNTIME_DIR_NAME: &str = "runtime";
/// Prefix of a staging folder; never a finished runtime.
const STAGING_PREFIX: &str = ".node-";

#[cfg(windows)]
pub const NODE_EXECUTABLE_NAME: &str = "node.exe";
#[cfg(not(windows))]
pub const NODE_EXECUTABLE_NAME: &str = "node";

/// Node's platform name for an OS / CPU pair (`std::env::consts` values), if the app downloads for it.
pub fn node_platform(os: &str, arch: &str) -> Option<&'static str> {
    match (os, arch) {
        ("macos", "aarch64") => Some("darwin-arm64"),
        ("macos", "x86_64") => Some("darwin-x64"),
        ("linux", "aarch64") => Some("linux-arm64"),
        ("linux", "x86_64") => Some("linux-x64"),
        ("windows", "aarch64") => Some("win-arm64"),
        ("windows", "x86_64") => Some("win-x64"),
        _ => None,
    }
}

/// The pinned archive for `platform`.
pub fn archive_for(platform: &str) -> Option<&'static NodeArchive> {
    NODE_ARCHIVES.iter().find(|archive| archive.platform == platform)
}

/// The pinned archive for the computer the app runs on.
///
/// # Errors
/// `InvalidInput` on a platform Node is not downloaded for.
pub fn archive_for_this_computer() -> AppResult<&'static NodeArchive> {
    node_platform(std::env::consts::OS, std::env::consts::ARCH).and_then(archive_for).ok_or_else(|| {
        AppError::InvalidInput(format!(
            "the plugin runtime is not available for this computer ({} {})",
            std::env::consts::OS,
            std::env::consts::ARCH
        ))
    })
}

/// `https://nodejs.org/dist/v<version>/<archive>`.
pub fn download_url(archive: &NodeArchive) -> String {
    format!("https://{DOWNLOAD_HOST}/dist/v{NODE_VERSION}/{}", archive.file_name)
}

/// Whether `url` is exactly the download URL of one pinned archive: https, `nodejs.org`, no
/// port, credentials, query or fragment. Anything else is refused before a request is made.
pub fn is_allowed_download_url(url: &str) -> bool {
    let Ok(parsed) = reqwest::Url::parse(url) else { return false };
    parsed.scheme() == "https"
        && parsed.host_str() == Some(DOWNLOAD_HOST)
        && parsed.port().is_none()
        && parsed.username().is_empty()
        && parsed.password().is_none()
        && parsed.query().is_none()
        && parsed.fragment().is_none()
        && NODE_ARCHIVES.iter().any(|archive| parsed.as_str() == download_url(archive))
}

/// `InvalidInput` unless `bytes` hash to the archive's pinned SHA-256.
pub fn verify_archive_checksum(bytes: &[u8], archive: &NodeArchive) -> AppResult<()> {
    let actual = crate::plugins::archive::sha256_hex(bytes);
    if actual == archive.sha256 {
        Ok(())
    } else {
        log::warn!("{} has SHA-256 {actual}, expected {}", archive.file_name, archive.sha256);
        Err(AppError::InvalidInput(format!(
            "the downloaded plugin runtime ({}) does not match its pinned checksum; nothing was installed",
            archive.file_name
        )))
    }
}

/// The archive member holding the executable, e.g. `node-v22.23.5-darwin-arm64/bin/node`.
fn executable_member(archive: &NodeArchive) -> String {
    let base = format!("node-v{NODE_VERSION}-{}", archive.platform);
    if archive.platform.starts_with("win-") {
        format!("{base}/node.exe")
    } else {
        format!("{base}/bin/node")
    }
}

/// Copies the archive's `node` executable (only that member) into `destination`. Returns the bytes written.
///
/// # Errors
/// `InvalidInput` when the archive cannot be read, lacks the member, the member is not a
/// regular file (a link, a folder) or is larger than [`MAX_EXECUTABLE_BYTES`].
pub fn extract_node_executable(
    archive_bytes: &[u8],
    archive: &NodeArchive,
    destination: &mut dyn Write,
) -> AppResult<u64> {
    let member = executable_member(archive);
    if archive.file_name.ends_with(".zip") {
        extract_from_zip(archive_bytes, &member, destination)
    } else if archive.file_name.ends_with(".tar.xz") {
        extract_from_tar_xz(archive_bytes, &member, destination)
    } else {
        Err(AppError::InvalidInput(format!("unsupported archive {}", archive.file_name)))
    }
}

fn bad_archive(detail: impl std::fmt::Display) -> AppError {
    AppError::InvalidInput(format!("the plugin runtime archive is not usable: {detail}"))
}

fn extract_from_tar_xz(archive_bytes: &[u8], member: &str, destination: &mut dyn Write) -> AppResult<u64> {
    let decoder = lzma_rust2::XzReader::new(archive_bytes, true);
    let mut tarball = tar::Archive::new(decoder);
    for entry in tarball.entries().map_err(bad_archive)? {
        let entry = entry.map_err(bad_archive)?;
        // Compare the raw path: no normalisation, so `a/../bin/node` never matches.
        if entry.path_bytes().as_ref() != member.as_bytes() {
            continue;
        }
        if !entry.header().entry_type().is_file() {
            return Err(bad_archive(format!("{member} is not a regular file")));
        }
        return copy_limited(entry, destination, member);
    }
    Err(bad_archive(format!("{member} is missing")))
}

fn extract_from_zip(archive_bytes: &[u8], member: &str, destination: &mut dyn Write) -> AppResult<u64> {
    let mut zip_archive = zip::ZipArchive::new(std::io::Cursor::new(archive_bytes)).map_err(bad_archive)?;
    let file = zip_archive.by_name(member).map_err(|error| bad_archive(format!("{member}: {error}")))?;
    if !file.is_file() || file.is_symlink() {
        return Err(bad_archive(format!("{member} is not a regular file")));
    }
    if file.size() > MAX_EXECUTABLE_BYTES {
        return Err(bad_archive(format!("{member} is larger than {MAX_EXECUTABLE_BYTES} bytes")));
    }
    copy_limited(file, destination, member)
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

/// `<runtime_root>/node-<version>`.
pub fn install_dir(runtime_root: &Path) -> PathBuf {
    runtime_root.join(format!("node-{NODE_VERSION}"))
}

/// `<runtime_root>/node-<version>/node[.exe]`: where the downloaded executable lives.
pub fn installed_executable(runtime_root: &Path) -> PathBuf {
    install_dir(runtime_root).join(NODE_EXECUTABLE_NAME)
}

/// Checks a freshly extracted executable before it is moved into place.
pub type ExecutableCheck = dyn Fn(&Path) -> AppResult<()> + Send + Sync;

/// Installs the executable from a verified archive: staging folder, extract, chmod 0755,
/// `check`, then one rename to [`install_dir`]. Older runtimes and leftovers are removed
/// afterwards. Returns the installed executable.
///
/// # Errors
/// `InvalidInput` for an unusable archive or a failed `check`; `Internal` for I/O errors.
/// Nothing is left in `runtime_root` on error.
pub fn install_from_archive(
    runtime_root: &Path,
    archive_bytes: &[u8],
    archive: &NodeArchive,
    check: &dyn Fn(&Path) -> AppResult<()>,
) -> AppResult<PathBuf> {
    verify_archive_checksum(archive_bytes, archive)?;
    std::fs::create_dir_all(runtime_root).map_err(|error| io_error("create", runtime_root, error))?;
    let staging = runtime_root.join(format!("{STAGING_PREFIX}{NODE_VERSION}-{}", uuid::Uuid::new_v4().simple()));
    let result = stage_and_move(&staging, runtime_root, archive_bytes, archive, check);
    if staging.exists() {
        if let Err(error) = std::fs::remove_dir_all(&staging) {
            log::warn!("could not remove {}: {error}", staging.display());
        }
    }
    let executable = result?;
    remove_other_runtimes(runtime_root);
    Ok(executable)
}

fn stage_and_move(
    staging: &Path,
    runtime_root: &Path,
    archive_bytes: &[u8],
    archive: &NodeArchive,
    check: &dyn Fn(&Path) -> AppResult<()>,
) -> AppResult<PathBuf> {
    std::fs::create_dir(staging).map_err(|error| io_error("create", staging, error))?;
    let staged_executable = staging.join(NODE_EXECUTABLE_NAME);
    let mut file = std::fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&staged_executable)
        .map_err(|error| io_error("create", &staged_executable, error))?;
    extract_node_executable(archive_bytes, archive, &mut file)?;
    file.sync_all().map_err(|error| io_error("write", &staged_executable, error))?;
    drop(file);
    make_executable(&staged_executable)?;
    clear_quarantine(&staged_executable);
    check(&staged_executable)?;
    let final_dir = install_dir(runtime_root);
    if final_dir.exists() {
        // An earlier install of this version that no longer runs (Install is only offered then).
        std::fs::remove_dir_all(&final_dir).map_err(|error| io_error("replace", &final_dir, error))?;
    }
    std::fs::rename(staging, &final_dir).map_err(|error| io_error("move into", &final_dir, error))?;
    Ok(final_dir.join(NODE_EXECUTABLE_NAME))
}

fn io_error(action: &str, path: &Path, error: std::io::Error) -> AppError {
    AppError::Internal(format!("could not {action} {}: {error}", path.display()))
}

#[cfg(unix)]
pub(crate) fn make_executable(path: &Path) -> AppResult<()> {
    use std::os::unix::fs::PermissionsExt;
    std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o755))
        .map_err(|error| io_error("chmod", path, error))
}

#[cfg(not(unix))]
pub(crate) fn make_executable(_path: &Path) -> AppResult<()> {
    Ok(())
}

/// Removes `com.apple.quarantine` if something set it (our downloads never do). Best effort.
#[cfg(target_os = "macos")]
pub(crate) fn clear_quarantine(path: &Path) {
    use std::os::unix::ffi::OsStrExt;
    let Ok(path_text) = std::ffi::CString::new(path.as_os_str().as_bytes()) else { return };
    // SAFETY: both pointers are valid NUL-terminated strings for the duration of the call.
    let result = unsafe { libc::removexattr(path_text.as_ptr(), c"com.apple.quarantine".as_ptr(), 0) };
    if result != 0 {
        let error = std::io::Error::last_os_error();
        if error.raw_os_error() != Some(libc::ENOATTR) {
            log::debug!("could not clear the quarantine flag of {}: {error}", path.display());
        }
    }
}

#[cfg(not(target_os = "macos"))]
pub(crate) fn clear_quarantine(_path: &Path) {}

/// Removes every runtime folder except the pinned version's, and staging leftovers.
fn remove_other_runtimes(runtime_root: &Path) {
    let keep = install_dir(runtime_root);
    for path in runtime_folders(runtime_root).into_iter().filter(|path| *path != keep) {
        if let Err(error) = std::fs::remove_dir_all(&path) {
            log::warn!("could not remove the old plugin runtime {}: {error}", path.display());
        }
    }
}

/// `node-*` and staging folders under `runtime_root`.
fn runtime_folders(runtime_root: &Path) -> Vec<PathBuf> {
    let Ok(entries) = std::fs::read_dir(runtime_root) else { return Vec::new() };
    entries
        .flatten()
        .filter(|entry| entry.file_type().is_ok_and(|file_type| file_type.is_dir()))
        .filter(|entry| {
            let name = entry.file_name();
            let name = name.to_string_lossy();
            name.starts_with("node-") || name.starts_with(STAGING_PREFIX)
        })
        .map(|entry| entry.path())
        .collect()
}

/// Removes every downloaded runtime. Returns whether anything was removed.
///
/// # Errors
/// `Internal` when a folder cannot be removed (on Windows: while a plugin still runs).
pub fn remove_downloaded(runtime_root: &Path) -> AppResult<bool> {
    let folders = runtime_folders(runtime_root);
    for path in &folders {
        std::fs::remove_dir_all(path).map_err(|error| io_error("remove", path, error))?;
    }
    Ok(!folders.is_empty())
}

#[cfg(test)]
mod tests {
    use super::*;

    const VERSION_FILE: &str = include_str!("../../../scripts/node-version");
    const CHECKSUMS_FILE: &str = include_str!("../../../scripts/node-checksums.txt");

    #[test]
    fn the_pin_matches_the_checked_in_version_and_checksums() {
        assert_eq!(NODE_VERSION, VERSION_FILE.trim());
        assert_eq!(NODE_ARCHIVES.len(), 6);
        for archive in NODE_ARCHIVES {
            assert!(archive.file_name.starts_with(&format!("node-v{NODE_VERSION}-{}.", archive.platform)));
            assert_eq!(archive.sha256.len(), 64);
            assert!(CHECKSUMS_FILE.contains(&format!("{}  {}", archive.sha256, archive.file_name)));
        }
        assert_eq!(archive_for("win-x64").unwrap().file_name, format!("node-v{NODE_VERSION}-win-x64.zip"));
    }

    #[test]
    fn every_supported_computer_has_an_archive() {
        for (os, arch) in [
            ("macos", "aarch64"),
            ("macos", "x86_64"),
            ("linux", "aarch64"),
            ("linux", "x86_64"),
            ("windows", "aarch64"),
            ("windows", "x86_64"),
        ] {
            let platform = node_platform(os, arch).unwrap();
            assert!(archive_for(platform).is_some(), "{platform}");
        }
        assert_eq!(node_platform("freebsd", "x86_64"), None);
        assert_eq!(node_platform("linux", "riscv64"), None);
    }

    #[test]
    fn only_the_pinned_nodejs_org_urls_are_allowed() {
        let archive = archive_for("darwin-arm64").unwrap();
        let url = download_url(archive);
        assert_eq!(url, format!("https://nodejs.org/dist/v{NODE_VERSION}/node-v{NODE_VERSION}-darwin-arm64.tar.xz"));
        assert!(is_allowed_download_url(&url));
        for refused in [
            url.replace("https://", "http://"),
            url.replace("nodejs.org", "nodejs.org.evil.test"),
            url.replace("nodejs.org", "evil.test"),
            url.replace("nodejs.org", "nodejs.org:8443"),
            url.replace("https://", "https://user:pass@"),
            format!("{url}?x=1"),
            format!("{url}#frag"),
            url.replace(NODE_VERSION, "22.0.0"),
            format!("https://nodejs.org/dist/v{NODE_VERSION}/node-v{NODE_VERSION}-linux-armv7l.tar.xz"),
            format!("https://nodejs.org/dist/v{NODE_VERSION}/../v1.0.0/node-v{NODE_VERSION}-darwin-arm64.tar.xz"),
            "not a url".to_owned(),
        ] {
            assert!(!is_allowed_download_url(&refused), "{refused}");
        }
    }

    /// A fake pinned archive for `bytes` (the checksum is computed, not pinned).
    fn fake_archive(platform: &'static str, file_name: &'static str, bytes: &[u8]) -> NodeArchive {
        let sha256: &'static str = Box::leak(crate::plugins::archive::sha256_hex(bytes).into_boxed_str());
        NodeArchive { platform, file_name, sha256 }
    }

    fn leak(text: String) -> &'static str {
        Box::leak(text.into_boxed_str())
    }

    enum TarMember<'a> {
        File(&'a str, &'a [u8]),
        Symlink(&'a str, &'a str),
    }

    fn tar_xz(members: &[TarMember<'_>]) -> Vec<u8> {
        let mut builder = tar::Builder::new(Vec::new());
        for member in members {
            let mut header = tar::Header::new_gnu();
            match member {
                TarMember::File(path, contents) => {
                    header.set_size(contents.len() as u64);
                    header.set_mode(0o755);
                    header.set_entry_type(tar::EntryType::Regular);
                    // `append_data` refuses `..`; write the raw name like a hostile archive would.
                    let name = &mut header.as_old_mut().name;
                    name[..path.len()].copy_from_slice(path.as_bytes());
                    header.set_cksum();
                    builder.append(&header, *contents).unwrap();
                }
                TarMember::Symlink(path, target) => {
                    header.set_size(0);
                    header.set_entry_type(tar::EntryType::Symlink);
                    builder.append_link(&mut header, path, target).unwrap();
                }
            }
        }
        let tar_bytes = builder.into_inner().unwrap();
        let mut compressed = Vec::new();
        let mut writer = lzma_rust2::XzWriter::new(&mut compressed, lzma_rust2::XzOptions::default()).unwrap();
        writer.write_all(&tar_bytes).unwrap();
        writer.finish().unwrap();
        compressed
    }

    fn zip_with(path: &str, contents: &[u8]) -> Vec<u8> {
        let mut writer = zip::ZipWriter::new(std::io::Cursor::new(Vec::new()));
        writer.start_file(path, zip::write::SimpleFileOptions::default()).unwrap();
        writer.write_all(contents).unwrap();
        writer.finish().unwrap().into_inner()
    }

    fn darwin_member() -> String {
        format!("node-v{NODE_VERSION}-darwin-arm64/bin/node")
    }

    #[test]
    fn extracts_only_the_node_executable_from_a_tar_xz() {
        let member = darwin_member();
        let bytes = tar_xz(&[
            TarMember::File(&format!("node-v{NODE_VERSION}-darwin-arm64/LICENSE"), b"license"),
            TarMember::File(&member, b"the node binary"),
        ]);
        let archive = fake_archive("darwin-arm64", "fake.tar.xz", &bytes);
        let mut extracted = Vec::new();
        assert_eq!(extract_node_executable(&bytes, &archive, &mut extracted).unwrap(), 15);
        assert_eq!(extracted, b"the node binary");
    }

    #[test]
    fn traversal_links_and_missing_members_are_refused() {
        let member = darwin_member();
        let traversal = format!("node-v{NODE_VERSION}-darwin-arm64/x/../bin/node");
        let only_traversal = tar_xz(&[TarMember::File(&traversal, b"evil"), TarMember::File("../../etc/evil", b"x")]);
        let archive = fake_archive("darwin-arm64", "fake.tar.xz", &only_traversal);
        let error = extract_node_executable(&only_traversal, &archive, &mut Vec::new()).unwrap_err();
        assert!(error.to_string().contains("is missing"), "{error}");

        let linked = tar_xz(&[TarMember::Symlink(&member, "/bin/sh")]);
        let archive = fake_archive("darwin-arm64", "fake.tar.xz", &linked);
        let error = extract_node_executable(&linked, &archive, &mut Vec::new()).unwrap_err();
        assert!(error.to_string().contains("not a regular file"), "{error}");

        let garbage = b"definitely not xz".to_vec();
        let archive = fake_archive("darwin-arm64", "fake.tar.xz", &garbage);
        assert_eq!(extract_node_executable(&garbage, &archive, &mut Vec::new()).unwrap_err().code(), "invalid_input");
    }

    #[test]
    fn extracts_node_exe_from_a_windows_zip() {
        let member = format!("node-v{NODE_VERSION}-win-x64/node.exe");
        let bytes = zip_with(&member, b"MZ windows node");
        let archive = fake_archive("win-x64", "fake.zip", &bytes);
        let mut extracted = Vec::new();
        extract_node_executable(&bytes, &archive, &mut extracted).unwrap();
        assert_eq!(extracted, b"MZ windows node");

        let wrong = zip_with("node.exe", b"MZ");
        let archive = fake_archive("win-x64", "fake.zip", &wrong);
        assert!(extract_node_executable(&wrong, &archive, &mut Vec::new()).is_err());
    }

    #[test]
    fn a_checksum_mismatch_installs_nothing() {
        let temp = tempfile::tempdir().unwrap();
        let bytes = tar_xz(&[TarMember::File(&darwin_member(), b"node")]);
        let mut archive = fake_archive("darwin-arm64", "fake.tar.xz", &bytes);
        archive.sha256 = leak("0".repeat(64));
        let error = install_from_archive(temp.path(), &bytes, &archive, &|_| Ok(())).unwrap_err();
        assert!(error.to_string().contains("does not match its pinned checksum"), "{error}");
        assert!(!install_dir(temp.path()).exists());
        // The real pin refuses arbitrary bytes too.
        assert!(verify_archive_checksum(b"x", archive_for("linux-x64").unwrap()).is_err());
    }

    #[test]
    fn installs_atomically_and_cleans_up_on_a_failed_check() {
        let temp = tempfile::tempdir().unwrap();
        let runtime_root = temp.path().join(RUNTIME_DIR_NAME);
        let old_runtime = runtime_root.join("node-20.0.0");
        std::fs::create_dir_all(&old_runtime).unwrap();
        let bytes = tar_xz(&[TarMember::File(&darwin_member(), b"#!/bin/sh\necho v1\n")]);
        let archive = fake_archive("darwin-arm64", "fake.tar.xz", &bytes);

        let failing = install_from_archive(&runtime_root, &bytes, &archive, &|_| {
            Err(AppError::InvalidInput("does not run".into()))
        });
        assert!(failing.is_err());
        assert!(!install_dir(&runtime_root).exists());
        assert_eq!(runtime_folders(&runtime_root), vec![old_runtime.clone()], "no staging leftovers");

        let executable = install_from_archive(&runtime_root, &bytes, &archive, &|staged| {
            assert!(staged.starts_with(&runtime_root) && !staged.starts_with(install_dir(&runtime_root)));
            Ok(())
        })
        .unwrap();
        assert_eq!(executable, installed_executable(&runtime_root));
        assert_eq!(std::fs::read(&executable).unwrap(), b"#!/bin/sh\necho v1\n");
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            assert_eq!(std::fs::metadata(&executable).unwrap().permissions().mode() & 0o777, 0o755);
        }
        assert!(!old_runtime.exists(), "older runtimes are removed");

        assert!(remove_downloaded(&runtime_root).unwrap());
        assert!(!executable.exists());
        assert!(!remove_downloaded(&runtime_root).unwrap());
    }
}
