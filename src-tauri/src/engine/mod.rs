//! Runs agents on the graphrt engine and streams their events to the UI.
//!
//! A run is a task that drives the graphrt event stream, persists every
//! event (`storage::runs`), and emits it to the frontend as the Tauri event
//! [`RUN_EVENT`]. When graphrt pauses (approval / human input) the snapshot is
//! stored and the task ends; `resume_run` continues it from the snapshot.
//!
//! Layout:
//! - [`RunManager`] (this file): the public start / resume / abort API.
//! - `preparation`: everything checked and built before a run exists
//!   (workflow, credentials, graphrt services, inputs).
//! - `driver`: the task that consumes one graphrt stream and records it.
//! - [`ModelRegistrySource`]: where model clients come from (keychain in the
//!   app, scripted mock models in tests).
//!
//! Workflow `env.*` values: graphrt never stores them in snapshots, so they
//! must be supplied on every start AND resume. Both paths get them from
//! `preparation::workflow_env`, which currently returns an empty map; a future
//! env/secret provider plugs in there and nowhere else.

mod driver;
mod preparation;
pub mod tauri_sink;
#[cfg(test)]
mod tests;

use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex, MutexGuard};

use graphrt_core::{RunHandle, RunInput, Snapshot};
use serde::{Deserialize, Serialize};

use self::driver::RunDriver;
use crate::credentials::CredentialStore;
use crate::error::{AppError, AppResult};
use crate::storage::models::{Run, RunStatus, RunTrigger};
use crate::storage::Database;

/// Name of the Tauri event carrying [`RunEventPayload`].
pub const RUN_EVENT: &str = "run-event";

/// Reason graphrt records on the `run_aborted` event when the user stops a run.
const USER_ABORT_REASON: &str = "Stopped by the user";

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

/// Provides the graphrt model registry for each run.
///
/// The app uses [`KeychainModelRegistrySource`]; tests inject scripted
/// `graphrt_llm::mock::MockModel`s through [`RunManager::with_model_registry_source`].
pub trait ModelRegistrySource: Send + Sync + std::fmt::Debug {
    /// Builds the registry for one run (called on every start and resume).
    ///
    /// # Errors
    /// Any `AppError`; the run is then not started.
    fn build_registry(&self, credentials: &CredentialStore, db: &Database) -> AppResult<graphrt_llm::ModelRegistry>;
}

/// Model clients built from the API keys in the OS keychain.
#[derive(Debug, Default)]
pub struct KeychainModelRegistrySource;

impl ModelRegistrySource for KeychainModelRegistrySource {
    fn build_registry(&self, credentials: &CredentialStore, db: &Database) -> AppResult<graphrt_llm::ModelRegistry> {
        crate::credentials::build_model_registry(credentials, db)
    }
}

/// Control handle of a run whose task is currently driving its stream.
///
/// `drive_id` identifies one task: after a pause and quick resume, the old
/// task must not remove the handle the new task registered for the same run.
#[derive(Debug, Clone)]
struct ActiveRun {
    drive_id: u64,
    handle: RunHandle,
}

/// Runs in progress, keyed by run id. Shared with every driver task.
#[derive(Debug, Default)]
pub(crate) struct ActiveRuns {
    runs: Mutex<HashMap<String, ActiveRun>>,
    next_drive_id: AtomicU64,
}

impl ActiveRuns {
    fn lock(&self) -> AppResult<MutexGuard<'_, HashMap<String, ActiveRun>>> {
        self.runs.lock().map_err(|_| AppError::Internal("active run table lock poisoned".into()))
    }

    /// Registers the handle of a new driver task and returns its `drive_id`.
    fn register(&self, run_id: &str, handle: RunHandle) -> AppResult<u64> {
        let drive_id = self.next_drive_id.fetch_add(1, Ordering::Relaxed);
        self.lock()?.insert(run_id.to_owned(), ActiveRun { drive_id, handle });
        Ok(drive_id)
    }

    /// Removes the handle only if it still belongs to the task `drive_id`.
    fn remove(&self, run_id: &str, drive_id: u64) {
        match self.lock() {
            Ok(mut runs) => {
                if runs.get(run_id).is_some_and(|active| active.drive_id == drive_id) {
                    runs.remove(run_id);
                }
            }
            Err(error) => log::warn!("could not unregister run {run_id}: {error}"),
        }
    }

    fn handle(&self, run_id: &str) -> AppResult<Option<RunHandle>> {
        Ok(self.lock()?.get(run_id).map(|active| active.handle.clone()))
    }
}

/// Starts, resumes and aborts agent runs. One per app, shared as `Arc<RunManager>`.
#[derive(Debug)]
pub struct RunManager {
    db: Arc<Database>,
    credentials: Arc<CredentialStore>,
    sink: Arc<dyn RunEventSink>,
    model_source: Arc<dyn ModelRegistrySource>,
    active_runs: Arc<ActiveRuns>,
}

impl RunManager {
    pub fn new(db: Arc<Database>, credentials: Arc<CredentialStore>, sink: Arc<dyn RunEventSink>) -> Self {
        Self {
            db,
            credentials,
            sink,
            model_source: Arc::new(KeychainModelRegistrySource),
            active_runs: Arc::new(ActiveRuns::default()),
        }
    }

    /// Replaces where model clients come from (tests use scripted mock models).
    /// The provider-key check in `start_run` / `resume_run` still applies.
    pub fn with_model_registry_source(mut self, model_source: Arc<dyn ModelRegistrySource>) -> Self {
        self.model_source = model_source;
        self
    }

    /// Starts the agent's current version with workflow inputs (JSON object) and
    /// returns the run right away (status `Running`); events follow on the sink.
    ///
    /// # Errors
    /// - `NotFound` when the agent does not exist.
    /// - `InvalidInput` / `Workflow` when the flow does not compile or `inputs` is not an object.
    /// - `MissingCredentials` when a model provider used by the flow has no key;
    ///   no run is recorded in that case.
    pub async fn start_run(&self, agent_id: &str, trigger: RunTrigger, inputs: serde_json::Value) -> AppResult<Run> {
        let agent = self.db.get_agent(agent_id)?;
        let engine = preparation::build_engine(&agent.flow_yaml, &self.credentials, &self.db, &*self.model_source)?;
        let mut run_input = RunInput::new();
        run_input.inputs = preparation::json_object_to_value_map(inputs, "run inputs")?;
        run_input.env = preparation::workflow_env(&agent)?;

        let run = self.db.insert_run(agent_id, agent.current_version, trigger)?;
        self.driver_for(&run).send_status(&run.id, RunStatus::Running);
        self.spawn_driver(&run, engine.run(run_input))?;
        Ok(run)
    }

    /// Resumes a paused run. `node_inputs` maps the paused node id to the user's
    /// answer, e.g. `{"approve_message": {"action": "approve", "values": {"message": "..."}}}`.
    ///
    /// The run resumes on the agent version it started with, even if the agent
    /// was edited meanwhile (graphrt rejects snapshots from a different graph).
    ///
    /// # Errors
    /// - `NotFound` for an unknown run, or when its agent version no longer exists.
    /// - `InvalidInput` when the run is not paused or `node_inputs` is not an object.
    /// - `MissingCredentials` when a model provider used by the flow has no key.
    pub async fn resume_run(&self, run_id: &str, node_inputs: serde_json::Value) -> AppResult<Run> {
        let run = self.db.get_run(run_id)?;
        if run.status != RunStatus::Paused {
            return Err(AppError::InvalidInput(format!("run {run_id} is not paused")));
        }
        let agent = self.db.get_agent(&run.agent_id)?;
        let flow_yaml = preparation::flow_for_version(&self.db, &agent, run.agent_version)?;
        let engine = preparation::build_engine(&flow_yaml, &self.credentials, &self.db, &*self.model_source)?;
        let snapshot = Snapshot::from_json(&self.db.get_run_snapshot(run_id)?)?;
        let resume_inputs = preparation::json_object_to_value_map(node_inputs, "node inputs")?;
        let mut run_input = RunInput::new().resume(snapshot, resume_inputs);
        run_input.env = preparation::workflow_env(&agent)?;

        // Validates the Paused → Running transition atomically, so two
        // concurrent resumes cannot both start a task.
        self.db.mark_run_resumed(run_id)?;
        self.driver_for(&run).send_status(run_id, RunStatus::Running);
        self.spawn_driver(&run, engine.run(run_input))?;
        self.db.get_run(run_id)
    }

    /// Stops a running or paused run (status `Aborted`).
    ///
    /// A running run is aborted through its graphrt handle and its task records
    /// the `run_aborted` event; a paused run (no task) is finished directly.
    ///
    /// # Errors
    /// - `NotFound` for an unknown run.
    /// - `InvalidInput` when the run has already finished.
    pub fn abort_run(&self, run_id: &str) -> AppResult<()> {
        let run = self.db.get_run(run_id)?;
        match run.status {
            RunStatus::Running => {
                if let Some(handle) = self.active_runs.handle(run_id)? {
                    handle.abort(USER_ABORT_REASON);
                    return Ok(());
                }
                // No task owns it (it is just finishing): settle it here.
                self.finish_aborted(&run)
            }
            RunStatus::Paused => self.finish_aborted(&run),
            finished => {
                Err(AppError::InvalidInput(format!("run {run_id} has already finished ({})", finished.as_db_text())))
            }
        }
    }

    fn finish_aborted(&self, run: &Run) -> AppResult<()> {
        self.db.finish_run(&run.id, RunStatus::Aborted, None, None)?;
        self.driver_for(run).send_status(&run.id, RunStatus::Aborted);
        Ok(())
    }

    fn driver_for(&self, run: &Run) -> RunDriver {
        RunDriver {
            db: self.db.clone(),
            sink: self.sink.clone(),
            active_runs: self.active_runs.clone(),
            agent_id: run.agent_id.clone(),
            trigger: run.trigger,
        }
    }

    /// Registers the stream's handle and spawns the task driving it.
    ///
    /// If registration fails the run is marked failed, so it never stays `Running`.
    fn spawn_driver(&self, run: &Run, stream: graphrt_core::RunStream) -> AppResult<()> {
        let driver = self.driver_for(run);
        let drive_id = match self.active_runs.register(&run.id, stream.handle()) {
            Ok(drive_id) => drive_id,
            Err(error) => {
                driver.fail_run(&run.id, &format!("could not start the run: {error}"));
                return Err(error);
            }
        };
        let run_id = run.id.clone();
        tauri::async_runtime::spawn(async move { driver.drive(run_id, drive_id, stream).await });
        Ok(())
    }
}
