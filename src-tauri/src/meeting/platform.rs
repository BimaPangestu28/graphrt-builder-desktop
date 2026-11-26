//! What each operating system provides for the notetaker: who is using the microphone,
//! and recording the microphone and the computer's sound as two tracks.
//!
//! Linux implements these with PipeWire (`super::linux`); other systems get
//! [`UnsupportedPlatform`] until their backends exist (see docs/design/meeting-notetaker.md).

use std::path::Path;

use futures::future::BoxFuture;
use serde::{Deserialize, Serialize};

/// Errors of the notetaker. Messages are safe to show to the user.
#[derive(Debug, thiserror::Error)]
pub enum MeetingError {
    #[error("meeting notes are not supported on this system yet")]
    Unsupported,
    #[error("{program} is not available: {reason}")]
    ToolMissing { program: String, reason: String },
    #[error("{program} failed: {reason}")]
    ToolFailed { program: String, reason: String },
    #[error("could not read the audio system's state: {0}")]
    Parse(String),
    #[error("file error: {0}")]
    Io(#[from] std::io::Error),
    #[error("{0}")]
    InvalidState(String),
    #[error("{0} not found")]
    NotFound(String),
    #[error("serialization error: {0}")]
    Serialization(#[from] serde_json::Error),
}

impl From<MeetingError> for crate::error::AppError {
    fn from(error: MeetingError) -> Self {
        match error {
            MeetingError::NotFound(what) => Self::NotFound(what),
            MeetingError::InvalidState(reason) => Self::InvalidInput(reason),
            MeetingError::Serialization(error) => Self::Serialization(error),
            other => Self::Internal(other.to_string()),
        }
    }
}

/// A program capturing the microphone right now.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MicUser {
    /// The audio system's id of the capture stream (stable while it runs).
    pub stream_id: u32,
    /// What the program calls itself ("ZOOM VoiceEngine", "Google Chrome input").
    pub app_name: String,
    /// Executable name when known ("zoom", "chrome").
    pub binary: Option<String>,
    pub pid: Option<u32>,
}

/// Which recorded track a file holds.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum TrackKind {
    /// The user's microphone ("You").
    Mic,
    /// The computer's sound: the other participants ("Others").
    System,
}

impl TrackKind {
    pub fn file_name(self) -> &'static str {
        match self {
            Self::Mic => "mic.wav",
            Self::System => "system.wav",
        }
    }

    pub fn speaker_label(self) -> &'static str {
        match self {
            Self::Mic => "You",
            Self::System => "Others",
        }
    }
}

/// Finds the programs that capture the microphone.
pub trait AudioActivityProbe: Send + Sync + std::fmt::Debug {
    fn mic_users(&self) -> BoxFuture<'_, Result<Vec<MicUser>, MeetingError>>;
}

/// Starts recording the microphone and the computer's sound into a folder.
pub trait MeetingRecorder: Send + Sync + std::fmt::Debug {
    /// Starts both tracks in `dir` (which exists). Fails when either track cannot start;
    /// nothing keeps running then.
    fn start<'a>(&'a self, dir: &'a Path) -> BoxFuture<'a, Result<Box<dyn RecordingSession>, MeetingError>>;
}

/// A recording in progress.
pub trait RecordingSession: Send + std::fmt::Debug {
    /// The tracks being written.
    fn tracks(&self) -> Vec<TrackKind>;
    /// Stops every track and waits until the files are complete.
    fn stop(self: Box<Self>) -> BoxFuture<'static, Result<(), MeetingError>>;
}

/// The backend of systems without a notetaker yet: every call says so.
#[derive(Debug, Default)]
pub struct UnsupportedPlatform;

impl AudioActivityProbe for UnsupportedPlatform {
    fn mic_users(&self) -> BoxFuture<'_, Result<Vec<MicUser>, MeetingError>> {
        Box::pin(async { Err(MeetingError::Unsupported) })
    }
}

impl MeetingRecorder for UnsupportedPlatform {
    fn start<'a>(&'a self, _dir: &'a Path) -> BoxFuture<'a, Result<Box<dyn RecordingSession>, MeetingError>> {
        Box::pin(async { Err(MeetingError::Unsupported) })
    }
}
