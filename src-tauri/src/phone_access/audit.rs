//! What paired phones did, for the person to look at: pairings, removals, requests
//! answered from a phone, and refused pairing attempts. Kept in
//! `<app data>/phone-access/activity.json` (the newest [`MAX_ENTRIES`]), never with a code
//! or a token in it.

use std::path::PathBuf;
use std::sync::Mutex;

use serde::{Deserialize, Serialize};

use crate::error::{AppError, AppResult};

/// Entries kept; older ones are dropped.
const MAX_ENTRIES: usize = 200;
const FILE_NAME: &str = "activity.json";

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ActivityKind {
    /// A phone used its pairing code.
    Paired,
    /// The person removed a phone on this computer.
    Removed,
    /// A phone unpaired itself in its page.
    UnpairedItself,
    /// A phone answered a request of a run.
    Answered,
    /// A pairing code was refused (unknown, used or expired) or came too often.
    PairingRefused,
}

/// One thing that happened.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Activity {
    pub at_ms: u64,
    pub kind: ActivityKind,
    pub device_id: Option<String>,
    pub device_name: Option<String>,
    /// The run it was about, for `answered`.
    pub run_id: Option<String>,
    /// The agent it was about, for `answered`.
    pub agent_name: Option<String>,
}

/// The activity log of this computer.
#[derive(Debug)]
pub struct ActivityLog {
    path: Option<PathBuf>,
    entries: Mutex<Vec<Activity>>,
}

impl ActivityLog {
    /// The log kept in `dir`, read now. An unreadable file starts an empty log.
    pub fn open(dir: Option<PathBuf>) -> Self {
        let path = dir.map(|dir| dir.join(FILE_NAME));
        let entries = path
            .as_ref()
            .and_then(|path| std::fs::read(path).ok())
            .and_then(|bytes| serde_json::from_slice::<Vec<Activity>>(&bytes).ok())
            .unwrap_or_default();
        Self { path, entries: Mutex::new(entries) }
    }

    /// Adds `activity`. A failed write is logged: the action itself already happened.
    pub fn record(&self, activity: Activity) {
        let Ok(mut entries) = self.entries.lock() else { return };
        entries.push(activity);
        if entries.len() > MAX_ENTRIES {
            let excess = entries.len() - MAX_ENTRIES;
            entries.drain(..excess);
        }
        if let Some(path) = &self.path {
            if let Err(error) = write_private(path, &entries) {
                log::warn!("phone access: cannot save the activity log: {error}");
            }
        }
    }

    /// The newest `limit` entries, newest first.
    ///
    /// # Errors
    /// `Internal` when the log is unavailable.
    pub fn newest(&self, limit: usize) -> AppResult<Vec<Activity>> {
        let entries = self.entries.lock().map_err(|_| AppError::Internal("the activity log is unavailable".into()))?;
        Ok(entries.iter().rev().take(limit).cloned().collect())
    }
}

/// Writes `entries` to a temporary file next to `path` and moves it in place, readable by
/// this user only.
fn write_private(path: &std::path::Path, entries: &[Activity]) -> std::io::Result<()> {
    let bytes = serde_json::to_vec(entries).map_err(std::io::Error::other)?;
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir)?;
    }
    let temporary = path.with_extension("json.tmp");
    let mut options = std::fs::OpenOptions::new();
    options.write(true).create(true).truncate(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    let mut file = options.open(&temporary)?;
    std::io::Write::write_all(&mut file, &bytes)?;
    file.sync_all()?;
    std::fs::rename(&temporary, path)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn paired(at_ms: u64) -> Activity {
        Activity {
            at_ms,
            kind: ActivityKind::Paired,
            device_id: Some("dev-1".into()),
            device_name: Some("Ana's phone".into()),
            run_id: None,
            agent_name: None,
        }
    }

    #[test]
    fn the_log_survives_a_restart_and_keeps_the_newest() {
        let dir = tempfile::tempdir().unwrap();
        let log = ActivityLog::open(Some(dir.path().to_path_buf()));
        for at_ms in 0..(MAX_ENTRIES as u64 + 5) {
            log.record(paired(at_ms));
        }
        let reopened = ActivityLog::open(Some(dir.path().to_path_buf()));
        let newest = reopened.newest(3).unwrap();
        assert_eq!(newest.iter().map(|entry| entry.at_ms).collect::<Vec<_>>(), [204, 203, 202]);
        assert_eq!(reopened.newest(usize::MAX).unwrap().len(), MAX_ENTRIES);
    }

    #[test]
    fn an_unreadable_file_starts_an_empty_log() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join(FILE_NAME), b"{ not json").unwrap();
        assert!(ActivityLog::open(Some(dir.path().to_path_buf())).newest(10).unwrap().is_empty());
    }
}
