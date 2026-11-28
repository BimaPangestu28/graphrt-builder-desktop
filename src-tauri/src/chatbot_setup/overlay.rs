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
//!
//! The online copy ([`overlay_for_online`]) gets the same overlay with the texts as `env`
//! variables of the document (`{{#env.chatbot_brief#}}`): `graphrt serve` has no host to
//! give `sys` values, and the owner's words still never become part of a template.

use graphrt_core::dsl::VariableDecl;
use graphrt_core::{Value, ValueType, Workflow};
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
    let (workflow, has_retrieval_step) = overlay_in(flow_yaml, knowledge_base_ids, SYS_NAMESPACE)?;
    let flow_text = workflow.to_json().map_err(|error| AppError::Workflow(error.to_string()))?;
    Ok(OverlaidFlow { flow_text, has_retrieval_step })
}

/// The texts the online copy reads from `env`: [`BRIEF_SYS_NAME`], [`HANDOFF_RULES_SYS_NAME`]
/// and [`NO_KNOWLEDGE_SYS_NAME`] (the same names as on this computer).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct OnlineTexts {
    pub brief: String,
    pub handoff_rules: String,
}

/// [`overlay_flow`] for the online copy: the references read `env.*`, and the document
/// declares those variables with `texts` as their values (replacing ones of the same name).
///
/// # Errors
/// `Workflow` when the document cannot be read or written back.
pub fn overlay_for_online(flow_yaml: &str, knowledge_base_ids: &[String], texts: &OnlineTexts) -> AppResult<String> {
    let (mut workflow, _) = overlay_in(flow_yaml, knowledge_base_ids, ENV_NAMESPACE)?;
    let values = [
        (BRIEF_SYS_NAME, texts.brief.as_str()),
        (HANDOFF_RULES_SYS_NAME, texts.handoff_rules.as_str()),
        (NO_KNOWLEDGE_SYS_NAME, ""),
    ];
    workflow.env.retain(|declared| values.iter().all(|(name, _)| declared.name != *name));
    for (name, text) in values {
        workflow.env.push(VariableDecl {
            name: name.to_owned(),
            ty: ValueType::String,
            value: Some(Value::from(text)),
            description: Some("Chatbot setup from Graphrt Desktop".to_owned()),
        });
    }
    workflow.to_json().map_err(|error| AppError::Workflow(error.to_string()))
}

/// `sys`: values the host gives each reply on this computer.
const SYS_NAMESPACE: &str = "sys";
/// `env`: values declared in the document itself (the online copy).
const ENV_NAMESPACE: &str = "env";

fn overlay_in(flow_yaml: &str, knowledge_base_ids: &[String], namespace: &str) -> AppResult<(Workflow, bool)> {
    let mut workflow = Workflow::parse(flow_yaml).map_err(|error| AppError::Workflow(error.to_string()))?;
    let mut has_retrieval_step = false;
    for node in &mut workflow.graph.nodes {
        match node.kind.as_str() {
            "llm" => prepend_system_message(&mut node.config, &reference(namespace, BRIEF_SYS_NAME)),
            "agent" => prefix_instruction(&mut node.config, &reference(namespace, BRIEF_SYS_NAME)),
            "question-classifier" => {
                prefix_instruction(&mut node.config, &reference(namespace, HANDOFF_RULES_SYS_NAME));
            }
            kind if kind == KNOWLEDGE_RETRIEVAL_KIND => {
                has_retrieval_step = true;
                point_retrieval_at(&mut node.config, knowledge_base_ids, namespace);
            }
            _ => {}
        }
    }
    Ok((workflow, has_retrieval_step))
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

fn reference(namespace: &str, name: &str) -> String {
    format!("{{{{#{namespace}.{name}#}}}}")
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

fn point_retrieval_at(config: &mut Map<String, Json>, knowledge_base_ids: &[String], namespace: &str) {
    if knowledge_base_ids.is_empty() {
        config.insert("query_variable_selector".into(), json!([namespace, NO_KNOWLEDGE_SYS_NAME]));
    } else {
        config.insert("dataset_ids".into(), json!(knowledge_base_ids));
    }
}
