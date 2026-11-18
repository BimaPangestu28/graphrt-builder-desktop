//! Version history (screen 24): each saved version's steps and what restoring
//! one would change compared with another, computed from the graphrt summary
//! of each version instead of the raw YAML.
//!
//! A version whose document no longer compiles (graphrt changed since it was
//! saved) does not fail the comparison: that side carries its error instead of
//! steps, and no per-step changes are listed.

use serde::{Deserialize, Serialize};
use tauri::State;

use crate::agent_builder::diff::{match_steps, StepMatch};
use crate::error::{AppError, AppResult};
use crate::flow::{self, FlowStep, FlowSummary};
use crate::state::AppState;
use crate::storage::models::AgentVersion;
use crate::storage::Database;

/// Why a version's steps could not be read; same shape as a command error.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VersionReadError {
    /// Stable code from [`AppError::code`], e.g. `workflow`.
    pub code: String,
    pub message: String,
}

impl From<&AppError> for VersionReadError {
    fn from(error: &AppError) -> Self {
        Self { code: error.code().to_owned(), message: error.to_string() }
    }
}

/// The steps of one saved version, or why they could not be read.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VersionSteps {
    pub version: i64,
    /// Empty when `error` is set.
    pub steps: Vec<FlowStep>,
    pub error: Option<VersionReadError>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum StepChangeKind {
    /// Only in the `to` version.
    Added,
    /// Only in the `from` version.
    Removed,
    /// In both, with a different type, title or detail.
    Changed,
    Unchanged,
}

/// One step id compared across two versions.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StepChange {
    /// graphrt node id.
    pub step_id: String,
    pub kind: StepChangeKind,
    /// The step in the `from` version (absent when added).
    pub before: Option<FlowStep>,
    /// The step in the `to` version (absent when removed).
    pub after: Option<FlowStep>,
    /// 1-based position in the `to` version's step order (absent when removed).
    pub position: Option<usize>,
}

/// What changes when going from `from` to `to`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VersionComparison {
    pub agent_id: String,
    pub from: VersionSteps,
    pub to: VersionSteps,
    /// Follows `from`'s order; steps only in `to` come right after the step that
    /// precedes them there. Empty when either side has an error.
    pub changes: Vec<StepChange>,
}

/// Compares two saved versions of an agent, e.g. current (`from`) and the one to restore (`to`).
///
/// # Errors
/// `NotFound` when the agent or either version does not exist. A version that
/// does not compile is reported inside the result, not as an error.
#[tauri::command]
pub fn compare_agent_versions(
    state: State<'_, AppState>,
    agent_id: String,
    from_version: i64,
    to_version: i64,
) -> AppResult<VersionComparison> {
    compare_versions(&state.db, &agent_id, from_version, to_version)
}

/// Steps, inputs and model providers of one saved version.
///
/// # Errors
/// `NotFound` for an unknown agent or version; `Workflow` when the version's
/// document no longer compiles.
#[tauri::command]
pub fn get_version_flow_summary(state: State<'_, AppState>, agent_id: String, version: i64) -> AppResult<FlowSummary> {
    summarize_version(&state.db, &agent_id, version)
}

/// See [`compare_agent_versions`].
pub fn compare_versions(
    database: &Database,
    agent_id: &str,
    from_version: i64,
    to_version: i64,
) -> AppResult<VersionComparison> {
    let versions = database.list_agent_versions(agent_id)?;
    let from = read_version_steps(find_version(&versions, agent_id, from_version)?);
    let to = read_version_steps(find_version(&versions, agent_id, to_version)?);
    let changes =
        if from.error.is_none() && to.error.is_none() { list_changes(&from.steps, &to.steps) } else { Vec::new() };
    Ok(VersionComparison { agent_id: agent_id.to_owned(), from, to, changes })
}

/// See [`get_version_flow_summary`].
pub fn summarize_version(database: &Database, agent_id: &str, version: i64) -> AppResult<FlowSummary> {
    let versions = database.list_agent_versions(agent_id)?;
    flow::summarize_flow(&find_version(&versions, agent_id, version)?.flow_yaml)
}

fn find_version<'a>(versions: &'a [AgentVersion], agent_id: &str, version: i64) -> AppResult<&'a AgentVersion> {
    versions
        .iter()
        .find(|saved| saved.version == version)
        .ok_or_else(|| AppError::NotFound(format!("version {version} of agent {agent_id}")))
}

fn read_version_steps(saved: &AgentVersion) -> VersionSteps {
    match flow::summarize_flow(&saved.flow_yaml) {
        Ok(summary) => VersionSteps { version: saved.version, steps: summary.steps, error: None },
        Err(error) => {
            log::warn!("version {} of agent {} cannot be summarized: {error}", saved.version, saved.agent_id);
            VersionSteps { version: saved.version, steps: Vec::new(), error: Some(VersionReadError::from(&error)) }
        }
    }
}

fn list_changes(from_steps: &[FlowStep], to_steps: &[FlowStep]) -> Vec<StepChange> {
    let position_in_to =
        |step: &FlowStep| to_steps.iter().position(|candidate| candidate.id == step.id).map(|index| index + 1);
    match_steps(from_steps, to_steps)
        .into_iter()
        .map(|matched| {
            let (kind, before, after) = match matched {
                StepMatch::Added(after) => (StepChangeKind::Added, None, Some(after)),
                StepMatch::Removed(before) => (StepChangeKind::Removed, Some(before), None),
                StepMatch::Changed { before, after } => (StepChangeKind::Changed, Some(before), Some(after)),
                StepMatch::Unchanged { before, after } => (StepChangeKind::Unchanged, Some(before), Some(after)),
            };
            let step_id = after.or(before).map(|step| step.id.clone()).unwrap_or_default();
            StepChange {
                step_id,
                kind,
                position: after.and_then(position_in_to),
                before: before.cloned(),
                after: after.cloned(),
            }
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::storage::models::{AgentKind, NewAgent};

    fn test_database() -> Database {
        Database::open_in_memory().unwrap()
    }

    /// A valid workflow whose steps are `answer` nodes chained in order: (id, title, answer text).
    fn chained_flow(steps: &[(&str, &str, &str)]) -> String {
        let mut nodes = String::from("    - { id: start, type: start }\n");
        let mut edges = String::new();
        let mut previous = "start";
        for (id, title, answer) in steps {
            nodes.push_str(&format!("    - {{ id: {id}, type: answer, title: \"{title}\", answer: \"{answer}\" }}\n"));
            edges.push_str(&format!("    - {{ source: {previous}, target: {id} }}\n"));
            previous = id;
        }
        nodes.push_str("    - { id: end, type: end }\n");
        edges.push_str(&format!("    - {{ source: {previous}, target: end }}\n"));
        format!("version: \"1\"\nname: test\ngraph:\n  nodes:\n{nodes}  edges:\n{edges}")
    }

    fn create_agent_with_versions(database: &Database, flows: &[String]) -> String {
        let agent = database
            .create_agent(NewAgent {
                name: "Versions".into(),
                kind: AgentKind::Task,
                description: String::new(),
                flow_yaml: flows[0].clone(),
            })
            .unwrap();
        for flow_yaml in &flows[1..] {
            database.update_agent_flow(&agent.id, flow_yaml, "Edited").unwrap();
        }
        agent.id
    }

    fn change_kinds(comparison: &VersionComparison) -> Vec<(StepChangeKind, &str, Option<usize>)> {
        comparison.changes.iter().map(|change| (change.kind, change.step_id.as_str(), change.position)).collect()
    }

    #[test]
    fn comparison_lists_added_removed_changed_and_unchanged_steps() {
        let database = test_database();
        let current = chained_flow(&[("find", "Find", "a"), ("qualify", "Qualify", "b"), ("write", "Write", "c")]);
        let older = chained_flow(&[("find", "Find", "a"), ("write", "Write longer", "c"), ("approve", "Approve", "d")]);
        let agent_id = create_agent_with_versions(&database, &[older, current]);

        let comparison = compare_versions(&database, &agent_id, 2, 1).unwrap();
        assert_eq!(comparison.from.version, 2);
        assert_eq!(comparison.to.version, 1);
        assert!(comparison.from.error.is_none() && comparison.to.error.is_none());
        assert_eq!(
            change_kinds(&comparison),
            [
                (StepChangeKind::Unchanged, "find", Some(1)),
                (StepChangeKind::Removed, "qualify", None),
                (StepChangeKind::Changed, "write", Some(2)),
                (StepChangeKind::Added, "approve", Some(3)),
            ]
        );
        let changed = &comparison.changes[2];
        assert_eq!(changed.before.as_ref().map(|step| step.title.as_str()), Some("Write"));
        assert_eq!(changed.after.as_ref().map(|step| step.title.as_str()), Some("Write longer"));
        assert!(comparison.changes[1].after.is_none());
        assert!(comparison.changes[3].before.is_none());
    }

    #[test]
    fn comparing_a_version_with_itself_is_all_unchanged() {
        let database = test_database();
        let agent_id = create_agent_with_versions(&database, &[chained_flow(&[("a", "A", "x"), ("b", "B", "y")])]);
        let comparison = compare_versions(&database, &agent_id, 1, 1).unwrap();
        assert!(comparison.changes.iter().all(|change| change.kind == StepChangeKind::Unchanged));
        assert_eq!(comparison.changes.len(), 2);
    }

    #[test]
    fn invalid_old_version_is_reported_without_failing_the_comparison() {
        let database = test_database();
        let broken = "version: \"1\"\ngraph:\n  nodes:\n    - { id: x, type: teleport }\n".to_owned();
        let agent_id = create_agent_with_versions(&database, &[broken, chained_flow(&[("a", "A", "x")])]);

        let comparison = compare_versions(&database, &agent_id, 2, 1).unwrap();
        assert_eq!(comparison.from.steps.len(), 1);
        assert!(comparison.from.error.is_none());
        let error = comparison.to.error.as_ref().unwrap();
        assert_eq!(error.code, "workflow");
        assert!(comparison.to.steps.is_empty());
        assert!(comparison.changes.is_empty());

        assert!(matches!(summarize_version(&database, &agent_id, 1), Err(AppError::Workflow(_))));
        assert_eq!(summarize_version(&database, &agent_id, 2).unwrap().steps[0].id, "a");
    }

    #[test]
    fn unknown_agent_or_version_is_not_found() {
        let database = test_database();
        let agent_id = create_agent_with_versions(&database, &[chained_flow(&[("a", "A", "x")])]);
        assert!(matches!(compare_versions(&database, &agent_id, 1, 9), Err(AppError::NotFound(_))));
        assert!(matches!(compare_versions(&database, "missing", 1, 1), Err(AppError::NotFound(_))));
        assert!(matches!(summarize_version(&database, &agent_id, 9), Err(AppError::NotFound(_))));
    }
}
