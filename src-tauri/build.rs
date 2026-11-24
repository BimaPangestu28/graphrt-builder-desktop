//! Build script: Tauri codegen plus the pinned Node.js release.
//!
//! The app does not bundle Node: it downloads the official archive of the version in
//! `scripts/node-version` the first time a plugin needs it (see `src/node_runtime/release.rs`).
//! This script compiles that version and the archive checksums pinned in
//! `scripts/node-checksums.txt` (written by `scripts/fetch-node.sh --update-checksums` from
//! the GPG-verified `SHASUMS256.txt`) into `$OUT_DIR/node_release.rs`, and fails the build
//! when the two files disagree, so a version bump without new checksums cannot ship.
//!
//! The graphrt CLI ("Put it online") is pinned the same way: `scripts/graphrt-cli-version`
//! and `scripts/graphrt-cli-checksums.txt` become `$OUT_DIR/graphrt_cli_release.rs` (see
//! `src/deploy/cli_release.rs`). The version `unreleased` with no archives is the placeholder
//! used until a graphrt release with `graphrt deploy` exists.
//!
//! It also exposes the target triple as `GRAPHRT_TARGET_TRIPLE`: debug builds use the
//! development copy `binaries/graphrt-node-<triple>` from `scripts/fetch-node.sh` when it exists.

use std::fmt::Write as _;
use std::path::Path;

/// Node platforms the app downloads for (`node_platform` in `src/node_runtime/release.rs`).
const NODE_PLATFORMS: &[&str] = &["darwin-arm64", "darwin-x64", "linux-arm64", "linux-x64", "win-arm64", "win-x64"];

fn main() {
    if let Err(message) = generate_node_release().and_then(|()| generate_graphrt_cli_release()) {
        eprintln!("error: {message}");
        std::process::exit(1);
    }
    match std::env::var("TARGET") {
        Ok(target_triple) => println!("cargo:rustc-env=GRAPHRT_TARGET_TRIPLE={target_triple}"),
        Err(error) => {
            eprintln!("error: TARGET is not set: {error}");
            std::process::exit(1);
        }
    }
    // A development Node fetched later is picked up at run time; nothing to rebuild.
    tauri_build::build()
}

/// One pinned archive: `(platform, file name, sha256)`.
type PinnedArchive = (String, String, String);

fn generate_node_release() -> Result<(), String> {
    let version_path = Path::new("../scripts/node-version");
    let checksums_path = Path::new("../scripts/node-checksums.txt");
    println!("cargo:rerun-if-changed={}", version_path.display());
    println!("cargo:rerun-if-changed={}", checksums_path.display());
    let version = read_text(version_path)?.trim().to_owned();
    if version.is_empty()
        || !version.split('.').all(|part| !part.is_empty() && part.bytes().all(|b| b.is_ascii_digit()))
    {
        return Err(format!("{} must hold a version such as 22.23.5, not `{version}`", version_path.display()));
    }
    let archives = parse_pinned_checksums(&read_text(checksums_path)?, &version)?;
    let out_dir = std::env::var("OUT_DIR").map_err(|error| format!("OUT_DIR is not set: {error}"))?;
    let generated = render_node_release(&version, &archives);
    std::fs::write(Path::new(&out_dir).join("node_release.rs"), generated)
        .map_err(|error| format!("cannot write node_release.rs: {error}"))
}

fn read_text(path: &Path) -> Result<String, String> {
    std::fs::read_to_string(path).map_err(|error| format!("cannot read {}: {error}", path.display()))
}

/// Every platform in [`NODE_PLATFORMS`] exactly once, for `version`, with a 64-digit hex checksum.
fn parse_pinned_checksums(text: &str, version: &str) -> Result<Vec<PinnedArchive>, String> {
    let fix = "run `scripts/fetch-node.sh --update-checksums` after changing scripts/node-version";
    let mut archives: Vec<PinnedArchive> = Vec::new();
    for line in text.lines().map(str::trim).filter(|line| !line.is_empty() && !line.starts_with('#')) {
        let mut fields = line.split_whitespace();
        let (Some(sha256), Some(file_name), None) = (fields.next(), fields.next(), fields.next()) else {
            return Err(format!("scripts/node-checksums.txt: bad line `{line}`"));
        };
        if sha256.len() != 64 || !sha256.bytes().all(|byte| byte.is_ascii_hexdigit() && !byte.is_ascii_uppercase()) {
            return Err(format!("scripts/node-checksums.txt: `{sha256}` is not a SHA-256"));
        }
        let platform =
            NODE_PLATFORMS.iter().find(|platform| file_name == archive_file_name(version, platform)).ok_or_else(
                || format!("scripts/node-checksums.txt lists {file_name}, not an archive of Node v{version}; {fix}"),
            )?;
        if archives.iter().any(|(listed, _, _)| listed == platform) {
            return Err(format!("scripts/node-checksums.txt lists {platform} twice"));
        }
        archives.push(((*platform).to_owned(), file_name.to_owned(), sha256.to_owned()));
    }
    if let Some(missing) =
        NODE_PLATFORMS.iter().find(|platform| !archives.iter().any(|(listed, _, _)| listed == *platform))
    {
        return Err(format!("scripts/node-checksums.txt has no {missing} archive of Node v{version}; {fix}"));
    }
    Ok(archives)
}

fn archive_file_name(version: &str, platform: &str) -> String {
    let extension = if platform.starts_with("win-") { "zip" } else { "tar.xz" };
    format!("node-v{version}-{platform}.{extension}")
}

fn render_node_release(version: &str, archives: &[PinnedArchive]) -> String {
    let mut generated = String::new();
    let _ = writeln!(generated, "// Generated by build.rs from scripts/node-version and scripts/node-checksums.txt.");
    let _ = writeln!(generated, "/// The Node.js version the app downloads (`scripts/node-version`).");
    let _ = writeln!(generated, "pub const NODE_VERSION: &str = {version:?};");
    let _ = writeln!(generated, "/// The official archive per platform with its pinned SHA-256.");
    let _ = writeln!(generated, "pub const NODE_ARCHIVES: &[NodeArchive] = &[");
    for (platform, file_name, sha256) in archives {
        let _ = writeln!(
            generated,
            "    NodeArchive {{ platform: {platform:?}, file_name: {file_name:?}, sha256: {sha256:?} }},"
        );
    }
    let _ = writeln!(generated, "];");
    generated
}

/// Target triples the graphrt CLI is downloaded for (`cli_platform` in `src/deploy/cli_release.rs`).
const GRAPHRT_CLI_TRIPLES: &[&str] = &[
    "aarch64-apple-darwin",
    "x86_64-apple-darwin",
    "aarch64-unknown-linux-gnu",
    "x86_64-unknown-linux-gnu",
    "aarch64-pc-windows-msvc",
    "x86_64-pc-windows-msvc",
];

/// The placeholder version: no release is pinned yet.
const UNRELEASED_GRAPHRT_CLI: &str = "unreleased";

/// One pinned CLI archive: `(triple, file name, sha256, size in bytes)`.
type PinnedCliArchive = (String, String, String, u64);

fn generate_graphrt_cli_release() -> Result<(), String> {
    let version_path = Path::new("../scripts/graphrt-cli-version");
    let checksums_path = Path::new("../scripts/graphrt-cli-checksums.txt");
    println!("cargo:rerun-if-changed={}", version_path.display());
    println!("cargo:rerun-if-changed={}", checksums_path.display());
    let version = read_text(version_path)?.trim().to_owned();
    let checksums = read_text(checksums_path)?;
    let archives = if version == UNRELEASED_GRAPHRT_CLI {
        if checksums.lines().any(|line| !line.trim().is_empty() && !line.trim().starts_with('#')) {
            return Err(
                "scripts/graphrt-cli-checksums.txt lists archives but scripts/graphrt-cli-version is `unreleased`"
                    .into(),
            );
        }
        Vec::new()
    } else {
        if version.is_empty() || !version.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'.' || b == b'-') {
            return Err(format!("{} must hold a version such as 0.9.0, not `{version}`", version_path.display()));
        }
        parse_cli_checksums(&checksums, &version)?
    };
    let out_dir = std::env::var("OUT_DIR").map_err(|error| format!("OUT_DIR is not set: {error}"))?;
    std::fs::write(Path::new(&out_dir).join("graphrt_cli_release.rs"), render_cli_release(&version, &archives))
        .map_err(|error| format!("cannot write graphrt_cli_release.rs: {error}"))
}

fn cli_archive_file_name(version: &str, triple: &str) -> String {
    let extension = if triple.contains("windows") { "zip" } else { "tar.gz" };
    format!("graphrt-{version}-{triple}.{extension}")
}

/// At least one archive, each for a known triple at most once, with a SHA-256 and a size.
fn parse_cli_checksums(text: &str, version: &str) -> Result<Vec<PinnedCliArchive>, String> {
    let mut archives: Vec<PinnedCliArchive> = Vec::new();
    for line in text.lines().map(str::trim).filter(|line| !line.is_empty() && !line.starts_with('#')) {
        let mut fields = line.split_whitespace();
        let (Some(sha256), Some(file_name), Some(size), None) =
            (fields.next(), fields.next(), fields.next(), fields.next())
        else {
            return Err(format!("scripts/graphrt-cli-checksums.txt: bad line `{line}` (sha256, file name, size)"));
        };
        if sha256.len() != 64 || !sha256.bytes().all(|byte| byte.is_ascii_hexdigit() && !byte.is_ascii_uppercase()) {
            return Err(format!("scripts/graphrt-cli-checksums.txt: `{sha256}` is not a SHA-256"));
        }
        let size: u64 =
            size.parse().map_err(|_| format!("scripts/graphrt-cli-checksums.txt: `{size}` is not a size"))?;
        let triple =
            GRAPHRT_CLI_TRIPLES.iter().find(|triple| file_name == cli_archive_file_name(version, triple)).ok_or_else(
                || format!("scripts/graphrt-cli-checksums.txt lists {file_name}, not a graphrt {version} archive"),
            )?;
        if archives.iter().any(|(listed, ..)| listed == triple) {
            return Err(format!("scripts/graphrt-cli-checksums.txt lists {triple} twice"));
        }
        archives.push(((*triple).to_owned(), file_name.to_owned(), sha256.to_owned(), size));
    }
    if archives.is_empty() {
        return Err(format!("scripts/graphrt-cli-checksums.txt lists no archive of graphrt {version}"));
    }
    Ok(archives)
}

fn render_cli_release(version: &str, archives: &[PinnedCliArchive]) -> String {
    let mut generated = String::new();
    let _ = writeln!(
        generated,
        "// Generated by build.rs from scripts/graphrt-cli-version and scripts/graphrt-cli-checksums.txt."
    );
    let _ = writeln!(generated, "/// The graphrt CLI version the app downloads; `None` while no release is pinned.");
    if archives.is_empty() {
        let _ = writeln!(generated, "pub const GRAPHRT_CLI_VERSION: Option<&str> = None;");
    } else {
        let _ = writeln!(generated, "pub const GRAPHRT_CLI_VERSION: Option<&str> = Some({version:?});");
    }
    let _ = writeln!(generated, "/// The release archive per target triple with its pinned SHA-256 and size.");
    let _ = writeln!(generated, "pub const GRAPHRT_CLI_ARCHIVES: &[CliArchive] = &[");
    for (triple, file_name, sha256, size) in archives {
        let _ = writeln!(
            generated,
            "    CliArchive {{ triple: {triple:?}, file_name: {file_name:?}, sha256: {sha256:?}, size_bytes: {size} }},"
        );
    }
    let _ = writeln!(generated, "];");
    generated
}
