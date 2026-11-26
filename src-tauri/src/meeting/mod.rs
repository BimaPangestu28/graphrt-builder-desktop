//! Meeting notetaker, built on the app's agents instead of a screen of its own.
//!
//! Design: docs/design/meeting-notetaker.md. In short:
//! - Detection (opt-in, Settings) notices another app on the microphone and, when at
//!   least one agent has the "when a meeting is recorded" [`trigger`], asks
//!   "Meeting detected. Take notes?" (notification + a card in the window). Nothing
//!   records without that click.
//! - While recording, a pill shows the time and Stop. When the meeting app releases the
//!   microphone, recording stops by itself after ~30 s unless the user keeps it going.
//! - On stop, every agent with the trigger runs with the meeting as inputs. Its
//!   `meeting.transcribe` step ([`node`]) transcribes locally with whisper.cpp
//!   (downloaded on first use, [`whisper_install`]), skipping silence ([`vad`]); then its
//!   own `llm` and plugin steps summarize and deliver. The audio is deleted after the
//!   transcript unless the user keeps it.
//!
//! - [`platform`]: the per-OS traits; [`linux`] implements them with PipeWire
//! - [`detector`]: when to offer, when a recorded meeting is over
//! - [`apps`]: naming the program that uses the microphone
//! - [`store`]: meetings on disk; [`transcript`]: whisper.cpp output and merging tracks

pub mod apps;
pub mod detector;
#[cfg(target_os = "linux")]
pub mod linux;
pub mod node;
pub mod platform;
pub mod settings;
pub mod store;
pub mod transcript;
pub mod trigger;
pub mod vad;
pub mod whisper_install;

use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, MutexGuard};
use std::time::{Duration, Instant};

use chrono::Utc;
use futures::future::BoxFuture;
use serde::Serialize;

use crate::desktop::notify::PlainNotifier;
use crate::error::AppResult;
use crate::plugins::download::Downloader;
use crate::storage::Database;
use apps::MeetingApp;
use detector::{DetectorAction, DetectorConfig, MeetingDetector};
use node::{MeetingTranscript, MeetingTranscription};
use platform::{AudioActivityProbe, MeetingError, MeetingRecorder, RecordingSession, TrackKind};
use settings::MeetingSettings;
use store::{MeetingRecord, MeetingStatus, MeetingStore, TrackFile};
use transcript::{Transcriber, WhisperCli};
use trigger::MeetingRunStarter;

/// How often the microphone is checked while detection is on.
pub const POLL_INTERVAL: Duration = Duration::from_secs(3);
/// After the meeting app releases the microphone, recording stops this long after
/// "the meeting seems over" was announced (which itself waits `release_after`).
pub const AUTO_STOP_DELAY: Duration = Duration::from_secs(20);
/// Microphone free this long before "the meeting seems over" (+ [`AUTO_STOP_DELAY`] ≈ 30 s).
pub const RELEASE_AFTER: Duration = Duration::from_secs(10);
/// Whisper segments within this distance of voiced audio are kept.
const VAD_SLACK_MS: u64 = 500;
/// Tauri event: the status changed (prompt, recording, download); no payload, refetch.
pub const MEETING_STATUS_EVENT: &str = "meeting-status-changed";
/// One line in every prompt: recording laws differ, and it is polite.
pub const CONSENT_REMINDER: &str = "Let the others know you are taking notes.";

/// Tells the UI something changed. The app emits a Tauri event; tests count calls.
pub trait MeetingEventSink: Send + Sync + std::fmt::Debug {
    fn status_changed(&self);
}

/// Emits [`MEETING_STATUS_EVENT`] to every window and refreshes the tray menu.
#[derive(Debug)]
pub struct TauriMeetingEventSink {
    app_handle: tauri::AppHandle,
}

impl TauriMeetingEventSink {
    pub fn new(app_handle: tauri::AppHandle) -> Self {
        Self { app_handle }
    }
}

impl MeetingEventSink for TauriMeetingEventSink {
    fn status_changed(&self) {
        use tauri::Emitter;
        if let Err(error) = self.app_handle.emit(MEETING_STATUS_EVENT, ()) {
            log::warn!("could not emit {MEETING_STATUS_EVENT}: {error}");
        }
        // The tray shows "Recording meeting notes · Stop" while recording.
        crate::desktop::tray::refresh_tray(&self.app_handle);
    }
}

/// "Meeting detected. Take notes?"
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MeetingPrompt {
    pub apps: Vec<MeetingApp>,
    /// "Zoom is using the microphone".
    pub message: String,
    /// [`CONSENT_REMINDER`].
    pub consent_reminder: String,
    /// The agents that will run on the notes ("Meeting notes to Notion").
    pub agent_names: Vec<String>,
}

/// whisper.cpp on this computer.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TranscriberStatus {
    /// Program and model are on disk (else they are downloaded on first use).
    pub is_installed: bool,
    /// "Downloading the speech model… 42%" while a download runs.
    pub download_message: Option<String>,
}

/// Everything the Settings section, the prompt card and the recording pill show.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MeetingStatusView {
    /// False on systems without a backend yet (macOS, Windows).
    pub is_supported: bool,
    pub settings: MeetingSettings,
    /// Names of the agents with the "when a meeting is recorded" trigger (tested or active).
    pub triggered_agents: Vec<String>,
    pub mic_users: Vec<MeetingApp>,
    /// Why the last check failed (pw-dump missing…).
    pub probe_error: Option<String>,
    pub prompt: Option<MeetingPrompt>,
    pub recording: Option<MeetingRecord>,
    /// Recording stops by itself in this many seconds (the meeting app left the mic).
    pub auto_stop_in_seconds: Option<u64>,
    pub transcriber: TranscriberStatus,
}

#[derive(Debug)]
struct LiveState {
    detector: MeetingDetector,
    mic_users: Vec<MeetingApp>,
    probe_error: Option<String>,
    auto_stop_at: Option<Instant>,
    download_message: Option<String>,
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
    /// Starts the triggered agents' runs after a recording stops.
    pub runs: Option<Arc<dyn MeetingRunStarter>>,
    /// Fetches whisper.cpp on first use.
    pub downloader: Option<Arc<dyn Downloader>>,
    /// Replaces whisper.cpp (tests).
    pub transcriber: Option<Arc<dyn Transcriber>>,
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
    runs: Option<Arc<dyn MeetingRunStarter>>,
    downloader: Option<Arc<dyn Downloader>>,
    transcriber: Option<Arc<dyn Transcriber>>,
    live: Mutex<LiveState>,
    active: tokio::sync::Mutex<Option<ActiveRecording>>,
    /// Mirrors `active.is_some()` for synchronous readers (the tray menu).
    is_recording: std::sync::atomic::AtomicBool,
    /// One transcription at a time (several agents of one meeting share the result).
    transcribing: tokio::sync::Mutex<()>,
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
            runs: config.runs,
            downloader: config.downloader,
            transcriber: config.transcriber,
            live: Mutex::new(LiveState {
                detector: MeetingDetector::new(DetectorConfig {
                    release_after: RELEASE_AFTER,
                    ..DetectorConfig::default()
                }),
                mic_users: Vec::new(),
                probe_error: None,
                auto_stop_at: None,
                download_message: None,
            }),
            active: tokio::sync::Mutex::new(None),
            is_recording: std::sync::atomic::AtomicBool::new(false),
            transcribing: tokio::sync::Mutex::new(()),
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

    /// Whether a meeting is being recorded (for the tray menu).
    pub fn is_recording(&self) -> bool {
        self.is_recording.load(std::sync::atomic::Ordering::SeqCst)
    }

    fn live(&self) -> MutexGuard<'_, LiveState> {
        // A panic while holding the lock leaves plain data; keep using it.
        self.live.lock().unwrap_or_else(std::sync::PoisonError::into_inner)
    }

    fn settings(&self) -> MeetingSettings {
        MeetingSettings::load(&self.db)
    }

    fn triggered_agent_names(&self) -> Vec<String> {
        match trigger::triggered_agents(&self.db) {
            Ok(agents) => agents.into_iter().map(|agent| agent.name).collect(),
            Err(error) => {
                log::warn!("could not list the agents with a meeting trigger: {error}");
                Vec::new()
            }
        }
    }

    /// One detection step: ask the audio system, feed the detector, act on its answer.
    /// Detection runs only when it is on and an agent would use the notes.
    pub async fn check_microphone(&self, now: Instant) {
        let is_recording = self.active.lock().await.is_some();
        if is_recording && self.is_auto_stop_due(now) {
            match self.stop_recording().await {
                Ok(record) => log::info!("meeting {} stopped by itself after the meeting app left", record.id),
                Err(error) => log::warn!("could not stop the meeting notes automatically: {error}"),
            }
            return;
        }
        let is_watching =
            self.settings().detection_enabled && (is_recording || !self.triggered_agent_names().is_empty());
        if !is_watching {
            self.reset_detection();
            return;
        }
        let probed = self.probe.mic_users().await;
        let (action, changed) = {
            let mut live = self.live();
            match probed {
                Ok(users) => {
                    let apps = apps::meeting_apps(&users);
                    let changed = apps != live.mic_users || live.probe_error.is_some();
                    if !apps.is_empty() && live.auto_stop_at.take().is_some() {
                        log::info!("the meeting app is back on the microphone; recording continues");
                    }
                    live.mic_users = apps.clone();
                    live.probe_error = None;
                    let action = live.detector.observe(now, &apps, is_recording);
                    if action == Some(DetectorAction::MeetingEnded) {
                        live.auto_stop_at = Some(now + AUTO_STOP_DELAY);
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
                "Meeting detected. Take notes?",
                format!("{}. Open graphrt to choose. {CONSENT_REMINDER}", apps::describe_users(apps)),
            ),
            Some(DetectorAction::MeetingEnded) => self.notify(
                "The meeting seems over",
                format!(
                    "Meeting notes stop in {} seconds. Open graphrt and choose Keep recording to continue.",
                    AUTO_STOP_DELAY.as_secs()
                ),
            ),
            Some(DetectorAction::WithdrawPrompt) | None => {}
        }
        if changed || action.is_some() {
            self.events.status_changed();
        }
    }

    fn is_auto_stop_due(&self, now: Instant) -> bool {
        self.live().auto_stop_at.is_some_and(|at| now >= at)
    }

    fn reset_detection(&self) {
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
    }

    fn notify(&self, title: &str, body: String) {
        if let Some(notifier) = &self.notifier {
            notifier.notify_plain(title.to_owned(), body);
        }
    }

    pub async fn status(&self) -> MeetingStatusView {
        let recording = self.active.lock().await.as_ref().map(|active| active.record.clone());
        let settings = self.settings();
        let paths = whisper_install::find_installed(
            &settings,
            &self.whisper_dir(),
            crate::child_env::host_path_string().as_deref(),
        );
        let triggered_agents = self.triggered_agent_names();
        let live = self.live();
        let prompt = live.detector.prompted_apps().map(|apps| MeetingPrompt {
            apps: apps.to_vec(),
            message: apps::describe_users(apps),
            consent_reminder: CONSENT_REMINDER.to_owned(),
            agent_names: triggered_agents.clone(),
        });
        let auto_stop_in_seconds = live
            .auto_stop_at
            .filter(|_| recording.is_some())
            .map(|at| at.saturating_duration_since(Instant::now()).as_secs());
        MeetingStatusView {
            is_supported: self.is_supported,
            settings,
            triggered_agents,
            mic_users: live.mic_users.clone(),
            probe_error: live.probe_error.clone(),
            prompt,
            recording,
            auto_stop_in_seconds,
            transcriber: TranscriberStatus {
                is_installed: paths.is_ready(),
                download_message: live.download_message.clone(),
            },
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

    /// An agent's meeting trigger was turned on or off: the Settings section lists them.
    pub fn triggers_changed(&self) {
        self.events.status_changed();
    }

    /// "Not now" on the prompt, or "Keep recording" when it was about to stop by itself.
    pub fn dismiss_prompt(&self) {
        {
            let mut live = self.live();
            live.detector.dismiss();
            live.auto_stop_at = None;
        }
        self.events.status_changed();
    }

    /// Starts recording both tracks (the user's "Take notes"). The program of the open
    /// prompt names the meeting.
    ///
    /// # Errors
    /// `InvalidState` while already recording; the recorder's errors (no PipeWire…).
    pub async fn start_recording(&self) -> Result<MeetingRecord, MeetingError> {
        if !self.is_supported {
            return Err(MeetingError::Unsupported);
        }
        let mut active = self.active.lock().await;
        if active.is_some() {
            return Err(MeetingError::InvalidState("already taking notes of a meeting".into()));
        }
        let app = self.live().detector.prompted_apps().and_then(|apps| apps.first()).map(|app| app.label.clone());
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
        self.is_recording.store(true, std::sync::atomic::Ordering::SeqCst);
        drop(active);
        {
            let mut live = self.live();
            live.detector.recording_started();
            live.auto_stop_at = None;
        }
        self.events.status_changed();
        Ok(record)
    }

    /// Stops the recording, finishes its files and starts the triggered agents' runs.
    ///
    /// # Errors
    /// `InvalidState` when nothing is recording.
    pub async fn stop_recording(&self) -> Result<MeetingRecord, MeetingError> {
        let Some(ActiveRecording { mut record, session }) = self.active.lock().await.take() else {
            return Err(MeetingError::InvalidState("no meeting is being recorded".into()));
        };
        self.is_recording.store(false, std::sync::atomic::Ordering::SeqCst);
        let stopped = session.stop().await;
        record.ended_at = Some(Utc::now());
        record.status = MeetingStatus::Recorded;
        if let Err(error) = &stopped {
            record.error = Some(format!("the recording did not stop cleanly: {error}"));
        }
        {
            let mut live = self.live();
            live.detector.recording_stopped();
            live.auto_stop_at = None;
        }
        record.run_ids = self.start_triggered_runs(&record).await;
        self.store.save(&record)?;
        self.events.status_changed();
        self.store.get(&record.id)
    }

    async fn start_triggered_runs(&self, record: &MeetingRecord) -> Vec<String> {
        let Some(runs) = &self.runs else { return Vec::new() };
        let agents = match trigger::triggered_agents(&self.db) {
            Ok(agents) => agents,
            Err(error) => {
                log::warn!("meeting {}: could not list the agents to run: {error}", record.id);
                return Vec::new();
            }
        };
        let inputs = trigger::run_inputs(record);
        let mut run_ids = Vec::new();
        for agent in agents {
            match runs.start_meeting_run(&agent.id, inputs.clone()).await {
                Ok(run_id) => run_ids.push(run_id),
                Err(error) => {
                    log::warn!("meeting {}: could not start {}: {error}", record.id, agent.name);
                    self.notify(&format!("{} could not start", agent.name), error.to_string());
                }
            }
        }
        if run_ids.is_empty() {
            self.notify(
                "Meeting notes saved",
                "No agent took the notes. Turn on \"When a meeting is recorded\" in an agent's schedule.".to_owned(),
            );
        }
        run_ids
    }

    fn whisper_dir(&self) -> PathBuf {
        self.store.root().join(whisper_install::WHISPER_DIR_NAME)
    }

    fn set_download_message(&self, message: Option<String>) {
        self.live().download_message = message;
        self.events.status_changed();
    }

    /// whisper.cpp, downloading the program and the model the first time.
    async fn local_whisper(&self, language: &str) -> Result<WhisperCli, MeetingError> {
        let settings = self.settings();
        let whisper_dir = self.whisper_dir();
        let found =
            whisper_install::find_installed(&settings, &whisper_dir, crate::child_env::host_path_string().as_deref());
        let program = match found.program {
            Some(program) => program,
            None => {
                let file = whisper_install::PROGRAM.ok_or(MeetingError::Unsupported)?;
                self.download("Downloading whisper.cpp", file).await?
            }
        };
        let model = match found.model {
            Some(model) => model,
            None => self.download("Downloading the speech model", whisper_install::MODEL).await?,
        };
        let threads = std::thread::available_parallelism().map(|count| count.get().min(8)).unwrap_or(4);
        Ok(WhisperCli { program, model, language: language.to_owned(), threads })
    }

    async fn download(&self, label: &str, file: whisper_install::PinnedFile) -> Result<PathBuf, MeetingError> {
        let downloader = self.downloader.clone().ok_or_else(|| MeetingError::ToolMissing {
            program: file.file_name.to_owned(),
            reason: "no download client".into(),
        })?;
        let megabytes = file.size_bytes / 1_000_000;
        self.set_download_message(Some(format!("{label} ({megabytes} MB)…")));
        let result = whisper_install::ensure_file(&downloader, &self.whisper_dir(), file, None).await;
        self.set_download_message(None);
        result
    }

    /// Transcribes a recorded meeting (the `meeting.transcribe` step). A meeting already
    /// transcribed returns its transcript, so several agents can share one meeting.
    ///
    /// # Errors
    /// `NotFound` for an unknown meeting or one whose audio is gone; `InvalidState` while
    /// it records; whisper's errors (also saved on the meeting).
    pub async fn transcribe(&self, meeting_id: &str, language: &str) -> Result<MeetingTranscript, MeetingError> {
        let _one_at_a_time = self.transcribing.lock().await;
        let mut record = self.store.get(meeting_id)?;
        if record.status == MeetingStatus::Recording {
            return Err(MeetingError::InvalidState("the meeting is still being recorded".into()));
        }
        if record.status == MeetingStatus::Transcribed {
            if let Ok(lines) = self.store.transcript_lines(meeting_id) {
                let markdown = self.store.transcript_markdown(meeting_id)?;
                return Ok(MeetingTranscript { title: record.title, markdown, lines });
            }
        }
        record.status = MeetingStatus::Transcribing;
        record.error = None;
        self.store.save(&record)?;
        let outcome = self.run_transcription(&record, language).await;
        match &outcome {
            Ok(_) => {
                record.status = MeetingStatus::Transcribed;
                if !self.settings().keep_audio {
                    match self.store.delete_audio(&record.id) {
                        Ok(()) => record.audio_deleted = true,
                        Err(error) => log::warn!("meeting {}: could not delete the audio: {error}", record.id),
                    }
                }
            }
            Err(error) => {
                record.status = MeetingStatus::TranscriptionFailed;
                record.error = Some(error.to_string());
            }
        }
        self.store.save(&record)?;
        outcome
    }

    async fn run_transcription(
        &self,
        record: &MeetingRecord,
        language: &str,
    ) -> Result<MeetingTranscript, MeetingError> {
        if record.audio_deleted {
            return Err(MeetingError::NotFound(
                "the meeting's audio (it was deleted after an earlier transcript)".into(),
            ));
        }
        let folder = self.store.folder(&record.id)?;
        let mut tracks = Vec::new();
        let mut whisper: Option<Arc<dyn Transcriber>> = self.transcriber.clone();
        for track in &record.tracks {
            let path = folder.join(&track.file_name);
            if !path.is_file() {
                log::warn!("meeting {}: track {} is missing; skipped", record.id, track.file_name);
                continue;
            }
            let Some(ranges) = speech_in(&path, track.kind)? else {
                tracks.push((track.kind, Vec::new()));
                continue;
            };
            let transcriber = match &whisper {
                Some(transcriber) => transcriber.clone(),
                None => {
                    let local: Arc<dyn Transcriber> = Arc::new(self.local_whisper(language).await?);
                    whisper = Some(local.clone());
                    local
                }
            };
            let segments = transcriber.transcribe(&path).await?;
            tracks.push((track.kind, vad::keep_voiced_segments(segments, &ranges, VAD_SLACK_MS)));
        }
        if tracks.is_empty() {
            return Err(MeetingError::NotFound("the recorded tracks".into()));
        }
        let lines = transcript::merge_tracks(tracks);
        let markdown = transcript::render_markdown(&record.title, &lines);
        self.store.save_transcript(&record.id, &lines, &markdown)?;
        Ok(MeetingTranscript { title: record.title.clone(), markdown, lines })
    }
}

/// The voiced stretches of a track, or `None` when it has (almost) no speech and is not
/// worth transcribing. An unreadable file is transcribed whole.
fn speech_in(path: &Path, track: TrackKind) -> Result<Option<Vec<vad::VoicedRange>>, MeetingError> {
    let pcm = match vad::read_wav(path) {
        Ok(pcm) => pcm,
        Err(MeetingError::Parse(reason)) => {
            log::warn!("{}: {reason}; transcribing it without silence detection", path.display());
            return Ok(Some(vec![vad::VoicedRange { start_ms: 0, end_ms: u64::MAX / 2 }]));
        }
        Err(error) => return Err(error),
    };
    let ranges = vad::voiced_ranges(&pcm);
    if vad::speech_ms(&ranges) < vad::MIN_SPEECH_MS {
        log::info!("{}: {:?} track has no speech; not transcribed", path.display(), track);
        return Ok(None);
    }
    Ok(Some(ranges))
}

impl MeetingTranscription for MeetingService {
    fn transcribe_meeting<'a>(
        &'a self,
        meeting_id: &'a str,
        language: &'a str,
    ) -> BoxFuture<'a, Result<MeetingTranscript, MeetingError>> {
        Box::pin(self.transcribe(meeting_id, language))
    }
}

#[cfg(test)]
mod tests;
