//! Meeting notetaker: notices a meeting on this computer, asks before taking notes,
//! records the microphone and the computer's sound as two tracks, and transcribes them.
//!
//! Design: docs/design/meeting-notetaker.md. Nothing here records on its own: detection
//! only raises a prompt ([`MeetingStatusView::prompt`] plus a system notification), and
//! recording starts from [`MeetingService::start_recording`] (the user's click).
//!
//! - [`platform`]: the per-OS traits; [`linux`] implements them with PipeWire
//! - [`detector`]: when to offer, when a recorded meeting seems over
//! - [`apps`]: naming the program that uses the microphone
//! - [`store`]: meetings on disk; [`transcript`]: whisper.cpp and merging the tracks
//! - [`settings`]: detection switch and transcriber paths

pub mod apps;
pub mod detector;
#[cfg(target_os = "linux")]
pub mod linux;
pub mod platform;
pub mod settings;
pub mod store;
pub mod transcript;

use std::collections::HashSet;
use std::path::PathBuf;
use std::sync::{Arc, Mutex, MutexGuard};
use std::time::{Duration, Instant};

use chrono::Utc;
use serde::Serialize;

use crate::desktop::notify::PlainNotifier;
use crate::error::AppResult;
use crate::storage::Database;
use apps::MeetingApp;
use detector::{DetectorAction, DetectorConfig, MeetingDetector};
use platform::{AudioActivityProbe, MeetingError, MeetingRecorder, RecordingSession};
use settings::MeetingSettings;
use store::{MeetingRecord, MeetingStatus, MeetingStore, TrackFile};
use transcript::{Transcriber, WhisperCli};

/// How often the microphone is checked while detection is on.
pub const POLL_INTERVAL: Duration = Duration::from_secs(3);
/// Tauri event: the status changed (prompt, recording, mic users); no payload, refetch.
pub const MEETING_STATUS_EVENT: &str = "meeting-status-changed";
/// Tauri event: the list of meetings changed (new, transcribed, deleted); no payload.
pub const MEETINGS_CHANGED_EVENT: &str = "meetings-changed";

/// Tells the UI something changed. The app emits Tauri events; tests count calls.
pub trait MeetingEventSink: Send + Sync + std::fmt::Debug {
    fn status_changed(&self);
    fn meetings_changed(&self);
}

/// Emits [`MEETING_STATUS_EVENT`] / [`MEETINGS_CHANGED_EVENT`] to every window.
#[derive(Debug)]
pub struct TauriMeetingEventSink {
    app_handle: tauri::AppHandle,
}

impl TauriMeetingEventSink {
    pub fn new(app_handle: tauri::AppHandle) -> Self {
        Self { app_handle }
    }

    fn emit(&self, event: &str) {
        use tauri::Emitter;
        if let Err(error) = self.app_handle.emit(event, ()) {
            log::warn!("could not emit {event}: {error}");
        }
    }
}

impl MeetingEventSink for TauriMeetingEventSink {
    fn status_changed(&self) {
        self.emit(MEETING_STATUS_EVENT);
    }

    fn meetings_changed(&self) {
        self.emit(MEETINGS_CHANGED_EVENT);
    }
}

/// "Meeting detected, take notes?"
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MeetingPrompt {
    pub apps: Vec<MeetingApp>,
    /// "Zoom is using the microphone".
    pub message: String,
}

/// Where transcription stands: what would run, and whether it can.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TranscriberStatus {
    pub whisper_cli: Option<String>,
    pub whisper_model: Option<String>,
    /// Where a downloaded `ggml-*.bin` model is found without configuring a path.
    pub models_folder: String,
    pub is_ready: bool,
}

/// Everything the Meetings page and the recording pill show.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MeetingStatusView {
    /// False on systems without a backend yet (macOS, Windows).
    pub is_supported: bool,
    pub settings: MeetingSettings,
    /// Meeting candidates on the microphone at the last check (detection on only).
    pub mic_users: Vec<MeetingApp>,
    /// Why the last check failed (pw-dump missing…), shown on the Meetings page.
    pub probe_error: Option<String>,
    pub prompt: Option<MeetingPrompt>,
    /// Recording, and the microphone has been free for a while: "Meeting seems over".
    pub meeting_seems_over: bool,
    pub recording: Option<MeetingRecord>,
    /// Meetings being transcribed now.
    pub transcribing: Vec<String>,
    pub transcriber: TranscriberStatus,
}

/// What the poll loop and the commands share; never held across an await.
#[derive(Debug)]
struct LiveState {
    detector: MeetingDetector,
    mic_users: Vec<MeetingApp>,
    probe_error: Option<String>,
    meeting_seems_over: bool,
    transcribing: HashSet<String>,
}

#[derive(Debug)]
struct ActiveRecording {
    record: MeetingRecord,
    session: Box<dyn RecordingSession>,
}

/// Construction inputs of [`MeetingService`].
#[derive(Debug)]
pub struct MeetingServiceConfig {
    pub db: Arc<Database>,
    /// `<app data>/meetings`.
    pub meetings_dir: PathBuf,
    pub probe: Arc<dyn AudioActivityProbe>,
    pub recorder: Arc<dyn MeetingRecorder>,
    pub is_supported: bool,
    pub events: Arc<dyn MeetingEventSink>,
    pub notifier: Option<Arc<dyn PlainNotifier>>,
}

#[derive(Debug)]
pub struct MeetingService {
    db: Arc<Database>,
    store: MeetingStore,
    probe: Arc<dyn AudioActivityProbe>,
    recorder: Arc<dyn MeetingRecorder>,
    is_supported: bool,
    events: Arc<dyn MeetingEventSink>,
    notifier: Option<Arc<dyn PlainNotifier>>,
    live: Mutex<LiveState>,
    active: tokio::sync::Mutex<Option<ActiveRecording>>,
}

/// The probe and recorder of this operating system, and whether they work.
pub fn platform_backends() -> (Arc<dyn AudioActivityProbe>, Arc<dyn MeetingRecorder>, bool) {
    #[cfg(target_os = "linux")]
    {
        (Arc::new(linux::PipeWireProbe), Arc::new(linux::pw_record::PwRecordRecorder::default()), true)
    }
    #[cfg(not(target_os = "linux"))]
    {
        (Arc::new(platform::UnsupportedPlatform), Arc::new(platform::UnsupportedPlatform), false)
    }
}

impl MeetingService {
    /// Also marks meetings left recording / transcribing by a previous run as finished.
    pub fn new(config: MeetingServiceConfig) -> Self {
        let store = MeetingStore::new(config.meetings_dir);
        match store.recover_interrupted(Utc::now()) {
            Ok(count) if count > 0 => log::info!("recovered {count} interrupted meetings"),
            Ok(_) => {}
            Err(error) => log::warn!("could not check for interrupted meetings: {error}"),
        }
        Self {
            db: config.db,
            store,
            probe: config.probe,
            recorder: config.recorder,
            is_supported: config.is_supported,
            events: config.events,
            notifier: config.notifier,
            live: Mutex::new(LiveState {
                detector: MeetingDetector::new(DetectorConfig::default()),
                mic_users: Vec::new(),
                probe_error: None,
                meeting_seems_over: false,
                transcribing: HashSet::new(),
            }),
            active: tokio::sync::Mutex::new(None),
        }
    }

    /// Checks the microphone every [`POLL_INTERVAL`] for as long as the app runs.
    pub fn spawn_watcher(self: &Arc<Self>) {
        if !self.is_supported {
            return;
        }
        let service = Arc::clone(self);
        tauri::async_runtime::spawn(async move {
            let mut interval = tokio::time::interval(POLL_INTERVAL);
            interval.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
            loop {
                interval.tick().await;
                service.check_microphone(Instant::now()).await;
            }
        });
    }

    fn live(&self) -> MutexGuard<'_, LiveState> {
        // A panic while holding the lock leaves plain data; keep using it.
        self.live.lock().unwrap_or_else(std::sync::PoisonError::into_inner)
    }

    fn settings(&self) -> MeetingSettings {
        MeetingSettings::load(&self.db)
    }

    /// One detection step: ask the audio system, feed the detector, act on its answer.
    pub async fn check_microphone(&self, now: Instant) {
        if !self.settings().detection_enabled {
            let had_state = {
                let mut live = self.live();
                let had_state = !live.mic_users.is_empty() || live.detector.prompted_apps().is_some();
                live.detector.reset();
                live.mic_users.clear();
                live.probe_error = None;
                had_state
            };
            if had_state {
                self.events.status_changed();
            }
            return;
        }
        let probed = self.probe.mic_users().await;
        let is_recording = self.active.lock().await.is_some();
        let (action, changed) = {
            let mut live = self.live();
            match probed {
                Ok(users) => {
                    let apps = apps::meeting_apps(&users);
                    let changed = apps != live.mic_users || live.probe_error.is_some();
                    live.mic_users = apps.clone();
                    live.probe_error = None;
                    let action = live.detector.observe(now, &apps, is_recording);
                    if action == Some(DetectorAction::MeetingEnded) {
                        live.meeting_seems_over = true;
                    }
                    (action, changed)
                }
                Err(error) => {
                    let message = error.to_string();
                    let changed = live.probe_error.as_deref() != Some(message.as_str());
                    if changed {
                        log::warn!("meeting detection: {message}");
                    }
                    live.probe_error = Some(message);
                    (None, changed)
                }
            }
        };
        match &action {
            Some(DetectorAction::Prompt(apps)) => self.notify(
                "Meeting detected",
                format!("{}. Take notes? Open graphrt to choose.", apps::describe_users(apps)),
            ),
            Some(DetectorAction::MeetingEnded) => self.notify(
                "Is the meeting over?",
                "The microphone has been free for a while. Open graphrt to stop the notes.".to_owned(),
            ),
            Some(DetectorAction::WithdrawPrompt) | None => {}
        }
        if changed || action.is_some() {
            self.events.status_changed();
        }
    }

    fn notify(&self, title: &str, body: String) {
        if let Some(notifier) = &self.notifier {
            notifier.notify_plain(title.to_owned(), body);
        }
    }

    pub async fn status(&self) -> MeetingStatusView {
        let recording = self.active.lock().await.as_ref().map(|active| active.record.clone());
        let settings = self.settings();
        let transcriber = self.transcriber_status(&settings);
        let live = self.live();
        let prompt = live
            .detector
            .prompted_apps()
            .map(|apps| MeetingPrompt { apps: apps.to_vec(), message: apps::describe_users(apps) });
        let mut transcribing: Vec<String> = live.transcribing.iter().cloned().collect();
        transcribing.sort();
        MeetingStatusView {
            is_supported: self.is_supported,
            settings,
            mic_users: live.mic_users.clone(),
            probe_error: live.probe_error.clone(),
            prompt,
            meeting_seems_over: live.meeting_seems_over && recording.is_some(),
            recording,
            transcribing,
            transcriber,
        }
    }

    pub fn update_settings(&self, settings: MeetingSettings) -> AppResult<MeetingSettings> {
        let settings = settings.normalized();
        settings.save(&self.db)?;
        if !settings.detection_enabled {
            let mut live = self.live();
            live.detector.reset();
            live.mic_users.clear();
            live.probe_error = None;
        }
        self.events.status_changed();
        Ok(settings)
    }

    /// "Not now" on the prompt, or "Keep recording" on "Meeting seems over".
    pub fn dismiss_prompt(&self) {
        {
            let mut live = self.live();
            live.detector.dismiss();
            live.meeting_seems_over = false;
        }
        self.events.status_changed();
    }

    /// Starts recording both tracks. `app` names the meeting; without it, the program
    /// of the open prompt does.
    ///
    /// # Errors
    /// `InvalidState` while already recording; the recorder's errors (no PipeWire…).
    pub async fn start_recording(&self, app: Option<String>) -> Result<MeetingRecord, MeetingError> {
        if !self.is_supported {
            return Err(MeetingError::Unsupported);
        }
        let mut active = self.active.lock().await;
        if active.is_some() {
            return Err(MeetingError::InvalidState("already taking notes of a meeting".into()));
        }
        let app = app.map(|app| app.trim().to_owned()).filter(|app| !app.is_empty()).or_else(|| {
            self.live().detector.prompted_apps().and_then(|apps| apps.first()).map(|app| app.label.clone())
        });
        let mut record = self.store.create(Utc::now(), app)?;
        let folder = self.store.folder(&record.id)?;
        let session = match self.recorder.start(&folder).await {
            Ok(session) => session,
            Err(error) => {
                if let Err(cleanup_error) = self.store.delete(&record.id) {
                    log::warn!("could not remove the folder of a recording that did not start: {cleanup_error}");
                }
                return Err(error);
            }
        };
        record.tracks = session
            .tracks()
            .into_iter()
            .map(|kind| TrackFile { kind, file_name: kind.file_name().to_owned(), size_bytes: 0 })
            .collect();
        self.store.save(&record)?;
        let record = self.store.get(&record.id)?;
        *active = Some(ActiveRecording { record: record.clone(), session });
        drop(active);
        {
            let mut live = self.live();
            live.detector.recording_started();
            live.meeting_seems_over = false;
        }
        self.events.status_changed();
        self.events.meetings_changed();
        Ok(record)
    }

    /// Stops the recording and finishes its files.
    ///
    /// # Errors
    /// `InvalidState` when nothing is recording.
    pub async fn stop_recording(&self) -> Result<MeetingRecord, MeetingError> {
        let Some(ActiveRecording { mut record, session }) = self.active.lock().await.take() else {
            return Err(MeetingError::InvalidState("no meeting is being recorded".into()));
        };
        let stopped = session.stop().await;
        record.ended_at = Some(Utc::now());
        record.status = MeetingStatus::Recorded;
        if let Err(error) = &stopped {
            record.error = Some(format!("the recording did not stop cleanly: {error}"));
        }
        self.store.save(&record)?;
        {
            let mut live = self.live();
            live.detector.recording_stopped();
            live.meeting_seems_over = false;
        }
        self.events.status_changed();
        self.events.meetings_changed();
        self.store.get(&record.id)
    }

    pub fn list(&self) -> Result<Vec<MeetingRecord>, MeetingError> {
        self.store.list()
    }

    pub fn transcript(&self, id: &str) -> Result<String, MeetingError> {
        self.store.transcript_markdown(id)
    }

    /// Deletes a meeting that is not recording or being transcribed.
    pub async fn delete(&self, id: &str) -> Result<(), MeetingError> {
        let is_recording = self.active.lock().await.as_ref().is_some_and(|active| active.record.id == id);
        if is_recording || self.live().transcribing.contains(id) {
            return Err(MeetingError::InvalidState("stop this meeting's notes before deleting it".into()));
        }
        self.store.delete(id)?;
        self.events.meetings_changed();
        Ok(())
    }

    fn transcriber_status(&self, settings: &MeetingSettings) -> TranscriberStatus {
        let models_folder = self.store.root().join(settings::MODELS_DIR_NAME);
        let whisper_cli = settings::resolve_whisper_cli(settings, crate::child_env::host_path_string().as_deref());
        let whisper_model = settings::resolve_whisper_model(settings, &models_folder);
        let is_ready = whisper_cli.as_ref().is_some_and(|path| path.is_file())
            && whisper_model.as_ref().is_some_and(|path| path.is_file());
        TranscriberStatus {
            whisper_cli: whisper_cli.map(|path| path.to_string_lossy().into_owned()),
            whisper_model: whisper_model.map(|path| path.to_string_lossy().into_owned()),
            models_folder: models_folder.to_string_lossy().into_owned(),
            is_ready,
        }
    }

    fn local_transcriber(&self) -> Result<WhisperCli, MeetingError> {
        let settings = self.settings();
        let status = self.transcriber_status(&settings);
        let program = status.whisper_cli.ok_or_else(|| MeetingError::ToolMissing {
            program: "whisper-cli".into(),
            reason: "install whisper.cpp or set the path of whisper-cli on the Meetings page".into(),
        })?;
        let model = status.whisper_model.ok_or_else(|| MeetingError::ToolMissing {
            program: "the whisper model".into(),
            reason: format!("put a ggml model (ggml-base.bin) in {} or set its path", status.models_folder),
        })?;
        let threads = std::thread::available_parallelism().map(|count| count.get().min(8)).unwrap_or(4);
        Ok(WhisperCli { program: program.into(), model: model.into(), language: "auto".into(), threads })
    }

    /// Transcribes both tracks locally with whisper.cpp and saves the merged transcript.
    ///
    /// # Errors
    /// `InvalidState` while it records or is already being transcribed; the transcriber's
    /// errors (also saved on the meeting as `TranscriptionFailed`).
    pub async fn transcribe(&self, id: &str) -> Result<MeetingRecord, MeetingError> {
        let transcriber = self.local_transcriber()?;
        self.transcribe_with(id, &transcriber).await
    }

    pub async fn transcribe_with(
        &self,
        id: &str,
        transcriber: &dyn Transcriber,
    ) -> Result<MeetingRecord, MeetingError> {
        let mut record = self.store.get(id)?;
        if record.status == MeetingStatus::Recording {
            return Err(MeetingError::InvalidState("stop the recording before transcribing it".into()));
        }
        if !self.live().transcribing.insert(id.to_owned()) {
            return Err(MeetingError::InvalidState("this meeting is already being transcribed".into()));
        }
        record.status = MeetingStatus::Transcribing;
        record.error = None;
        let outcome = match self.store.save(&record) {
            Ok(()) => {
                self.events.status_changed();
                self.events.meetings_changed();
                self.run_transcription(&record, transcriber).await
            }
            Err(error) => Err(error),
        };
        self.live().transcribing.remove(id);
        match &outcome {
            Ok(()) => {
                record.status = MeetingStatus::Transcribed;
                record.error = None;
            }
            Err(error) => {
                record.status = MeetingStatus::TranscriptionFailed;
                record.error = Some(error.to_string());
            }
        }
        let saved = self.store.save(&record);
        self.events.status_changed();
        self.events.meetings_changed();
        outcome?;
        saved?;
        self.store.get(id)
    }

    async fn run_transcription(
        &self,
        record: &MeetingRecord,
        transcriber: &dyn Transcriber,
    ) -> Result<(), MeetingError> {
        let folder = self.store.folder(&record.id)?;
        let mut tracks = Vec::new();
        for track in &record.tracks {
            let path = folder.join(&track.file_name);
            if !path.is_file() {
                log::warn!("meeting {}: track {} is missing; skipped", record.id, track.file_name);
                continue;
            }
            tracks.push((track.kind, transcriber.transcribe(&path).await?));
        }
        if tracks.is_empty() {
            return Err(MeetingError::NotFound("the recorded tracks".into()));
        }
        let lines = transcript::merge_tracks(tracks);
        let markdown = transcript::render_markdown(&record.title, &lines);
        self.store.save_transcript(&record.id, &lines, &markdown)
    }
}

#[cfg(test)]
mod tests;
