//! Whether an agent reads what it learned, and turning that on or off.
//!
//! An `agent` step reads lessons when it has `learning: { agent: <this agent's id> }`.
//! The switch on the "What this agent learned" screen sets that on every step that can
//! use it and saves a new version, like a skills change. No user is named: a step then
//! reads the lessons that apply to everyone the agent serves.

use serde::Serialize;

use super::document::EditableDocument;
use super::{graph_from_workflow, record_in_chat, GraphContext, GraphSource, ProblemSeverity};
use crate::agent_builder::edit_lock;
use crate::error::{AppError, AppResult};
use crate::storage::models::Agent;
use crate::storage::Database;

/// The step kind that can read lessons.
const AGENT_STEP_KIND: &str = "agent";
/// The step setting that names whose lessons it reads.
const LEARNING_KEY: &str = "learning";
/// Prefix of the version summary and chat entry of a learning change.
pub const LEARNING_EDIT_PREFIX: &str = "Learning: ";

/// Whether an agent's steps read what it learned.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LearningUse {
    /// How many steps could read lessons (none: the agent cannot use them as built).
    pub capable_steps: usize,
    /// How many of them do.
    pub reading_steps: usize,
}

/// How many steps of `agent` can read lessons and how many do. A document that cannot be
/// read counts as no steps.
pub fn learning_use(agent: &Agent) -> LearningUse {
    match EditableDocument::parse(&agent.flow_yaml) {
        Ok(document) => {
            let steps = || document.workflow.graph.nodes.iter().filter(|node| node.kind == AGENT_STEP_KIND);
            LearningUse {
                capable_steps: steps().count(),
                reading_steps: steps().filter(|node| reads_own_lessons(&node.config, &agent.id)).count(),
            }
        }
        Err(error) => {
            log::warn!("could not read agent {} to see whether it uses what it learned: {error}", agent.id);
            LearningUse { capable_steps: 0, reading_steps: 0 }
        }
    }
}

fn reads_own_lessons(config: &serde_json::Map<String, serde_json::Value>, agent_id: &str) -> bool {
    config.get(LEARNING_KEY).and_then(|learning| learning.get("agent")).and_then(serde_json::Value::as_str)
        == Some(agent_id)
}

/// Makes every step that can read lessons read this agent's (or none of them), saved as a
/// new version. Saves nothing when that is already the case.
///
/// # Errors
/// - `BuilderBusy` while a chat change of this agent runs.
/// - `NotFound` for an unknown agent; `InvalidInput` when no step can read lessons.
/// - `InvalidGraph` when the change gives the agent a problem it did not have.
pub fn set_learning_use(
    db: &Database,
    agent_id: &str,
    enabled: bool,
    context: &GraphContext<'_>,
) -> AppResult<LearningUse> {
    if edit_lock::is_builder_editing(agent_id) {
        return Err(AppError::BuilderBusy);
    }
    let agent = db.get_agent(agent_id)?;
    let base = EditableDocument::parse(&agent.flow_yaml)?;
    let mut workflow = base.workflow.clone();
    let mut changed_step_ids = Vec::new();
    let mut capable_steps = 0;
    for step in workflow.graph.nodes.iter_mut().filter(|node| node.kind == AGENT_STEP_KIND) {
        capable_steps += 1;
        if reads_own_lessons(&step.config, agent_id) == enabled {
            continue;
        }
        if enabled {
            step.config.insert(LEARNING_KEY.to_owned(), serde_json::json!({ "agent": agent_id }));
        } else {
            step.config.remove(LEARNING_KEY);
        }
        changed_step_ids.push(step.id.clone());
    }
    if capable_steps == 0 {
        return Err(AppError::InvalidInput(format!(
            "{} cannot use what it learned the way it is built: no step chooses its own tools",
            agent.name
        )));
    }
    if changed_step_ids.is_empty() {
        return Ok(learning_use(&agent));
    }
    let flow_yaml = base.to_yaml(&workflow)?;
    let saved_document = EditableDocument::parse(&flow_yaml)?;
    let version = agent.current_version;
    let source = GraphSource { agent_id, version, latest_version: version };
    let base_problems = graph_from_workflow(source, &base.workflow, context).problems;
    let new_problems: Vec<_> = graph_from_workflow(source, &saved_document.workflow, context)
        .problems
        .into_iter()
        .filter(|problem| problem.severity == ProblemSeverity::Error)
        .filter(|problem| {
            !base_problems.iter().any(|known| {
                known.code == problem.code && known.node_id == problem.node_id && known.message == problem.message
            })
        })
        .collect();
    if !new_problems.is_empty() {
        return Err(AppError::InvalidGraph(new_problems));
    }
    let summary = if enabled {
        format!("{LEARNING_EDIT_PREFIX}uses what it learned")
    } else {
        format!("{LEARNING_EDIT_PREFIX}no longer uses what it learned")
    };
    let saved_agent = db.update_agent_flow_from_version(agent_id, version, &flow_yaml, &summary)?;
    record_in_chat(db, agent_id, &summary, &changed_step_ids, (version, saved_agent.current_version));
    Ok(learning_use(&saved_agent))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::flow;
    use crate::storage::models::{AgentKind, NewAgent};

    const TWO_AGENT_STEPS: &str = r#"
version: "1"
name: support
graph:
  nodes:
    - { id: start, type: start, variables: [{ variable: question, type: paragraph, required: true }] }
    - { id: helper, type: agent, model: { provider: openai, name: gpt-4o-mini }, query: "{{#start.question#}}" }
    - { id: checker, type: agent, model: { provider: openai, name: gpt-4o-mini }, query: "{{#helper.text#}}" }
    - { id: end, type: end, outputs: [{ variable: result, value_selector: [checker, text], value_type: string }] }
  edges:
    - { source: start, target: helper }
    - { source: helper, target: checker }
    - { source: checker, target: end }
"#;
    const ONLY_A_MODEL_STEP: &str = include_str!("../../fixtures/flows/simple_answer.yaml");

    fn create_agent(db: &Database, flow_yaml: &str) -> String {
        let new_agent = NewAgent {
            name: "Support".into(),
            kind: AgentKind::Task,
            description: String::new(),
            flow_yaml: flow_yaml.into(),
        };
        db.create_agent(new_agent).unwrap().id
    }

    #[test]
    fn turning_it_on_makes_every_capable_step_read_this_agents_own_lessons() {
        let db = Database::open_in_memory().unwrap();
        let agent_id = create_agent(&db, TWO_AGENT_STEPS);
        let registry = flow::builtin_node_registry();
        let context = GraphContext::new(&registry);
        assert_eq!(learning_use(&db.get_agent(&agent_id).unwrap()), LearningUse { capable_steps: 2, reading_steps: 0 });

        let on = set_learning_use(&db, &agent_id, true, &context).unwrap();

        assert_eq!(on, LearningUse { capable_steps: 2, reading_steps: 2 });
        let agent = db.get_agent(&agent_id).unwrap();
        assert_eq!(agent.current_version, 2);
        flow::compile_flow(&agent.flow_yaml).unwrap();
        let document = EditableDocument::parse(&agent.flow_yaml).unwrap();
        for step in document.workflow.graph.nodes.iter().filter(|node| node.kind == AGENT_STEP_KIND) {
            // Its own lessons only, and no user: nothing here can widen what a run reads.
            assert_eq!(step.config.get(LEARNING_KEY), Some(&serde_json::json!({ "agent": agent_id })));
        }

        set_learning_use(&db, &agent_id, true, &context).unwrap();
        assert_eq!(db.get_agent(&agent_id).unwrap().current_version, 2, "already on: nothing saved");

        let off = set_learning_use(&db, &agent_id, false, &context).unwrap();
        assert_eq!(off.reading_steps, 0);
        assert!(!db.get_agent(&agent_id).unwrap().flow_yaml.contains("learning"));
    }

    #[test]
    fn a_step_reading_another_agents_lessons_does_not_count_and_is_replaced() {
        let db = Database::open_in_memory().unwrap();
        let other = TWO_AGENT_STEPS.replace(
            "query: \"{{#start.question#}}\" }",
            "query: \"{{#start.question#}}\", learning: { agent: someone-else } }",
        );
        let agent_id = create_agent(&db, &other);
        let registry = flow::builtin_node_registry();

        assert_eq!(learning_use(&db.get_agent(&agent_id).unwrap()).reading_steps, 0);
        set_learning_use(&db, &agent_id, true, &GraphContext::new(&registry)).unwrap();

        assert!(!db.get_agent(&agent_id).unwrap().flow_yaml.contains("someone-else"));
    }

    #[test]
    fn an_agent_without_a_capable_step_says_so() {
        let db = Database::open_in_memory().unwrap();
        let agent_id = create_agent(&db, ONLY_A_MODEL_STEP);
        let registry = flow::builtin_node_registry();

        let error = set_learning_use(&db, &agent_id, true, &GraphContext::new(&registry)).unwrap_err();

        assert_eq!(error.code(), "invalid_input");
        assert_eq!(db.get_agent(&agent_id).unwrap().current_version, 1);
    }
}
