//! Meetings on disk: one folder per meeting under `<app data>/meetings/`, with
//! `meta.json`, the tracks (`mic.wav`, `system.wav`) and, once transcribed,
//! `transcript.json` and `transcript.md`.
//!
//! Files rather than SQLite tables: a meeting is a handful of large files the user may
//! want to open, copy or delete in the file manager, and `meta.json` travels with them.

use std::path::{Path, PathBuf};

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

use super::platform::{MeetingError, TrackKind};
use super::transcript::TranscriptLine;

pub const MEETINGS_DIR_NAME: &str = "meetings";
const META_FILE: &str = "meta.json";
pub const TRANSCRIPT_JSON_FILE: &str = "transcript.json";
pub const TRANSCRIPT_MARKDOWN_FILE: &str = "transcript.md";

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum MeetingStatus {
    Recording,
    Recorded,
    Transcribing,
    Transcribed,
    /// Transcription failed; `error` says why. The audio is kept, so it can be retried.
    TranscriptionFailed,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TrackFile {
    pub kind: TrackKind,
    pub file_name: String,
    /// Size on disk, filled in when listing.
    #[serde(default)]
    pub size_bytes: u64,
}

/// One meeting (`meta.json`).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MeetingRecord {
    pub id: String,
    pub title: String,
    /// The program that was using the microphone when recording started ("Zoom").
    pub app: Option<String>,
    pub started_at: DateTime<Utc>,
    pub ended_at: Option<DateTime<Utc>>,
    pub status: MeetingStatus,
    pub tracks: Vec<TrackFile>,
    pub error: Option<String>,
    /// Absolute folder of the meeting (not saved; filled in when read).
    #[serde(default, skip_deserializing)]
    pub folder: String,
}

/// The meetings folder.
#[derive(Debug, Clone)]
pub struct MeetingStore {
    root: PathBuf,
}

impl MeetingStore {
    pub fn new(root: PathBuf) -> Self {
        Self { root }
    }

    pub fn root(&self) -> &Path {
        &self.root
    }

    /// Creates the folder of a new meeting and saves its `meta.json` (status Recording).
    pub fn create(&self, now: DateTime<Utc>, app: Option<String>) -> Result<MeetingRecord, MeetingError> {
        let suffix: String = uuid::Uuid::new_v4().simple().to_string().chars().take(6).collect();
        let id = format!("{}-{suffix}", now.format("%Y%m%d-%H%M%S"));
        std::fs::create_dir_all(self.root.join(&id))?;
        let title = default_title(app.as_deref(), now);
        let record = MeetingRecord {
            id,
            title,
            app,
            started_at: now,
            ended_at: None,
            status: MeetingStatus::Recording,
            tracks: Vec::new(),
            error: None,
            folder: String::new(),
        };
        self.save(&record)?;
        self.get(&record.id)
    }

    pub fn folder(&self, id: &str) -> Result<PathBuf, MeetingError> {
        let is_safe =
            !id.is_empty() && id.chars().all(|character| character.is_ascii_alphanumeric() || character == '-');
        if !is_safe {
            return Err(MeetingError::NotFound(format!("meeting {id}")));
        }
        Ok(self.root.join(id))
    }

    pub fn save(&self, record: &MeetingRecord) -> Result<(), MeetingError> {
        let folder = self.folder(&record.id)?;
        let json = serde_json::to_string_pretty(record)?;
        let temporary = folder.join(format!("{META_FILE}.tmp"));
        std::fs::write(&temporary, json)?;
        std::fs::rename(&temporary, folder.join(META_FILE))?;
        Ok(())
    }

    pub fn get(&self, id: &str) -> Result<MeetingRecord, MeetingError> {
        let folder = self.folder(id)?;
        let json = match std::fs::read_to_string(folder.join(META_FILE)) {
            Ok(json) => json,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                return Err(MeetingError::NotFound(format!("meeting {id}")));
            }
            Err(error) => return Err(error.into()),
        };
        let mut record: MeetingRecord = serde_json::from_str(&json)?;
        record.folder = folder.to_string_lossy().into_owned();
        for track in &mut record.tracks {
            track.size_bytes =
                std::fs::metadata(folder.join(&track.file_name)).map(|metadata| metadata.len()).unwrap_or(0);
        }
        Ok(record)
    }

    /// Every meeting, newest first. Unreadable folders are skipped (and logged).
    pub fn list(&self) -> Result<Vec<MeetingRecord>, MeetingError> {
        let entries = match std::fs::read_dir(&self.root) {
            Ok(entries) => entries,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(Vec::new()),
            Err(error) => return Err(error.into()),
        };
        let mut records = Vec::new();
        for entry in entries.flatten() {
            if !entry.path().join(META_FILE).is_file() {
                continue;
            }
            let id = entry.file_name().to_string_lossy().into_owned();
            match self.get(&id) {
                Ok(record) => records.push(record),
                Err(error) => log::warn!("skipping meeting folder {id}: {error}"),
            }
        }
        records.sort_by_key(|record| std::cmp::Reverse(record.started_at));
        Ok(records)
    }

    /// Meetings left Recording or Transcribing when the app stopped: their files are
    /// what was written until then. Returns how many were fixed.
    pub fn recover_interrupted(&self, now: DateTime<Utc>) -> Result<usize, MeetingError> {
        let mut fixed = 0;
        for mut record in self.list()? {
            let next = match record.status {
                MeetingStatus::Recording => MeetingStatus::Recorded,
                MeetingStatus::Transcribing => MeetingStatus::TranscriptionFailed,
                _ => continue,
            };
            if record.status == MeetingStatus::Recording {
                record.ended_at = Some(record.ended_at.unwrap_or(now));
            } else {
                record.error = Some("graphrt closed while transcribing; transcribe again".into());
            }
            record.status = next;
            self.save(&record)?;
            fixed += 1;
        }
        Ok(fixed)
    }

    pub fn save_transcript(&self, id: &str, lines: &[TranscriptLine], markdown: &str) -> Result<(), MeetingError> {
        let folder = self.folder(id)?;
        std::fs::write(folder.join(TRANSCRIPT_JSON_FILE), serde_json::to_string_pretty(lines)?)?;
        std::fs::write(folder.join(TRANSCRIPT_MARKDOWN_FILE), markdown)?;
        Ok(())
    }

    pub fn transcript_markdown(&self, id: &str) -> Result<String, MeetingError> {
        let path = self.folder(id)?.join(TRANSCRIPT_MARKDOWN_FILE);
        std::fs::read_to_string(&path).map_err(|error| match error.kind() {
            std::io::ErrorKind::NotFound => MeetingError::NotFound(format!("the transcript of meeting {id}")),
            _ => error.into(),
        })
    }

    /// Removes the meeting's folder and everything in it.
    pub fn delete(&self, id: &str) -> Result<(), MeetingError> {
        let folder = self.folder(id)?;
        if !folder.join(META_FILE).is_file() {
            return Err(MeetingError::NotFound(format!("meeting {id}")));
        }
        std::fs::remove_dir_all(folder)?;
        Ok(())
    }
}

/// "Zoom meeting, Nov 26 14:05" / "Meeting, Nov 26 14:05", in local time.
fn default_title(app: Option<&str>, now: DateTime<Utc>) -> String {
    let when = now.with_timezone(&chrono::Local).format("%b %-d %H:%M");
    match app {
        Some(app) => format!("{app} meeting, {when}"),
        None => format!("Meeting, {when}"),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::TimeZone;

    fn store() -> (tempfile::TempDir, MeetingStore) {
        let dir = tempfile::tempdir().expect("temp dir");
        let store = MeetingStore::new(dir.path().join(MEETINGS_DIR_NAME));
        (dir, store)
    }

    fn at(hour: u32) -> DateTime<Utc> {
        Utc.with_ymd_and_hms(2026, 11, 26, hour, 5, 0).single().expect("valid time")
    }

    #[test]
    fn creates_lists_newest_first_and_reads_back() {
        let (_dir, store) = store();
        let first = store.create(at(9), Some("Zoom".into())).expect("create");
        let second = store.create(at(10), None).expect("create");
        assert!(first.title.starts_with("Zoom meeting, Nov 26"));
        assert!(second.title.starts_with("Meeting, "));
        assert_eq!(first.status, MeetingStatus::Recording);

        let ids: Vec<String> = store.list().expect("list").into_iter().map(|record| record.id).collect();
        assert_eq!(ids, [second.id.clone(), first.id.clone()]);
        assert!(store.get(&first.id).expect("get").folder.ends_with(&first.id));
    }

    #[test]
    fn track_sizes_are_read_from_disk() {
        let (_dir, store) = store();
        let mut record = store.create(at(9), None).expect("create");
        std::fs::write(store.folder(&record.id).expect("folder").join("mic.wav"), [0_u8; 44]).expect("write");
        record.tracks = vec![TrackFile { kind: TrackKind::Mic, file_name: "mic.wav".into(), size_bytes: 0 }];
        store.save(&record).expect("save");
        assert_eq!(store.get(&record.id).expect("get").tracks[0].size_bytes, 44);
    }

    #[test]
    fn interrupted_meetings_are_recovered() {
        let (_dir, store) = store();
        let recording = store.create(at(9), None).expect("create");
        let mut transcribing = store.create(at(10), None).expect("create");
        transcribing.status = MeetingStatus::Transcribing;
        store.save(&transcribing).expect("save");

        assert_eq!(store.recover_interrupted(at(11)).expect("recover"), 2);
        let recording = store.get(&recording.id).expect("get");
        assert_eq!((recording.status, recording.ended_at), (MeetingStatus::Recorded, Some(at(11))));
        let transcribing = store.get(&transcribing.id).expect("get");
        assert_eq!(transcribing.status, MeetingStatus::TranscriptionFailed);
        assert!(transcribing.error.is_some());
        assert_eq!(store.recover_interrupted(at(12)).expect("recover"), 0);
    }

    #[test]
    fn ids_cannot_leave_the_meetings_folder() {
        let (_dir, store) = store();
        assert!(matches!(store.get("../secrets"), Err(MeetingError::NotFound(_))));
        assert!(matches!(store.delete("a/b"), Err(MeetingError::NotFound(_))));
        assert!(matches!(store.get(""), Err(MeetingError::NotFound(_))));
    }

    #[test]
    fn saves_and_deletes_transcripts() {
        let (_dir, store) = store();
        let record = store.create(at(9), None).expect("create");
        assert!(matches!(store.transcript_markdown(&record.id), Err(MeetingError::NotFound(_))));
        store.save_transcript(&record.id, &[], "# Meeting\n").expect("save transcript");
        assert_eq!(store.transcript_markdown(&record.id).expect("read"), "# Meeting\n");
        store.delete(&record.id).expect("delete");
        assert!(store.list().expect("list").is_empty());
    }

    #[test]
    fn listing_a_missing_folder_is_empty() {
        let (_dir, store) = store();
        assert!(store.list().expect("list").is_empty());
    }
}
