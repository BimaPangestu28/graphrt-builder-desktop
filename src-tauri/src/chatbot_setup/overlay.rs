//! Applies a saved chatbot setup to the chatbot's workflow for one reply,
//! in memory: the stored flow and its versions never change.
//!
//! - `llm` steps: a system message `{{#sys.chatbot_brief#}}` first (merged
//!   into an existing leading system message).
//! - `agent` steps: the same reference before their `instruction`.
//! - `question-classifier` steps: `{{#sys.chatbot_handoff_rules#}}` before their
//!   `instruction`, so the rules steer which hand-off path is picked.
//! - `knowledge-retrieval` steps: `dataset_ids` become the attached knowledge
//!   bases; with none attached their query reads an empty `sys` value, which
//!   graphrt answers with no passages (instead of searching detached ones).

use graphrt_core::Workflow;
use serde_json::{json, Map, Value as Json};

use crate::error::{AppError, AppResult};
use crate::knowledge::retrieval::KNOWLEDGE_RETRIEVAL_KIND;

/// `sys` value holding [`super::brief::chatbot_brief`].
pub const BRIEF_SYS_NAME: &str = "chatbot_brief";
/// `sys` value holding [`super::brief::handoff_rules_text`].
pub const HANDOFF_RULES_SYS_NAME: &str = "chatbot_handoff_rules";
/// Always-empty `sys` value retrieval steps search when no knowledge is attached.
pub const NO_KNOWLEDGE_SYS_NAME: &str = "chatbot_no_knowledge";

/// The overlaid workflow (graphrt JSON document) for one reply.
#[derive(Debug, Clone, PartialEq)]
pub struct OverlaidFlow {
    pub flow_text: String,
    /// The flow searches knowledge itself; otherwise the host adds passages to the brief.
    pub has_retrieval_step: bool,
}

/// Overlays `flow_yaml` with the setup's references (see the module docs).
///
/// # Errors
/// `Workflow` when the document cannot be read or written back.
pub fn overlay_flow(flow_yaml: &str, knowledge_base_ids: &[String]) -> AppResult<OverlaidFlow> {
    let mut workflow = Workflow::parse(flow_yaml).map_err(|error| AppError::Workflow(error.to_string()))?;
    let mut has_retrieval_step = false;
    for node in &mut workflow.graph.nodes {
        match node.kind.as_str() {
            "llm" => prepend_system_message(&mut node.config, &sys_reference(BRIEF_SYS_NAME)),
            "agent" => prefix_instruction(&mut node.config, &sys_reference(BRIEF_SYS_NAME)),
            "question-classifier" => prefix_instruction(&mut node.config, &sys_reference(HANDOFF_RULES_SYS_NAME)),
            kind if kind == KNOWLEDGE_RETRIEVAL_KIND => {
                has_retrieval_step = true;
                point_retrieval_at(&mut node.config, knowledge_base_ids);
            }
            _ => {}
        }
    }
    let flow_text = workflow.to_json().map_err(|error| AppError::Workflow(error.to_string()))?;
    Ok(OverlaidFlow { flow_text, has_retrieval_step })
}

/// `dataset_ids` of every retrieval step (ids or names), in document order.
/// A document that cannot be read references nothing.
pub fn referenced_dataset_ids(flow_yaml: &str) -> Vec<String> {
    let Ok(workflow) = Workflow::parse(flow_yaml) else { return Vec::new() };
    let mut references: Vec<String> = Vec::new();
    for node in workflow.graph.nodes.iter().filter(|node| node.kind == KNOWLEDGE_RETRIEVAL_KIND) {
        let dataset_ids = node.config.get("dataset_ids").and_then(Json::as_array).into_iter().flatten();
        for reference in dataset_ids.filter_map(Json::as_str) {
            if !references.iter().any(|known| known == reference) {
                references.push(reference.to_owned());
            }
        }
    }
    references
}

fn sys_reference(name: &str) -> String {
    format!("{{{{#sys.{name}#}}}}")
}

fn prepend_system_message(config: &mut Map<String, Json>, reference: &str) {
    let system_message = json!({ "role": "system", "text": reference });
    let template = config.remove("prompt_template");
    let messages = match template {
        Some(Json::Array(mut messages)) => {
            match messages.first_mut().and_then(Json::as_object_mut) {
                Some(first) if first.get("role").and_then(Json::as_str) == Some("system") => {
                    let original = first.get("text").and_then(Json::as_str).unwrap_or_default();
                    first.insert("text".into(), Json::String(format!("{reference}\n\n{original}")));
                }
                _ => messages.insert(0, system_message),
            }
            messages
        }
        // A single completion prompt becomes a chat with the brief first.
        Some(single @ Json::Object(_)) => vec![system_message, single],
        _ => vec![system_message],
    };
    config.insert("prompt_template".into(), Json::Array(messages));
}

fn prefix_instruction(config: &mut Map<String, Json>, reference: &str) {
    let instruction = match config.get("instruction").and_then(Json::as_str) {
        Some(original) if !original.trim().is_empty() => format!("{reference}\n\n{original}"),
        _ => reference.to_owned(),
    };
    config.insert("instruction".into(), Json::String(instruction));
}

fn point_retrieval_at(config: &mut Map<String, Json>, knowledge_base_ids: &[String]) {
    if knowledge_base_ids.is_empty() {
        config.insert("query_variable_selector".into(), json!(["sys", NO_KNOWLEDGE_SYS_NAME]));
    } else {
        config.insert("dataset_ids".into(), json!(knowledge_base_ids));
    }
}
