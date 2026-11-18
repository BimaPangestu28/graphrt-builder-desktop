//! "Build agent" from a plain-language request (screens 02 → 03 → 04).
//!
//! Asks the default model for a graphrt workflow document, validates it with
//! `flow::compile_flow`, and on failure sends graphrt's error back to the model
//! to repair it (up to [`MAX_REPAIR_ATTEMPTS`]). Progress goes to the caller so
//! screen 03 can tick its checklist.

use serde::{Deserialize, Serialize};

use crate::credentials::CredentialStore;
use crate::error::{AppError, AppResult};
use crate::storage::models::{Agent, AgentKind};
use crate::storage::Database;

pub const MAX_REPAIR_ATTEMPTS: usize = 2;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BuildRequest {
    pub description: String,
    /// `None` lets the builder pick (it infers the kind from the description).
    pub kind: Option<AgentKind>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum BuildStage {
    Understanding,
    Drafting,
    Checking,
    Repairing,
    Done,
}

/// One progress update for screen 03.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BuildProgress {
    pub stage: BuildStage,
    pub message: String,
}

/// Result of a chat edit on screen 04.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RevisionResult {
    pub agent: Agent,
    /// What changed, in plain words: "Changed 2 steps: ...".
    pub summary: String,
    /// Ids of steps that were added or changed, to highlight them.
    pub changed_step_ids: Vec<String>,
}

/// Generates, validates and saves a new draft agent.
pub async fn build_agent(
    _db: &Database,
    _credentials: &CredentialStore,
    _request: BuildRequest,
    _on_progress: &(dyn Fn(BuildProgress) + Send + Sync),
) -> AppResult<Agent> {
    Err(AppError::Internal("not implemented".into()))
}

/// Applies a plain-language change to an agent's flow and saves it as a new version.
pub async fn revise_agent(
    _db: &Database,
    _credentials: &CredentialStore,
    _agent_id: &str,
    _instruction: &str,
    _on_progress: &(dyn Fn(BuildProgress) + Send + Sync),
) -> AppResult<RevisionResult> {
    Err(AppError::Internal("not implemented".into()))
}
