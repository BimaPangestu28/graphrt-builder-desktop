//! The Node.js runtime graphrt plugins run on ("the plugin runtime").
//!
//! graphrt's process plugins declare `"command": "node"`. The app does not bundle Node (it
//! was 79% of the macOS app): the first time something needs it (installing or running a
//! plugin, installing the browser runtime) the user is asked, and the official Node.js
//! release pinned at build time is downloaded from nodejs.org, checked against its pinned
//! SHA-256 and installed into `<app data>/runtime/node-<version>/` (see [`release`]).
//! Nothing is downloaded without that action: [`NodeRuntime::install_node_runtime`] is only
//! called by the `install_node_runtime` command.
//!
//! Where `node` comes from, in order ([`NodeRuntime::node_location`]):
//!
//! 1. the downloaded runtime (`<app data>/runtime/node-<pinned version>/node[.exe]`);
//! 2. debug builds only: the development copy `src-tauri/binaries/graphrt-node-<triple>`
//!    from `scripts/fetch-node.sh` (skipped with `GRAPHRT_IGNORE_DEV_NODE=1`, to try the
//!    download flow);
//! 3. debug builds only: a `node` on PATH (logged). Release builds never use either.
//!
//! Plugins that drive a browser (Playwright: `google-maps-scraper`, `whatsapp-web`) also get
//! Chromium downloaded on demand. Browsers go into Playwright's *default* cache
//! (`~/Library/Caches/ms-playwright`, `%USERPROFILE%\AppData\Local\ms-playwright`,
//! `~/.cache/ms-playwright`), not the app data folder: graphrt starts plugins with a cleared
//! environment (only `PATH`, `HOME`, `USERPROFILE`, ... pass through), so a plugin's
//! Playwright resolves exactly that folder unless the host also injects
//! `PLAYWRIGHT_BROWSERS_PATH`. [`NodeRuntime::plugin_process_env`] still returns
//! `PLAYWRIGHT_BROWSERS_PATH` (same folder), so both cases agree.
//!
//! CONTRACT: the plugin host calls [`NodeRuntime::plugin_process_env`] and
//! [`NodeRuntime::node_command_path`] for every plugin process and
//! [`NodeRuntime::browser_runtime_status_for`] / [`NodeRuntime::install_browser_runtime_for`]
//! for plugins that need a browser.
//!
//! How that env reaches a plugin: graphrt-plugin (rev 32bcd7a) spawns `runtime.command` after
//! `env_clear()`, copies `PATH`, `HOME`, ... from the *app's* environment, then applies
//! `ProcessRuntime::env`. A macOS app started from Finder has `PATH=/usr/bin:/bin:/usr/sbin:/sbin`,
//! so a bare `node` is not found unless the host edits the parsed manifest before
//! `PluginHost::add`: set `command` to [`NodeRuntime::node_command_path`] (absolute, so no PATH
//! lookup is involved) when it is `"node"`, and merge [`NodeRuntime::plugin_process_env`] into
//! `ProcessRuntime::env` (so `node` spawned by the plugin itself, and
//! `PLAYWRIGHT_BROWSERS_PATH`, work too). Both point at the download location even before
//! the runtime is installed, so installing it needs no plugin reload to take effect.
//! `PluginHost::add` does not re-validate the manifest, so this is allowed.

pub mod release;

use std::ffi::{OsStr, OsString};
use std::io::Read;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicU64, AtomicUsize, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};

use futures::future::BoxFuture;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter};

use crate::error::{AppError, AppResult};
use crate::plugins::download::{Downloader, ProgressCallback as DownloadProgressCallback};
use release::{ExecutableCheck, NodeArchive, NODE_VERSION};

/// Name of the Tauri event carrying [`NodeRuntimeEvent`].
pub const NODE_RUNTIME_EVENT: &str = "node-runtime-event";
/// Fallback browser folder under the app data dir, used only when the home
/// folder (and so Playwright's default cache) cannot be determined.
pub const BROWSERS_DIR_NAME: &str = "browsers";
/// Folder name of Playwright's default browser cache.
const PLAYWRIGHT_CACHE_DIR_NAME: &str = "ms-playwright";
/// Folder under the app data dir searched for a plugin that ships Playwright
/// when [`NodeRuntime::install_browser_runtime`] gets no plugin directory.
pub const PLUGINS_DIR_NAME: &str = "plugins";

/// Downloading Chromium is ~150 MB; give slow connections time, but not forever.
const BROWSER_INSTALL_TIMEOUT: Duration = Duration::from_secs(30 * 60);
/// The Node archive is ~30 MB.
const NODE_DOWNLOAD_TIMEOUT: Duration = Duration::from_secs(15 * 60);
/// Node download progress is reported at most every this many bytes.
const NODE_PROGRESS_STEP_BYTES: u64 = 512 * 1024;
/// How deep under the plugins folder a plugin's `node_modules` may sit.
const PLUGIN_SEARCH_DEPTH: usize = 3;
/// Playwright writes this file into a browser folder once it is fully extracted.
const INSTALLATION_COMPLETE_MARKER: &str = "INSTALLATION_COMPLETE";
/// Set to `1` to ignore the development copy of Node in debug builds.
const IGNORE_DEV_NODE_ENV: &str = "GRAPHRT_IGNORE_DEV_NODE";

/// A system-wide Node, only looked for on PATH in debug builds.
#[cfg(windows)]
const SYSTEM_NODE_FILE_NAME: &str = "node.exe";
#[cfg(not(windows))]
const SYSTEM_NODE_FILE_NAME: &str = "node";

/// Whether the Chromium that Playwright plugins need is installed.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum BrowserRuntimeStatus {
    NotInstalled,
    Installing,
    Installed,
}

/// Whether a usable Node (the plugin runtime) is there. Same values as [`BrowserRuntimeStatus`].
pub type PluginRuntimeStatus = BrowserRuntimeStatus;

/// Where the `node` executable came from.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum NodeSource {
    /// Downloaded by the app into `<app data>/runtime` (the only source in release builds).
    Downloaded,
    /// The development copy from `scripts/fetch-node.sh` (debug builds only).
    Development,
    /// A `node` found on PATH (debug builds only).
    System,
    /// No usable Node was found.
    Missing,
}

/// The resolved `node` executable, if any.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct NodeLocation {
    pub executable: Option<PathBuf>,
    pub source: NodeSource,
}

impl NodeLocation {
    pub const MISSING: Self = Self { executable: None, source: NodeSource::Missing };
}

/// What the settings screen shows about the runtimes (`node_runtime_info`).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NodeRuntimeInfo {
    /// Whether plugins can start (a usable Node is there, or being installed).
    pub status: PluginRuntimeStatus,
    /// `node --version` output such as `v22.23.5`; `None` when Node is missing or fails to run.
    pub version: Option<String>,
    /// The version the app downloads, e.g. `22.23.5`.
    pub pinned_version: String,
    pub path: Option<String>,
    pub source: NodeSource,
    /// The downloaded runtime can be removed (Settings › Remove).
    pub removable: bool,
    /// The app can download Node for this computer.
    pub downloadable: bool,
    pub browser_status: BrowserRuntimeStatus,
    pub browsers_path: String,
}

/// Runtime install progress. Serialized with a snake_case `type` tag and camelCase fields,
/// e.g. `{ "type": "node_install_progress", "message": "...", "percent": 40 }`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case", rename_all_fields = "camelCase")]
pub enum NodeRuntimeEvent {
    /// Playwright's installer started for the plugin in `plugin_dir`.
    BrowserInstallStarted {
        plugin_dir: String,
    },
    /// One line of installer output (download progress, extraction, ...).
    BrowserInstallProgress {
        line: String,
    },
    /// The browser is ready; `already_installed` when nothing was downloaded.
    BrowserInstallFinished {
        already_installed: bool,
    },
    BrowserInstallFailed {
        message: String,
    },
    /// The plugin runtime (Node.js) download started.
    NodeInstallStarted {
        version: String,
    },
    /// Download or install progress of the plugin runtime.
    NodeInstallProgress {
        message: String,
        /// 0 to 100 while downloading, when the size is known.
        percent: Option<f64>,
        received_bytes: Option<u64>,
        total_bytes: Option<u64>,
    },
    /// The plugin runtime is ready; `already_installed` when nothing was downloaded.
    NodeInstallFinished {
        already_installed: bool,
    },
    NodeInstallFailed {
        message: String,
    },
}

/// Delivers [`NodeRuntimeEvent`]s. The app emits Tauri events; tests collect them.
pub trait NodeRuntimeEventSink: Send + Sync + std::fmt::Debug {
    fn send(&self, event: NodeRuntimeEvent);
}

/// Emits [`NODE_RUNTIME_EVENT`] to every window.
#[derive(Debug)]
pub struct TauriNodeRuntimeEventSink {
    app_handle: AppHandle,
}

impl TauriNodeRuntimeEventSink {
    pub fn new(app_handle: AppHandle) -> Self {
        Self { app_handle }
    }
}

impl NodeRuntimeEventSink for TauriNodeRuntimeEventSink {
    fn send(&self, event: NodeRuntimeEvent) {
        if let Err(error) = self.app_handle.emit(NODE_RUNTIME_EVENT, event) {
            log::warn!("could not emit node runtime event: {error}");
        }
    }
}

/// Logs events instead of sending them (no UI attached).
#[derive(Debug, Default)]
pub struct LogNodeRuntimeEvents;

impl NodeRuntimeEventSink for LogNodeRuntimeEvents {
    fn send(&self, event: NodeRuntimeEvent) {
        log::debug!("node runtime event: {event:?}");
    }
}

/// Everything needed to run Playwright's `install chromium`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct BrowserInstallRequest {
    pub node_executable: PathBuf,
    pub playwright_cli: PathBuf,
    pub working_dir: PathBuf,
    pub env: Vec<(String, String)>,
}

/// Receives installer output one line at a time.
pub type ProgressCallback = Arc<dyn Fn(String) + Send + Sync>;

/// Runs the browser download. Real: Playwright's CLI; tests: a fake.
pub trait BrowserInstaller: Send + Sync + std::fmt::Debug {
    fn install(&self, request: BrowserInstallRequest, on_progress: ProgressCallback) -> BoxFuture<'_, AppResult<()>>;
}

/// Runs `node <playwright cli> install chromium` and streams its output.
#[derive(Debug, Default)]
pub struct PlaywrightCliInstaller;

impl BrowserInstaller for PlaywrightCliInstaller {
    fn install(&self, request: BrowserInstallRequest, on_progress: ProgressCallback) -> BoxFuture<'_, AppResult<()>> {
        Box::pin(async move {
            tokio::task::spawn_blocking(move || run_playwright_install(&request, &on_progress))
                .await
                .map_err(|error| AppError::Internal(format!("the browser installer task failed: {error}")))?
        })
    }
}

/// Where Node and the browser cache live; built once at start-up. Cheap to clone.
#[derive(Clone)]
pub struct NodeRuntime {
    /// `<app data>/runtime`, where Node is downloaded to.
    runtime_dir: PathBuf,
    /// The Node used while none is downloaded: the development copy or PATH (debug builds), else missing.
    fallback_location: NodeLocation,
    /// The archive this computer downloads; `None` on platforms Node is not offered for.
    node_archive: Option<NodeArchive>,
    downloader: Option<Arc<dyn Downloader>>,
    executable_check: Arc<ExecutableCheck>,
    browsers_dir: PathBuf,
    plugins_dir: PathBuf,
    installer: Arc<dyn BrowserInstaller>,
    events: Arc<dyn NodeRuntimeEventSink>,
    install_guard: Arc<InstallGuard>,
    node_install_guard: Arc<InstallGuard>,
}

impl std::fmt::Debug for NodeRuntime {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct("NodeRuntime")
            .field("runtime_dir", &self.runtime_dir)
            .field("fallback_location", &self.fallback_location)
            .field("browsers_dir", &self.browsers_dir)
            .finish_non_exhaustive()
    }
}

/// Serializes installs of one runtime and counts the ones requested or running.
#[derive(Debug, Default)]
struct InstallGuard {
    lock: tokio::sync::Mutex<()>,
    pending_installs: AtomicUsize,
}

/// Keeps [`InstallGuard::pending_installs`] raised while an install is waiting or running.
struct PendingInstall<'a>(&'a AtomicUsize);

impl<'a> PendingInstall<'a> {
    fn begin(counter: &'a AtomicUsize) -> Self {
        counter.fetch_add(1, Ordering::SeqCst);
        Self(counter)
    }
}

impl Drop for PendingInstall<'_> {
    fn drop(&mut self) {
        self.0.fetch_sub(1, Ordering::SeqCst);
    }
}

impl NodeRuntime {
    /// Looks for Node (see the module docs) and the browser cache: Playwright's default
    /// cache, or `app_data_dir/browsers` when the home folder is unknown. Downloads go
    /// through `downloader` (see [`Self::with_downloader`]).
    pub fn new(app_data_dir: PathBuf) -> Self {
        let system_path = crate::child_env::host_var("PATH");
        let ignore_dev_node = std::env::var(IGNORE_DEV_NODE_ENV).is_ok_and(|value| value == "1");
        let dev_node = (cfg!(debug_assertions) && !ignore_dev_node).then(development_node_path);
        let fallback = resolve_fallback_location(dev_node.as_deref(), cfg!(debug_assertions), system_path.as_deref());
        let runtime = Self::with_parts(app_data_dir, fallback, Arc::new(PlaywrightCliInstaller));
        log_node_location(&runtime.node_location());
        let home_dir = std::env::var_os(if cfg!(windows) { "USERPROFILE" } else { "HOME" }).map(PathBuf::from);
        match playwright_default_cache_dir(std::env::consts::OS, home_dir.as_deref()) {
            Some(cache_dir) => runtime.with_browsers_dir(cache_dir),
            None => {
                log::warn!("home folder unknown; keeping Playwright browsers in {}", runtime.browsers_dir.display());
                runtime
            }
        }
    }

    /// Changes where browsers are installed and looked for.
    pub fn with_browsers_dir(mut self, browsers_dir: PathBuf) -> Self {
        self.browsers_dir = browsers_dir;
        self
    }

    /// Builds a runtime whose Node, while none is downloaded, is `fallback_location`, with a
    /// browser installer (tests and callers that want a fake installer).
    pub fn with_parts(
        app_data_dir: PathBuf,
        fallback_location: NodeLocation,
        installer: Arc<dyn BrowserInstaller>,
    ) -> Self {
        Self {
            runtime_dir: app_data_dir.join(release::RUNTIME_DIR_NAME),
            fallback_location,
            node_archive: release::archive_for_this_computer().ok().copied(),
            downloader: None,
            executable_check: Arc::new(check_node_runs),
            browsers_dir: app_data_dir.join(BROWSERS_DIR_NAME),
            plugins_dir: app_data_dir.join(PLUGINS_DIR_NAME),
            installer,
            events: Arc::new(LogNodeRuntimeEvents),
            install_guard: Arc::new(InstallGuard::default()),
            node_install_guard: Arc::new(InstallGuard::default()),
        }
    }

    /// Sends install progress to `events` (the app passes a [`TauriNodeRuntimeEventSink`]).
    pub fn with_event_sink(mut self, events: Arc<dyn NodeRuntimeEventSink>) -> Self {
        self.events = events;
        self
    }

    /// Changes where [`Self::install_browser_runtime`] looks for installed plugins.
    pub fn with_plugins_dir(mut self, plugins_dir: PathBuf) -> Self {
        self.plugins_dir = plugins_dir;
        self
    }

    /// The HTTPS client [`Self::install_node_runtime`] downloads with.
    pub fn with_downloader(mut self, downloader: Arc<dyn Downloader>) -> Self {
        self.downloader = Some(downloader);
        self
    }

    /// Tests: a different archive (a fixture with its own checksum) and executable check.
    #[cfg(test)]
    fn with_node_archive(mut self, archive: Option<NodeArchive>, check: Arc<ExecutableCheck>) -> Self {
        self.node_archive = archive;
        self.executable_check = check;
        self
    }

    /// The Node plugins run on right now: the downloaded runtime, else the fallback.
    pub fn node_location(&self) -> NodeLocation {
        let downloaded = release::installed_executable(&self.runtime_dir);
        if is_usable_executable(&downloaded) {
            return NodeLocation { executable: Some(downloaded), source: NodeSource::Downloaded };
        }
        self.fallback_location.clone()
    }

    /// Absolute path of the `node` executable.
    ///
    /// # Errors
    /// `InvalidInput` when the plugin runtime is not installed.
    pub fn node_executable(&self) -> AppResult<PathBuf> {
        self.node_location().executable.ok_or_else(|| {
            AppError::InvalidInput(
                "the plugin runtime (Node.js) is not installed; install it from Plugins or Settings".into(),
            )
        })
    }

    /// What `"command": "node"` becomes: the current Node, else where the runtime will be
    /// installed (so plugins start once it is, and fail with that path until then).
    pub fn node_command_path(&self) -> PathBuf {
        self.node_location().executable.unwrap_or_else(|| release::installed_executable(&self.runtime_dir))
    }

    /// Folder Playwright keeps its browsers in (`PLAYWRIGHT_BROWSERS_PATH`).
    pub fn browsers_dir(&self) -> &Path {
        &self.browsers_dir
    }

    /// Extra environment for a plugin process: `PATH` starting with Node's folder (so a
    /// plugin spawning `node` finds it) and `PLAYWRIGHT_BROWSERS_PATH` pointing at the browser cache.
    pub fn plugin_process_env(&self) -> Vec<(String, String)> {
        let node_command = self.node_command_path();
        compose_plugin_env(node_command.parent(), crate::child_env::host_var("PATH"), &self.browsers_dir)
    }

    /// Whether plugins can start: a usable Node is there (or one is being downloaded).
    pub fn node_runtime_status(&self) -> PluginRuntimeStatus {
        if self.node_install_guard.pending_installs.load(Ordering::SeqCst) > 0 {
            return PluginRuntimeStatus::Installing;
        }
        if self.node_location().executable.is_some() {
            PluginRuntimeStatus::Installed
        } else {
            PluginRuntimeStatus::NotInstalled
        }
    }

    /// Downloads and installs the pinned Node.js release (see [`release`]), unless it is
    /// already downloaded. Concurrent calls run one after another. Progress goes to the
    /// Tauri event `node-runtime-event`. Only call this for an explicit user action.
    ///
    /// # Errors
    /// `InvalidInput` on a platform Node is not offered for, a checksum mismatch or an
    /// unusable archive; `Internal` when the download fails (offline) or files cannot be
    /// written. Nothing is installed on error.
    pub async fn install_node_runtime(&self) -> AppResult<()> {
        let _pending = PendingInstall::begin(&self.node_install_guard.pending_installs);
        let _exclusive = self.node_install_guard.lock.lock().await;
        if is_usable_executable(&release::installed_executable(&self.runtime_dir)) {
            self.events.send(NodeRuntimeEvent::NodeInstallFinished { already_installed: true });
            return Ok(());
        }
        self.events.send(NodeRuntimeEvent::NodeInstallStarted { version: NODE_VERSION.to_owned() });
        let result = self.download_and_install_node().await;
        match &result {
            Ok(path) => {
                log::info!("installed the plugin runtime Node.js v{NODE_VERSION} at {}", path.display());
                self.events.send(NodeRuntimeEvent::NodeInstallFinished { already_installed: false });
            }
            Err(error) => {
                log::warn!("could not install the plugin runtime: {error}");
                self.events.send(NodeRuntimeEvent::NodeInstallFailed { message: error.to_string() });
            }
        }
        result.map(|_| ())
    }

    async fn download_and_install_node(&self) -> AppResult<PathBuf> {
        let archive = self.node_archive.ok_or_else(|| {
            AppError::InvalidInput(format!(
                "the plugin runtime is not available for this computer ({} {})",
                std::env::consts::OS,
                std::env::consts::ARCH
            ))
        })?;
        let url = release::download_url(&archive);
        if !release::is_allowed_download_url(&url) {
            return Err(AppError::InvalidInput(format!("refused to download the plugin runtime from {url}")));
        }
        let downloader = self
            .downloader
            .clone()
            .ok_or_else(|| AppError::Internal("the plugin runtime cannot be downloaded: no download client".into()))?;
        let archive_bytes = downloader
            .fetch(&url, release::MAX_ARCHIVE_BYTES, NODE_DOWNLOAD_TIMEOUT, Some(self.node_download_progress()))
            .await
            .map_err(describe_download_error)?;
        self.send_node_step("Checking and installing Node.js…");
        let runtime_dir = self.runtime_dir.clone();
        let check = self.executable_check.clone();
        tokio::task::spawn_blocking(move || {
            release::install_from_archive(&runtime_dir, &archive_bytes, &archive, check.as_ref())
        })
        .await
        .map_err(|error| AppError::Internal(format!("the plugin runtime install task stopped: {error}")))?
    }

    fn send_node_step(&self, message: &str) {
        self.events.send(NodeRuntimeEvent::NodeInstallProgress {
            message: message.to_owned(),
            percent: None,
            received_bytes: None,
            total_bytes: None,
        });
    }

    /// Download progress as `node_install_progress` events, at most every [`NODE_PROGRESS_STEP_BYTES`].
    fn node_download_progress(&self) -> DownloadProgressCallback {
        let events = self.events.clone();
        let last_reported = Arc::new(AtomicU64::new(0));
        Arc::new(move |received: u64, total: Option<u64>| {
            let previous = last_reported.load(Ordering::Relaxed);
            let finished = total.is_some_and(|total| received >= total);
            if received < previous.saturating_add(NODE_PROGRESS_STEP_BYTES) && !finished && previous != 0 {
                return;
            }
            last_reported.store(received.max(1), Ordering::Relaxed);
            let percent =
                total.filter(|total| *total > 0).map(|total| (received as f64 * 100.0 / total as f64).min(100.0));
            events.send(NodeRuntimeEvent::NodeInstallProgress {
                message: "Downloading Node.js".to_owned(),
                percent,
                received_bytes: Some(received),
                total_bytes: total,
            });
        })
    }

    /// Removes the downloaded runtime (Settings › Remove). Plugins stop working until it is
    /// installed again; a development copy or PATH Node (debug builds) takes over.
    /// Returns whether anything was removed.
    ///
    /// # Errors
    /// `InvalidInput` while the runtime is being installed; `Internal` when it cannot be
    /// deleted (on Windows: while a plugin still runs).
    pub async fn remove_node_runtime(&self) -> AppResult<bool> {
        let Ok(_exclusive) = self.node_install_guard.lock.try_lock() else {
            return Err(AppError::InvalidInput(
                "the plugin runtime is being installed; try again when it is done".into(),
            ));
        };
        let runtime_dir = self.runtime_dir.clone();
        tokio::task::spawn_blocking(move || release::remove_downloaded(&runtime_dir))
            .await
            .map_err(|error| AppError::Internal(format!("the remove task stopped: {error}")))?
    }

    /// Whether any Playwright Chromium is installed (or an install is under way).
    /// Use [`Self::browser_runtime_status_for`] to check the exact build a plugin needs.
    pub fn browser_runtime_status(&self) -> BrowserRuntimeStatus {
        if self.install_in_progress() {
            return BrowserRuntimeStatus::Installing;
        }
        if has_any_complete_browser(&self.browsers_dir, "chromium") {
            BrowserRuntimeStatus::Installed
        } else {
            BrowserRuntimeStatus::NotInstalled
        }
    }

    /// Whether the Chromium build that the plugin's own Playwright version expects is installed.
    pub fn browser_runtime_status_for(&self, plugin_dir: &Path) -> AppResult<BrowserRuntimeStatus> {
        if self.install_in_progress() {
            return Ok(BrowserRuntimeStatus::Installing);
        }
        let playwright = PlaywrightPackage::locate(plugin_dir)?;
        Ok(installed_status(&self.browsers_dir, &playwright.required_browser_dirs()?))
    }

    /// Downloads Chromium for Playwright into the browser cache (idempotent),
    /// using the Playwright of an installed plugin under the plugins folder
    /// (the newest version when several plugins ship it).
    /// Progress goes to the Tauri event `node-runtime-event`.
    pub async fn install_browser_runtime(&self) -> AppResult<()> {
        let plugin_dir = find_plugin_with_playwright(&self.plugins_dir).ok_or_else(|| {
            AppError::InvalidInput(format!(
                "no installed plugin ships Playwright (looked in {}); install a browser plugin first",
                self.plugins_dir.display()
            ))
        })?;
        self.install_browser_runtime_for(&plugin_dir).await
    }

    /// Downloads the Chromium build the plugin's Playwright version needs, with
    /// that Playwright's CLI and Node. Concurrent calls run one after
    /// another; a call that finds the browser installed returns at once.
    /// Progress goes to the Tauri event `node-runtime-event`.
    ///
    /// # Errors
    /// `InvalidInput` when `plugin_dir`, or the Playwright CLI found for it, is
    /// not inside the app's plugins folder: the installer runs that file with
    /// Node, so only code of an installed plugin may be used. `InvalidInput` too
    /// when the plugin runtime (Node) is not installed.
    pub async fn install_browser_runtime_for(&self, plugin_dir: &Path) -> AppResult<()> {
        let _pending = PendingInstall::begin(&self.install_guard.pending_installs);
        let _exclusive = self.install_guard.lock.lock().await;
        let plugins_root = canonical_dir(&self.plugins_dir)?;
        let plugin_dir = require_inside(&plugins_root, plugin_dir, "the plugin folder")?;
        let playwright = PlaywrightPackage::locate(&plugin_dir)?;
        require_inside(&plugins_root, &playwright.cli, "the Playwright installer")?;
        let plugin_dir = plugin_dir.as_path();
        if installed_status(&self.browsers_dir, &playwright.required_browser_dirs()?) == BrowserRuntimeStatus::Installed
        {
            self.events.send(NodeRuntimeEvent::BrowserInstallFinished { already_installed: true });
            return Ok(());
        }
        let result = self.run_installer(plugin_dir, &playwright).await;
        match &result {
            Ok(()) => self.events.send(NodeRuntimeEvent::BrowserInstallFinished { already_installed: false }),
            Err(error) => self.events.send(NodeRuntimeEvent::BrowserInstallFailed { message: error.to_string() }),
        }
        result
    }

    /// Runtime status, version, path and browser status for the settings screen.
    pub async fn info(&self) -> NodeRuntimeInfo {
        let location = self.node_location();
        let version = match location.executable.clone() {
            Some(executable) => tokio::task::spawn_blocking(move || read_node_version(&executable))
                .await
                .unwrap_or_else(|error| Err(AppError::Internal(error.to_string())))
                .map_err(|error| log::warn!("could not read the Node version: {error}"))
                .ok(),
            None => None,
        };
        NodeRuntimeInfo {
            status: self.node_runtime_status(),
            version,
            pinned_version: NODE_VERSION.to_owned(),
            path: location.executable.as_ref().map(|path| path.display().to_string()),
            source: location.source,
            removable: location.source == NodeSource::Downloaded,
            downloadable: self.node_archive.is_some(),
            browser_status: self.browser_runtime_status(),
            browsers_path: self.browsers_dir.display().to_string(),
        }
    }

    fn install_in_progress(&self) -> bool {
        self.install_guard.pending_installs.load(Ordering::SeqCst) > 0
    }

    async fn run_installer(&self, plugin_dir: &Path, playwright: &PlaywrightPackage) -> AppResult<()> {
        let node_executable = self.node_executable()?;
        std::fs::create_dir_all(&self.browsers_dir).map_err(|error| {
            AppError::Internal(format!("cannot create the browser folder {}: {error}", self.browsers_dir.display()))
        })?;
        self.events.send(NodeRuntimeEvent::BrowserInstallStarted { plugin_dir: plugin_dir.display().to_string() });
        let request = BrowserInstallRequest {
            node_executable,
            playwright_cli: playwright.cli.clone(),
            working_dir: plugin_dir.to_path_buf(),
            env: self.plugin_process_env(),
        };
        let events = self.events.clone();
        let on_progress: ProgressCallback =
            Arc::new(move |line| events.send(NodeRuntimeEvent::BrowserInstallProgress { line }));
        self.installer.install(request, on_progress).await
    }
}

/// A clear message for a failed runtime download (usually: offline).
fn describe_download_error(error: AppError) -> AppError {
    match error {
        AppError::Internal(detail) => AppError::Internal(format!(
            "could not download the plugin runtime from nodejs.org; check the internet connection and try again ({detail})"
        )),
        other => other,
    }
}

/// Runs the staged executable once: `node --version` must print the pinned version.
fn check_node_runs(executable: &Path) -> AppResult<()> {
    let version = read_node_version(executable).map_err(|error| {
        AppError::InvalidInput(format!("the downloaded plugin runtime does not start on this computer: {error}"))
    })?;
    if version == format!("v{NODE_VERSION}") {
        Ok(())
    } else {
        Err(AppError::InvalidInput(format!(
            "the downloaded plugin runtime reports {version}, expected v{NODE_VERSION}"
        )))
    }
}

fn log_node_location(location: &NodeLocation) {
    match (location.source, &location.executable) {
        (NodeSource::Downloaded, Some(path)) => log::info!("using the downloaded plugin runtime at {}", path.display()),
        (NodeSource::Development, Some(path)) => log::info!("using the development Node at {}", path.display()),
        (NodeSource::System, Some(path)) => {
            log::warn!("no downloaded Node; using {} from PATH (debug build only)", path.display())
        }
        _ => log::info!("the plugin runtime (Node.js) is not installed yet; plugins ask for it when needed"),
    }
}

/// `src-tauri/binaries/graphrt-node-<target triple>[.exe]` from `scripts/fetch-node.sh`.
fn development_node_path() -> PathBuf {
    let extension = if cfg!(windows) { ".exe" } else { "" };
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("binaries")
        .join(format!("graphrt-node-{}{extension}", env!("GRAPHRT_TARGET_TRIPLE")))
}

/// The Node used while none is downloaded: `dev_node` when usable, else (with
/// `allow_system_fallback`, debug builds) the first `node` on `system_path`.
pub fn resolve_fallback_location(
    dev_node: Option<&Path>,
    allow_system_fallback: bool,
    system_path: Option<&OsStr>,
) -> NodeLocation {
    if let Some(dev_node) = dev_node.filter(|path| is_usable_executable(path)) {
        return NodeLocation { executable: Some(dev_node.to_path_buf()), source: NodeSource::Development };
    }
    let from_path = if allow_system_fallback { system_path.and_then(find_node_on_path) } else { None };
    match from_path {
        Some(executable) => NodeLocation { executable: Some(executable), source: NodeSource::System },
        None => NodeLocation::MISSING,
    }
}

fn find_node_on_path(system_path: &OsStr) -> Option<PathBuf> {
    std::env::split_paths(system_path)
        .map(|dir| dir.join(SYSTEM_NODE_FILE_NAME))
        .find(|path| is_usable_executable(path))
}

/// A non-empty regular file (executable on Unix). Empty files are build placeholders.
fn is_usable_executable(path: &Path) -> bool {
    let Ok(metadata) = std::fs::metadata(path) else {
        return false;
    };
    if !metadata.is_file() || metadata.len() == 0 {
        return false;
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        metadata.permissions().mode() & 0o111 != 0
    }
    #[cfg(not(unix))]
    {
        true
    }
}

/// Playwright's default browser cache as a plugin process sees it. Plugins get
/// a cleared environment without `XDG_CACHE_HOME` / `LOCALAPPDATA`, so
/// Playwright falls back to paths under the home folder (`HOME` on Unix,
/// `USERPROFILE` on Windows, both passed through by graphrt).
pub fn playwright_default_cache_dir(os: &str, home_dir: Option<&Path>) -> Option<PathBuf> {
    let home_dir = home_dir.filter(|dir| !dir.as_os_str().is_empty())?;
    let cache_root = match os {
        "macos" => home_dir.join("Library").join("Caches"),
        "windows" => home_dir.join("AppData").join("Local"),
        _ => home_dir.join(".cache"),
    };
    Some(cache_root.join(PLAYWRIGHT_CACHE_DIR_NAME))
}

/// `PATH` = Node's folder then `system_path`; `PLAYWRIGHT_BROWSERS_PATH` = `browsers_dir`.
pub fn compose_plugin_env(
    node_dir: Option<&Path>,
    system_path: Option<OsString>,
    browsers_dir: &Path,
) -> Vec<(String, String)> {
    let mut path_entries: Vec<PathBuf> = node_dir.map(Path::to_path_buf).into_iter().collect();
    if let Some(system_path) = &system_path {
        path_entries.extend(std::env::split_paths(system_path).filter(|entry| Some(entry.as_path()) != node_dir));
    }
    let joined_path = match std::env::join_paths(&path_entries) {
        Ok(joined) => joined,
        Err(error) => {
            log::warn!("cannot put the bundled Node first on PATH: {error}");
            system_path.unwrap_or_default()
        }
    };
    vec![
        ("PATH".to_string(), joined_path.to_string_lossy().into_owned()),
        ("PLAYWRIGHT_BROWSERS_PATH".to_string(), browsers_dir.to_string_lossy().into_owned()),
    ]
}

/// The Playwright package a plugin depends on.
#[derive(Debug, Clone, PartialEq, Eq)]
struct PlaywrightPackage {
    cli: PathBuf,
    browsers_json: PathBuf,
}

/// The subset of `playwright-core/browsers.json` used here.
#[derive(Debug, Deserialize)]
struct BrowsersManifest {
    browsers: Vec<BrowserManifestEntry>,
}

#[derive(Debug, Deserialize)]
struct BrowserManifestEntry {
    name: String,
    revision: String,
}

impl PlaywrightPackage {
    /// Resolves `playwright` (or `playwright-core`) the way Node would: in
    /// `node_modules` of the plugin folder or any parent folder.
    fn locate(plugin_dir: &Path) -> AppResult<Self> {
        plugin_dir.ancestors().find_map(Self::in_node_modules).ok_or_else(|| {
            AppError::InvalidInput(format!(
                "the plugin in {} does not ship Playwright (node_modules/playwright not found)",
                plugin_dir.display()
            ))
        })
    }

    fn in_node_modules(dir: &Path) -> Option<Self> {
        let node_modules = dir.join("node_modules");
        let playwright = node_modules.join("playwright");
        let core = node_modules.join("playwright-core");
        let nested_core = playwright.join("node_modules").join("playwright-core");
        let cli = [playwright.join("cli.js"), core.join("cli.js")].into_iter().find(|path| path.is_file())?;
        let browsers_json =
            [nested_core.join("browsers.json"), core.join("browsers.json")].into_iter().find(|path| path.is_file())?;
        Some(Self { cli, browsers_json })
    }

    /// Folder names Playwright installs `chromium` into for this version, such
    /// as `chromium-1255` and `chromium_headless_shell-1255`.
    fn required_browser_dirs(&self) -> AppResult<Vec<String>> {
        let manifest_text = std::fs::read_to_string(&self.browsers_json)
            .map_err(|error| AppError::Internal(format!("cannot read {}: {error}", self.browsers_json.display())))?;
        let manifest: BrowsersManifest = serde_json::from_str(&manifest_text)?;
        let required: Vec<String> = manifest
            .browsers
            .iter()
            .filter(|entry| entry.name == "chromium" || entry.name == "chromium-headless-shell")
            .map(|entry| format!("{}-{}", entry.name.replace('-', "_"), entry.revision))
            .collect();
        if required.is_empty() {
            return Err(AppError::Internal(format!("{} lists no Chromium build", self.browsers_json.display())));
        }
        Ok(required)
    }
}

fn is_complete_browser_dir(dir: &Path) -> bool {
    dir.join(INSTALLATION_COMPLETE_MARKER).is_file()
}

fn installed_status(browsers_dir: &Path, required_dirs: &[String]) -> BrowserRuntimeStatus {
    if required_dirs.iter().all(|name| is_complete_browser_dir(&browsers_dir.join(name))) {
        BrowserRuntimeStatus::Installed
    } else {
        BrowserRuntimeStatus::NotInstalled
    }
}

/// Any fully installed `<browser>-<revision>` folder.
fn has_any_complete_browser(browsers_dir: &Path, browser: &str) -> bool {
    let prefix = format!("{browser}-");
    let Ok(entries) = std::fs::read_dir(browsers_dir) else {
        return false;
    };
    entries
        .flatten()
        .any(|entry| entry.file_name().to_string_lossy().starts_with(&prefix) && is_complete_browser_dir(&entry.path()))
}

/// The plugin folder (up to [`PLUGIN_SEARCH_DEPTH`] levels down) whose Playwright is newest.
fn find_plugin_with_playwright(plugins_dir: &Path) -> Option<PathBuf> {
    let mut found: Vec<(Vec<u64>, PathBuf)> = Vec::new();
    collect_playwright_plugins(plugins_dir, PLUGIN_SEARCH_DEPTH, &mut found);
    found.into_iter().max_by(|left, right| left.0.cmp(&right.0)).map(|(_, dir)| dir)
}

fn collect_playwright_plugins(dir: &Path, depth_left: usize, found: &mut Vec<(Vec<u64>, PathBuf)>) {
    if let Some(version) = playwright_version_in(dir) {
        found.push((version, dir.to_path_buf()));
        return;
    }
    if depth_left == 0 {
        return;
    }
    let Ok(entries) = std::fs::read_dir(dir) else {
        return;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_dir() && entry.file_name() != "node_modules" {
            collect_playwright_plugins(&path, depth_left - 1, found);
        }
    }
}

/// Numeric parts of `node_modules/playwright/package.json`'s version, e.g. `[1, 65, 1]`.
fn playwright_version_in(dir: &Path) -> Option<Vec<u64>> {
    let manifest_path = dir.join("node_modules").join("playwright").join("package.json");
    let manifest: serde_json::Value = serde_json::from_str(&std::fs::read_to_string(manifest_path).ok()?).ok()?;
    let version = manifest.get("version")?.as_str()?;
    Some(version.split(['.', '-']).take(3).map(|part| part.parse().unwrap_or(0)).collect())
}

/// Windows: start console programs (node) without flashing a console window
/// over the app (the release build is a GUI-subsystem program). No-op elsewhere.
fn hide_console_window(command: &mut Command) {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        command.creation_flags(CREATE_NO_WINDOW);
    }
    #[cfg(not(windows))]
    let _ = command;
}

fn read_node_version(node_executable: &Path) -> AppResult<String> {
    let mut command = Command::new(node_executable);
    crate::child_env::apply(&mut command);
    command.arg("--version").stdin(Stdio::null());
    hide_console_window(&mut command);
    let output = command
        .output()
        .map_err(|error| AppError::Internal(format!("cannot run {}: {error}", node_executable.display())))?;
    if !output.status.success() {
        return Err(AppError::Internal(format!("{} --version failed: {}", node_executable.display(), output.status)));
    }
    Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
}

fn canonical_dir(dir: &Path) -> AppResult<PathBuf> {
    std::fs::canonicalize(dir).map_err(|error| {
        AppError::InvalidInput(format!("no installed plugin ships Playwright ({}: {error})", dir.display()))
    })
}

/// `path` resolved (links followed) when it lies inside `root` (already canonical).
fn require_inside(root: &Path, path: &Path, what: &str) -> AppResult<PathBuf> {
    let resolved = std::fs::canonicalize(path)
        .map_err(|error| AppError::InvalidInput(format!("{what} {} cannot be read: {error}", path.display())))?;
    if resolved.starts_with(root) {
        Ok(resolved)
    } else {
        log::warn!("refused to run the browser installer from {} (outside {})", resolved.display(), root.display());
        Err(AppError::InvalidInput(format!(
            "{what} {} is not inside the plugins folder; only installed plugins can install the browser",
            path.display()
        )))
    }
}

/// Variables of the app's own environment the Playwright installer may see:
/// the home folder (Playwright's default cache and Node need it), the temp
/// folder, Windows system folders Node cannot start without, and Playwright's
/// own settings and the proxy settings (download host, proxy) so a user's setup still applies.
const INSTALLER_PASSTHROUGH_ENV: &[&str] = &[
    "HOME",
    "USERPROFILE",
    "TMPDIR",
    "TEMP",
    "TMP",
    "SYSTEMROOT",
    "SystemRoot",
    "WINDIR",
    "LOCALAPPDATA",
    "HTTPS_PROXY",
    "HTTP_PROXY",
    "NO_PROXY",
    "https_proxy",
    "http_proxy",
    "no_proxy",
];
/// Prefix of Playwright's own environment settings.
const PLAYWRIGHT_ENV_PREFIX: &str = "PLAYWRIGHT_";

/// The whole environment of the installer: the allowed variables of `app_env`,
/// then `request_env` (`PATH`, `PLAYWRIGHT_BROWSERS_PATH`), which wins.
/// Nothing else of the app's environment (API keys, tokens) reaches it.
fn installer_env(
    app_env: impl IntoIterator<Item = (OsString, OsString)>,
    request_env: &[(String, String)],
) -> Vec<(OsString, OsString)> {
    let mut env: Vec<(OsString, OsString)> = app_env
        .into_iter()
        .filter(|(key, _)| {
            let key = key.to_string_lossy();
            INSTALLER_PASSTHROUGH_ENV.contains(&key.as_ref()) || key.starts_with(PLAYWRIGHT_ENV_PREFIX)
        })
        .filter(|(key, _)| !request_env.iter().any(|(request_key, _)| OsString::from(request_key) == *key))
        .collect();
    env.extend(request_env.iter().map(|(key, value)| (OsString::from(key), OsString::from(value))));
    env
}

/// `node <playwright cli> install chromium` in the plugin folder, with a cleared
/// environment (see [`installer_env`]).
fn playwright_install_command(
    request: &BrowserInstallRequest,
    app_env: impl IntoIterator<Item = (OsString, OsString)>,
) -> Command {
    let mut command = Command::new(&request.node_executable);
    command
        .arg(&request.playwright_cli)
        .args(["install", "chromium"])
        .current_dir(&request.working_dir)
        .env_clear()
        .envs(installer_env(app_env, &request.env))
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    hide_console_window(&mut command);
    command
}

fn run_playwright_install(request: &BrowserInstallRequest, on_progress: &ProgressCallback) -> AppResult<()> {
    let mut command = playwright_install_command(request, crate::child_env::host_vars());
    let mut child = command
        .spawn()
        .map_err(|error| AppError::Internal(format!("cannot start the Playwright installer: {error}")))?;
    let readers: Vec<_> = [
        child.stdout.take().map(|stream| Box::new(stream) as Box<dyn Read + Send>),
        child.stderr.take().map(|stream| Box::new(stream) as Box<dyn Read + Send>),
    ]
    .into_iter()
    .flatten()
    .map(|stream| {
        let on_progress = on_progress.clone();
        std::thread::spawn(move || forward_lines(stream, &on_progress))
    })
    .collect();
    let status = wait_with_timeout(&mut child, BROWSER_INSTALL_TIMEOUT);
    for reader in readers {
        if reader.join().is_err() {
            log::warn!("a Playwright installer output reader panicked");
        }
    }
    let status = status?;
    if status.success() {
        Ok(())
    } else {
        Err(AppError::Internal(format!("the Playwright browser installer failed ({status})")))
    }
}

fn wait_with_timeout(child: &mut std::process::Child, timeout: Duration) -> AppResult<std::process::ExitStatus> {
    let deadline = Instant::now() + timeout;
    loop {
        match child.try_wait() {
            Ok(Some(status)) => return Ok(status),
            Ok(None) if Instant::now() >= deadline => {
                if let Err(error) = child.kill() {
                    log::warn!("could not stop the Playwright installer: {error}");
                }
                // Reap it so it does not linger as a zombie.
                if let Err(error) = child.wait() {
                    log::warn!("could not reap the Playwright installer: {error}");
                }
                return Err(AppError::Internal(format!(
                    "the browser download did not finish within {} minutes",
                    timeout.as_secs() / 60
                )));
            }
            Ok(None) => std::thread::sleep(Duration::from_millis(200)),
            Err(error) => return Err(AppError::Internal(format!("lost track of the Playwright installer: {error}"))),
        }
    }
}

/// Splits output on `\n` and `\r` (progress bars redraw with `\r`) and forwards non-empty lines.
fn forward_lines(mut stream: Box<dyn Read + Send>, on_progress: &ProgressCallback) {
    let mut buffer = [0_u8; 4096];
    let mut pending_line: Vec<u8> = Vec::new();
    loop {
        let read_count = match stream.read(&mut buffer) {
            Ok(0) => break,
            Ok(count) => count,
            Err(error) if error.kind() == std::io::ErrorKind::Interrupted => continue,
            Err(error) => {
                log::warn!("could not read Playwright installer output: {error}");
                break;
            }
        };
        for &byte in &buffer[..read_count] {
            if byte == b'\n' || byte == b'\r' {
                emit_line(&mut pending_line, on_progress);
            } else {
                pending_line.push(byte);
            }
        }
    }
    emit_line(&mut pending_line, on_progress);
}

fn emit_line(pending_line: &mut Vec<u8>, on_progress: &ProgressCallback) {
    let line = String::from_utf8_lossy(pending_line).trim().to_string();
    pending_line.clear();
    if !line.is_empty() {
        on_progress(line);
    }
}

#[cfg(test)]
mod tests {
    use std::sync::Mutex;

    use super::*;

    fn write_executable(path: &Path) {
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(path, b"#!/bin/sh\n").unwrap();
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o755)).unwrap();
        }
    }

    fn mark_installed(browsers_dir: &Path, name: &str) {
        let dir = browsers_dir.join(name);
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join(INSTALLATION_COMPLETE_MARKER), b"").unwrap();
    }

    /// A plugin folder with `node_modules/playwright` at `version` and Chromium `revision`.
    fn write_playwright_plugin(plugin_dir: &Path, version: &str, revision: &str) {
        let playwright = plugin_dir.join("node_modules/playwright");
        let core = plugin_dir.join("node_modules/playwright-core");
        std::fs::create_dir_all(&playwright).unwrap();
        std::fs::create_dir_all(&core).unwrap();
        std::fs::write(playwright.join("cli.js"), b"").unwrap();
        std::fs::write(playwright.join("package.json"), format!(r#"{{"version":"{version}"}}"#)).unwrap();
        let manifest = format!(
            r#"{{"browsers":[{{"name":"chromium","revision":"{revision}"}},
                {{"name":"chromium-headless-shell","revision":"{revision}"}},
                {{"name":"firefox","revision":"9"}}]}}"#
        );
        std::fs::write(core.join("browsers.json"), manifest).unwrap();
    }

    #[derive(Debug, Default)]
    struct CollectedEvents(Mutex<Vec<NodeRuntimeEvent>>);

    impl NodeRuntimeEventSink for CollectedEvents {
        fn send(&self, event: NodeRuntimeEvent) {
            self.0.lock().unwrap().push(event);
        }
    }

    /// Pretends to download: waits, then marks the browsers complete.
    #[derive(Debug)]
    struct FakeInstaller {
        browsers_dir: PathBuf,
        revision: String,
        runs: AtomicUsize,
        concurrent: AtomicUsize,
        max_concurrent: AtomicUsize,
    }

    impl FakeInstaller {
        fn new(browsers_dir: PathBuf, revision: &str) -> Self {
            Self {
                browsers_dir,
                revision: revision.to_string(),
                runs: AtomicUsize::new(0),
                concurrent: AtomicUsize::new(0),
                max_concurrent: AtomicUsize::new(0),
            }
        }
    }

    impl BrowserInstaller for FakeInstaller {
        fn install(
            &self,
            request: BrowserInstallRequest,
            on_progress: ProgressCallback,
        ) -> BoxFuture<'_, AppResult<()>> {
            Box::pin(async move {
                let now = self.concurrent.fetch_add(1, Ordering::SeqCst) + 1;
                self.max_concurrent.fetch_max(now, Ordering::SeqCst);
                self.runs.fetch_add(1, Ordering::SeqCst);
                assert!(request.env.iter().any(|(key, _)| key == "PLAYWRIGHT_BROWSERS_PATH"));
                on_progress("Downloading Chromium 10%".into());
                tokio::time::sleep(Duration::from_millis(50)).await;
                mark_installed(&self.browsers_dir, &format!("chromium-{}", self.revision));
                mark_installed(&self.browsers_dir, &format!("chromium_headless_shell-{}", self.revision));
                self.concurrent.fetch_sub(1, Ordering::SeqCst);
                Ok(())
            })
        }
    }

    fn bundled_location(dir: &Path) -> NodeLocation {
        let executable = dir.join("bin").join(SYSTEM_NODE_FILE_NAME);
        write_executable(&executable);
        NodeLocation { executable: Some(executable), source: NodeSource::Development }
    }

    #[test]
    fn uses_the_development_copy_then_path_only_when_allowed() {
        let temp = tempfile::tempdir().unwrap();
        let dev_node = temp.path().join("binaries/graphrt-node-test");
        write_executable(&dev_node);
        let location = resolve_fallback_location(Some(&dev_node), false, None);
        assert_eq!(location, NodeLocation { executable: Some(dev_node.clone()), source: NodeSource::Development });

        // An empty placeholder is not a Node.
        std::fs::write(&dev_node, b"").unwrap();
        let system_dir = temp.path().join("usr/local/bin");
        write_executable(&system_dir.join(SYSTEM_NODE_FILE_NAME));
        let system_path = std::env::join_paths([temp.path().join("missing"), system_dir.clone()]).unwrap();
        let debug_location = resolve_fallback_location(Some(&dev_node), true, Some(&system_path));
        assert_eq!(debug_location.source, NodeSource::System);
        assert_eq!(debug_location.executable, Some(system_dir.join(SYSTEM_NODE_FILE_NAME)));

        let release_location = resolve_fallback_location(None, false, Some(&system_path));
        assert_eq!(release_location, NodeLocation::MISSING);
    }

    #[test]
    fn the_development_copy_is_the_fetch_node_output_for_this_target() {
        let path = development_node_path();
        assert!(path.starts_with(Path::new(env!("CARGO_MANIFEST_DIR")).join("binaries")));
        let file_name = path.file_name().unwrap().to_string_lossy().into_owned();
        assert!(file_name.starts_with(&format!("graphrt-node-{}", env!("GRAPHRT_TARGET_TRIPLE"))), "{file_name}");
    }

    #[test]
    fn missing_node_is_a_clear_error_and_plugins_point_at_the_download_location() {
        let temp = tempfile::tempdir().unwrap();
        let runtime =
            NodeRuntime::with_parts(temp.path().to_path_buf(), NodeLocation::MISSING, Arc::new(PlaywrightCliInstaller));
        let message = runtime.node_executable().unwrap_err().to_string();
        assert!(message.contains("plugin runtime (Node.js) is not installed"), "{message}");
        assert_eq!(runtime.node_runtime_status(), PluginRuntimeStatus::NotInstalled);
        let expected = release::installed_executable(&temp.path().join(release::RUNTIME_DIR_NAME));
        assert_eq!(runtime.node_command_path(), expected);
        let env = runtime.plugin_process_env();
        let path_value = &env.iter().find(|(key, _)| key == "PATH").unwrap().1;
        assert_eq!(std::env::split_paths(path_value).next().as_deref(), expected.parent());
    }

    #[test]
    fn a_downloaded_runtime_wins_over_the_fallback() {
        let temp = tempfile::tempdir().unwrap();
        let runtime = NodeRuntime::with_parts(
            temp.path().to_path_buf(),
            bundled_location(temp.path()),
            Arc::new(PlaywrightCliInstaller),
        );
        assert_eq!(runtime.node_location().source, NodeSource::Development);
        let downloaded = release::installed_executable(&temp.path().join(release::RUNTIME_DIR_NAME));
        write_executable(&downloaded);
        assert_eq!(
            runtime.node_location(),
            NodeLocation { executable: Some(downloaded), source: NodeSource::Downloaded }
        );
        assert_eq!(runtime.node_runtime_status(), PluginRuntimeStatus::Installed);
    }

    /// Serves one fixture for the pinned URL; counts requests; can pretend to be offline.
    #[derive(Debug)]
    struct FixtureDownloader {
        body: Vec<u8>,
        offline: bool,
        requests: Mutex<Vec<String>>,
    }

    impl Downloader for FixtureDownloader {
        fn fetch(
            &self,
            url: &str,
            max_bytes: u64,
            _timeout: Duration,
            progress: Option<DownloadProgressCallback>,
        ) -> BoxFuture<'_, AppResult<Vec<u8>>> {
            self.requests.lock().unwrap().push(url.to_owned());
            assert_eq!(max_bytes, release::MAX_ARCHIVE_BYTES);
            let body = self.body.clone();
            let offline = self.offline;
            Box::pin(async move {
                if offline {
                    return Err(AppError::Internal("download failed: error sending request: dns error".into()));
                }
                if let Some(progress) = progress {
                    let total = body.len() as u64;
                    progress(total / 2, Some(total));
                    progress(total, Some(total));
                }
                Ok(body)
            })
        }
    }

    /// A `.tar.xz` laid out like Node's darwin-arm64 archive whose `bin/node` is a shell
    /// script printing the pinned version, and a pinned archive entry with its checksum.
    fn fixture_node_archive() -> (Vec<u8>, NodeArchive) {
        let member = format!("node-v{NODE_VERSION}-darwin-arm64/bin/node");
        let script = format!("#!/bin/sh\necho v{NODE_VERSION}\n");
        let mut header = tar::Header::new_gnu();
        header.set_size(script.len() as u64);
        header.set_mode(0o755);
        let mut builder = tar::Builder::new(Vec::new());
        builder.append_data(&mut header, &member, script.as_bytes()).unwrap();
        let tar_bytes = builder.into_inner().unwrap();
        let mut compressed = Vec::new();
        let mut writer = lzma_rust2::XzWriter::new(&mut compressed, lzma_rust2::XzOptions::default()).unwrap();
        std::io::Write::write_all(&mut writer, &tar_bytes).unwrap();
        writer.finish().unwrap();
        let pinned = release::archive_for("darwin-arm64").unwrap();
        let sha256: &'static str = Box::leak(crate::plugins::archive::sha256_hex(&compressed).into_boxed_str());
        (compressed, NodeArchive { sha256, ..*pinned })
    }

    fn runtime_with_fixture(
        data_dir: &Path,
        offline: bool,
        check: Arc<ExecutableCheck>,
    ) -> (NodeRuntime, Arc<FixtureDownloader>, Arc<CollectedEvents>) {
        let (body, archive) = fixture_node_archive();
        let downloader = Arc::new(FixtureDownloader { body, offline, requests: Mutex::new(Vec::new()) });
        let events = Arc::new(CollectedEvents::default());
        let runtime =
            NodeRuntime::with_parts(data_dir.to_path_buf(), NodeLocation::MISSING, Arc::new(PlaywrightCliInstaller))
                .with_downloader(downloader.clone())
                .with_event_sink(events.clone())
                .with_node_archive(Some(archive), check);
        (runtime, downloader, events)
    }

    #[tokio::test]
    async fn installs_the_runtime_from_the_pinned_url_then_removes_it() {
        let temp = tempfile::tempdir().unwrap();
        // On Unix the fixture's `node` is a real shell script, so the real check runs it.
        let check: Arc<ExecutableCheck> =
            if cfg!(unix) { Arc::new(check_node_runs) } else { Arc::new(|_: &Path| Ok(())) };
        let (runtime, downloader, events) = runtime_with_fixture(temp.path(), false, check);

        let first = runtime.clone();
        let first_install = tokio::spawn(async move { first.install_node_runtime().await });
        let second = runtime.clone();
        let second_install = tokio::spawn(async move { second.install_node_runtime().await });
        first_install.await.unwrap().unwrap();
        second_install.await.unwrap().unwrap();

        let requests = downloader.requests.lock().unwrap().clone();
        assert_eq!(requests.len(), 1, "concurrent installs download once");
        assert_eq!(
            requests[0],
            format!("https://nodejs.org/dist/v{NODE_VERSION}/node-v{NODE_VERSION}-darwin-arm64.tar.xz")
        );
        let location = runtime.node_location();
        assert_eq!(location.source, NodeSource::Downloaded);
        assert_eq!(runtime.node_runtime_status(), PluginRuntimeStatus::Installed);
        let info = runtime.info().await;
        assert!(info.removable && info.downloadable);
        assert_eq!(info.pinned_version, NODE_VERSION);
        if cfg!(unix) {
            assert_eq!(info.version, Some(format!("v{NODE_VERSION}")));
        }

        let sent = events.0.lock().unwrap().clone();
        assert!(sent.contains(&NodeRuntimeEvent::NodeInstallStarted { version: NODE_VERSION.to_owned() }));
        assert!(sent.iter().any(|event| matches!(event, NodeRuntimeEvent::NodeInstallProgress { percent: Some(percent), .. } if *percent == 100.0)));
        assert!(sent.contains(&NodeRuntimeEvent::NodeInstallFinished { already_installed: false }));
        assert!(sent.contains(&NodeRuntimeEvent::NodeInstallFinished { already_installed: true }));

        assert!(runtime.remove_node_runtime().await.unwrap());
        assert_eq!(runtime.node_runtime_status(), PluginRuntimeStatus::NotInstalled);
        assert!(!runtime.info().await.removable);
    }

    #[tokio::test]
    async fn offline_installs_fail_clearly_and_leave_nothing() {
        let temp = tempfile::tempdir().unwrap();
        let (runtime, _, events) = runtime_with_fixture(temp.path(), true, Arc::new(|_: &Path| Ok(())));
        let error = runtime.install_node_runtime().await.unwrap_err();
        assert!(error.to_string().contains("check the internet connection"), "{error}");
        assert_eq!(runtime.node_runtime_status(), PluginRuntimeStatus::NotInstalled);
        assert!(events
            .0
            .lock()
            .unwrap()
            .iter()
            .any(|event| matches!(event, NodeRuntimeEvent::NodeInstallFailed { .. })));
    }

    #[tokio::test]
    async fn a_binary_that_does_not_run_is_not_installed() {
        let temp = tempfile::tempdir().unwrap();
        let check: Arc<ExecutableCheck> = Arc::new(|_: &Path| Err(AppError::InvalidInput("bad CPU type".into())));
        let (runtime, _, _) = runtime_with_fixture(temp.path(), false, check);
        assert!(runtime.install_node_runtime().await.is_err());
        assert!(!release::install_dir(&temp.path().join(release::RUNTIME_DIR_NAME)).exists());
    }

    #[tokio::test]
    async fn unsupported_computers_and_missing_clients_are_refused() {
        let temp = tempfile::tempdir().unwrap();
        let (runtime, downloader, _) = runtime_with_fixture(temp.path(), false, Arc::new(|_: &Path| Ok(())));
        let unsupported = runtime.clone().with_node_archive(None, Arc::new(|_: &Path| Ok(())));
        let error = unsupported.install_node_runtime().await.unwrap_err();
        assert!(error.to_string().contains("not available for this computer"), "{error}");
        assert!(!unsupported.info().await.downloadable);
        assert!(downloader.requests.lock().unwrap().is_empty());

        let no_client =
            NodeRuntime::with_parts(temp.path().to_path_buf(), NodeLocation::MISSING, Arc::new(PlaywrightCliInstaller));
        if no_client.node_archive.is_some() {
            assert!(no_client.install_node_runtime().await.is_err());
        }
    }

    #[tokio::test]
    async fn the_browser_install_needs_the_plugin_runtime() {
        let temp = tempfile::tempdir().unwrap();
        let plugin_dir = temp.path().join(PLUGINS_DIR_NAME).join("google-maps-scraper");
        write_playwright_plugin(&plugin_dir, "1.65.1", "1255");
        let installer = Arc::new(FakeInstaller::new(temp.path().join(BROWSERS_DIR_NAME), "1255"));
        let runtime = NodeRuntime::with_parts(temp.path().to_path_buf(), NodeLocation::MISSING, installer.clone());
        let error = runtime.install_browser_runtime_for(&plugin_dir).await.unwrap_err();
        assert!(error.to_string().contains("plugin runtime"), "{error}");
        assert_eq!(installer.runs.load(Ordering::SeqCst), 0);
    }

    #[test]
    fn node_events_serialize_for_the_frontend() {
        let event = NodeRuntimeEvent::NodeInstallProgress {
            message: "Downloading Node.js".into(),
            percent: Some(40.0),
            received_bytes: Some(4),
            total_bytes: Some(10),
        };
        assert_eq!(
            serde_json::to_value(event).unwrap(),
            serde_json::json!({
                "type": "node_install_progress",
                "message": "Downloading Node.js",
                "percent": 40.0,
                "receivedBytes": 4,
                "totalBytes": 10,
            })
        );
    }

    /// The real archive from nodejs.org (network, ~26-36 MB), installed and run. Run with
    /// `cargo test real_node_download -- --ignored`.
    #[tokio::test]
    #[ignore = "downloads Node.js from nodejs.org"]
    async fn real_node_download_installs_a_working_node() {
        let temp = tempfile::tempdir().unwrap();
        let downloader = Arc::new(crate::plugins::download::HttpsDownloader::new().unwrap());
        let runtime =
            NodeRuntime::with_parts(temp.path().to_path_buf(), NodeLocation::MISSING, Arc::new(PlaywrightCliInstaller))
                .with_downloader(downloader);
        runtime.install_node_runtime().await.unwrap();
        assert_eq!(runtime.info().await.version, Some(format!("v{NODE_VERSION}")));
        if let Ok(target) = std::env::var("GRAPHRT_TEST_KEEP_NODE_AT") {
            let target = PathBuf::from(target);
            std::fs::create_dir_all(target.parent().unwrap()).unwrap();
            std::fs::copy(runtime.node_executable().unwrap(), target).unwrap();
        }
    }

    #[test]
    fn plugin_env_puts_node_first_and_points_playwright_at_the_cache() {
        let node_dir = PathBuf::from("/Applications/graphrt.app/Contents/MacOS");
        let system_path = std::env::join_paths(["/usr/bin", "/bin"]).unwrap();
        let env = compose_plugin_env(Some(&node_dir), Some(system_path), Path::new("/data/browsers"));
        let path_value = &env.iter().find(|(key, _)| key == "PATH").unwrap().1;
        let entries: Vec<PathBuf> = std::env::split_paths(path_value).collect();
        assert_eq!(entries, vec![node_dir, PathBuf::from("/usr/bin"), PathBuf::from("/bin")]);
        assert!(
            env.contains(&("PLAYWRIGHT_BROWSERS_PATH".into(), PathBuf::from("/data/browsers").display().to_string()))
        );
    }

    #[test]
    fn playwright_cache_matches_what_a_clean_env_plugin_resolves() {
        let home = Path::new("/home/someone");
        assert_eq!(playwright_default_cache_dir("macos", Some(home)), Some(home.join("Library/Caches/ms-playwright")));
        assert_eq!(playwright_default_cache_dir("linux", Some(home)), Some(home.join(".cache/ms-playwright")));
        assert_eq!(
            playwright_default_cache_dir("windows", Some(home)),
            Some(home.join("AppData").join("Local").join("ms-playwright"))
        );
        assert_eq!(playwright_default_cache_dir("linux", None), None);
        assert_eq!(playwright_default_cache_dir("linux", Some(Path::new(""))), None);
    }

    #[test]
    fn runtime_new_uses_the_default_playwright_cache() {
        let temp = tempfile::tempdir().unwrap();
        let runtime = NodeRuntime::new(temp.path().to_path_buf());
        if let Some(home) = std::env::var_os(if cfg!(windows) { "USERPROFILE" } else { "HOME" }) {
            assert!(runtime.browsers_dir().starts_with(PathBuf::from(home)));
            assert!(runtime.browsers_dir().ends_with(PLAYWRIGHT_CACHE_DIR_NAME));
        }
    }

    #[test]
    fn plugin_env_keeps_the_system_path_without_node() {
        let env = compose_plugin_env(None, Some(OsString::from("/usr/bin")), Path::new("/b"));
        assert_eq!(env[0], ("PATH".to_string(), "/usr/bin".to_string()));
    }

    #[test]
    fn runtime_env_uses_the_app_data_browsers_dir() {
        let temp = tempfile::tempdir().unwrap();
        let location = bundled_location(temp.path());
        let runtime = NodeRuntime::with_parts(temp.path().to_path_buf(), location, Arc::new(PlaywrightCliInstaller));
        let env = runtime.plugin_process_env();
        let browsers = &env.iter().find(|(key, _)| key == "PLAYWRIGHT_BROWSERS_PATH").unwrap().1;
        assert_eq!(PathBuf::from(browsers), temp.path().join(BROWSERS_DIR_NAME));
        let path_value = &env.iter().find(|(key, _)| key == "PATH").unwrap().1;
        assert_eq!(std::env::split_paths(path_value).next(), Some(temp.path().join("bin")));
    }

    #[test]
    fn detects_browser_status_from_a_fake_browsers_dir() {
        let temp = tempfile::tempdir().unwrap();
        let plugin_dir = temp.path().join("plugins/google-maps-scraper");
        write_playwright_plugin(&plugin_dir, "1.65.1", "1255");
        let runtime = NodeRuntime::with_parts(
            temp.path().to_path_buf(),
            bundled_location(temp.path()),
            Arc::new(PlaywrightCliInstaller),
        );
        let browsers_dir = temp.path().join(BROWSERS_DIR_NAME);
        assert_eq!(runtime.browser_runtime_status(), BrowserRuntimeStatus::NotInstalled);

        // Half-extracted download: folder without the completion marker.
        std::fs::create_dir_all(browsers_dir.join("chromium-1255")).unwrap();
        assert_eq!(runtime.browser_runtime_status(), BrowserRuntimeStatus::NotInstalled);

        mark_installed(&browsers_dir, "chromium-1255");
        assert_eq!(runtime.browser_runtime_status(), BrowserRuntimeStatus::Installed);
        // The plugin also needs the headless shell of the same revision.
        assert_eq!(runtime.browser_runtime_status_for(&plugin_dir).unwrap(), BrowserRuntimeStatus::NotInstalled);
        mark_installed(&browsers_dir, "chromium_headless_shell-1255");
        assert_eq!(runtime.browser_runtime_status_for(&plugin_dir).unwrap(), BrowserRuntimeStatus::Installed);

        // A plugin on a newer Playwright needs a newer build.
        let newer_plugin = temp.path().join("plugins/whatsapp-web");
        write_playwright_plugin(&newer_plugin, "1.66.0", "1260");
        assert_eq!(runtime.browser_runtime_status_for(&newer_plugin).unwrap(), BrowserRuntimeStatus::NotInstalled);
    }

    #[test]
    fn a_plugin_without_playwright_is_rejected() {
        let temp = tempfile::tempdir().unwrap();
        let runtime = NodeRuntime::with_parts(
            temp.path().to_path_buf(),
            bundled_location(temp.path()),
            Arc::new(PlaywrightCliInstaller),
        );
        let error = runtime.browser_runtime_status_for(&temp.path().join("plain-plugin")).unwrap_err();
        assert_eq!(error.code(), "invalid_input");
    }

    #[test]
    fn picks_the_plugin_with_the_newest_playwright() {
        let temp = tempfile::tempdir().unwrap();
        write_playwright_plugin(&temp.path().join("a/0.1.0"), "1.49.0", "1148");
        write_playwright_plugin(&temp.path().join("b"), "1.65.1", "1255");
        std::fs::create_dir_all(temp.path().join("c")).unwrap();
        assert_eq!(find_plugin_with_playwright(temp.path()), Some(temp.path().join("b")));
        assert_eq!(find_plugin_with_playwright(&temp.path().join("c")), None);
    }

    #[test]
    fn forwards_lines_split_on_newlines_and_carriage_returns() {
        let lines = Arc::new(Mutex::new(Vec::new()));
        let collected = lines.clone();
        let on_progress: ProgressCallback = Arc::new(move |line| collected.lock().unwrap().push(line));
        forward_lines(Box::new(&b"Downloading\r 10%\r 20%\n\ndone"[..]), &on_progress);
        assert_eq!(*lines.lock().unwrap(), vec!["Downloading", "10%", "20%", "done"]);
    }

    #[tokio::test]
    async fn concurrent_installs_run_once_and_report_installing() {
        let temp = tempfile::tempdir().unwrap();
        let plugin_dir = temp.path().join("plugins/google-maps-scraper");
        write_playwright_plugin(&plugin_dir, "1.65.1", "1255");
        let browsers_dir = temp.path().join(BROWSERS_DIR_NAME);
        let installer = Arc::new(FakeInstaller::new(browsers_dir, "1255"));
        let events = Arc::new(CollectedEvents::default());
        let runtime =
            NodeRuntime::with_parts(temp.path().to_path_buf(), bundled_location(temp.path()), installer.clone())
                .with_event_sink(events.clone());

        let first = runtime.clone();
        let first_dir = plugin_dir.clone();
        let first_install = tokio::spawn(async move { first.install_browser_runtime_for(&first_dir).await });
        let second = runtime.clone();
        let second_install = tokio::spawn(async move { second.install_browser_runtime().await });
        tokio::time::sleep(Duration::from_millis(10)).await;
        assert_eq!(runtime.browser_runtime_status(), BrowserRuntimeStatus::Installing);

        first_install.await.unwrap().unwrap();
        second_install.await.unwrap().unwrap();
        assert_eq!(installer.runs.load(Ordering::SeqCst), 1);
        assert_eq!(installer.max_concurrent.load(Ordering::SeqCst), 1);
        assert_eq!(runtime.browser_runtime_status(), BrowserRuntimeStatus::Installed);
        assert_eq!(runtime.browser_runtime_status_for(&plugin_dir).unwrap(), BrowserRuntimeStatus::Installed);

        let sent_events = events.0.lock().unwrap().clone();
        assert!(
            sent_events.contains(&NodeRuntimeEvent::BrowserInstallProgress { line: "Downloading Chromium 10%".into() })
        );
        assert!(sent_events.contains(&NodeRuntimeEvent::BrowserInstallFinished { already_installed: false }));
        assert!(sent_events.contains(&NodeRuntimeEvent::BrowserInstallFinished { already_installed: true }));

        // Asking again later is a no-op.
        runtime.install_browser_runtime_for(&plugin_dir).await.unwrap();
        assert_eq!(installer.runs.load(Ordering::SeqCst), 1);
    }

    #[tokio::test]
    async fn install_without_a_playwright_plugin_fails_clearly() {
        let temp = tempfile::tempdir().unwrap();
        let installer = Arc::new(FakeInstaller::new(temp.path().join(BROWSERS_DIR_NAME), "1"));
        let runtime = NodeRuntime::with_parts(temp.path().to_path_buf(), bundled_location(temp.path()), installer);
        let error = runtime.install_browser_runtime().await.unwrap_err();
        assert_eq!(error.code(), "invalid_input");
        assert_eq!(runtime.browser_runtime_status(), BrowserRuntimeStatus::NotInstalled);
    }

    #[test]
    fn events_serialize_with_a_type_tag() {
        let event = NodeRuntimeEvent::BrowserInstallStarted { plugin_dir: "/p".into() };
        assert_eq!(
            serde_json::to_value(event).unwrap(),
            serde_json::json!({ "type": "browser_install_started", "pluginDir": "/p" })
        );
    }
    #[tokio::test]
    async fn a_plugin_folder_outside_the_plugins_folder_is_refused() {
        let temp = tempfile::tempdir().unwrap();
        let outside = temp.path().join("elsewhere/evil");
        write_playwright_plugin(&outside, "1.65.1", "1255");
        let installer = Arc::new(FakeInstaller::new(temp.path().join(BROWSERS_DIR_NAME), "1255"));
        std::fs::create_dir_all(temp.path().join(PLUGINS_DIR_NAME)).unwrap();
        let runtime =
            NodeRuntime::with_parts(temp.path().to_path_buf(), bundled_location(temp.path()), installer.clone());

        let error = runtime.install_browser_runtime_for(&outside).await.unwrap_err();
        assert_eq!(error.code(), "invalid_input");
        assert!(error.to_string().contains("not inside the plugins folder"), "{error}");
        let sneaky = temp.path().join(PLUGINS_DIR_NAME).join("../elsewhere/evil");
        assert_eq!(runtime.install_browser_runtime_for(&sneaky).await.unwrap_err().code(), "invalid_input");
        #[cfg(unix)]
        {
            let linked = temp.path().join(PLUGINS_DIR_NAME).join("linked");
            std::os::unix::fs::symlink(&outside, &linked).unwrap();
            assert_eq!(runtime.install_browser_runtime_for(&linked).await.unwrap_err().code(), "invalid_input");
        }
        assert_eq!(installer.runs.load(Ordering::SeqCst), 0, "the installer never ran");
    }

    #[test]
    fn the_installer_sees_only_path_home_temp_proxy_and_playwright_settings() {
        let app_env = [
            ("HOME", "/Users/me"),
            ("PATH", "/usr/bin"),
            ("OPENAI_API_KEY", "sk-live"),
            ("GH_TOKEN", "ghp_x"),
            ("PLAYWRIGHT_DOWNLOAD_HOST", "https://mirror.test"),
            ("PLAYWRIGHT_BROWSERS_PATH", "/somewhere/else"),
            ("HTTPS_PROXY", "http://proxy.test:3128"),
        ]
        .map(|(key, value)| (OsString::from(key), OsString::from(value)));
        let request_env = vec![
            ("PATH".to_owned(), "/node/bin:/usr/bin".to_owned()),
            ("PLAYWRIGHT_BROWSERS_PATH".to_owned(), "/b".to_owned()),
        ];

        let env: Vec<(String, String)> = installer_env(app_env, &request_env)
            .into_iter()
            .map(|(key, value)| (key.to_string_lossy().into_owned(), value.to_string_lossy().into_owned()))
            .collect();

        let pairs: Vec<(&str, &str)> = env.iter().map(|(key, value)| (key.as_str(), value.as_str())).collect();
        assert_eq!(
            pairs,
            [
                ("HOME", "/Users/me"),
                ("PLAYWRIGHT_DOWNLOAD_HOST", "https://mirror.test"),
                ("HTTPS_PROXY", "http://proxy.test:3128"),
                ("PATH", "/node/bin:/usr/bin"),
                ("PLAYWRIGHT_BROWSERS_PATH", "/b"),
            ]
        );
    }

    #[test]
    fn the_install_command_runs_the_plugins_cli_in_its_folder() {
        let request = BrowserInstallRequest {
            node_executable: PathBuf::from("/app/graphrt-node"),
            playwright_cli: PathBuf::from("/data/plugins/p/node_modules/playwright/cli.js"),
            working_dir: PathBuf::from("/data/plugins/p"),
            env: vec![("PATH".to_owned(), "/app".to_owned())],
        };
        let command = playwright_install_command(&request, [(OsString::from("AWS_SECRET_ACCESS_KEY"), "x".into())]);
        assert_eq!(command.get_program(), "/app/graphrt-node");
        let args: Vec<&OsStr> = command.get_args().collect();
        assert_eq!(args, ["/data/plugins/p/node_modules/playwright/cli.js", "install", "chromium"]);
        assert_eq!(command.get_current_dir(), Some(Path::new("/data/plugins/p")));
        let envs: Vec<(&OsStr, Option<&OsStr>)> = command.get_envs().collect();
        assert_eq!(envs, [(OsStr::new("PATH"), Some(OsStr::new("/app")))]);
    }

    /// The cleared environment for real: `sh` stands in for Node and prints what it sees.
    #[cfg(unix)]
    #[test]
    fn the_installer_process_does_not_inherit_the_apps_environment() {
        let temp = tempfile::tempdir().unwrap();
        let script = temp.path().join("cli.js");
        std::fs::write(&script, "env\n").unwrap();
        let request = BrowserInstallRequest {
            node_executable: PathBuf::from("/bin/sh"),
            playwright_cli: script,
            working_dir: temp.path().to_path_buf(),
            env: vec![("PATH".to_owned(), "/usr/bin:/bin".to_owned())],
        };
        let app_env = [("GRAPHRT_TEST_LEAK", "leaked"), ("HOME", "/Users/me")]
            .map(|(key, value)| (OsString::from(key), OsString::from(value)));
        let output = playwright_install_command(&request, app_env).output().unwrap();
        let seen = String::from_utf8_lossy(&output.stdout);
        assert!(seen.contains("HOME=/Users/me") && seen.contains("PATH=/usr/bin:/bin"), "{seen}");
        assert!(!seen.contains("GRAPHRT_TEST_LEAK"), "{seen}");
        assert!(!seen.contains("CARGO"), "the test runner's own variables must not reach it: {seen}");
    }

    /// Real download with Playwright's CLI (network, ~250 MB). Run with
    /// `GRAPHRT_TEST_NODE=<node> GRAPHRT_TEST_PLAYWRIGHT_PLUGIN=<plugin dir>
    /// GRAPHRT_TEST_DATA_DIR=<dir> cargo test real_playwright -- --ignored`.
    #[tokio::test]
    #[ignore = "downloads Chromium"]
    async fn real_playwright_install_downloads_chromium() {
        let node = PathBuf::from(std::env::var("GRAPHRT_TEST_NODE").unwrap());
        let plugin_dir = PathBuf::from(std::env::var("GRAPHRT_TEST_PLAYWRIGHT_PLUGIN").unwrap());
        let data_dir = PathBuf::from(std::env::var("GRAPHRT_TEST_DATA_DIR").unwrap());
        let events = Arc::new(CollectedEvents::default());
        let runtime = NodeRuntime::with_parts(
            data_dir,
            NodeLocation { executable: Some(node), source: NodeSource::Development },
            Arc::new(PlaywrightCliInstaller),
        )
        .with_plugins_dir(plugin_dir.parent().unwrap().to_path_buf())
        .with_event_sink(events.clone());
        runtime.install_browser_runtime_for(&plugin_dir).await.unwrap();
        assert_eq!(runtime.browser_runtime_status_for(&plugin_dir).unwrap(), BrowserRuntimeStatus::Installed);
        let progress_lines = events
            .0
            .lock()
            .unwrap()
            .iter()
            .filter(|event| matches!(event, NodeRuntimeEvent::BrowserInstallProgress { .. }))
            .count();
        println!("{progress_lines} progress lines");
    }
}
