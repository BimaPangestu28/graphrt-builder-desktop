//! Skills on an agent: which of its steps can use skills, and putting skills on a step.
//!
//! Skills belong to `agent` steps (the kind that picks tools by itself). Choosing them is a
//! change of the step's `skills` list in the workflow document, saved as a new version
//! like an edit in the Nodes view, so it shows in the version history and can be undone.
//! Nobody edits the document by hand: the Skills screens call [`set_step_skills`].

use serde::Serialize;

use super::document::EditableDocument;
use super::{graph_from_workflow, record_in_chat, GraphContext, GraphProblem, GraphSource, ProblemSeverity};
use crate::agent_builder::edit_lock;
use crate::error::{AppError, AppResult};
use crate::storage::models::Agent;
use crate::storage::Database;

/// The step kind that can use skills.
const AGENT_STEP_KIND: &str = "agent";
/// The step setting that lists its skills.
const SKILLS_KEY: &str = "skills";
/// Prefix of the version summary and chat entry of a skills change.
pub const SKILLS_EDIT_PREFIX: &str = "Skills: ";

/// A step that can use skills.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SkillStep {
    pub step_id: String,
    /// What the builder calls the step.
    pub title: String,
    /// Technical names of the skills it has.
    pub skills: Vec<String>,
}

/// An agent and its steps that can use skills (none: the agent cannot use skills as built).
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentSkills {
    pub agent_id: String,
    pub agent_name: String,
    pub steps: Vec<SkillStep>,
}

/// Every agent with its steps that can use skills. An agent whose document cannot be read
/// is listed without steps.
///
/// # Errors
/// `Database` when the agents cannot be read.
pub fn list_agent_skills(db: &Database, context: &GraphContext<'_>) -> AppResult<Vec<AgentSkills>> {
    Ok(db.list_agents()?.iter().map(|agent| agent_skills(agent, context)).collect())
}

fn agent_skills(agent: &Agent, context: &GraphContext<'_>) -> AgentSkills {
    let steps = match EditableDocument::parse(&agent.flow_yaml) {
        Ok(document) => skill_steps(agent, &document, context),
        Err(error) => {
            log::warn!("could not read agent {} to list its skills: {error}", agent.id);
            Vec::new()
        }
    };
    AgentSkills { agent_id: agent.id.clone(), agent_name: agent.name.clone(), steps }
}

fn skill_steps(agent: &Agent, document: &EditableDocument, context: &GraphContext<'_>) -> Vec<SkillStep> {
    let source =
        GraphSource { agent_id: &agent.id, version: agent.current_version, latest_version: agent.current_version };
    let graph = graph_from_workflow(source, &document.workflow, context);
    document
        .workflow
        .graph
        .nodes
        .iter()
        .filter(|node| node.kind == AGENT_STEP_KIND)
        .map(|node| SkillStep {
            step_id: node.id.clone(),
            title: graph
                .nodes
                .iter()
                .find(|view| view.id == node.id)
                .map_or_else(|| node.id.clone(), |view| view.display_title.clone()),
            skills: listed_skills(&node.config),
        })
        .collect()
}

fn listed_skills(config: &serde_json::Map<String, serde_json::Value>) -> Vec<String> {
    match config.get(SKILLS_KEY) {
        Some(serde_json::Value::Array(names)) => {
            names.iter().filter_map(serde_json::Value::as_str).map(str::to_owned).collect()
        }
        _ => Vec::new(),
    }
}

/// Sets the skills of step `step_id` (in the order given, without repeats) and saves the
/// agent as a new version. Saves nothing when the step already has exactly these skills.
/// Whether the skills are installed is the caller's check.
///
/// # Errors
/// - `BuilderBusy` while a chat change of this agent runs.
/// - `NotFound` for an unknown agent, or a step that does not exist or cannot use skills.
/// - `InvalidInput` for a name that is not a valid skill name.
/// - `InvalidGraph` when the change gives the agent a problem it did not have.
pub fn set_step_skills(
    db: &Database,
    agent_id: &str,
    step_id: &str,
    skills: &[String],
    context: &GraphContext<'_>,
) -> AppResult<AgentSkills> {
    if edit_lock::is_builder_editing(agent_id) {
        return Err(AppError::BuilderBusy);
    }
    let agent = db.get_agent(agent_id)?;
    let base = EditableDocument::parse(&agent.flow_yaml)?;
    let mut wanted: Vec<String> = Vec::with_capacity(skills.len());
    for name in skills {
        if !graphrt_skill::is_valid_name(name) {
            return Err(AppError::InvalidInput(format!("`{name}` is not a skill name")));
        }
        if !wanted.contains(name) {
            wanted.push(name.clone());
        }
    }
    let mut workflow = base.workflow.clone();
    let step = workflow
        .graph
        .nodes
        .iter_mut()
        .find(|node| node.id == step_id && node.kind == AGENT_STEP_KIND)
        .ok_or_else(|| AppError::NotFound(format!("a step of {} that can use skills ({step_id})", agent.name)))?;
    if listed_skills(&step.config) == wanted {
        return Ok(agent_skills(&agent, context));
    }
    if wanted.is_empty() {
        step.config.remove(SKILLS_KEY);
    } else {
        step.config.insert(SKILLS_KEY.to_owned(), serde_json::json!(wanted));
    }
    let flow_yaml = base.to_yaml(&workflow)?;
    let saved_document = EditableDocument::parse(&flow_yaml)?;
    let version = agent.current_version;
    let source = GraphSource { agent_id, version, latest_version: version };
    let edited_graph = graph_from_workflow(source, &saved_document.workflow, context);
    let base_graph = graph_from_workflow(source, &base.workflow, context);
    let new_problems = new_errors(&base_graph.problems, edited_graph.problems);
    if !new_problems.is_empty() {
        return Err(AppError::InvalidGraph(new_problems));
    }
    let step_title = edited_graph
        .nodes
        .iter()
        .find(|view| view.id == step_id)
        .map_or_else(|| step_id.to_owned(), |view| view.display_title.clone());
    let summary = if wanted.is_empty() {
        format!("{SKILLS_EDIT_PREFIX}{step_title} uses no skills now")
    } else {
        format!("{SKILLS_EDIT_PREFIX}{step_title} can use {}", wanted.join(", "))
    };
    let saved_agent = db.update_agent_flow_from_version(agent_id, version, &flow_yaml, &summary)?;
    record_in_chat(db, agent_id, &summary, &[step_id.to_owned()], (version, saved_agent.current_version));
    Ok(agent_skills(&saved_agent, context))
}

/// Takes skill `name` off every step of every agent that lists it (before the skill is
/// removed, so no agent is left pointing at a skill that is gone). Returns the agents changed.
///
/// # Errors
/// As [`set_step_skills`]; the agents changed before the error keep their change.
pub fn remove_skill_from_agents(db: &Database, name: &str, context: &GraphContext<'_>) -> AppResult<Vec<String>> {
    let mut changed_agent_ids = Vec::new();
    for agent in list_agent_skills(db, context)? {
        for step in agent.steps.iter().filter(|step| step.skills.iter().any(|skill| skill == name)) {
            let remaining: Vec<String> = step.skills.iter().filter(|skill| *skill != name).cloned().collect();
            set_step_skills(db, &agent.agent_id, &step.step_id, &remaining, context)?;
            if !changed_agent_ids.contains(&agent.agent_id) {
                changed_agent_ids.push(agent.agent_id.clone());
            }
        }
    }
    Ok(changed_agent_ids)
}

/// The blocking problems of `edited` that `base` did not have (same code, step and message).
fn new_errors(base: &[GraphProblem], edited: Vec<GraphProblem>) -> Vec<GraphProblem> {
    edited
        .into_iter()
        .filter(|problem| problem.severity == ProblemSeverity::Error)
        .filter(|problem| {
            !base.iter().any(|known| {
                known.code == problem.code && known.node_id == problem.node_id && known.message == problem.message
            })
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::flow;
    use crate::storage::models::{AgentKind, NewAgent};

    const WITH_AGENT_STEP: &str = r#"
version: "1"
name: support
graph:
  nodes:
    - { id: start, type: start, variables: [{ variable: question, type: paragraph, required: true }] }
    - id: helper
      type: agent
      title: Help the customer
      model: { provider: openai, name: gpt-4o-mini }
      query: "{{#start.question#}}"
    - id: summary
      type: llm
      model: { provider: openai, name: gpt-4o-mini }
      prompt_template: [{ role: user, text: "{{#helper.text#}}" }]
    - { id: end, type: end, outputs: [{ variable: result, value_selector: [summary, text], value_type: string }] }
  edges:
    - { source: start, target: helper }
    - { source: helper, target: summary }
    - { source: summary, target: end }
"#;

    fn create_agent(db: &Database) -> String {
        let new_agent = NewAgent {
            name: "Support".into(),
            kind: AgentKind::Task,
            description: String::new(),
            flow_yaml: WITH_AGENT_STEP.into(),
        };
        db.create_agent(new_agent).unwrap().id
    }

    fn names(skills: &[&str]) -> Vec<String> {
        skills.iter().map(|skill| (*skill).to_owned()).collect()
    }

    #[test]
    fn only_steps_that_pick_their_own_tools_can_use_skills() {
        let db = Database::open_in_memory().unwrap();
        create_agent(&db);
        let registry = flow::builtin_node_registry();

        let listed = list_agent_skills(&db, &GraphContext::new(&registry)).unwrap();

        assert_eq!(listed.len(), 1);
        assert_eq!(listed[0].agent_name, "Support");
        let steps: Vec<(&str, &str)> =
            listed[0].steps.iter().map(|step| (step.step_id.as_str(), step.title.as_str())).collect();
        assert_eq!(steps, [("helper", "Help the customer")]);
        assert!(listed[0].steps[0].skills.is_empty());
    }

    #[test]
    fn choosing_skills_saves_a_new_version_that_lists_them() {
        let db = Database::open_in_memory().unwrap();
        let agent_id = create_agent(&db);
        let registry = flow::builtin_node_registry();
        let context = GraphContext::new(&registry);

        let saved =
            set_step_skills(&db, &agent_id, "helper", &names(&["refund-policy", "tone", "tone"]), &context).unwrap();

        assert_eq!(saved.steps[0].skills, ["refund-policy", "tone"]);
        let agent = db.get_agent(&agent_id).unwrap();
        assert_eq!(agent.current_version, 2);
        flow::compile_flow(&agent.flow_yaml).unwrap();
        let versions = db.list_agent_versions(&agent_id).unwrap();
        assert!(
            versions
                .iter()
                .any(|version| version.change_summary == "Skills: Help the customer can use refund-policy, tone"),
            "{versions:?}"
        );

        // The same choice again changes nothing.
        set_step_skills(&db, &agent_id, "helper", &names(&["refund-policy", "tone"]), &context).unwrap();
        assert_eq!(db.get_agent(&agent_id).unwrap().current_version, 2);

        let cleared = set_step_skills(&db, &agent_id, "helper", &[], &context).unwrap();
        assert!(cleared.steps[0].skills.is_empty());
        assert!(!db.get_agent(&agent_id).unwrap().flow_yaml.contains("skills"));
    }

    #[test]
    fn skills_cannot_go_on_other_steps_or_have_made_up_names() {
        let db = Database::open_in_memory().unwrap();
        let agent_id = create_agent(&db);
        let registry = flow::builtin_node_registry();
        let context = GraphContext::new(&registry);

        let on_a_model_step = set_step_skills(&db, &agent_id, "summary", &names(&["tone"]), &context).unwrap_err();
        assert_eq!(on_a_model_step.code(), "not_found");
        let bad_name = set_step_skills(&db, &agent_id, "helper", &names(&["../tone"]), &context).unwrap_err();
        assert_eq!(bad_name.code(), "invalid_input");
        let unknown_agent = set_step_skills(&db, "nobody", "helper", &names(&["tone"]), &context).unwrap_err();
        assert_eq!(unknown_agent.code(), "not_found");
        assert_eq!(db.get_agent(&agent_id).unwrap().current_version, 1);
    }

    #[test]
    fn a_skills_change_waits_while_the_builder_changes_the_agent() {
        let db = Database::open_in_memory().unwrap();
        let agent_id = create_agent(&db);
        let registry = flow::builtin_node_registry();
        let _editing = edit_lock::begin_builder_edit(&agent_id);

        let error =
            set_step_skills(&db, &agent_id, "helper", &names(&["tone"]), &GraphContext::new(&registry)).unwrap_err();

        assert_eq!(error.code(), "builder_busy");
    }

    #[test]
    fn removing_a_skill_takes_it_off_every_agent_that_uses_it() {
        let db = Database::open_in_memory().unwrap();
        let first = create_agent(&db);
        let second = create_agent(&db);
        let registry = flow::builtin_node_registry();
        let context = GraphContext::new(&registry);
        set_step_skills(&db, &first, "helper", &names(&["refund-policy", "tone"]), &context).unwrap();
        set_step_skills(&db, &second, "helper", &names(&["tone"]), &context).unwrap();

        let changed = remove_skill_from_agents(&db, "refund-policy", &context).unwrap();

        assert_eq!(changed, std::slice::from_ref(&first));
        let listed = list_agent_skills(&db, &context).unwrap();
        let skills_of =
            |agent_id: &str| listed.iter().find(|agent| agent.agent_id == agent_id).unwrap().steps[0].skills.clone();
        assert_eq!(skills_of(&first), ["tone"]);
        assert_eq!(skills_of(&second), ["tone"]);
    }
}
