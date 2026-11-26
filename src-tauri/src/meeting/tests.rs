//! MeetingService with a scripted microphone, a fake recorder, run starter and transcriber.

use std::path::Path;
use std::sync::atomic::{AtomicUsize, Ordering};

use futures::future::BoxFuture;

use super::platform::{MicUser, TrackKind};
use super::transcript::Segment;
use super::trigger::MeetingTrigger;
use super::*;
use crate::storage::models::{AgentKind, AgentStatus, NewAgent};

#[derive(Debug, Default)]
struct ScriptedProbe {
    users: Mutex<Vec<MicUser>>,
}

impl ScriptedProbe {
    fn set(&self, users: Vec<MicUser>) {
        *self.users.lock().expect("lock") = users;
    }
}

impl AudioActivityProbe for ScriptedProbe {
    fn mic_users(&self) -> BoxFuture<'_, Result<Vec<MicUser>, MeetingError>> {
        let users = self.users.lock().expect("lock").clone();
        Box::pin(async move { Ok(users) })
    }
}

/// Writes a silent mic track and a system track with 1.5 s of "speech".
#[derive(Debug, Default)]
struct FakeRecorder {
    fails: bool,
    stops: Arc<AtomicUsize>,
}

#[derive(Debug)]
struct FakeSession {
    stops: Arc<AtomicUsize>,
}

impl RecordingSession for FakeSession {
    fn tracks(&self) -> Vec<TrackKind> {
        vec![TrackKind::Mic, TrackKind::System]
    }

    fn stop(self: Box<Self>) -> BoxFuture<'static, Result<(), MeetingError>> {
        self.stops.fetch_add(1, Ordering::SeqCst);
        Box::pin(async { Ok(()) })
    }
}

impl MeetingRecorder for FakeRecorder {
    fn start<'a>(&'a self, dir: &'a Path) -> BoxFuture<'a, Result<Box<dyn RecordingSession>, MeetingError>> {
        Box::pin(async move {
            if self.fails {
                return Err(MeetingError::ToolFailed { program: "pw-record".into(), reason: "no PipeWire".into() });
            }
            std::fs::write(dir.join("mic.wav"), vad::tests::wav(16_000, &[(3_000, 40)]))?;
            std::fs::write(dir.join("system.wav"), vad::tests::wav(16_000, &[(500, 40), (1_500, 8_000), (1_000, 40)]))?;
            Ok(Box::new(FakeSession { stops: self.stops.clone() }) as Box<dyn RecordingSession>)
        })
    }
}

/// Hears speech at 0.6 s and an invented line at 2.8 s in every track it is given.
#[derive(Debug, Default)]
struct FakeTranscriber {
    fails: bool,
    calls: Mutex<Vec<String>>,
}

impl Transcriber for FakeTranscriber {
    fn transcribe<'a>(&'a self, audio: &'a Path) -> BoxFuture<'a, Result<Vec<Segment>, MeetingError>> {
        let name = audio.file_name().map(|name| name.to_string_lossy().into_owned()).unwrap_or_default();
        self.calls.lock().expect("lock").push(name);
        Box::pin(async move {
            if self.fails {
                return Err(MeetingError::ToolFailed { program: "whisper-cli".into(), reason: "bad model".into() });
            }
            Ok(vec![
                Segment { start_ms: 600, end_ms: 1_800, text: "Hello everyone.".into() },
                Segment { start_ms: 4_000, end_ms: 5_000, text: "Thank you.".into() },
            ])
        })
    }
}

#[derive(Debug, Default)]
struct FakeRuns {
    started: Mutex<Vec<(String, serde_json::Value)>>,
}

impl MeetingRunStarter for FakeRuns {
    fn start_meeting_run<'a>(
        &'a self,
        agent_id: &'a str,
        inputs: serde_json::Value,
    ) -> BoxFuture<'a, AppResult<String>> {
        let mut started = self.started.lock().expect("lock");
        started.push((agent_id.to_owned(), inputs));
        let run_id = format!("run-{}", started.len());
        Box::pin(async move { Ok(run_id) })
    }
}

#[derive(Debug, Default)]
struct CountingEvents {
    status: AtomicUsize,
}

impl MeetingEventSink for CountingEvents {
    fn status_changed(&self) {
        self.status.fetch_add(1, Ordering::SeqCst);
    }
}

#[derive(Debug, Default)]
struct RecordingNotifier {
    shown: Mutex<Vec<(String, String)>>,
}

impl PlainNotifier for RecordingNotifier {
    fn notify_plain(&self, title: String, body: String) {
        self.shown.lock().expect("lock").push((title, body));
    }
}

struct Fixture {
    _dir: tempfile::TempDir,
    db: Arc<Database>,
    service: MeetingService,
    probe: Arc<ScriptedProbe>,
    stops: Arc<AtomicUsize>,
    notifier: Arc<RecordingNotifier>,
    runs: Arc<FakeRuns>,
    transcriber: Arc<FakeTranscriber>,
}

fn fixture_with(recorder_fails: bool, transcriber_fails: bool) -> Fixture {
    let dir = tempfile::tempdir().expect("temp dir");
    let db = Arc::new(Database::open_in_memory().expect("db"));
    let probe = Arc::new(ScriptedProbe::default());
    let stops = Arc::new(AtomicUsize::new(0));
    let notifier = Arc::new(RecordingNotifier::default());
    let runs = Arc::new(FakeRuns::default());
    let transcriber = Arc::new(FakeTranscriber { fails: transcriber_fails, ..FakeTranscriber::default() });
    let service = MeetingService::new(MeetingServiceConfig {
        db: db.clone(),
        meetings_dir: dir.path().join("meetings"),
        probe: probe.clone(),
        recorder: Arc::new(FakeRecorder { fails: recorder_fails, stops: stops.clone() }),
        is_supported: true,
        events: Arc::new(CountingEvents::default()),
        notifier: Some(notifier.clone()),
        runs: Some(runs.clone()),
        downloader: None,
        transcriber: Some(transcriber.clone()),
    });
    Fixture { _dir: dir, db, service, probe, stops, notifier, runs, transcriber }
}

fn fixture() -> Fixture {
    fixture_with(false, false)
}

fn zoom_user() -> MicUser {
    MicUser { stream_id: 90, app_name: "ZOOM VoiceEngine".into(), binary: Some("zoom".into()), pid: Some(5150) }
}

fn enable_detection(fixture: &Fixture) {
    let settings = MeetingSettings { detection_enabled: true, ..MeetingSettings::default() };
    fixture.service.update_settings(settings).expect("save settings");
}

/// An active agent "Meeting notes to Notion" with the meeting trigger on; returns its id.
fn add_triggered_agent(fixture: &Fixture) -> String {
    let agent = fixture
        .db
        .create_agent(NewAgent {
            name: "Meeting notes to Notion".into(),
            kind: AgentKind::Task,
            description: "Summarize meetings".into(),
            flow_yaml: "nodes: []".into(),
        })
        .expect("agent");
    fixture.db.set_agent_status(&agent.id, AgentStatus::Active).expect("status");
    trigger::save(&fixture.db, &agent.id, MeetingTrigger { enabled: true }).expect("trigger");
    agent.id
}

/// Detection on, an agent with the trigger, Zoom on the microphone long enough to ask.
async fn prompted(fixture: &Fixture) -> Instant {
    enable_detection(fixture);
    add_triggered_agent(fixture);
    fixture.probe.set(vec![zoom_user()]);
    let start = Instant::now();
    fixture.service.check_microphone(start).await;
    fixture.service.check_microphone(start + Duration::from_secs(6)).await;
    start + Duration::from_secs(6)
}

fn notification_titles(fixture: &Fixture) -> Vec<String> {
    fixture.notifier.shown.lock().expect("lock").iter().map(|(title, _)| title.clone()).collect()
}

#[tokio::test]
async fn detection_is_off_until_turned_on() {
    let fixture = fixture();
    add_triggered_agent(&fixture);
    fixture.probe.set(vec![zoom_user()]);
    let start = Instant::now();
    fixture.service.check_microphone(start).await;
    fixture.service.check_microphone(start + Duration::from_secs(10)).await;
    let status = fixture.service.status().await;
    assert!(status.mic_users.is_empty());
    assert_eq!(status.prompt, None);
    assert!(fixture.notifier.shown.lock().expect("lock").is_empty());
}

#[tokio::test]
async fn without_an_agent_to_take_the_notes_nothing_is_offered() {
    let fixture = fixture();
    enable_detection(&fixture);
    fixture.probe.set(vec![zoom_user()]);
    let start = Instant::now();
    fixture.service.check_microphone(start).await;
    fixture.service.check_microphone(start + Duration::from_secs(10)).await;
    assert_eq!(fixture.service.status().await.prompt, None);
}

#[tokio::test]
async fn offers_to_take_notes_with_a_consent_reminder_and_never_records_on_its_own() {
    let fixture = fixture();
    prompted(&fixture).await;

    let status = fixture.service.status().await;
    let prompt = status.prompt.expect("a prompt");
    assert_eq!(prompt.message, "Zoom is using the microphone");
    assert_eq!(prompt.consent_reminder, CONSENT_REMINDER);
    assert_eq!(prompt.agent_names, ["Meeting notes to Notion"]);
    assert_eq!(status.recording, None, "only asks");
    let shown = fixture.notifier.shown.lock().expect("lock").clone();
    assert_eq!(shown.len(), 1);
    assert_eq!(shown[0].0, "Meeting detected. Take notes?");
    assert!(shown[0].1.contains(CONSENT_REMINDER));
}

#[tokio::test]
async fn stop_runs_every_agent_with_the_meeting_trigger() {
    let fixture = fixture();
    prompted(&fixture).await;

    let record = fixture.service.start_recording().await.expect("start");
    assert_eq!(record.app.as_deref(), Some("Zoom"), "named after the prompt");
    assert_eq!(record.tracks.iter().map(|track| track.kind).collect::<Vec<_>>(), [TrackKind::Mic, TrackKind::System]);
    assert_eq!(fixture.service.status().await.prompt, None);
    assert!(matches!(fixture.service.start_recording().await, Err(MeetingError::InvalidState(_))));
    assert!(fixture.runs.started.lock().expect("lock").is_empty(), "runs start after Stop");
    assert!(fixture.service.is_recording());

    let stopped = fixture.service.stop_recording().await.expect("stop");
    assert_eq!(stopped.status, MeetingStatus::Recorded);
    assert!(!fixture.service.is_recording());
    assert_eq!(stopped.run_ids, ["run-1"]);
    assert_eq!(fixture.stops.load(Ordering::SeqCst), 1);
    let started = fixture.runs.started.lock().expect("lock").clone();
    assert_eq!(started.len(), 1);
    assert_eq!(started[0].1["meeting_id"], stopped.id);
    assert_eq!(started[0].1["meeting_app"], "Zoom");
    assert!(matches!(fixture.service.stop_recording().await, Err(MeetingError::InvalidState(_))));
}

#[tokio::test]
async fn stops_by_itself_about_30_seconds_after_the_meeting_app_leaves() {
    let fixture = fixture();
    let now = prompted(&fixture).await;
    fixture.service.start_recording().await.expect("start");
    fixture.probe.set(Vec::new());
    fixture.service.check_microphone(now + Duration::from_secs(3)).await;
    fixture.service.check_microphone(now + Duration::from_secs(11)).await;

    assert_eq!(notification_titles(&fixture).last().map(String::as_str), Some("The meeting seems over"));
    let status = fixture.service.status().await;
    assert!(status.recording.is_some(), "not yet");
    assert!(status.auto_stop_in_seconds.is_some());

    fixture.service.check_microphone(now + Duration::from_secs(20)).await;
    assert!(fixture.service.status().await.recording.is_some());
    fixture.service.check_microphone(now + Duration::from_secs(32)).await;
    assert_eq!(fixture.service.status().await.recording, None, "stopped");
    assert_eq!(fixture.runs.started.lock().expect("lock").len(), 1);
}

#[tokio::test]
async fn keep_recording_cancels_the_automatic_stop() {
    let fixture = fixture();
    let now = prompted(&fixture).await;
    fixture.service.start_recording().await.expect("start");
    fixture.probe.set(Vec::new());
    fixture.service.check_microphone(now + Duration::from_secs(11)).await;
    fixture.service.dismiss_prompt();
    assert_eq!(fixture.service.status().await.auto_stop_in_seconds, None);
    fixture.service.check_microphone(now + Duration::from_secs(60)).await;
    assert!(fixture.service.status().await.recording.is_some());
}

#[tokio::test]
async fn the_meeting_app_coming_back_cancels_the_automatic_stop() {
    let fixture = fixture();
    let now = prompted(&fixture).await;
    fixture.service.start_recording().await.expect("start");
    fixture.probe.set(Vec::new());
    fixture.service.check_microphone(now + Duration::from_secs(11)).await;
    fixture.probe.set(vec![zoom_user()]);
    fixture.service.check_microphone(now + Duration::from_secs(14)).await;
    fixture.service.check_microphone(now + Duration::from_secs(40)).await;
    assert!(fixture.service.status().await.recording.is_some());
}

#[tokio::test]
async fn a_recorder_that_cannot_start_leaves_nothing_behind() {
    let fixture = fixture_with(true, false);
    let error = fixture.service.start_recording().await.expect_err("fails");
    assert!(error.to_string().contains("no PipeWire"));
    assert!(fixture.service.store.list().expect("list").is_empty());
    assert_eq!(fixture.service.status().await.recording, None);
}

async fn recorded_meeting(fixture: &Fixture) -> MeetingRecord {
    fixture.service.start_recording().await.expect("start");
    fixture.service.stop_recording().await.expect("stop")
}

#[tokio::test]
async fn transcribes_only_speech_and_deletes_the_audio() {
    let fixture = fixture();
    let record = recorded_meeting(&fixture).await;

    let transcript = fixture.service.transcribe(&record.id, "auto").await.expect("transcribe");
    assert_eq!(*fixture.transcriber.calls.lock().expect("lock"), ["system.wav"], "the silent mic is skipped");
    let spoken: Vec<(&str, &str)> =
        transcript.lines.iter().map(|line| (line.speaker.as_str(), line.text.as_str())).collect();
    assert_eq!(spoken, [("Others", "Hello everyone.")], "the line over silence is dropped");
    assert!(transcript.markdown.contains("Others: Hello everyone."));

    let saved = fixture.service.store.get(&record.id).expect("get");
    assert_eq!(saved.status, MeetingStatus::Transcribed);
    assert!(saved.audio_deleted);
    let folder = fixture.service.store.folder(&record.id).expect("folder");
    assert!(!folder.join("mic.wav").exists() && !folder.join("system.wav").exists());

    let again = fixture.service.transcribe(&record.id, "auto").await.expect("shared");
    assert_eq!(again, transcript, "a second agent gets the same transcript");
    assert_eq!(fixture.transcriber.calls.lock().expect("lock").len(), 1);
}

#[tokio::test]
async fn keep_meeting_audio_keeps_the_tracks() {
    let fixture = fixture();
    let settings = MeetingSettings { keep_audio: true, ..MeetingSettings::default() };
    fixture.service.update_settings(settings).expect("save");
    let record = recorded_meeting(&fixture).await;
    fixture.service.transcribe(&record.id, "auto").await.expect("transcribe");
    let folder = fixture.service.store.folder(&record.id).expect("folder");
    assert!(folder.join("system.wav").exists());
    assert!(!fixture.service.store.get(&record.id).expect("get").audio_deleted);
}

#[tokio::test]
async fn a_failed_transcription_is_saved_and_keeps_the_audio() {
    let fixture = fixture_with(false, true);
    let record = recorded_meeting(&fixture).await;
    let error = fixture.service.transcribe(&record.id, "auto").await.expect_err("fails");
    assert!(error.to_string().contains("bad model"));
    let failed = fixture.service.store.get(&record.id).expect("get");
    assert_eq!(failed.status, MeetingStatus::TranscriptionFailed);
    assert!(failed.error.as_deref().is_some_and(|message| message.contains("bad model")));
    assert!(fixture.service.store.folder(&record.id).expect("folder").join("system.wav").exists());
}

#[tokio::test]
async fn a_meeting_still_recording_or_unknown_is_not_transcribed() {
    let fixture = fixture();
    let record = fixture.service.start_recording().await.expect("start");
    assert!(matches!(fixture.service.transcribe(&record.id, "auto").await, Err(MeetingError::InvalidState(_))));
    assert!(matches!(
        fixture.service.transcribe("20200101-000000-abcdef", "auto").await,
        Err(MeetingError::NotFound(_))
    ));
}

#[tokio::test]
async fn whisper_is_downloaded_on_first_use_and_needs_a_download_client() {
    let dir = tempfile::tempdir().expect("temp dir");
    let db = Arc::new(Database::open_in_memory().expect("db"));
    let service = MeetingService::new(MeetingServiceConfig {
        db,
        meetings_dir: dir.path().join("meetings"),
        probe: Arc::new(ScriptedProbe::default()),
        recorder: Arc::new(FakeRecorder::default()),
        is_supported: true,
        events: Arc::new(CountingEvents::default()),
        notifier: None,
        runs: None,
        downloader: None,
        transcriber: None,
    });
    let status = service.status().await.transcriber;
    assert!(!status.is_installed);
    service.start_recording().await.expect("start");
    let record = service.stop_recording().await.expect("stop");
    let error = service.transcribe(&record.id, "auto").await.expect_err("no whisper");
    assert!(matches!(error, MeetingError::ToolMissing { .. } | MeetingError::Unsupported), "{error}");
}
