//! Recording the microphone and the computer's sound with two `pw-record` processes.
//!
//! - mic: the default source (`node.name=graphrt-meeting-mic`)
//! - system: `stream.capture.sink=true`, which WirePlumber links to the default sink's
//!   monitor (`node.name=graphrt-meeting-system`)
//!
//! Both write 16 kHz mono 16-bit WAV, what whisper reads directly. Stop sends SIGINT so
//! pw-record writes the final WAV header, and kills a process still running after
//! [`STOP_TIMEOUT`].

use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::time::Duration;

use futures::future::BoxFuture;
use tokio::io::AsyncReadExt;
use tokio::process::{Child, Command};

use super::pw_dump::OWN_STREAM_PREFIX;
use crate::meeting::platform::{MeetingError, MeetingRecorder, RecordingSession, TrackKind};

const PW_RECORD: &str = "pw-record";
const STOP_TIMEOUT: Duration = Duration::from_secs(5);
/// A track that fails (no device, no PipeWire) exits at once; wait this long to notice.
const STARTUP_CHECK: Duration = Duration::from_millis(400);

/// The pw-record arguments of one track writing to `file`.
pub fn track_arguments(track: TrackKind, file: &Path) -> Vec<String> {
    let properties = match track {
        TrackKind::Mic => format!("{{ node.name={OWN_STREAM_PREFIX}mic media.name=\"graphrt meeting notes (mic)\" }}"),
        TrackKind::System => format!(
            "{{ stream.capture.sink=true node.name={OWN_STREAM_PREFIX}system media.name=\"graphrt meeting notes (system audio)\" }}"
        ),
    };
    vec![
        "-P".into(),
        properties,
        "--rate".into(),
        "16000".into(),
        "--channels".into(),
        "1".into(),
        "--format".into(),
        "s16".into(),
        file.to_string_lossy().into_owned(),
    ]
}

/// Starts `pw-record` for each track.
#[derive(Debug)]
pub struct PwRecordRecorder {
    program: PathBuf,
}

impl Default for PwRecordRecorder {
    fn default() -> Self {
        Self { program: PathBuf::from(PW_RECORD) }
    }
}

impl MeetingRecorder for PwRecordRecorder {
    fn start<'a>(&'a self, dir: &'a Path) -> BoxFuture<'a, Result<Box<dyn RecordingSession>, MeetingError>> {
        Box::pin(async move {
            let mut processes = Vec::new();
            for track in [TrackKind::Mic, TrackKind::System] {
                match self.spawn_track(track, &dir.join(track.file_name())) {
                    Ok(child) => processes.push(TrackProcess { track, child }),
                    Err(error) => {
                        stop_all(processes).await;
                        return Err(error);
                    }
                }
            }
            tokio::time::sleep(STARTUP_CHECK).await;
            for index in 0..processes.len() {
                if let Some(error) = exited_early(&mut processes[index]).await {
                    stop_all(processes).await;
                    return Err(error);
                }
            }
            Ok(Box::new(PwRecordSession { processes }) as Box<dyn RecordingSession>)
        })
    }
}

impl PwRecordRecorder {
    fn spawn_track(&self, track: TrackKind, file: &Path) -> Result<Child, MeetingError> {
        let mut command = Command::new(&self.program);
        crate::child_env::apply_tokio(&mut command);
        command
            .args(track_arguments(track, file))
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::piped())
            .kill_on_drop(true)
            .spawn()
            .map_err(|error| MeetingError::ToolMissing { program: PW_RECORD.into(), reason: error.to_string() })
    }
}

#[derive(Debug)]
struct TrackProcess {
    track: TrackKind,
    child: Child,
}

/// `Some(error)` when the track's process already exited (it could not record).
async fn exited_early(process: &mut TrackProcess) -> Option<MeetingError> {
    match process.child.try_wait() {
        Ok(None) => None,
        Ok(Some(status)) => {
            let mut stderr = String::new();
            if let Some(mut pipe) = process.child.stderr.take() {
                if let Err(error) = pipe.read_to_string(&mut stderr).await {
                    log::warn!("could not read pw-record's errors: {error}");
                }
            }
            let reason =
                if stderr.trim().is_empty() { format!("exited with {status}") } else { stderr.trim().to_owned() };
            let track = match process.track {
                TrackKind::Mic => "the microphone",
                TrackKind::System => "the computer's sound",
            };
            Some(MeetingError::ToolFailed { program: format!("{PW_RECORD} ({track})"), reason })
        }
        Err(error) => Some(MeetingError::Io(error)),
    }
}

#[derive(Debug)]
struct PwRecordSession {
    processes: Vec<TrackProcess>,
}

impl RecordingSession for PwRecordSession {
    fn tracks(&self) -> Vec<TrackKind> {
        self.processes.iter().map(|process| process.track).collect()
    }

    fn stop(self: Box<Self>) -> BoxFuture<'static, Result<(), MeetingError>> {
        Box::pin(async move {
            stop_all(self.processes).await;
            Ok(())
        })
    }
}

async fn stop_all(processes: Vec<TrackProcess>) {
    for mut process in processes {
        interrupt(&process.child);
        match tokio::time::timeout(STOP_TIMEOUT, process.child.wait()).await {
            Ok(Ok(_)) => {}
            Ok(Err(error)) => log::warn!("pw-record did not stop cleanly: {error}"),
            Err(_) => {
                log::warn!("pw-record did not stop within {STOP_TIMEOUT:?}; killing it");
                if let Err(error) = process.child.kill().await {
                    log::warn!("could not kill pw-record: {error}");
                }
            }
        }
    }
}

/// SIGINT, so pw-record finishes the WAV file (a kill would leave its header unfinished).
fn interrupt(child: &Child) {
    let Some(pid) = child.id() else { return };
    let Ok(pid) = libc::pid_t::try_from(pid) else { return };
    // SAFETY: `kill` only sends a signal to our own child process; no memory is shared.
    let result = unsafe { libc::kill(pid, libc::SIGINT) };
    if result != 0 {
        log::warn!("could not interrupt pw-record: {}", std::io::Error::last_os_error());
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_system_track_captures_the_sink_monitor() {
        let arguments = track_arguments(TrackKind::System, Path::new("/tmp/m/system.wav"));
        assert!(arguments[1].contains("stream.capture.sink=true"));
        assert!(arguments[1].contains("node.name=graphrt-meeting-system"));
        assert_eq!(arguments.last().map(String::as_str), Some("/tmp/m/system.wav"));
    }

    #[test]
    fn the_mic_track_records_16_khz_mono() {
        let arguments = track_arguments(TrackKind::Mic, Path::new("mic.wav"));
        assert!(!arguments[1].contains("capture.sink"));
        assert!(arguments[1].contains("node.name=graphrt-meeting-mic"));
        let joined = arguments.join(" ");
        assert!(joined.contains("--rate 16000 --channels 1 --format s16"));
    }
}
