use std::path::Path;
use std::time::{Duration, Instant, SystemTime};

use super::*;

fn hex(text: &str) -> String {
    text.bytes().map(|byte| format!("{byte:02x}")).collect()
}

fn write_frame(directory: &Path, frame_key: &str, bytes: &[u8]) {
    std::fs::write(directory.join(format!("{frame_key}.jpg")), bytes).unwrap();
}

fn set_modified(directory: &Path, frame_key: &str, modified: SystemTime) {
    let file = std::fs::File::options().write(true).open(directory.join(format!("{frame_key}.jpg"))).unwrap();
    file.set_modified(modified).unwrap();
}

#[test]
fn parses_node_frame_names_with_a_hex_node_id() {
    let file_name = format!("node.{}.1f2e3d4c5b6a.jpg", hex("search_maps"));
    let source = parse_frame_file_name(&file_name).unwrap();
    assert_eq!(source.node_id.as_deref(), Some("search_maps"));
    assert_eq!(source.frame_key, format!("node.{}.1f2e3d4c5b6a", hex("search_maps")));
}

#[test]
fn parses_page_frame_names_without_a_node() {
    let source = parse_frame_file_name("page.abc123.jpg").unwrap();
    assert_eq!(source, FrameSource { frame_key: "page.abc123".into(), node_id: None });
}

#[test]
fn ignores_temp_files_other_files_and_malformed_names() {
    for file_name in [
        ".page.abc123.tmp",
        "page.abc123.png",
        "page..jpg",
        "page.abc.def.jpg",
        "node.zz.abc.jpg",
        "node.616.abc.jpg",
        "node.616263.jpg",
        "notes.txt",
        "other.abc.jpg",
        "node.c328.abc.jpg",
    ] {
        assert_eq!(parse_frame_file_name(file_name), None, "{file_name}");
    }
}

#[test]
fn data_url_is_base64_jpeg() {
    assert_eq!(to_data_url(b"jpeg"), "data:image/jpeg;base64,anBlZw==");
}

#[test]
fn scan_sends_new_frames_once_and_again_only_when_the_image_changes() {
    let folder = tempfile::tempdir().unwrap();
    let frame_key = format!("node.{}.abc", hex("search"));
    write_frame(folder.path(), &frame_key, b"first");
    let mut watcher = FrameWatcher::new(folder.path().to_path_buf());
    let now = SystemTime::now();

    let updates = watcher.scan(now);
    assert_eq!(
        updates,
        vec![LiveViewFrame {
            frame_key: frame_key.clone(),
            node_id: Some("search".into()),
            image: Some(to_data_url(b"first"))
        }]
    );
    assert!(watcher.scan(now).is_empty(), "an unchanged file is not sent again");

    write_frame(folder.path(), &frame_key, b"first");
    set_modified(folder.path(), &frame_key, now - Duration::from_secs(1));
    assert!(watcher.scan(now).is_empty(), "a rewritten but identical image is not sent again");

    write_frame(folder.path(), &frame_key, b"second");
    set_modified(folder.path(), &frame_key, now);
    let updates = watcher.scan(now);
    assert_eq!(updates.len(), 1);
    assert_eq!(updates[0].image.as_deref(), Some(to_data_url(b"second").as_str()));
}

#[test]
fn scan_does_not_read_a_file_whose_time_and_size_are_unchanged() {
    let folder = tempfile::tempdir().unwrap();
    let modified = SystemTime::now() - Duration::from_secs(1);
    write_frame(folder.path(), "page.abc", b"aaaa");
    set_modified(folder.path(), "page.abc", modified);
    let mut watcher = FrameWatcher::new(folder.path().to_path_buf());
    assert_eq!(watcher.scan(SystemTime::now()).len(), 1);

    // Same size and time: the listing alone says nothing changed, so the new bytes are not read.
    write_frame(folder.path(), "page.abc", b"bbbb");
    set_modified(folder.path(), "page.abc", modified);
    assert!(watcher.scan(SystemTime::now()).is_empty());
}

#[test]
fn scan_sends_a_frame_whose_size_changed_within_the_same_timestamp() {
    let folder = tempfile::tempdir().unwrap();
    let modified = SystemTime::now() - Duration::from_secs(1);
    write_frame(folder.path(), "page.abc", b"first");
    set_modified(folder.path(), "page.abc", modified);
    let mut watcher = FrameWatcher::new(folder.path().to_path_buf());
    assert_eq!(watcher.scan(SystemTime::now()).len(), 1);

    // Coarse file system clocks: the next frame can carry the same modification time.
    write_frame(folder.path(), "page.abc", b"second frame");
    set_modified(folder.path(), "page.abc", modified);
    let updates = watcher.scan(SystemTime::now());
    assert_eq!(updates.len(), 1);
    assert_eq!(updates[0].image.as_deref(), Some(to_data_url(b"second frame").as_str()));
}

#[test]
fn scan_ends_a_page_when_its_file_is_deleted() {
    let folder = tempfile::tempdir().unwrap();
    write_frame(folder.path(), "page.abc", b"frame");
    let mut watcher = FrameWatcher::new(folder.path().to_path_buf());
    let now = SystemTime::now();
    assert_eq!(watcher.scan(now).len(), 1);

    std::fs::remove_file(folder.path().join("page.abc.jpg")).unwrap();
    assert_eq!(watcher.scan(now), vec![LiveViewFrame { frame_key: "page.abc".into(), node_id: None, image: None }]);
    assert!(watcher.scan(now).is_empty());
}

#[test]
fn scan_deletes_stale_frames_and_ends_their_page() {
    let folder = tempfile::tempdir().unwrap();
    write_frame(folder.path(), "page.abc", b"frame");
    let mut watcher = FrameWatcher::new(folder.path().to_path_buf());
    let now = SystemTime::now();
    assert_eq!(watcher.scan(now).len(), 1);

    let later = now + STALE_AFTER + Duration::from_secs(1);
    assert_eq!(watcher.scan(later), vec![LiveViewFrame { frame_key: "page.abc".into(), node_id: None, image: None }]);
    assert!(!folder.path().join("page.abc.jpg").exists());
}

#[test]
fn scan_skips_empty_oversized_and_unknown_files() {
    let folder = tempfile::tempdir().unwrap();
    write_frame(folder.path(), "page.empty", b"");
    write_frame(folder.path(), "page.huge", &vec![0_u8; usize::try_from(MAX_FRAME_BYTES).unwrap() + 1]);
    std::fs::write(folder.path().join("notes.txt"), b"not a frame").unwrap();
    std::fs::write(folder.path().join(".page.abc.tmp"), b"partial").unwrap();
    let mut watcher = FrameWatcher::new(folder.path().to_path_buf());
    assert!(watcher.scan(SystemTime::now()).is_empty());
}

#[test]
fn scan_of_a_missing_folder_sends_nothing() {
    let folder = tempfile::tempdir().unwrap();
    let mut watcher = FrameWatcher::new(folder.path().join("missing"));
    assert!(watcher.scan(SystemTime::now()).is_empty());
}

#[test]
fn reset_directory_empties_the_folder_and_keeps_it() {
    let folder = tempfile::tempdir().unwrap();
    let directory = folder.path().join(LIVE_VIEW_DIR_NAME);
    std::fs::create_dir_all(&directory).unwrap();
    write_frame(&directory, "page.abc", b"left over");
    reset_directory(&directory);
    assert!(directory.is_dir());
    assert_eq!(std::fs::read_dir(&directory).unwrap().count(), 0);
}

#[test]
fn serializes_frames_in_camel_case() {
    let frame = LiveViewFrame { frame_key: "page.abc".into(), node_id: None, image: None };
    assert_eq!(
        serde_json::to_value(frame).unwrap(),
        serde_json::json!({"frameKey": "page.abc", "nodeId": null, "image": null})
    );
}

#[test]
fn plugin_env_entry_names_the_folder() {
    let entry = plugin_env_entry(Path::new("/data/live-view"));
    assert_eq!(entry, ("GRAPHRT_LIVE_VIEW_DIR".to_owned(), "/data/live-view".to_owned()));
}

#[test]
fn polls_slowly_until_something_happens() {
    let pacing = PollPacing::idle();
    assert_eq!(pacing.next_delay(Instant::now()), IDLE_POLL_INTERVAL);
}

#[test]
fn polls_fast_during_activity_then_backs_off_after_the_grace_period() {
    let started = Instant::now();
    let mut pacing = PollPacing::idle();
    pacing.note_activity(started);
    assert_eq!(pacing.next_delay(started + Duration::from_millis(50)), ACTIVE_POLL_INTERVAL);
    assert_eq!(pacing.next_delay(started + ACTIVE_GRACE - Duration::from_millis(1)), ACTIVE_POLL_INTERVAL);
    assert_eq!(pacing.next_delay(started + ACTIVE_GRACE), IDLE_POLL_INTERVAL);
}

#[test]
fn a_page_is_live_while_its_frame_file_exists() {
    let folder = tempfile::tempdir().unwrap();
    let mut watcher = FrameWatcher::new(folder.path().to_path_buf());
    assert!(!watcher.has_live_pages());
    write_frame(folder.path(), "page.abc", b"frame");
    watcher.scan(SystemTime::now());
    assert!(watcher.has_live_pages());
    std::fs::remove_file(folder.path().join("page.abc.jpg")).unwrap();
    watcher.scan(SystemTime::now());
    assert!(!watcher.has_live_pages());
}

#[test]
fn many_wake_ups_never_block_and_collapse_into_one() {
    let (waker, wakeups) = LiveViewWaker::channel();
    for _ in 0..100 {
        waker.wake();
    }
    assert!(wakeups.try_recv().is_ok());
    assert!(wakeups.try_recv().is_err());
}

#[test]
fn only_a_run_starting_or_starting_a_step_wakes_the_watcher() {
    use crate::storage::models::RunStatus;
    let payload = |status: RunStatus, event_type: &str| crate::engine::RunEventPayload {
        run_id: "run".into(),
        agent_id: "agent".into(),
        seq: 1,
        status,
        event: serde_json::json!({"type": event_type}),
    };
    assert!(may_open_a_page(&payload(RunStatus::Running, "node_started")));
    assert!(may_open_a_page(&payload(RunStatus::Running, "status_changed")));
    assert!(!may_open_a_page(&payload(RunStatus::Running, "node_chunk")));
    assert!(!may_open_a_page(&payload(RunStatus::Succeeded, "status_changed")));
}

#[derive(Debug, Default)]
struct CollectingSink {
    frames: std::sync::Mutex<Vec<LiveViewFrame>>,
}

impl LiveViewSink for CollectingSink {
    fn send(&self, frame: LiveViewFrame) {
        self.frames.lock().unwrap().push(frame);
    }
}

#[test]
fn a_wake_up_shows_the_first_frame_without_waiting_for_the_idle_poll() {
    let folder = tempfile::tempdir().unwrap();
    let sink = Arc::new(CollectingSink::default());
    let waker = spawn(folder.path().to_path_buf(), sink.clone());
    // Let the watcher's first scan pass, so it waits on the idle interval.
    std::thread::sleep(Duration::from_millis(50));
    write_frame(folder.path(), "page.abc", b"frame");
    let woken_at = Instant::now();
    waker.wake();
    while sink.frames.lock().unwrap().is_empty() {
        assert!(woken_at.elapsed() < IDLE_POLL_INTERVAL / 2, "the frame waited for the idle poll");
        std::thread::sleep(Duration::from_millis(5));
    }
    assert_eq!(sink.frames.lock().unwrap()[0].frame_key, "page.abc");
}
