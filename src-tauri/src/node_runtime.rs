//! The Node.js runtime graphrt plugins run on.
//!
//! graphrt's process plugins declare `"command": "node"`. The desktop app ships
//! its own Node as a Tauri sidecar (`binaries/graphrt-node-<target-triple>`, fetched and
//! checksum-verified at build time by `scripts/fetch-node.sh`), so users never
//! install Node themselves. Plugins that drive a browser (Playwright:
//! `google-maps-scraper`, `whatsapp-web`) get Chromium downloaded on demand.
//!
//! Browsers go into Playwright's *default* cache (`~/Library/Caches/ms-playwright`,
//! `%USERPROFILE%\AppData\Local\ms-playwright`, `~/.cache/ms-playwright`), not
//! the app data folder: graphrt starts plugins with a cleared environment
//! (only `PATH`, `HOME`, `USERPROFILE`, ... pass through), so a plugin's
//! Playwright resolves exactly that folder unless the host also injects
//! `PLAYWRIGHT_BROWSERS_PATH`. [`NodeRuntime::plugin_process_env`] still
//! returns `PLAYWRIGHT_BROWSERS_PATH` (same folder), so both cases agree.
//!
//! Where the sidecar lives at run time (Tauri copies it next to the main
//! executable and strips the target triple):
//!
//! - macOS app: `graphrt.app/Contents/MacOS/graphrt-node`
//! - Windows: `graphrt-node.exe` next to `graphrt.exe`
//! - Linux deb / AppImage: `usr/bin/graphrt-node` next to `usr/bin/graphrt`
//! - `tauri dev` / `cargo run`: `target/<profile>/graphrt-node` (copied by tauri-build)
//!
//! Debug builds fall back to a `node` on PATH (logged); release builds never do.
//!
//! CONTRACT: the plugin host calls [`NodeRuntime::plugin_process_env`] for every
//! plugin process and [`NodeRuntime::browser_runtime_status_for`] /
//! [`NodeRuntime::install_browser_runtime_for`] for plugins that need a browser.
//!
//! How that env reaches a plugin: graphrt-plugin (rev 32bcd7a) spawns
//! `runtime.command` after `env_clear()`, copies `PATH`, `HOME`, ... from the
//! *app's* environment, then applies `ProcessRuntime::env`. A macOS app started
//! from Finder has `PATH=/usr/bin:/bin:/usr/sbin:/sbin`, so a bare `node` is not
//! found unless the host edits the parsed manifest before `PluginHost::add`:
//! set `command` to [`NodeRuntime::node_executable`] (absolute, so no PATH
//! lookup is involved) when it is `"node"`, and merge
//! [`NodeRuntime::plugin_process_env`] into `ProcessRuntime::env` (so `node`
//! spawned by the plugin itself, and `PLAYWRIGHT_BROWSERS_PATH`, work too).
//! `PluginHost::add` does not re-validate the manifest, so this is allowed.

use std::ffi::{OsStr, OsString};
use std::io::Read;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};

use futures::future::BoxFuture;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter};

use crate::error::{AppError, AppResult};

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
/// How deep under the plugins folder a plugin's `node_modules` may sit.
const PLUGIN_SEARCH_DEPTH: usize = 3;
/// Playwright writes this file into a browser folder once it is fully extracted.
const INSTALLATION_COMPLETE_MARKER: &str = "INSTALLATION_COMPLETE";

/// The bundled sidecar is `graphrt-node`, not `node`: Linux packages install it
/// into `/usr/bin`, where `node` would clash with the distribution's nodejs.
#[cfg(windows)]
const SIDECAR_FILE_NAME: &str = "graphrt-node.exe";
#[cfg(not(windows))]
const SIDECAR_FILE_NAME: &str = "graphrt-node";
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

/// Where the `node` executable came from.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum NodeSource {
    /// The sidecar shipped with the app.
    Bundled,
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

/// What the settings screen shows about the runtime (`node_runtime_info`).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NodeRuntimeInfo {
    /// `node --version` output such as `v22.23.5`; `None` when Node is missing or fails to run.
    pub version: Option<String>,
    pub path: Option<String>,
    pub source: NodeSource,
    pub browser_status: BrowserRuntimeStatus,
    pub browsers_path: String,
}

/// Browser install progress. Serialized as
/// `{ "type": "browser_install_progress", "line": "..." }`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
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
#[derive(Debug, Clone)]
pub struct NodeRuntime {
    node_location: NodeLocation,
    browsers_dir: PathBuf,
    plugins_dir: PathBuf,
    installer: Arc<dyn BrowserInstaller>,
    events: Arc<dyn NodeRuntimeEventSink>,
    install_guard: Arc<InstallGuard>,
}

/// Serializes browser installs and counts the ones requested or running.
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
    /// Resolves the bundled Node next to the app executable and the browser
    /// cache: Playwright's default cache (see the module docs), or
    /// `app_data_dir/browsers` when the home folder is unknown.
    pub fn new(app_data_dir: PathBuf) -> Self {
        let node_location = match std::env::current_exe() {
            Ok(executable) => {
                let executable_dir = executable.parent().map(Path::to_path_buf).unwrap_or_default();
                let system_path = std::env::var_os("PATH");
                resolve_node_location(&executable_dir, cfg!(debug_assertions), system_path.as_deref())
            }
            Err(error) => {
                log::error!("cannot locate the app executable to find the bundled Node: {error}");
                NodeLocation { executable: None, source: NodeSource::Missing }
            }
        };
        log_node_location(&node_location);
        let runtime = Self::with_parts(app_data_dir, node_location, Arc::new(PlaywrightCliInstaller));
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

    /// Builds a runtime from an already resolved Node and a browser installer
    /// (tests and callers that want a fake installer).
    pub fn with_parts(
        app_data_dir: PathBuf,
        node_location: NodeLocation,
        installer: Arc<dyn BrowserInstaller>,
    ) -> Self {
        Self {
            node_location,
            browsers_dir: app_data_dir.join(BROWSERS_DIR_NAME),
            plugins_dir: app_data_dir.join(PLUGINS_DIR_NAME),
            installer,
            events: Arc::new(LogNodeRuntimeEvents),
            install_guard: Arc::new(InstallGuard::default()),
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

    /// Absolute path of the bundled `node` executable.
    pub fn node_executable(&self) -> AppResult<PathBuf> {
        self.node_location.executable.clone().ok_or_else(|| {
            AppError::Internal(
                "the bundled Node.js runtime is missing from the app; reinstall graphrt \
                 (developers: run scripts/fetch-node.sh)"
                    .into(),
            )
        })
    }

    pub fn node_location(&self) -> &NodeLocation {
        &self.node_location
    }

    /// Folder Playwright keeps its browsers in (`PLAYWRIGHT_BROWSERS_PATH`).
    pub fn browsers_dir(&self) -> &Path {
        &self.browsers_dir
    }

    /// Extra environment for a plugin process: `PATH` starting with the bundled
    /// Node's folder (so `"command": "node"` finds it) and
    /// `PLAYWRIGHT_BROWSERS_PATH` pointing at the app's browser cache.
    pub fn plugin_process_env(&self) -> Vec<(String, String)> {
        let node_dir = self.node_location.executable.as_deref().and_then(Path::parent);
        compose_plugin_env(node_dir, std::env::var_os("PATH"), &self.browsers_dir)
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
    /// that Playwright's CLI and the bundled Node. Concurrent calls run one after
    /// another; a call that finds the browser installed returns at once.
    /// Progress goes to the Tauri event `node-runtime-event`.
    pub async fn install_browser_runtime_for(&self, plugin_dir: &Path) -> AppResult<()> {
        let _pending = PendingInstall::begin(&self.install_guard.pending_installs);
        let _exclusive = self.install_guard.lock.lock().await;
        let playwright = PlaywrightPackage::locate(plugin_dir)?;
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

    /// Version, path and browser status for the settings screen.
    pub async fn info(&self) -> NodeRuntimeInfo {
        let version = match self.node_location.executable.clone() {
            Some(executable) => tokio::task::spawn_blocking(move || read_node_version(&executable))
                .await
                .unwrap_or_else(|error| Err(AppError::Internal(error.to_string())))
                .map_err(|error| log::warn!("could not read the Node version: {error}"))
                .ok(),
            None => None,
        };
        NodeRuntimeInfo {
            version,
            path: self.node_location.executable.as_ref().map(|path| path.display().to_string()),
            source: self.node_location.source,
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

fn log_node_location(location: &NodeLocation) {
    match (location.source, &location.executable) {
        (NodeSource::Bundled, Some(path)) => log::info!("using the bundled Node at {}", path.display()),
        (NodeSource::System, Some(path)) => {
            log::warn!("bundled Node not found; using {} from PATH (debug build only)", path.display())
        }
        _ => log::error!("no Node.js runtime found: plugins will not start (run scripts/fetch-node.sh)"),
    }
}

/// Finds the sidecar next to the executable; with `allow_system_fallback`
/// (debug builds) falls back to the first `node` on `system_path`.
pub fn resolve_node_location(
    executable_dir: &Path,
    allow_system_fallback: bool,
    system_path: Option<&OsStr>,
) -> NodeLocation {
    if let Some(sidecar) = sidecar_candidates(executable_dir).into_iter().find(|path| is_usable_executable(path)) {
        return NodeLocation { executable: Some(sidecar), source: NodeSource::Bundled };
    }
    let from_path = if allow_system_fallback { system_path.and_then(find_node_on_path) } else { None };
    match from_path {
        Some(executable) => NodeLocation { executable: Some(executable), source: NodeSource::System },
        None => NodeLocation { executable: None, source: NodeSource::Missing },
    }
}

/// `<exe dir>/graphrt-node` covers bundles and `target/<profile>`; test binaries run
/// from `target/<profile>/deps`, so its parent is tried too.
fn sidecar_candidates(executable_dir: &Path) -> Vec<PathBuf> {
    let mut candidates = vec![executable_dir.join(SIDECAR_FILE_NAME)];
    if executable_dir.file_name() == Some(OsStr::new("deps")) {
        if let Some(profile_dir) = executable_dir.parent() {
            candidates.push(profile_dir.join(SIDECAR_FILE_NAME));
        }
    }
    candidates
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

fn read_node_version(node_executable: &Path) -> AppResult<String> {
    let output = Command::new(node_executable)
        .arg("--version")
        .stdin(Stdio::null())
        .output()
        .map_err(|error| AppError::Internal(format!("cannot run {}: {error}", node_executable.display())))?;
    if !output.status.success() {
        return Err(AppError::Internal(format!("{} --version failed: {}", node_executable.display(), output.status)));
    }
    Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
}

fn run_playwright_install(request: &BrowserInstallRequest, on_progress: &ProgressCallback) -> AppResult<()> {
    let mut command = Command::new(&request.node_executable);
    command
        .arg(&request.playwright_cli)
        .args(["install", "chromium"])
        .current_dir(&request.working_dir)
        .envs(request.env.iter().map(|(key, value)| (key, value)))
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        command.creation_flags(CREATE_NO_WINDOW);
    }
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
        let executable = dir.join("bin").join(SIDECAR_FILE_NAME);
        write_executable(&executable);
        NodeLocation { executable: Some(executable), source: NodeSource::Bundled }
    }

    #[test]
    fn finds_the_sidecar_in_a_macos_bundle() {
        let temp = tempfile::tempdir().unwrap();
        let macos_dir = temp.path().join("graphrt.app/Contents/MacOS");
        write_executable(&macos_dir.join(SIDECAR_FILE_NAME));
        let location = resolve_node_location(&macos_dir, false, None);
        assert_eq!(location.source, NodeSource::Bundled);
        assert_eq!(location.executable, Some(macos_dir.join(SIDECAR_FILE_NAME)));
    }

    #[test]
    fn finds_the_sidecar_in_the_dev_target_dir_from_tests() {
        let temp = tempfile::tempdir().unwrap();
        let profile_dir = temp.path().join("target/debug");
        write_executable(&profile_dir.join(SIDECAR_FILE_NAME));
        let location = resolve_node_location(&profile_dir.join("deps"), false, None);
        assert_eq!(location.executable, Some(profile_dir.join(SIDECAR_FILE_NAME)));
    }

    #[test]
    fn ignores_an_empty_placeholder_and_falls_back_to_path_only_when_allowed() {
        let temp = tempfile::tempdir().unwrap();
        let app_dir = temp.path().join("app");
        std::fs::create_dir_all(&app_dir).unwrap();
        std::fs::write(app_dir.join(SIDECAR_FILE_NAME), b"").unwrap();
        let system_dir = temp.path().join("usr/local/bin");
        write_executable(&system_dir.join(SYSTEM_NODE_FILE_NAME));
        let system_path = std::env::join_paths([temp.path().join("missing"), system_dir.clone()]).unwrap();

        let debug_location = resolve_node_location(&app_dir, true, Some(&system_path));
        assert_eq!(debug_location.source, NodeSource::System);
        assert_eq!(debug_location.executable, Some(system_dir.join(SYSTEM_NODE_FILE_NAME)));

        let release_location = resolve_node_location(&app_dir, false, Some(&system_path));
        assert_eq!(release_location, NodeLocation { executable: None, source: NodeSource::Missing });
    }

    #[test]
    fn missing_node_is_a_clear_error() {
        let temp = tempfile::tempdir().unwrap();
        let runtime = NodeRuntime::with_parts(
            temp.path().to_path_buf(),
            NodeLocation { executable: None, source: NodeSource::Missing },
            Arc::new(PlaywrightCliInstaller),
        );
        let message = runtime.node_executable().unwrap_err().to_string();
        assert!(message.contains("fetch-node.sh"), "{message}");
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
            NodeLocation { executable: Some(node), source: NodeSource::Bundled },
            Arc::new(PlaywrightCliInstaller),
        )
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
