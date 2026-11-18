//! Starts the next agent of a chain when a run finishes (screen 11).
//!
//! The run driver is not chain-aware. Instead the app wraps its run event sink
//! in a [`ChainingSink`]: it forwards every event unchanged and, when a run's
//! status changes to `succeeded` or `failed`, hands the run to the
//! [`ChainRunner`], which starts the next agents through the `RunManager`.
//!
//! Ownership: `RunManager` owns the sink, and the runner needs the
//! `RunManager` to start runs. To avoid an `Arc` cycle the runner keeps a
//! `Weak` handle, set once after construction with [`ChainRunner::attach`].
//!
//! Which links fire for a finished run of agent X:
//! - A run the chain started itself follows only that chain, from the step it
//!   was started for.
//! - Any other run (manual, scheduled, test) follows every ACTIVE chain where
//!   X is followed by another step.
//! - A step whose agent failed ends the chain when its `on_failure` is `stop`;
//!   otherwise the next link is evaluated, and starts only if its condition is
//!   `always`. After a success the next link always starts.
//!
//! Loop guard: one chain execution runs each agent at most once (the set of
//! agents it already started travels with it), so A → B → A never loops, and
//! runs a chain started never trigger other chains, so two chains cannot ping-pong.
//! Pausing a chain stops its executions at the next link; "Test chain" runs
//! follow the chain even while it is paused.
//!
//! The origin of chain-started runs is kept in memory: a run that is paused for
//! approval continues its chain after resume, but not across an app restart.

#[cfg(test)]
mod tests;

use std::collections::{HashMap, HashSet};
use std::sync::{Arc, OnceLock, Weak};

use serde_json::{Map, Value as Json};

use crate::engine::{RunEventPayload, RunEventSink, RunManager};
use crate::error::{AppError, AppResult};
use crate::storage::chains::{Chain, ChainFailurePolicy, ChainInputSource, ChainRunCondition, ChainStatus, ChainStep};
use crate::storage::models::{AgentStatus, Run, RunStatus, RunTrigger};
use crate::storage::Database;

/// Which chain execution started a run, and what it already ran.
#[derive(Debug, Clone)]
struct ChainOrigin {
    chain_id: String,
    /// Position of the step this run was started for.
    position: usize,
    /// Agents this execution started, the finished run's agent included.
    started_agent_ids: HashSet<String>,
    /// Started by "Test chain": follows the chain even while it is paused.
    is_test: bool,
}

/// A next step to start, decided from a finished run.
#[derive(Debug)]
struct PlannedStart {
    origin: ChainOrigin,
    agent_id: String,
    inputs: Json,
}

/// Decides and starts the next runs of chains. One per app, shared as `Arc`.
#[derive(Debug)]
pub struct ChainRunner {
    db: Arc<Database>,
    runs: OnceLock<Weak<RunManager>>,
    /// Chain origin of runs started by a chain, by run id. The async mutex is held
    /// while a run is started and its origin recorded, so its end is never
    /// handled before its origin is known.
    origins: tokio::sync::Mutex<HashMap<String, ChainOrigin>>,
}

impl ChainRunner {
    pub fn new(db: Arc<Database>) -> Self {
        Self { db, runs: OnceLock::new(), origins: tokio::sync::Mutex::new(HashMap::new()) }
    }

    /// Gives the runner the `RunManager` it starts runs with (kept as `Weak`).
    /// Only the first call has an effect.
    pub fn attach(&self, runs: &Arc<RunManager>) {
        if self.runs.set(Arc::downgrade(runs)).is_err() {
            log::warn!("the chain runner was already attached to a run manager");
        }
    }

    fn run_manager(&self) -> AppResult<Arc<RunManager>> {
        self.runs
            .get()
            .and_then(Weak::upgrade)
            .ok_or_else(|| AppError::Internal("chains are not ready to start runs".into()))
    }

    /// "Test chain": starts the first agent with the first step's constant inputs.
    /// The chain is followed even while it is paused.
    ///
    /// # Errors
    /// `NotFound` for an unknown chain, `InvalidInput` for a chain without agents,
    /// or whatever starting the run reports.
    pub async fn test_chain(&self, chain_id: &str) -> AppResult<Run> {
        let chain = self.db.get_chain(chain_id)?;
        let first_step = chain
            .steps
            .first()
            .ok_or_else(|| AppError::InvalidInput("add an agent to the chain before testing it".into()))?;
        let mut origins = self.origins.lock().await;
        let inputs = build_inputs(first_step, None);
        let run = self.run_manager()?.start_run(&first_step.agent_id, RunTrigger::Test, inputs).await?;
        let started_agent_ids = HashSet::from([first_step.agent_id.clone()]);
        origins
            .insert(run.id.clone(), ChainOrigin { chain_id: chain.id, position: 0, started_agent_ids, is_test: true });
        Ok(run)
    }

    /// Handles a finished run: plans and starts the next steps. Errors are logged.
    async fn handle_finished_run(&self, run_id: String, agent_id: String, status: RunStatus) {
        let mut origins = self.origins.lock().await;
        let origin = origins.remove(&run_id);
        let planned_starts = match self.plan_next_starts(&run_id, &agent_id, status, origin) {
            Ok(planned_starts) => planned_starts,
            Err(error) => {
                log::warn!("could not continue the chains after run {run_id}: {error}");
                return;
            }
        };
        for planned_start in planned_starts {
            let trigger = if planned_start.origin.is_test { RunTrigger::Test } else { RunTrigger::Manual };
            let started = match self.run_manager() {
                Ok(runs) => runs.start_run(&planned_start.agent_id, trigger, planned_start.inputs).await,
                Err(error) => Err(error),
            };
            match started {
                Ok(run) => {
                    origins.insert(run.id, planned_start.origin);
                }
                Err(error) => log::warn!(
                    "chain {} could not start agent {}: {error}",
                    planned_start.origin.chain_id,
                    planned_start.agent_id
                ),
            }
        }
    }

    fn plan_next_starts(
        &self,
        run_id: &str,
        agent_id: &str,
        status: RunStatus,
        origin: Option<ChainOrigin>,
    ) -> AppResult<Vec<PlannedStart>> {
        let finished_origins = match origin {
            Some(origin) => vec![origin],
            None => self
                .db
                .find_active_chain_successors(agent_id)?
                .into_iter()
                .map(|successor| ChainOrigin {
                    chain_id: successor.chain_id,
                    position: successor.finished_position,
                    started_agent_ids: HashSet::from([agent_id.to_owned()]),
                    is_test: false,
                })
                .collect(),
        };
        if finished_origins.is_empty() {
            return Ok(Vec::new());
        }
        let outputs = self.db.get_run(run_id)?.outputs;
        let mut planned_starts = Vec::new();
        for finished_origin in finished_origins {
            let chain = match self.db.get_chain(&finished_origin.chain_id) {
                Ok(chain) => chain,
                Err(AppError::NotFound(_)) => continue,
                Err(error) => return Err(error),
            };
            if let Some(planned_start) = self.plan_next_step(&chain, finished_origin, status, outputs.as_ref()) {
                planned_starts.push(planned_start);
            }
        }
        Ok(planned_starts)
    }

    /// The next step of `chain` after the step in `finished`, if it should start.
    fn plan_next_step(
        &self,
        chain: &Chain,
        finished: ChainOrigin,
        status: RunStatus,
        outputs: Option<&Json>,
    ) -> Option<PlannedStart> {
        if chain.status != ChainStatus::Active && !finished.is_test {
            return None;
        }
        let finished_step = chain.steps.get(finished.position)?;
        let next_position = finished.position + 1;
        let next_step = chain.steps.get(next_position)?;
        if !link_allows_start(finished_step, next_step, status) {
            return None;
        }
        if finished.started_agent_ids.contains(&next_step.agent_id) {
            log::info!("chain {} stopped: agent {} already ran in this execution", chain.id, next_step.agent_id);
            return None;
        }
        if self.db.get_agent(&next_step.agent_id).ok()?.status == AgentStatus::Paused {
            log::info!("chain {} stopped: agent {} is paused", chain.id, next_step.agent_id);
            return None;
        }
        let mut started_agent_ids = finished.started_agent_ids;
        started_agent_ids.insert(next_step.agent_id.clone());
        Some(PlannedStart {
            origin: ChainOrigin {
                chain_id: chain.id.clone(),
                position: next_position,
                started_agent_ids,
                is_test: finished.is_test,
            },
            agent_id: next_step.agent_id.clone(),
            inputs: build_inputs(next_step, outputs),
        })
    }
}

/// Whether the link into `next_step` starts it after `finished_step` ended with `status`.
fn link_allows_start(finished_step: &ChainStep, next_step: &ChainStep, status: RunStatus) -> bool {
    match status {
        RunStatus::Succeeded => true,
        RunStatus::Failed => {
            finished_step.on_failure == ChainFailurePolicy::Continue
                && next_step.run_condition == ChainRunCondition::Always
        }
        RunStatus::Running | RunStatus::Paused | RunStatus::Aborted => false,
    }
}

/// Start inputs of `step`: constants, and outputs of the previous run (missing ones are left out).
fn build_inputs(step: &ChainStep, previous_outputs: Option<&Json>) -> Json {
    let mut inputs = Map::new();
    for mapping in &step.inputs {
        let value = match &mapping.source {
            ChainInputSource::Constant { value } => Some(value.clone()),
            ChainInputSource::Output { output_key } => {
                previous_outputs.and_then(|outputs| outputs.get(output_key)).cloned()
            }
        };
        if let Some(value) = value {
            inputs.insert(mapping.input.clone(), value);
        }
    }
    Json::Object(inputs)
}

/// Forwards run events to `inner` and lets the [`ChainRunner`] react to finished runs.
#[derive(Debug)]
pub struct ChainingSink {
    inner: Arc<dyn RunEventSink>,
    runner: Arc<ChainRunner>,
}

impl ChainingSink {
    pub fn new(inner: Arc<dyn RunEventSink>, runner: Arc<ChainRunner>) -> Self {
        Self { inner, runner }
    }
}

impl RunEventSink for ChainingSink {
    fn send(&self, payload: RunEventPayload) {
        let is_finish = payload.event.get("type").and_then(Json::as_str) == Some("status_changed")
            && matches!(payload.status, RunStatus::Succeeded | RunStatus::Failed);
        let finished_run = is_finish.then(|| (payload.run_id.clone(), payload.agent_id.clone(), payload.status));
        self.inner.send(payload);
        if let Some((run_id, agent_id, status)) = finished_run {
            let runner = self.runner.clone();
            tauri::async_runtime::spawn(async move { runner.handle_finished_run(run_id, agent_id, status).await });
        }
    }
}
