//! One bot turn: runs the chatbot's workflow for one customer message.
//!
//! Inputs: the start input `message`, `sys.query` (same text),
//! `sys.conversation_id`, `sys.user_id` (the customer handle), the stored
//! `conversation.*` variables and the chatbot setup's `sys` values
//! (`crate::chatbot_setup::reply`). graphrt does not keep conversation variables
//! between runs; the host does, so the values the run writes (`variable_updated`
//! events) are merged back and returned for storage.
//!
//! The reply is the answer text assembled in template order by graphrt's
//! [`ResponseAssembler`], falling back to the `answer` output. End outputs
//! `handoff`, `handoff_reason`, `summary` and `suggested_reply` follow the
//! hand-off convention described in `guides/chatbot.md`.

use std::time::{Duration, Instant};

use futures::StreamExt;
use graphrt_core::response::ResponseAssembler;
use graphrt_core::{Engine, Event, IndexMap, RunInput, Selector, Value};
use serde_json::{Map, Value as Json};

use super::models::Conversation;
use crate::error::{AppError, AppResult};
use crate::knowledge::retrieval::KNOWLEDGE_RETRIEVAL_KIND;

/// Start input carrying the customer's message.
pub const MESSAGE_INPUT: &str = "message";
/// End output that hands the chat to the owner when truthy.
pub const HANDOFF_OUTPUT: &str = "handoff";
/// End output explaining the hand-off (`order_to_confirm`, `asked_for_person`, `not_sure` or plain words).
pub const HANDOFF_REASON_OUTPUT: &str = "handoff_reason";
/// Hand-off reason: the customer asked for a person.
pub const ASKED_FOR_PERSON_REASON: &str = "asked_for_person";
/// Hand-off reason: the answer is not in the knowledge.
pub const NOT_SURE_REASON: &str = "not_sure";
/// Hand-off reason: an order is ready for the owner to confirm.
pub const ORDER_TO_CONFIRM_REASON: &str = "order_to_confirm";
/// Hand-off reason: the customer sounds upset.
pub const SOUNDS_UPSET_REASON: &str = "sounds_upset";
/// Optional end output: a short summary of the customer and their order.
pub const SUMMARY_OUTPUT: &str = "summary";
/// Optional end output: a reply the owner can send with one click.
pub const SUGGESTED_REPLY_OUTPUT: &str = "suggested_reply";

/// What one bot turn produced.
#[derive(Debug, Clone, PartialEq)]
pub struct BotTurn {
    /// Text for the customer; empty when the workflow answered nothing.
    pub reply_text: String,
    /// `Some` when the workflow asked to hand the chat to the owner.
    pub handoff: Option<Handoff>,
    /// Every `conversation.*` variable after the run (JSON object).
    pub variables: Json,
    pub summary: Option<String>,
    pub suggested_reply: Option<String>,
    /// Passages the flow's own knowledge-retrieval steps found, in order.
    pub retrieved_sources: Vec<RetrievedSource>,
    /// Source names shown under the reply (filled by the host from the setup).
    pub citations: Vec<String>,
}

/// Where one passage the bot was given comes from.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RetrievedSource {
    pub knowledge_base_id: String,
    /// File or page name, e.g. `menu.pdf`.
    pub source_name: String,
}

impl RetrievedSource {
    /// Reads one hit of a `knowledge-retrieval` step's `result` output.
    fn from_result_item(item: &Json) -> Option<Self> {
        let knowledge_base_id = item.get("dataset_id")?.as_str()?.to_owned();
        let source_name = item
            .get("metadata")
            .and_then(|metadata| metadata.get("source_name"))
            .and_then(Json::as_str)
            .or_else(|| item.get("title").and_then(Json::as_str))
            .filter(|name| !name.trim().is_empty())?
            .to_owned();
        Some(Self { knowledge_base_id, source_name })
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Handoff {
    pub reason: Option<String>,
}

/// Shortest gap between two reply drafts, so a fast model does not flood the UI.
pub const DRAFT_INTERVAL: Duration = Duration::from_millis(50);

/// Runs `engine` for `message_text` and collects the reply.
///
/// `on_draft` receives the reply assembled so far while model tokens stream in
/// (the first text at once, then at most once per [`DRAFT_INTERVAL`]), so the
/// UI can show the answer as it is written instead of after the whole run.
///
/// # Errors
/// `Workflow` when the run fails, is aborted, or pauses (a chatbot cannot wait
/// for an approval in the middle of a chat).
pub async fn run_bot_turn(
    engine: &Engine,
    env: IndexMap<String, Value>,
    conversation: &Conversation,
    message_text: &str,
    extra_sys_values: &[(String, String)],
    on_draft: &(dyn Fn(&str) + Send + Sync),
) -> AppResult<BotTurn> {
    let mut variables = conversation.variables.as_object().cloned().unwrap_or_default();
    let mut assembler = ResponseAssembler::new(engine.graph());
    for (name, value) in &variables {
        assembler = assembler.with_value(&Selector::of("conversation", name), Value::from_json(value.clone()));
    }
    let mut run_input = build_run_input(env, conversation, message_text, &variables);
    for (name, value) in extra_sys_values {
        run_input = run_input.sys(name.as_str(), value.as_str());
    }
    let retrieval_steps: Vec<&str> = engine
        .graph()
        .nodes()
        .iter()
        .filter(|node| node.parent.is_none() && node.kind == KNOWLEDGE_RETRIEVAL_KIND)
        .map(|node| &*node.id)
        .collect();
    let mut retrieved_sources = Vec::new();
    let mut stream = engine.run(run_input);

    let mut assembled_reply = String::new();
    let mut outputs = None;
    let mut last_draft: Option<Instant> = None;
    while let Some(event) = stream.next().await {
        let mut grew = false;
        for chunk in assembler.push(&event) {
            grew |= !chunk.text.is_empty();
            assembled_reply.push_str(&chunk.text);
        }
        if grew && last_draft.is_none_or(|sent| sent.elapsed() >= DRAFT_INTERVAL) {
            let draft = assembled_reply.trim_start();
            if !draft.is_empty() {
                on_draft(draft);
                last_draft = Some(Instant::now());
            }
        }
        match event {
            Event::VariableUpdated { selector, value, .. } if selector.namespace() == "conversation" => {
                apply_variable_update(&mut variables, &selector, value.to_json());
            }
            Event::NodeSucceeded { node_id, outputs: step_outputs, .. }
                if retrieval_steps.contains(&node_id.as_str()) =>
            {
                if let Some(Json::Array(items)) = step_outputs.get("result").map(Value::to_json) {
                    retrieved_sources.extend(items.iter().filter_map(RetrievedSource::from_result_item));
                }
            }
            Event::RunSucceeded { outputs: run_outputs, .. } => outputs = Some(run_outputs),
            Event::RunFailed { error, .. } => return Err(AppError::Workflow(error)),
            Event::RunAborted { reason, .. } => {
                return Err(AppError::Workflow(format!("the bot was stopped: {reason}")))
            }
            Event::RunPaused { .. } => {
                return Err(AppError::Workflow(
                    "the chatbot's steps wait for an approval, which a chat cannot give".into(),
                ))
            }
            _ => {}
        }
    }
    for chunk in assembler.finish() {
        assembled_reply.push_str(&chunk.text);
    }
    let outputs = outputs.ok_or_else(|| AppError::Workflow("the bot stopped without an answer".into()))?;
    let mut turn = collect_turn(assembled_reply, &outputs, Json::Object(variables));
    turn.retrieved_sources = retrieved_sources;
    Ok(turn)
}

fn build_run_input(
    env: IndexMap<String, Value>,
    conversation: &Conversation,
    message_text: &str,
    variables: &Map<String, Json>,
) -> RunInput {
    let mut run_input = RunInput::new()
        .input(MESSAGE_INPUT, message_text)
        .sys("query", message_text)
        .sys("conversation_id", conversation.id.as_str())
        .sys("user_id", conversation.customer_handle.as_str());
    run_input.env = env;
    // Untrusted JSON conversion: stored values can never forge file references.
    run_input.conversation =
        variables.iter().map(|(name, value)| (name.clone(), Value::from_json(value.clone()))).collect();
    run_input
}

fn collect_turn(assembled_reply: String, outputs: &IndexMap<String, Value>, variables: Json) -> BotTurn {
    let reply_text = match assembled_reply.trim() {
        "" => outputs.get("answer").map(Value::to_text).unwrap_or_default().trim().to_owned(),
        reply => reply.to_owned(),
    };
    let handoff = outputs
        .get(HANDOFF_OUTPUT)
        .is_some_and(is_truthy)
        .then(|| Handoff { reason: non_empty_text(outputs.get(HANDOFF_REASON_OUTPUT)) });
    BotTurn {
        reply_text,
        handoff,
        variables,
        summary: non_empty_text(outputs.get(SUMMARY_OUTPUT)),
        suggested_reply: non_empty_text(outputs.get(SUGGESTED_REPLY_OUTPUT)),
        retrieved_sources: Vec::new(),
        citations: Vec::new(),
    }
}

/// `true`, a non-zero number, or the text `true` / `yes` / `1` (model and
/// template outputs are text, and graphrt never coerces text to boolean).
fn is_truthy(value: &Value) -> bool {
    match value {
        Value::Bool(flag) => *flag,
        Value::Int(number) => *number != 0,
        Value::Float(number) => *number != 0.0,
        Value::String(text) => matches!(text.trim().to_ascii_lowercase().as_str(), "true" | "yes" | "1"),
        _ => false,
    }
}

fn non_empty_text(value: Option<&Value>) -> Option<String> {
    let text = value.filter(|value| !value.is_null())?.to_text();
    let trimmed = text.trim();
    (!trimmed.is_empty()).then(|| trimmed.to_owned())
}

/// Writes `value` at `conversation.<name>[.path...]`, creating objects on the way.
fn apply_variable_update(variables: &mut Map<String, Json>, selector: &Selector, value: Json) {
    let path = selector.path();
    if path.is_empty() {
        variables.insert(selector.name().to_owned(), value);
        return;
    }
    let mut target = variables.entry(selector.name().to_owned()).or_insert_with(|| Json::Object(Map::new()));
    for (index, key) in path.iter().enumerate() {
        if !target.is_object() {
            *target = Json::Object(Map::new());
        }
        let Json::Object(fields) = target else { return };
        if index == path.len() - 1 {
            fields.insert(key.to_string(), value);
            return;
        }
        target = fields.entry(key.to_string()).or_insert_with(|| Json::Object(Map::new()));
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn truthy_handoff_values() {
        assert!(is_truthy(&Value::Bool(true)));
        assert!(is_truthy(&Value::from(" Yes ")));
        assert!(is_truthy(&Value::Int(1)));
        assert!(!is_truthy(&Value::Bool(false)));
        assert!(!is_truthy(&Value::from("false")));
        assert!(!is_truthy(&Value::Null));
    }

    #[test]
    fn variable_updates_replace_or_nest() {
        let mut variables = Map::new();
        apply_variable_update(&mut variables, &Selector::of("conversation", "turns"), json!(2));
        apply_variable_update(&mut variables, &Selector::parse("conversation.order.boxes").unwrap(), json!(50));
        assert_eq!(Json::Object(variables), json!({"turns": 2, "order": {"boxes": 50}}));
    }

    #[test]
    fn turn_falls_back_to_the_answer_output_and_reads_handoff() {
        let outputs: IndexMap<String, Value> = [
            ("answer".to_owned(), Value::from(" Siap kak ")),
            (HANDOFF_OUTPUT.to_owned(), Value::from("true")),
            (HANDOFF_REASON_OUTPUT.to_owned(), Value::from("order_to_confirm")),
            (SUMMARY_OUTPUT.to_owned(), Value::from("")),
        ]
        .into_iter()
        .collect();
        let turn = collect_turn(String::new(), &outputs, json!({}));
        assert_eq!(turn.reply_text, "Siap kak");
        assert_eq!(turn.handoff, Some(Handoff { reason: Some("order_to_confirm".into()) }));
        assert_eq!(turn.summary, None);
    }
}
