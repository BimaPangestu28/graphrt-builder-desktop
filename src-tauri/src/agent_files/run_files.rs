//! The files a run made, for the Run result screen.
//!
//! Which files a run shows: the ones in the run's outputs (the `end` node), because the
//! workflow author chose them. A run whose outputs hold none shows the files its steps
//! made (the `files` output of `agent` and `tool` steps), in the order they finished.
//! Every reference is looked up in the agent's workspace before it becomes a card.

use serde_json::Value as Json;

use super::cards::{cards_for_references, workspace_references_in, FileCard};
use super::AgentFiles;
use crate::error::AppResult;

/// Output of `agent`, `tool` and `answer` steps holding the files they made.
const STEP_FILES_OUTPUT: &str = "files";

/// The `workspace:` references a run's stored events hold (see the module docs).
pub fn references_in_run_events<'a>(events: impl IntoIterator<Item = &'a Json>) -> Vec<String> {
    let mut from_outputs = Vec::new();
    let mut from_steps: Vec<String> = Vec::new();
    for event in events {
        let outputs = event.get("outputs");
        match event.get("type").and_then(Json::as_str) {
            Some("run_succeeded") => from_outputs = outputs.map(workspace_references_in).unwrap_or_default(),
            Some("node_succeeded") => {
                let step_files = outputs.and_then(|outputs| outputs.get(STEP_FILES_OUTPUT));
                for reference in step_files.map(workspace_references_in).unwrap_or_default() {
                    if !from_steps.contains(&reference) {
                        from_steps.push(reference);
                    }
                }
            }
            _ => {}
        }
    }
    if from_outputs.is_empty() {
        from_steps
    } else {
        from_outputs
    }
}

impl AgentFiles {
    /// The cards of the files a run of `agent_id` made, from its stored events.
    ///
    /// # Errors
    /// `Internal` when the agent's folder cannot be opened.
    pub async fn run_file_cards<'a>(
        &self,
        agent_id: &str,
        events: impl IntoIterator<Item = &'a Json>,
    ) -> AppResult<Vec<FileCard>> {
        let references = references_in_run_events(events);
        match self.existing_agent_workspace(agent_id)? {
            Some(view) => Ok(cards_for_references(&view, &references).await),
            None => Ok(Vec::new()),
        }
    }
}
