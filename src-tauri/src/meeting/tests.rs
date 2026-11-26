//! MeetingService with a scripted microphone, a fake recorder and a fake transcriber.

use std::path::Path;
use std::sync::atomic::{AtomicUsize, Ordering};

use futures::future::BoxFuture;

use super::platform::{MicUser, TrackKind};
use super::transcript::Segment;
use super::*;

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
            std::fs::write(dir.join("mic.wav"), b"mic")?;
            std::fs::write(dir.join("system.wav"), b"system")?;
            Ok(Box::new(FakeSession { stops: self.stops.clone() }) as Box<dyn RecordingSession>)
        })
    }
}

/// "mic.wav" says one thing at 1 s, "system.wav" another at 0 s.
#[derive(Debug, Default)]
struct FakeTranscriber {
    fails: bool,
}

impl Transcriber for FakeTranscriber {
    fn transcribe<'a>(&'a self, audio: &'a Path) -> BoxFuture<'a, Result<Vec<Segment>, MeetingError>> {
        Box::pin(async move {
            if self.fails {
                return Err(MeetingError::ToolFailed { program: "whisper-cli".into(), reason: "bad model".into() });
            }
            let is_mic = audio.ends_with("mic.wav");
            let (start_ms, text) = if is_mic { (1000, "Thanks for joining.") } else { (0, "Hello everyone.") };
            Ok(vec![Segment { start_ms, end_ms: start_ms + 900, text: text.into() }])
        })
    }
}

#[derive(Debug, Default)]
struct CountingEvents {
    status: AtomicUsize,
    meetings: AtomicUsize,
}

impl MeetingEventSink for CountingEvents {
    fn status_changed(&self) {
        self.status.fetch_add(1, Ordering::SeqCst);
    }

    fn meetings_changed(&self) {
        self.meetings.fetch_add(1, Ordering::SeqCst);
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
    service: MeetingService,
    probe: Arc<ScriptedProbe>,
    stops: Arc<AtomicUsize>,
    notifier: Arc<RecordingNotifier>,
    events: Arc<CountingEvents>,
}

fn fixture_with(recorder_fails: bool) -> Fixture {
    let dir = tempfile::tempdir().expect("temp dir");
    let db = Arc::new(Database::open_in_memory().expect("db"));
    let probe = Arc::new(ScriptedProbe::default());
    let stops = Arc::new(AtomicUsize::new(0));
    let notifier = Arc::new(RecordingNotifier::default());
    let events = Arc::new(CountingEvents::default());
    let service = MeetingService::new(MeetingServiceConfig {
        db,
        meetings_dir: dir.path().join("meetings"),
        probe: probe.clone(),
        recorder: Arc::new(FakeRecorder { fails: recorder_fails, stops: stops.clone() }),
        is_supported: true,
        events: events.clone(),
        notifier: Some(notifier.clone()),
    });
    Fixture { _dir: dir, service, probe, stops, notifier, events }
}

fn fixture() -> Fixture {
    fixture_with(false)
}

fn zoom_user() -> MicUser {
    MicUser { stream_id: 90, app_name: "ZOOM VoiceEngine".into(), binary: Some("zoom".into()), pid: Some(5150) }
}

fn enable_detection(fixture: &Fixture) {
    let settings = MeetingSettings { detection_enabled: true, ..MeetingSettings::default() };
    fixture.service.update_settings(settings).expect("save settings");
}

#[tokio::test]
async fn detection_is_off_until_turned_on() {
    let fixture = fixture();
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
async fn offers_to_take_notes_and_never_records_on_its_own() {
    let fixture = fixture();
    enable_detection(&fixture);
    fixture.probe.set(vec![zoom_user()]);
    let start = Instant::now();
    fixture.service.check_microphone(start).await;
    fixture.service.check_microphone(start + Duration::from_secs(6)).await;

    let status = fixture.service.status().await;
    let prompt = status.prompt.expect("a prompt");
    assert_eq!(prompt.message, "Zoom is using the microphone");
    assert_eq!(status.recording, None, "only asks");
    let shown = fixture.notifier.shown.lock().expect("lock").clone();
    assert_eq!(shown.len(), 1);
    assert_eq!(shown[0].0, "Meeting detected");
    assert!(fixture.service.list().expect("list").is_empty());
}

#[tokio::test]
async fn take_notes_records_both_tracks_until_stop() {
    let fixture = fixture();
    enable_detection(&fixture);
    fixture.probe.set(vec![zoom_user()]);
    let start = Instant::now();
    fixture.service.check_microphone(start).await;
    fixture.service.check_microphone(start + Duration::from_secs(6)).await;

    let record = fixture.service.start_recording(None).await.expect("start");
    assert_eq!(record.app.as_deref(), Some("Zoom"), "named after the prompt");
    assert_eq!(record.status, MeetingStatus::Recording);
    assert_eq!(record.tracks.iter().map(|track| track.kind).collect::<Vec<_>>(), [TrackKind::Mic, TrackKind::System]);
    let status = fixture.service.status().await;
    assert_eq!(status.prompt, None);
    assert_eq!(status.recording.as_ref().map(|recording| recording.id.as_str()), Some(record.id.as_str()));
    assert!(matches!(fixture.service.start_recording(None).await, Err(MeetingError::InvalidState(_))));

    let stopped = fixture.service.stop_recording().await.expect("stop");
    assert_eq!(stopped.status, MeetingStatus::Recorded);
    assert!(stopped.ended_at.is_some());
    assert_eq!(stopped.tracks[0].size_bytes, 3);
    assert_eq!(fixture.stops.load(Ordering::SeqCst), 1);
    assert_eq!(fixture.service.status().await.recording, None);
    assert!(matches!(fixture.service.stop_recording().await, Err(MeetingError::InvalidState(_))));
    assert!(fixture.events.meetings.load(Ordering::SeqCst) >= 2);
}

#[tokio::test]
async fn asks_whether_to_stop_when_the_meeting_seems_over() {
    let fixture = fixture();
    enable_detection(&fixture);
    fixture.service.start_recording(Some("Meet".into())).await.expect("start");
    let start = Instant::now();
    fixture.probe.set(vec![zoom_user()]);
    fixture.service.check_microphone(start).await;
    fixture.probe.set(Vec::new());
    fixture.service.check_microphone(start + Duration::from_secs(16)).await;

    let status = fixture.service.status().await;
    assert!(status.meeting_seems_over);
    assert!(status.recording.is_some(), "it does not stop by itself");
    let shown = fixture.notifier.shown.lock().expect("lock").clone();
    assert_eq!(shown.last().map(|(title, _)| title.as_str()), Some("Is the meeting over?"));

    fixture.service.dismiss_prompt();
    assert!(!fixture.service.status().await.meeting_seems_over);
}

#[tokio::test]
async fn a_recorder_that_cannot_start_leaves_nothing_behind() {
    let fixture = fixture_with(true);
    let error = fixture.service.start_recording(None).await.expect_err("fails");
    assert!(error.to_string().contains("no PipeWire"));
    assert!(fixture.service.list().expect("list").is_empty());
    assert_eq!(fixture.service.status().await.recording, None);
}

#[tokio::test]
async fn transcribes_both_tracks_into_one_transcript() {
    let fixture = fixture();
    let record = fixture.service.start_recording(Some("Zoom".into())).await.expect("start");
    assert!(matches!(
        fixture.service.transcribe_with(&record.id, &FakeTranscriber::default()).await,
        Err(MeetingError::InvalidState(_))
    ));
    fixture.service.stop_recording().await.expect("stop");

    let transcribed =
        fixture.service.transcribe_with(&record.id, &FakeTranscriber::default()).await.expect("transcribe");
    assert_eq!(transcribed.status, MeetingStatus::Transcribed);
    let transcript = fixture.service.transcript(&record.id).expect("transcript");
    assert!(transcript.contains("[00:00:00] Others: Hello everyone."), "{transcript}");
    assert!(transcript.contains("[00:00:01] You: Thanks for joining."), "{transcript}");
    assert!(fixture.service.status().await.transcribing.is_empty());
}

#[tokio::test]
async fn a_failed_transcription_is_saved_and_can_be_retried() {
    let fixture = fixture();
    let record = fixture.service.start_recording(None).await.expect("start");
    fixture.service.stop_recording().await.expect("stop");

    let error = fixture.service.transcribe_with(&record.id, &FakeTranscriber { fails: true }).await.expect_err("fails");
    assert!(error.to_string().contains("bad model"));
    let failed = fixture.service.list().expect("list").remove(0);
    assert_eq!(failed.status, MeetingStatus::TranscriptionFailed);
    assert!(failed.error.as_deref().is_some_and(|message| message.contains("bad model")));

    let retried = fixture.service.transcribe_with(&record.id, &FakeTranscriber::default()).await.expect("retry");
    assert_eq!((retried.status, retried.error), (MeetingStatus::Transcribed, None));
}

#[tokio::test]
async fn a_recording_meeting_cannot_be_deleted() {
    let fixture = fixture();
    let record = fixture.service.start_recording(None).await.expect("start");
    assert!(matches!(fixture.service.delete(&record.id).await, Err(MeetingError::InvalidState(_))));
    fixture.service.stop_recording().await.expect("stop");
    fixture.service.delete(&record.id).await.expect("delete");
    assert!(fixture.service.list().expect("list").is_empty());
}

#[tokio::test]
async fn transcription_needs_whisper_and_a_model() {
    let fixture = fixture();
    let settings =
        MeetingSettings { whisper_cli_path: Some("/nonexistent/whisper-cli".into()), ..MeetingSettings::default() };
    fixture.service.update_settings(settings).expect("save");
    let status = fixture.service.status().await.transcriber;
    assert!(!status.is_ready);
    assert_eq!(status.whisper_model, None);
    assert!(matches!(fixture.service.transcribe("any").await, Err(MeetingError::ToolMissing { .. })));
}
