//! Live view of the headless browser a plugin step drives, shown under the
//! running step (Test run panel, run detail on the Runs page).
//!
//! Contract with browser plugins (graphrt-plugins `lib/live-view.mjs`):
//! - every plugin process gets [`LIVE_VIEW_DIR_ENV`] = `<app data>/live-view`
//!   (see `plugins::PluginService::reload`); a plugin that knows it writes the
//!   latest screen of its page as `<dir>/<frame name>.jpg` (temp file + rename,
//!   about 6 per second) and deletes it when the page closes;
//! - frame names are `node.<hex node id>.<random>` for a workflow node and
//!   `page.<random>` when the node is unknown (tool calls).
//!
//! A watcher thread polls the folder and emits each changed frame (a file is
//! read only when its modification time or size changed since the last scan)
//! as the Tauri event [`LIVE_VIEW_EVENT`] (a JPEG data URL), and `image: null`
//! once a frame file is gone or stale. It polls every [`ACTIVE_POLL_INTERVAL`]
//! while pages are live and for [`ACTIVE_GRACE`] after the last sign of
//! activity (a frame, or a run starting a step: [`LiveViewWaker`]), and only
//! every [`IDLE_POLL_INTERVAL`] otherwise, so an idle app does not wake ten
//! times a second. Frames are live only: they
//! are never stored with the run, never logged, and the folder is emptied when
//! the app starts. The plugin process is shared by runs and does not know the
//! run id, so the frontend matches frames to the running step by node id.

#[cfg(test)]
mod tests;

use std::collections::hash_map::DefaultHasher;
use std::collections::HashMap;
use std::hash::{Hash, Hasher};
use std::path::{Path, PathBuf};
use std::sync::mpsc::{Receiver, RecvTimeoutError, SyncSender, TrySendError};
use std::sync::Arc;
use std::time::{Duration, Instant, SystemTime};

use serde::Serialize;
use tauri::{AppHandle, Emitter};

/// Environment variable naming the frame folder for plugin processes.
pub const LIVE_VIEW_DIR_ENV: &str = "GRAPHRT_LIVE_VIEW_DIR";
/// The frame folder's name under the app data folder.
pub const LIVE_VIEW_DIR_NAME: &str = "live-view";
/// Name of the Tauri event carrying [`LiveViewFrame`].
pub const LIVE_VIEW_EVENT: &str = "run-live-view";

/// How often the folder is checked while pages are live. Plugins write ~6 frames per
/// second; polling faster than that keeps the shown rate close to it. A scan with no
/// change only lists the folder (no file is read), so this is cheap.
const ACTIVE_POLL_INTERVAL: Duration = Duration::from_millis(100);
/// How often the folder is checked when nothing happened for [`ACTIVE_GRACE`]: the
/// first frame of a page no run announced (e.g. a chatbot's tool call) shows within this.
const IDLE_POLL_INTERVAL: Duration = Duration::from_secs(1);
/// How long fast polling continues after the last frame or wake-up (a browser step
/// may take a while to open its first page).
const ACTIVE_GRACE: Duration = Duration::from_secs(15);
/// A frame not rewritten for this long belongs to a plugin that stopped without cleaning up.
const STALE_AFTER: Duration = Duration::from_secs(20);
/// Larger files are not frames the plugins write (960x720 JPEGs are ~30-120 KB).
const MAX_FRAME_BYTES: u64 = 1024 * 1024;
const FRAME_EXTENSION: &str = ".jpg";
const NODE_FRAME_PREFIX: &str = "node";
const PAGE_FRAME_PREFIX: &str = "page";

/// The environment entry that tells plugin processes where to write frames.
pub fn plugin_env_entry(directory: &Path) -> (String, String) {
    (LIVE_VIEW_DIR_ENV.to_owned(), directory.to_string_lossy().into_owned())
}

/// One live view update, sent to the frontend.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LiveViewFrame {
    /// Identifies one browser page (the frame file name without `.jpg`).
    pub frame_key: String,
    /// The workflow node the page belongs to; `None` for tool calls.
    pub node_id: Option<String>,
    /// `data:image/jpeg;base64,...`, or `None` when the page closed.
    pub image: Option<String>,
}

/// Delivers live view frames. The app emits Tauri events; tests collect them.
pub trait LiveViewSink: Send + Sync + std::fmt::Debug {
    fn send(&self, frame: LiveViewFrame);
}

/// Emits [`LIVE_VIEW_EVENT`] to every window.
#[derive(Debug)]
pub struct TauriLiveViewSink {
    app_handle: AppHandle,
}

impl TauriLiveViewSink {
    pub fn new(app_handle: AppHandle) -> Self {
        Self { app_handle }
    }
}

impl LiveViewSink for TauriLiveViewSink {
    fn send(&self, frame: LiveViewFrame) {
        // Never log the frame itself.
        if let Err(error) = self.app_handle.emit(LIVE_VIEW_EVENT, frame) {
            log::warn!("could not emit a live view frame: {error}");
        }
    }
}

/// What a frame file name says about its page.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct FrameSource {
    pub frame_key: String,
    pub node_id: Option<String>,
}

/// Reads a frame file name (`node.<hex>.<suffix>.jpg` or `page.<suffix>.jpg`).
/// Returns `None` for temp files, other files and malformed names.
pub(crate) fn parse_frame_file_name(file_name: &str) -> Option<FrameSource> {
    let frame_key = file_name.strip_suffix(FRAME_EXTENSION)?;
    let parts: Vec<&str> = frame_key.split('.').collect();
    let node_id = match parts.as_slice() {
        [PAGE_FRAME_PREFIX, suffix] if is_name_part(suffix) => None,
        [NODE_FRAME_PREFIX, encoded_node_id, suffix] if is_name_part(suffix) => Some(decode_hex_text(encoded_node_id)?),
        _ => return None,
    };
    Some(FrameSource { frame_key: frame_key.to_owned(), node_id })
}

fn is_name_part(text: &str) -> bool {
    !text.is_empty() && text.bytes().all(|byte| byte.is_ascii_alphanumeric())
}

/// Decodes lowercase or uppercase hex into UTF-8 text.
fn decode_hex_text(encoded: &str) -> Option<String> {
    if encoded.is_empty() || !encoded.len().is_multiple_of(2) {
        return None;
    }
    let bytes = (0..encoded.len())
        .step_by(2)
        .map(|index| u8::from_str_radix(encoded.get(index..index + 2)?, 16).ok())
        .collect::<Option<Vec<u8>>>()?;
    String::from_utf8(bytes).ok()
}

/// The JPEG as a data URL for an `<img>`.
pub(crate) fn to_data_url(jpeg_bytes: &[u8]) -> String {
    use base64::Engine as _;
    format!("data:image/jpeg;base64,{}", base64::engine::general_purpose::STANDARD.encode(jpeg_bytes))
}

/// What the folder listing says about a frame file, compared before reading it.
/// The size is checked too: on file systems with coarse timestamps two frames
/// written within the same tick share a modification time but rarely a size.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct FileStamp {
    modified: SystemTime,
    byte_len: u64,
}

/// What the watcher last sent for one frame file.
#[derive(Debug, Clone)]
struct SentFrame {
    source: FrameSource,
    stamp: FileStamp,
    content_hash: u64,
}

/// Turns the folder's contents into frame updates; one per app.
#[derive(Debug)]
pub(crate) struct FrameWatcher {
    directory: PathBuf,
    sent: HashMap<String, SentFrame>,
}

impl FrameWatcher {
    pub fn new(directory: PathBuf) -> Self {
        Self { directory, sent: HashMap::new() }
    }

    /// Checks the folder once. Returns the frames to send: changed images, and
    /// `image: None` for pages whose file is gone or stale (stale files are deleted).
    pub fn scan(&mut self, now: SystemTime) -> Vec<LiveViewFrame> {
        let mut updates = Vec::new();
        let mut present = Vec::new();
        for (source, path, stamp) in self.frame_files() {
            if is_stale(stamp.modified, now) {
                remove_frame_file(&path);
                continue;
            }
            present.push(source.frame_key.clone());
            if let Some(update) = self.read_if_changed(source, &path, stamp) {
                updates.push(update);
            }
        }
        updates.extend(self.forget_missing(&present));
        updates
    }

    /// Frame files in the folder with their modification time and size.
    fn frame_files(&self) -> Vec<(FrameSource, PathBuf, FileStamp)> {
        let Ok(entries) = std::fs::read_dir(&self.directory) else { return Vec::new() };
        entries
            .filter_map(Result::ok)
            .filter_map(|entry| {
                let source = parse_frame_file_name(&entry.file_name().to_string_lossy())?;
                let metadata = entry.metadata().ok().filter(|metadata| metadata.is_file())?;
                if metadata.len() > MAX_FRAME_BYTES {
                    return None;
                }
                let stamp = FileStamp { modified: metadata.modified().ok()?, byte_len: metadata.len() };
                Some((source, entry.path(), stamp))
            })
            .collect()
    }

    fn read_if_changed(&mut self, source: FrameSource, path: &Path, stamp: FileStamp) -> Option<LiveViewFrame> {
        if self.sent.get(&source.frame_key).is_some_and(|sent| sent.stamp == stamp) {
            return None;
        }
        // The plugin may have deleted the file since the folder was listed.
        let jpeg_bytes = std::fs::read(path).ok().filter(|bytes| !bytes.is_empty())?;
        let content_hash = hash_bytes(&jpeg_bytes);
        let previous_hash = self.sent.get(&source.frame_key).map(|sent| sent.content_hash);
        self.sent.insert(source.frame_key.clone(), SentFrame { source: source.clone(), stamp, content_hash });
        if previous_hash == Some(content_hash) {
            return None;
        }
        Some(LiveViewFrame {
            frame_key: source.frame_key,
            node_id: source.node_id,
            image: Some(to_data_url(&jpeg_bytes)),
        })
    }

    /// Whether a page is live (a frame was sent and its file is still there).
    pub fn has_live_pages(&self) -> bool {
        !self.sent.is_empty()
    }

    /// Ends the pages whose file is no longer there.
    fn forget_missing(&mut self, present: &[String]) -> Vec<LiveViewFrame> {
        let missing: Vec<String> = self.sent.keys().filter(|key| !present.contains(key)).cloned().collect();
        missing
            .into_iter()
            .filter_map(|key| self.sent.remove(&key))
            .map(|sent| LiveViewFrame { frame_key: sent.source.frame_key, node_id: sent.source.node_id, image: None })
            .collect()
    }
}

fn is_stale(modified: SystemTime, now: SystemTime) -> bool {
    now.duration_since(modified).is_ok_and(|age| age > STALE_AFTER)
}

fn hash_bytes(bytes: &[u8]) -> u64 {
    let mut hasher = DefaultHasher::new();
    bytes.hash(&mut hasher);
    hasher.finish()
}

fn remove_frame_file(path: &Path) {
    if let Err(error) = std::fs::remove_file(path) {
        if error.kind() != std::io::ErrorKind::NotFound {
            log::warn!("could not delete a stale live view frame {}: {error}", path.display());
        }
    }
}

/// Creates the frame folder and deletes everything in it (frames left by a
/// previous app session). Errors are logged: live view is optional.
pub(crate) fn reset_directory(directory: &Path) {
    if let Err(error) = std::fs::remove_dir_all(directory) {
        if error.kind() != std::io::ErrorKind::NotFound {
            log::warn!("could not clear the live view folder {}: {error}", directory.display());
        }
    }
    if let Err(error) = std::fs::create_dir_all(directory) {
        log::warn!("could not create the live view folder {}: {error}", directory.display());
    }
}

/// When the watcher polls next: fast while there is activity, slowly otherwise.
#[derive(Debug, Clone, Copy)]
pub(crate) struct PollPacing {
    last_activity: Option<Instant>,
}

impl PollPacing {
    pub fn idle() -> Self {
        Self { last_activity: None }
    }

    /// Something happened at `now` (a live page, a run starting a step).
    pub fn note_activity(&mut self, now: Instant) {
        self.last_activity = Some(now);
    }

    /// The wait before the next scan.
    pub fn next_delay(&self, now: Instant) -> Duration {
        let active = self.last_activity.is_some_and(|activity| now.saturating_duration_since(activity) < ACTIVE_GRACE);
        if active {
            ACTIVE_POLL_INTERVAL
        } else {
            IDLE_POLL_INTERVAL
        }
    }
}

/// Tells the watcher a browser page may open soon, so it polls fast right away
/// instead of noticing the first frame up to [`IDLE_POLL_INTERVAL`] late. Cheap to
/// clone and to call often: a wake-up already pending absorbs the next ones.
#[derive(Debug, Clone)]
pub struct LiveViewWaker {
    sender: SyncSender<()>,
}

impl LiveViewWaker {
    fn channel() -> (Self, Receiver<()>) {
        let (sender, receiver) = std::sync::mpsc::sync_channel(1);
        (Self { sender }, receiver)
    }

    pub fn wake(&self) {
        match self.sender.try_send(()) {
            Ok(()) | Err(TrySendError::Full(())) | Err(TrySendError::Disconnected(())) => {}
        }
    }
}

/// Passes run events on to `inner` and wakes the live view watcher when a run
/// starts, resumes or starts a step (only those can open a browser page).
#[derive(Debug)]
pub struct WakeOnRunActivity {
    inner: Arc<dyn crate::engine::RunEventSink>,
    waker: LiveViewWaker,
}

impl WakeOnRunActivity {
    pub fn new(inner: Arc<dyn crate::engine::RunEventSink>, waker: LiveViewWaker) -> Self {
        Self { inner, waker }
    }
}

/// Whether a run event means a browser page may open soon.
pub(crate) fn may_open_a_page(payload: &crate::engine::RunEventPayload) -> bool {
    let event_type = payload.event.get("type").and_then(serde_json::Value::as_str);
    payload.status == crate::storage::models::RunStatus::Running
        && matches!(event_type, Some("node_started" | "status_changed"))
}

impl crate::engine::RunEventSink for WakeOnRunActivity {
    fn send(&self, payload: crate::engine::RunEventPayload) {
        if may_open_a_page(&payload) {
            self.waker.wake();
        }
        self.inner.send(payload);
    }
}

/// Scans, sends, then waits for the next scan (or a wake-up), forever.
fn watch_forever(mut watcher: FrameWatcher, sink: &dyn LiveViewSink, wakeups: &Receiver<()>) {
    let mut pacing = PollPacing::idle();
    loop {
        for frame in watcher.scan(SystemTime::now()) {
            sink.send(frame);
        }
        if watcher.has_live_pages() {
            pacing.note_activity(Instant::now());
        }
        match wakeups.recv_timeout(pacing.next_delay(Instant::now())) {
            Ok(()) => pacing.note_activity(Instant::now()),
            Err(RecvTimeoutError::Timeout) => {}
            // The watcher keeps a sender, so this does not happen; never spin if it does.
            Err(RecvTimeoutError::Disconnected) => std::thread::sleep(IDLE_POLL_INTERVAL),
        }
    }
}

/// Empties `directory` and starts the watcher thread that sends frames to `sink`.
/// Returns the waker the run engine pokes when a step starts.
pub fn spawn(directory: PathBuf, sink: Arc<dyn LiveViewSink>) -> LiveViewWaker {
    reset_directory(&directory);
    let watcher = FrameWatcher::new(directory);
    let (waker, wakeups) = LiveViewWaker::channel();
    let kept_waker = waker.clone();
    let started = std::thread::Builder::new().name("live-view".into()).spawn(move || {
        let _keep_channel_open = kept_waker;
        watch_forever(watcher, sink.as_ref(), &wakeups);
    });
    if let Err(error) = started {
        log::warn!("live view is off: could not start its watcher: {error}");
    }
    waker
}
