//! PipeWire backend: `pw-dump` for who uses the microphone, `pw-record` for the two tracks.
//!
//! Both tools ship with PipeWire (`pipewire-bin` on Debian/Ubuntu), which every current
//! desktop distribution runs; apps that speak PulseAudio show up through pipewire-pulse.

pub mod pw_dump;
pub mod pw_record;

use futures::future::BoxFuture;
use tokio::process::Command;

use super::platform::{AudioActivityProbe, MeetingError, MicUser};

const PW_DUMP: &str = "pw-dump";

/// Lists mic users by running `pw-dump` and parsing its JSON.
#[derive(Debug, Default)]
pub struct PipeWireProbe;

impl AudioActivityProbe for PipeWireProbe {
    fn mic_users(&self) -> BoxFuture<'_, Result<Vec<MicUser>, MeetingError>> {
        Box::pin(async {
            let mut command = Command::new(PW_DUMP);
            crate::child_env::apply_tokio(&mut command);
            let output = command
                .kill_on_drop(true)
                .output()
                .await
                .map_err(|error| MeetingError::ToolMissing { program: PW_DUMP.into(), reason: error.to_string() })?;
            if !output.status.success() {
                return Err(MeetingError::ToolFailed {
                    program: PW_DUMP.into(),
                    reason: String::from_utf8_lossy(&output.stderr).trim().to_owned(),
                });
            }
            let json = String::from_utf8_lossy(&output.stdout);
            pw_dump::parse_mic_users(&json, std::process::id())
        })
    }
}
