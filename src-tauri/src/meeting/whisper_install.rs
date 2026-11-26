//! whisper.cpp on demand: the `whisper-cli` program and the `ggml-base` model are
//! downloaded the first time a meeting is transcribed, never bundled with the app.
//!
//! Each file has a pinned URL and SHA-256; a download that does not match is discarded.
//! Files land in `<app data>/meetings/whisper/` (written to a temporary name, then
//! renamed). A `whisper-cli` on PATH, or paths set in the notetaker settings, are used
//! instead of downloading (developers, distributions that package whisper.cpp).

use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::Duration;

use crate::plugins::download::{require_https, Downloader, ProgressCallback};

use super::platform::MeetingError;
use super::settings::MeetingSettings;

pub const WHISPER_DIR_NAME: &str = "whisper";
const DOWNLOAD_TIMEOUT: Duration = Duration::from_secs(30 * 60);

/// A file to download, pinned by checksum.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct PinnedFile {
    pub url: &'static str,
    pub sha256: &'static str,
    /// Name in the whisper folder.
    pub file_name: &'static str,
    pub size_bytes: u64,
    pub is_executable: bool,
}

/// whisper.cpp's multilingual `base` model (Indonesian included), from the model's
/// Hugging Face repository; the SHA-256 is the file's published LFS hash.
pub const MODEL: PinnedFile = PinnedFile {
    url: "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.bin",
    sha256: "60ed5bc3dd14eea856493d334349b405782ddcaf0028d4b5df4088345fba2efe",
    file_name: "ggml-base.bin",
    size_bytes: 147_951_465,
    is_executable: false,
};

/// whisper.cpp v1.9.6 has no Linux binaries of its own, so graphrt builds `whisper-cli`
/// (static ggml, x86-64-v3, needs only glibc >= 2.35) in the Linux release builder and
/// publishes it on the `whisper-cpp-v1.9.6` prerelease of graphrt (with whisper.cpp's
/// MIT license). macOS / Windows get theirs with their backends.
#[cfg(all(target_os = "linux", target_arch = "x86_64"))]
pub const PROGRAM: Option<PinnedFile> = Some(PinnedFile {
    url: "https://github.com/BimaPangestu28/graphrt-builder-desktop/releases/download/whisper-cpp-v1.9.6/whisper-cli-v1.9.6-linux-x86_64",
    sha256: "8cb010a7c5776bd664237037e438dacbb13898bda1fb5874a516505bf2286261",
    file_name: "whisper-cli",
    size_bytes: 4_073_288,
    is_executable: true,
});

#[cfg(not(all(target_os = "linux", target_arch = "x86_64")))]
pub const PROGRAM: Option<PinnedFile> = None;

/// Hosts downloads may come from (Hugging Face's CDN and GitHub's asset storage are
/// redirect targets the HTTP client follows).
const ALLOWED_HOSTS: &[&str] = &["huggingface.co", "github.com"];

fn is_allowed_url(url: &str) -> bool {
    let Some(rest) = url.strip_prefix("https://") else { return false };
    let host = rest.split(['/', '?', '#']).next().unwrap_or("");
    ALLOWED_HOSTS.contains(&host)
}

/// Where whisper.cpp comes from for one transcription.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct WhisperPaths {
    pub program: Option<PathBuf>,
    pub model: Option<PathBuf>,
}

impl WhisperPaths {
    pub fn is_ready(&self) -> bool {
        self.program.as_ref().is_some_and(|path| path.is_file())
            && self.model.as_ref().is_some_and(|path| path.is_file())
    }
}

/// Finds whisper.cpp without downloading: configured paths, then PATH (program only),
/// then files downloaded before.
pub fn find_installed(settings: &MeetingSettings, whisper_dir: &Path, search_path: Option<&str>) -> WhisperPaths {
    let program = settings
        .whisper_cli_path
        .as_ref()
        .map(PathBuf::from)
        .or_else(|| {
            let search_path = search_path?;
            std::env::split_paths(search_path).map(|dir| dir.join("whisper-cli")).find(|candidate| candidate.is_file())
        })
        .or_else(|| {
            let downloaded = whisper_dir.join(PROGRAM?.file_name);
            downloaded.is_file().then_some(downloaded)
        });
    let model = settings.whisper_model_path.as_ref().map(PathBuf::from).or_else(|| {
        let downloaded = whisper_dir.join(MODEL.file_name);
        downloaded.is_file().then_some(downloaded)
    });
    WhisperPaths { program, model }
}

/// Downloads `file` into `dir` unless it is there already; returns its path.
///
/// # Errors
/// `ToolMissing` when the download fails or its checksum does not match.
pub async fn ensure_file(
    downloader: &Arc<dyn Downloader>,
    dir: &Path,
    file: PinnedFile,
    progress: Option<ProgressCallback>,
) -> Result<PathBuf, MeetingError> {
    let target = dir.join(file.file_name);
    if target.is_file() {
        return Ok(target);
    }
    let missing = |reason: String| MeetingError::ToolMissing { program: file.file_name.to_owned(), reason };
    if !is_allowed_url(file.url) {
        return Err(missing(format!("refused to download from {}", file.url)));
    }
    require_https(file.url).map_err(|error| missing(error.to_string()))?;
    let bytes = downloader
        .fetch(file.url, file.size_bytes + 1024 * 1024, DOWNLOAD_TIMEOUT, progress)
        .await
        .map_err(|error| missing(format!("could not download it: {error}")))?;
    let actual = crate::plugins::archive::sha256_hex(&bytes);
    if actual != file.sha256 {
        return Err(missing(format!("the download is not the expected file (SHA-256 {actual})")));
    }
    std::fs::create_dir_all(dir)?;
    let temporary = dir.join(format!("{}.download", file.file_name));
    std::fs::write(&temporary, &bytes)?;
    #[cfg(unix)]
    if file.is_executable {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(&temporary, std::fs::Permissions::from_mode(0o755))?;
    }
    std::fs::rename(&temporary, &target)?;
    Ok(target)
}

#[cfg(test)]
mod tests {
    use futures::future::BoxFuture;
    use std::sync::Mutex;

    use super::*;
    use crate::error::{AppError, AppResult};

    #[derive(Debug, Default)]
    struct FakeDownloader {
        body: Vec<u8>,
        requests: Mutex<Vec<String>>,
    }

    impl Downloader for FakeDownloader {
        fn fetch(
            &self,
            url: &str,
            _max_bytes: u64,
            _timeout: Duration,
            _progress: Option<ProgressCallback>,
        ) -> BoxFuture<'_, AppResult<Vec<u8>>> {
            self.requests.lock().expect("lock").push(url.to_owned());
            let body = self.body.clone();
            Box::pin(async move {
                if body.is_empty() {
                    Err(AppError::NotFound("asset".into()))
                } else {
                    Ok(body)
                }
            })
        }
    }

    fn pinned(body: &[u8]) -> PinnedFile {
        let sha256: &'static str = Box::leak(crate::plugins::archive::sha256_hex(body).into_boxed_str());
        PinnedFile {
            url: "https://github.com/x/y/releases/download/t/whisper-cli",
            sha256,
            file_name: "whisper-cli",
            size_bytes: body.len() as u64,
            is_executable: true,
        }
    }

    #[tokio::test]
    async fn downloads_once_and_checks_the_checksum() {
        let dir = tempfile::tempdir().expect("temp dir");
        let fake = Arc::new(FakeDownloader { body: b"#!/bin/sh\n".to_vec(), ..Default::default() });
        let downloader: Arc<dyn Downloader> = fake.clone();
        let file = pinned(b"#!/bin/sh\n");
        let path = ensure_file(&downloader, dir.path(), file, None).await.expect("downloads");
        assert_eq!(std::fs::read(&path).expect("read"), b"#!/bin/sh\n");
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            assert_eq!(std::fs::metadata(&path).expect("meta").permissions().mode() & 0o111, 0o111);
        }
        ensure_file(&downloader, dir.path(), file, None).await.expect("already there");
        assert_eq!(fake.requests.lock().expect("lock").len(), 1);
    }

    #[tokio::test]
    async fn a_wrong_download_is_discarded() {
        let dir = tempfile::tempdir().expect("temp dir");
        let downloader: Arc<dyn Downloader> = Arc::new(FakeDownloader { body: b"evil".to_vec(), ..Default::default() });
        let error = ensure_file(&downloader, dir.path(), pinned(b"good"), None).await.expect_err("mismatch");
        assert!(error.to_string().contains("not the expected file"));
        assert!(!dir.path().join("whisper-cli").exists());
    }

    #[tokio::test]
    async fn only_pinned_hosts_are_used() {
        let dir = tempfile::tempdir().expect("temp dir");
        let downloader: Arc<dyn Downloader> = Arc::new(FakeDownloader { body: b"x".to_vec(), ..Default::default() });
        let file = PinnedFile { url: "https://example.com/whisper-cli", ..pinned(b"x") };
        assert!(ensure_file(&downloader, dir.path(), file, None).await.is_err());
        assert!(is_allowed_url(MODEL.url));
        assert!(!is_allowed_url("http://huggingface.co/x"));
        assert!(!is_allowed_url("https://huggingface.co.evil.com/x"));
    }

    #[test]
    fn prefers_configured_paths_then_path_then_downloads() {
        let dir = tempfile::tempdir().expect("temp dir");
        let bin = dir.path().join("bin");
        let whisper_dir = dir.path().join("whisper");
        std::fs::create_dir_all(&bin).expect("bin");
        std::fs::create_dir_all(&whisper_dir).expect("whisper");
        let defaults = MeetingSettings::default();

        let nothing = find_installed(&defaults, &whisper_dir, None);
        assert_eq!(nothing, WhisperPaths { program: None, model: None });
        assert!(!nothing.is_ready());

        std::fs::write(whisper_dir.join(MODEL.file_name), "model").expect("write");
        if let Some(program) = PROGRAM {
            std::fs::write(whisper_dir.join(program.file_name), "bin").expect("write");
            let downloaded = find_installed(&defaults, &whisper_dir, None);
            assert!(downloaded.is_ready());
        }
        std::fs::write(bin.join("whisper-cli"), "").expect("write");
        let search_path = std::env::join_paths([bin.clone()]).expect("join");
        assert_eq!(
            find_installed(&defaults, &whisper_dir, search_path.to_str()).program,
            Some(bin.join("whisper-cli"))
        );

        let configured = MeetingSettings {
            whisper_cli_path: Some("/opt/whisper-cli".into()),
            whisper_model_path: Some("/opt/m.bin".into()),
            ..MeetingSettings::default()
        };
        let paths = find_installed(&configured, &whisper_dir, search_path.to_str());
        assert_eq!(paths.program, Some(PathBuf::from("/opt/whisper-cli")));
        assert_eq!(paths.model, Some(PathBuf::from("/opt/m.bin")));
    }
}
