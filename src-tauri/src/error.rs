//! Error type shared by every module and returned to the frontend by Tauri commands.

use serde::Serialize;

/// Errors the desktop backend can report. Each variant maps to a stable `code`
/// the frontend can branch on; `message` is safe to show to the user and never
/// contains secrets.
#[derive(Debug, thiserror::Error)]
pub enum AppError {
    #[error("{0} not found")]
    NotFound(String),
    #[error("invalid input: {0}")]
    InvalidInput(String),
    #[error("database error: {0}")]
    Database(#[from] rusqlite::Error),
    #[error("keychain error: {0}")]
    Credentials(String),
    #[error("no API key is set for {0}")]
    MissingCredentials(String),
    #[error("workflow error: {0}")]
    Workflow(String),
    #[error("model error: {0}")]
    Model(String),
    #[error("schedule error: {0}")]
    Schedule(String),
    #[error("serialization error: {0}")]
    Serialization(#[from] serde_json::Error),
    #[error("{0}")]
    Internal(String),
}

impl AppError {
    /// Stable machine-readable code sent to the frontend.
    pub fn code(&self) -> &'static str {
        match self {
            Self::NotFound(_) => "not_found",
            Self::InvalidInput(_) => "invalid_input",
            Self::Database(_) => "database",
            Self::Credentials(_) => "credentials",
            Self::MissingCredentials(_) => "missing_credentials",
            Self::Workflow(_) => "workflow",
            Self::Model(_) => "model",
            Self::Schedule(_) => "schedule",
            Self::Serialization(_) => "serialization",
            Self::Internal(_) => "internal",
        }
    }
}

/// Serialized as `{ "code": "...", "message": "..." }` so the frontend gets a typed error.
impl Serialize for AppError {
    fn serialize<S: serde::Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        use serde::ser::SerializeStruct;
        let mut state = serializer.serialize_struct("AppError", 2)?;
        state.serialize_field("code", self.code())?;
        state.serialize_field("message", &self.to_string())?;
        state.end()
    }
}

pub type AppResult<T> = Result<T, AppError>;
