//! Runs agents on the graphrt engine and streams their events to the UI.
//!
//! A run is a tokio task that drives the graphrt event stream, persists every
//! event (`storage::runs`), and emits it to the frontend as the Tauri event
//! [`RUN_EVENT`]. When graphrt pauses (approval / human input) the snapshot is
//! stored and the task ends; `resume_run` continues it from the snapshot.

pub mod tauri_sink;

use std::sync::Arc;

use serde::{Deserialize, Serialize};

use crate::credentials::CredentialStore;
use crate::error::{AppError, AppResult};
use crate::storage::models::{Run, RunStatus, RunTrigger};
use crate::storage::Database;

/// Name of the Tauri event carrying [`RunEventPayload`].
pub const RUN_EVENT: &str = "run-event";

/// Sent to the frontend for every graphrt event of a run, and once more when
/// the run's status changes (then `event` is `{"type": "status_changed"}`).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RunEventPayload {
    pub run_id: String,
    pub agent_id: String,
    pub seq: i64,
    pub status: RunStatus,
    pub event: serde_json::Value,
}

/// Delivers run events to the UI. The app uses a Tauri emitter; tests collect them.
pub trait RunEventSink: Send + Sync + std::fmt::Debug {
    fn send(&self, payload: RunEventPayload);
}

#[derive(Debug)]
pub struct RunManager {
    // CONTRACT: implementation detail of the engine owner.
    _db: Arc<Database>,
    _credentials: Arc<CredentialStore>,
    _sink: Arc<dyn RunEventSink>,
}

impl RunManager {
    pub fn new(db: Arc<Database>, credentials: Arc<CredentialStore>, sink: Arc<dyn RunEventSink>) -> Self {
        Self { _db: db, _credentials: credentials, _sink: sink }
    }

    /// Starts the agent's current version with workflow inputs (JSON object) and
    /// returns the run right away (status `Running`); events follow on the sink.
    pub async fn start_run(&self, _agent_id: &str, _trigger: RunTrigger, _inputs: serde_json::Value) -> AppResult<Run> {
        Err(AppError::Internal("not implemented".into()))
    }

    /// Resumes a paused run. `node_inputs` maps the paused node id to the user's
    /// answer, e.g. `{"approve_message": {"action": "approve", "values": {"message": "..."}}}`.
    pub async fn resume_run(&self, _run_id: &str, _node_inputs: serde_json::Value) -> AppResult<Run> {
        Err(AppError::Internal("not implemented".into()))
    }

    /// Stops a running or paused run (status `Aborted`).
    pub fn abort_run(&self, _run_id: &str) -> AppResult<()> {
        Err(AppError::Internal("not implemented".into()))
    }
}
