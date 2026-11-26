//! The pinned graphrt CLI release "Put it online" downloads on demand, and installing it safely.
//!
//! Same rules as the Node runtime (`crate::node_runtime::release`):
//! - **Pin**: the version (`scripts/graphrt-cli-version`) and each archive's SHA-256 and size
//!   (`scripts/graphrt-cli-checksums.txt`) are compiled in by `build.rs`. While the version is
//!   the placeholder `unreleased`, [`GRAPHRT_CLI_VERSION`] is `None` and nothing can be
//!   downloaded: the UI says online deploy is not available yet.
//! - **Source**: only `https://github.com/Graphrt/graphrt/releases/download/v<pinned>/<pinned
//!   archive>` is fetched ([`is_allowed_download_url`]), capped at [`MAX_ARCHIVE_BYTES`]. Release
//!   assets are named after the target only: `graphrt-<target>.tar.gz`, `graphrt-<target>.zip`
//!   on Windows (graphrt `docs/deploy-direct.md`, "Getting the CLI"). The checksums come from the
//!   release's `SHA256SUMS` (`scripts/pin-graphrt-cli.sh`); releases are not signed.
//! - **Extraction**: only the `graphrt` executable (`graphrt.exe` on Windows) at exactly
//!   `graphrt-<target>/graphrt[.exe]` (the archive's one folder; `LICENSE`, `README.md` and
//!   `CHANGELOG.md` next to it are skipped), compared as raw paths, regular files only, at most
//!   [`MAX_EXECUTABLE_BYTES`]. It is written to a path this module chooses.
//! - **Install**: a fresh staging folder under `<app data>/runtime`, chmod 0755, a check run,
//!   then one rename to `<app data>/runtime/graphrt-<version>`. A failed install leaves nothing.

use std::io::{Read, Write};
use std::path::{Path, PathBuf};

use crate::error::{AppError, AppResult};
use crate::node_runtime::release::{clear_quarantine, make_executable};

/// One graphrt CLI release archive and its pinned SHA-256 (lowercase hex) and size.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct CliArchive {
    /// Release target triple, e.g. `aarch64-apple-darwin`.
    pub triple: &'static str,
    /// e.g. `graphrt-aarch64-apple-darwin.tar.gz` (no version in the name).
    pub file_name: &'static str,
    pub sha256: &'static str,
    pub size_bytes: u64,
}

include!(concat!(env!("OUT_DIR"), "/graphrt_cli_release.rs"));

/// The only host the CLI is downloaded from (GitHub redirects to its asset host over HTTPS).
pub const DOWNLOAD_HOST: &str = "github.com";
/// The repository whose releases hold the CLI.
pub const RELEASE_REPOSITORY: &str = "Graphrt/graphrt";
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

/// The release target the CLI is downloaded for on an OS / CPU pair (`std::env::consts` values).
///
/// Linux uses the static musl builds (they run on any distribution). graphrt ships no Windows
/// arm64 build; Windows on Arm runs the x86_64 one through its built-in emulation.
pub fn cli_platform(os: &str, arch: &str) -> Option<&'static str> {
    match (os, arch) {
        ("macos", "aarch64") => Some("aarch64-apple-darwin"),
        ("macos", "x86_64") => Some("x86_64-apple-darwin"),
        ("linux", "aarch64") => Some("aarch64-unknown-linux-musl"),
        ("linux", "x86_64") => Some("x86_64-unknown-linux-musl"),
        ("windows", "aarch64" | "x86_64") => Some("x86_64-pc-windows-msvc"),
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

/// The one archive path the executable has: `graphrt-<target>/graphrt[.exe]`.
fn executable_member(archive: &CliArchive) -> String {
    let name = if archive.triple.contains("windows") { "graphrt.exe" } else { "graphrt" };
    format!("graphrt-{}/{name}", archive.triple)
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
    archive: &CliArchive,
    destination: &mut dyn Write,
) -> AppResult<u64> {
    let member = executable_member(archive);
    if archive.file_name.ends_with(".zip") {
        extract_from_zip(archive_bytes, &member, destination)
    } else if archive.file_name.ends_with(".tar.gz") {
        extract_from_tar_gz(archive_bytes, &member, destination)
    } else {
        Err(AppError::InvalidInput(format!("unsupported archive {}", archive.file_name)))
    }
}

fn extract_from_tar_gz(archive_bytes: &[u8], member: &str, destination: &mut dyn Write) -> AppResult<u64> {
    let mut tarball = tar::Archive::new(flate2::read::GzDecoder::new(archive_bytes));
    for entry in tarball.entries().map_err(bad_archive)? {
        let entry = entry.map_err(bad_archive)?;
        // Raw path comparison: `./graphrt-x/graphrt` or `graphrt-x/../graphrt-x/graphrt` never match.
        if entry.path_bytes().as_ref() != member.as_bytes() {
            continue;
        }
        if !entry.header().entry_type().is_file() {
            return Err(bad_archive(format!("{member} is not a regular file")));
        }
        return copy_limited(entry, destination, member);
    }
    Err(bad_archive(format!("the graphrt executable ({member}) is missing")))
}

fn extract_from_zip(archive_bytes: &[u8], member: &str, destination: &mut dyn Write) -> AppResult<u64> {
    let mut zip_archive = zip::ZipArchive::new(std::io::Cursor::new(archive_bytes)).map_err(bad_archive)?;
    let Ok(file) = zip_archive.by_name(member) else {
        return Err(bad_archive(format!("the graphrt executable ({member}) is missing")));
    };
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
    extract_cli_executable(archive_bytes, archive, &mut file)?;
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
    const MAC_MEMBER: &str = "graphrt-aarch64-apple-darwin/graphrt";

    fn fake_archive(triple: &'static str, file_name: &'static str, bytes: &[u8]) -> CliArchive {
        let sha256: &'static str = Box::leak(crate::plugins::archive::sha256_hex(bytes).into_boxed_str());
        CliArchive { triple, file_name, sha256, size_bytes: bytes.len() as u64 }
    }

    fn mac_archive(bytes: &[u8]) -> CliArchive {
        fake_archive("aarch64-apple-darwin", "graphrt-aarch64-apple-darwin.tar.gz", bytes)
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

    fn zip_with(members: &[(&str, &[u8])]) -> Vec<u8> {
        let mut writer = zip::ZipWriter::new(std::io::Cursor::new(Vec::new()));
        for (path, contents) in members {
            writer.start_file(*path, zip::write::SimpleFileOptions::default()).unwrap();
            writer.write_all(contents).unwrap();
        }
        writer.finish().unwrap().into_inner()
    }

    /// The layout of a real release archive: one `graphrt-<target>/` folder with the binary and docs.
    fn release_layout(folder: &str, binary: &str, contents: &'static [u8]) -> Vec<(String, &'static [u8])> {
        vec![
            (format!("{folder}/LICENSE"), b"license".as_slice()),
            (format!("{folder}/README.md"), b"readme".as_slice()),
            (format!("{folder}/CHANGELOG.md"), b"changelog".as_slice()),
            (format!("{folder}/{binary}"), contents),
        ]
    }

    #[test]
    fn the_placeholder_pin_offers_nothing_to_download() {
        if VERSION_FILE.trim() == "unreleased" {
            assert_eq!(GRAPHRT_CLI_VERSION, None);
            assert!(GRAPHRT_CLI_ARCHIVES.is_empty());
            assert!(archive_for_this_computer().is_none());
            let url = "https://github.com/Graphrt/graphrt/releases/download/vunreleased/graphrt.tar.gz";
            assert!(!is_allowed_download_url(url));
        } else {
            assert_eq!(GRAPHRT_CLI_VERSION, Some(VERSION_FILE.trim()));
            assert_eq!(GRAPHRT_CLI_ARCHIVES.len(), 5, "every release target is pinned");
            assert!(archive_for_this_computer().is_some());
        }
    }

    #[test]
    fn every_supported_computer_maps_to_a_release_target() {
        assert_eq!(cli_platform("macos", "aarch64"), Some("aarch64-apple-darwin"));
        assert_eq!(cli_platform("macos", "x86_64"), Some("x86_64-apple-darwin"));
        assert_eq!(cli_platform("linux", "x86_64"), Some("x86_64-unknown-linux-musl"));
        assert_eq!(cli_platform("linux", "aarch64"), Some("aarch64-unknown-linux-musl"));
        assert_eq!(cli_platform("windows", "x86_64"), Some("x86_64-pc-windows-msvc"));
        assert_eq!(
            cli_platform("windows", "aarch64"),
            Some("x86_64-pc-windows-msvc"),
            "x64 emulation on Windows on Arm"
        );
        assert_eq!(cli_platform("freebsd", "x86_64"), None);
    }

    #[test]
    fn download_urls_name_the_release_asset_without_a_version() {
        let archive = mac_archive(b"x");
        assert_eq!(
            download_url("0.6.0", &archive),
            "https://github.com/Graphrt/graphrt/releases/download/v0.6.0/graphrt-aarch64-apple-darwin.tar.gz"
        );
        assert!(!is_allowed_download_url("http://github.com/x"));
        assert!(!is_allowed_download_url("not a url"));
    }

    #[test]
    fn extracts_only_the_binary_of_the_release_folder() {
        let layout = release_layout("graphrt-aarch64-apple-darwin", "graphrt", b"the cli");
        let members: Vec<(&str, &[u8], tar::EntryType)> =
            layout.iter().map(|(path, contents)| (path.as_str(), *contents, tar::EntryType::Regular)).collect();
        let good = tar_gz(&members);
        let mut extracted = Vec::new();
        assert_eq!(extract_cli_executable(&good, &mac_archive(&good), &mut extracted).unwrap(), 7);
        assert_eq!(extracted, b"the cli");
    }

    #[test]
    fn refuses_other_places_links_and_traversal() {
        for refused in ["graphrt", "./graphrt-aarch64-apple-darwin/graphrt", "graphrt-x86_64-apple-darwin/graphrt"] {
            let bytes = tar_gz(&[(refused, b"cli", tar::EntryType::Regular)]);
            let error = extract_cli_executable(&bytes, &mac_archive(&bytes), &mut Vec::new()).unwrap_err();
            assert!(error.to_string().contains("missing"), "{refused}: {error}");
        }
        let traversal = tar_gz(&[("x/../graphrt-aarch64-apple-darwin/graphrt", b"evil", tar::EntryType::Regular)]);
        let error = extract_cli_executable(&traversal, &mac_archive(&traversal), &mut Vec::new()).unwrap_err();
        assert!(error.to_string().contains("missing"), "{error}");

        let linked = tar_gz(&[(MAC_MEMBER, b"", tar::EntryType::Symlink)]);
        let error = extract_cli_executable(&linked, &mac_archive(&linked), &mut Vec::new()).unwrap_err();
        assert!(error.to_string().contains("not a regular file"), "{error}");
    }

    #[test]
    fn extracts_graphrt_exe_from_the_windows_zip() {
        let layout = release_layout("graphrt-x86_64-pc-windows-msvc", "graphrt.exe", b"MZ windows cli");
        let members: Vec<(&str, &[u8])> = layout.iter().map(|(path, contents)| (path.as_str(), *contents)).collect();
        let bytes = zip_with(&members);
        let archive = fake_archive("x86_64-pc-windows-msvc", "graphrt-x86_64-pc-windows-msvc.zip", &bytes);
        let mut extracted = Vec::new();
        extract_cli_executable(&bytes, &archive, &mut extracted).unwrap();
        assert_eq!(extracted, b"MZ windows cli");

        let at_root = zip_with(&[("graphrt.exe", b"MZ")]);
        let archive = fake_archive("x86_64-pc-windows-msvc", "graphrt-x86_64-pc-windows-msvc.zip", &at_root);
        assert!(extract_cli_executable(&at_root, &archive, &mut Vec::new())
            .unwrap_err()
            .to_string()
            .contains("missing"));
    }

    #[cfg(unix)]
    const RELEASE_ASSETS: [&str; 5] = [
        "graphrt-aarch64-apple-darwin.tar.gz",
        "graphrt-x86_64-apple-darwin.tar.gz",
        "graphrt-x86_64-unknown-linux-musl.tar.gz",
        "graphrt-aarch64-unknown-linux-musl.tar.gz",
        "graphrt-x86_64-pc-windows-msvc.zip",
    ];

    /// A fake `releases/download/v0.6.0/` folder: every asset plus SHA256SUMS listing `listed`.
    #[cfg(unix)]
    fn fake_release(root: &Path, listed: &[&str]) {
        let release = root.join("v0.6.0");
        std::fs::create_dir_all(&release).unwrap();
        let mut sums = String::new();
        for (index, asset) in RELEASE_ASSETS.iter().enumerate() {
            let bytes = format!("archive {index}").repeat(index + 1).into_bytes();
            std::fs::write(release.join(asset), &bytes).unwrap();
            if listed.contains(asset) {
                sums.push_str(&format!("{}  {asset}\n", crate::plugins::archive::sha256_hex(&bytes)));
            }
        }
        sums.push_str(&format!("{}  graphrt-gateway-aarch64-apple-darwin.tar.gz\n", "f".repeat(64)));
        std::fs::write(release.join("SHA256SUMS"), sums).unwrap();
    }

    #[cfg(unix)]
    fn run_pin_script(release_root: &Path, output: &Path) -> std::process::Output {
        let script = concat!(env!("CARGO_MANIFEST_DIR"), "/../scripts/pin-graphrt-cli.sh");
        std::process::Command::new("bash")
            .arg(script)
            .arg("v0.6.0")
            .env("GRAPHRT_RELEASE_BASE_URL", format!("file://{}", release_root.display()))
            .env("GRAPHRT_PIN_OUTPUT_DIR", output)
            .output()
            .unwrap()
    }

    #[cfg(unix)]
    #[test]
    fn the_pin_script_writes_every_target_from_sha256sums() {
        let temp = tempfile::tempdir().unwrap();
        let (release_root, output) = (temp.path().join("download"), temp.path().join("scripts"));
        std::fs::create_dir_all(&output).unwrap();
        fake_release(&release_root, &RELEASE_ASSETS);
        let finished = run_pin_script(&release_root, &output);
        assert!(finished.status.success(), "{}", String::from_utf8_lossy(&finished.stderr));
        assert_eq!(std::fs::read_to_string(output.join("graphrt-cli-version")).unwrap(), "0.6.0\n");
        let pinned = std::fs::read_to_string(output.join("graphrt-cli-checksums.txt")).unwrap();
        let lines: Vec<Vec<&str>> = pinned
            .lines()
            .filter(|line| !line.starts_with('#'))
            .map(|line| line.split_whitespace().collect())
            .collect();
        assert_eq!(lines.iter().map(|fields| fields[1]).collect::<Vec<_>>(), RELEASE_ASSETS, "no gateway archive");
        for (index, fields) in lines.iter().enumerate() {
            let bytes = std::fs::read(release_root.join("v0.6.0").join(fields[1])).unwrap();
            assert_eq!(
                fields,
                &[
                    crate::plugins::archive::sha256_hex(&bytes).as_str(),
                    RELEASE_ASSETS[index],
                    &bytes.len().to_string()
                ]
            );
        }
    }

    #[cfg(unix)]
    #[test]
    fn the_pin_script_refuses_a_release_missing_a_target_or_a_bad_archive() {
        let temp = tempfile::tempdir().unwrap();
        let (release_root, output) = (temp.path().join("download"), temp.path().join("scripts"));
        std::fs::create_dir_all(&output).unwrap();
        fake_release(&release_root, &RELEASE_ASSETS[..4]);
        let finished = run_pin_script(&release_root, &output);
        assert!(!finished.status.success());
        assert!(String::from_utf8_lossy(&finished.stderr).contains("graphrt-x86_64-pc-windows-msvc.zip"));
        assert!(!output.join("graphrt-cli-version").exists(), "nothing is written");

        fake_release(&release_root, &RELEASE_ASSETS);
        std::fs::write(release_root.join("v0.6.0").join(RELEASE_ASSETS[2]), b"tampered").unwrap();
        let finished = run_pin_script(&release_root, &output);
        assert!(!finished.status.success());
        assert!(String::from_utf8_lossy(&finished.stderr).contains("SHA256SUMS says"));
        assert!(!output.join("graphrt-cli-checksums.txt").exists());
    }

    #[test]
    fn installs_atomically_verifies_the_checksum_and_cleans_up() {
        let temp = tempfile::tempdir().unwrap();
        let runtime_root = temp.path().join("runtime");
        let old_version = runtime_root.join("graphrt-0.1.0");
        let node_runtime = runtime_root.join("node-22.0.0");
        std::fs::create_dir_all(&old_version).unwrap();
        std::fs::create_dir_all(&node_runtime).unwrap();
        let bytes = tar_gz(&[(MAC_MEMBER, b"#!/bin/sh\necho ok\n", tar::EntryType::Regular)]);
        let mut archive = mac_archive(&bytes);

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
