//! Desktop details added to a run's stored pause reasons when it pauses, and
//! read back to expire approvals that waited too long.
//!
//! graphrt pauses with `{frame, node_id, kind, data}` per waiting node. Before
//! the reasons are stored on the run row, [`PauseSettings::enrich`] adds:
//!
//! - `human_input` (an "Ask me before continuing" step) with a time limit:
//!   `expires_at` (RFC 3339) and `on_timeout` (`{"kind": "stop"}` or
//!   `{"kind": "answer", "action": "<button id>"}`). The time limit is the
//!   pause data's `timeout_ms` when graphrt sends one, else the step's own
//!   `timeout_ms`. graphrt's document loader moves a node's top-level
//!   `timeout_ms` into the node's run policy, so for a `human-input` step it
//!   never reaches the pause data; the desktop reads it from the policy instead
//!   (the step pauses at once, so as a run time limit it changes nothing).
//!   What happens on expiry is the step's `on_timeout` config key, which
//!   graphrt ignores (its `human-input` config allows extra keys):
//!   `on_timeout: stop` (also the default) or `on_timeout: { action: skip }`.
//!   A deadline survives a resume that leaves the question unanswered (e.g.
//!   another question of the same run was answered): see [`carried_deadlines`].
//! - `tool_approval` (a "Run an agent" step whose tools ask first): each
//!   `data.calls[]` gets `provider` / `tool` when the step's `tools` list names
//!   the tool, and its `arguments` with secret-looking values replaced by
//!   [`REDACTED`]. graphrt keeps the real arguments in the snapshot, so
//!   redacting the stored reason never changes what the tool receives.
//!
//! graphrt's agent node has no time limit for tool approvals, sends no reason
//! for a call and has no "allow for the rest of this run" answer; it resumes
//! with `{"approvals": {"<call id>": bool}}` or `{"approved": bool}`.

use std::collections::HashMap;

use chrono::{DateTime, Utc};
use graphrt_core::Graph;
use serde::{Deserialize, Serialize};
use serde_json::{json, Map, Value as Json};

use crate::flow::{TimeoutChoice, TrustedHosts};

pub(crate) const HUMAN_INPUT_PAUSE_KIND: &str = "human_input";
pub(crate) const TOOL_APPROVAL_PAUSE_KIND: &str = "tool_approval";
const HUMAN_INPUT_NODE_KIND: &str = "human-input";
const AGENT_NODE_KIND: &str = "agent";
pub(crate) const EXPIRES_AT_KEY: &str = "expires_at";
pub(crate) const ON_TIMEOUT_KEY: &str = "on_timeout";
/// Shown instead of a tool argument that looks like a secret.
pub(crate) const REDACTED: &str = "[hidden]";
/// Longest tool name graphrt offers a model (see `unique_name` in graphrt-llm's agent node).
const MAX_TOOL_NAME_CHARS: usize = 64;

/// Argument names whose values are never shown (matched as lowercase substrings).
const SECRET_KEY_PARTS: &[&str] =
    &["password", "passwd", "secret", "token", "api_key", "apikey", "api-key", "authorization", "credential", "cookie"];
/// Value prefixes of common API keys and tokens.
const SECRET_VALUE_PREFIXES: &[&str] = &["Bearer ", "Basic ", "sk-", "sk_", "ghp_", "gho_", "xoxb-", "xoxp-", "AKIA"];

/// What an approval step does when nobody answered before its deadline.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum TimeoutAction {
    /// Stop the run (status `aborted`).
    Stop,
    /// Answer with this button (action id), with the fields' defaults.
    Answer { action: String },
}

/// Time limit settings of one `human-input` step.
#[derive(Debug, Clone, PartialEq, Eq)]
struct ApprovalStepTimeout {
    /// The step's own `timeout_ms`; `None` waits until answered.
    timeout_ms: Option<u64>,
    on_timeout: TimeoutAction,
}

/// A tool an agent step names in its `tools` list.
#[derive(Debug, Clone, PartialEq, Eq)]
struct ToolReference {
    provider: String,
    tool: String,
}

/// What the desktop needs from a flow to enrich its pause reasons.
#[derive(Debug, Clone, Default)]
pub(crate) struct PauseSettings {
    approval_steps: HashMap<String, ApprovalStepTimeout>,
    agent_tools: HashMap<String, Vec<ToolReference>>,
}

impl PauseSettings {
    /// Reads the approval and agent steps of `flow_yaml`; an unreadable flow (logged) gives none.
    pub(crate) fn from_flow(flow_yaml: &str, trusted_hosts: &TrustedHosts) -> Self {
        match crate::flow::compile_flow(flow_yaml) {
            Ok(graph) => Self::from_graph(&graph, trusted_hosts),
            Err(error) => {
                log::warn!("could not read the approval settings of a flow: {error}");
                Self::default()
            }
        }
    }

    fn from_graph(graph: &Graph, trusted_hosts: &TrustedHosts) -> Self {
        let mut settings = Self::default();
        let answers_into_a_send: Vec<String> = crate::flow::timeouts_that_send(graph, trusted_hosts)
            .into_iter()
            .map(|timeout| timeout.approval_node_id)
            .collect();
        for node in graph.nodes() {
            let config = &node.doc.config;
            match node.kind.as_str() {
                HUMAN_INPUT_NODE_KIND => {
                    let timeout_ms = node.policy.timeout_ms.or_else(|| config.get("timeout_ms").and_then(Json::as_u64));
                    let on_timeout = if answers_into_a_send.iter().any(|node_id| **node_id == *node.id) {
                        // Saved before validation refused this: never send without a person answering.
                        log::warn!(
                            "approval step {}: on_timeout would answer into a send, the run stops instead",
                            node.id
                        );
                        TimeoutAction::Stop
                    } else {
                        read_on_timeout(&node.id, config)
                    };
                    settings.approval_steps.insert(node.id.to_string(), ApprovalStepTimeout { timeout_ms, on_timeout });
                }
                AGENT_NODE_KIND => {
                    settings.agent_tools.insert(node.id.to_string(), read_tool_references(config));
                }
                _ => {}
            }
        }
        settings
    }

    /// Adds deadlines, timeout actions and tool details to graphrt's pause reasons (a JSON array).
    pub(crate) fn enrich(&self, reasons: &mut Json, carried: &HashMap<String, String>, now: DateTime<Utc>) {
        let Some(reasons) = reasons.as_array_mut() else { return };
        for reason in reasons {
            let key = pause_key(reason);
            let node_id = text(reason, "node_id").unwrap_or_default().to_owned();
            let Some(fields) = reason.as_object_mut() else { continue };
            match fields.get("kind").and_then(Json::as_str) {
                Some(HUMAN_INPUT_PAUSE_KIND) => self.add_deadline(fields, &node_id, carried.get(&key), now),
                Some(TOOL_APPROVAL_PAUSE_KIND) => self.describe_tool_calls(fields, &node_id),
                _ => {}
            }
        }
    }

    fn add_deadline(
        &self,
        fields: &mut Map<String, Json>,
        node_id: &str,
        carried: Option<&String>,
        now: DateTime<Utc>,
    ) {
        let step = self.approval_steps.get(node_id);
        let data_timeout = fields.get("data").and_then(|data| data.get("timeout_ms")).and_then(Json::as_u64);
        let Some(timeout_ms) = data_timeout.or_else(|| step.and_then(|step| step.timeout_ms)) else { return };
        let expires_at = carried.cloned().unwrap_or_else(|| deadline_after(now, timeout_ms).to_rfc3339());
        let on_timeout = step.map_or(TimeoutAction::Stop, |step| step.on_timeout.clone());
        fields.insert(EXPIRES_AT_KEY.to_owned(), Json::String(expires_at));
        fields.insert(ON_TIMEOUT_KEY.to_owned(), serde_json::to_value(on_timeout).unwrap_or(Json::Null));
    }

    fn describe_tool_calls(&self, fields: &mut Map<String, Json>, node_id: &str) {
        let references = self.agent_tools.get(node_id).map_or(&[][..], Vec::as_slice);
        let Some(calls) = fields.get_mut("data").and_then(|data| data.get_mut("calls")).and_then(Json::as_array_mut)
        else {
            return;
        };
        for call in calls.iter_mut().filter_map(Json::as_object_mut) {
            if let Some(arguments) = call.get_mut("arguments") {
                *arguments = redact_secrets(arguments);
            }
            let exposed_name = call.get("name").and_then(Json::as_str).unwrap_or_default();
            if let Some(reference) = find_tool_reference(references, exposed_name) {
                call.insert("provider".to_owned(), Json::String(reference.provider.clone()));
                call.insert("tool".to_owned(), Json::String(reference.tool.clone()));
            }
        }
    }
}

fn deadline_after(now: DateTime<Utc>, timeout_ms: u64) -> DateTime<Utc> {
    let timeout = chrono::Duration::milliseconds(i64::try_from(timeout_ms).unwrap_or(i64::MAX));
    now.checked_add_signed(timeout).unwrap_or(DateTime::<Utc>::MAX_UTC)
}

/// `on_timeout: stop`, `on_timeout: { action: <id> }` or `on_timeout: <id>`; anything
/// else (or a button the step does not have) stops the run.
fn read_on_timeout(node_id: &str, config: &Map<String, Json>) -> TimeoutAction {
    match crate::flow::read_timeout_choice(config) {
        TimeoutChoice::Stop => TimeoutAction::Stop,
        TimeoutChoice::Answer(action) => TimeoutAction::Answer { action },
        TimeoutChoice::UnknownAction => {
            log::warn!("approval step {node_id}: on_timeout names no button of the step, the run stops instead");
            TimeoutAction::Stop
        }
    }
}

/// `tools: ["provider/name", {provider, name}]`; `provider/*` cannot be resolved and is skipped.
fn read_tool_references(config: &Map<String, Json>) -> Vec<ToolReference> {
    let Some(tools) = config.get("tools").and_then(Json::as_array) else { return Vec::new() };
    tools
        .iter()
        .filter_map(|entry| match entry {
            Json::String(reference) => {
                let (provider, tool) = reference.split_once('/')?;
                Some(ToolReference { provider: provider.to_owned(), tool: tool.to_owned() })
            }
            Json::Object(_) => Some(ToolReference {
                provider: text(entry, "provider")?.to_owned(),
                tool: text(entry, "name").or_else(|| text(entry, "tool"))?.to_owned(),
            }),
            _ => None,
        })
        .filter(|reference| reference.tool != "*")
        .collect()
}

/// graphrt offers a tool to the model as its cleaned name, or `provider_name` when two collide.
fn find_tool_reference<'a>(references: &'a [ToolReference], exposed_name: &str) -> Option<&'a ToolReference> {
    references.iter().find(|reference| model_safe_name(&reference.tool) == exposed_name).or_else(|| {
        references
            .iter()
            .find(|reference| model_safe_name(&format!("{}_{}", reference.provider, reference.tool)) == exposed_name)
    })
}

fn model_safe_name(name: &str) -> String {
    name.chars()
        .map(
            |character| {
                if character.is_ascii_alphanumeric() || character == '_' || character == '-' {
                    character
                } else {
                    '_'
                }
            },
        )
        .take(MAX_TOOL_NAME_CHARS)
        .collect()
}

/// `arguments` with values under secret-looking names, and token-looking strings, replaced.
pub(crate) fn redact_secrets(value: &Json) -> Json {
    match value {
        Json::Object(fields) => Json::Object(
            fields
                .iter()
                .map(|(name, field_value)| {
                    let shown = if is_secret_name(name) && !field_value.is_null() {
                        Json::String(REDACTED.to_owned())
                    } else {
                        redact_secrets(field_value)
                    };
                    (name.clone(), shown)
                })
                .collect(),
        ),
        Json::Array(items) => Json::Array(items.iter().map(redact_secrets).collect()),
        Json::String(text) if SECRET_VALUE_PREFIXES.iter().any(|prefix| text.starts_with(prefix)) => {
            Json::String(REDACTED.to_owned())
        }
        other => other.clone(),
    }
}

fn is_secret_name(name: &str) -> bool {
    let lowercase = name.to_ascii_lowercase();
    SECRET_KEY_PARTS.iter().any(|part| lowercase.contains(part))
}

fn text<'a>(value: &'a Json, field: &str) -> Option<&'a str> {
    value.get(field).and_then(Json::as_str)
}

/// Identifies one waiting question across pauses: `kind|frame|node_id`.
fn pause_key(reason: &Json) -> String {
    format!(
        "{}|{}|{}",
        text(reason, "kind").unwrap_or_default(),
        text(reason, "frame").unwrap_or_default(),
        text(reason, "node_id").unwrap_or_default()
    )
}

/// Deadlines of the stored pause reasons, so a question still unanswered after a
/// resume keeps its deadline instead of starting a new one.
pub(crate) fn carried_deadlines(reasons: Option<&Json>) -> HashMap<String, String> {
    reasons
        .and_then(Json::as_array)
        .map(|reasons| {
            reasons
                .iter()
                .filter_map(|reason| Some((pause_key(reason), text(reason, EXPIRES_AT_KEY)?.to_owned())))
                .collect()
        })
        .unwrap_or_default()
}

/// A question whose deadline has passed.
#[derive(Debug, Clone, PartialEq)]
pub(crate) struct ExpiredApproval {
    pub(crate) node_id: String,
    pub(crate) frame: String,
    pub(crate) on_timeout: TimeoutAction,
    /// The answer to resume with (`{action, values}` with the fields' defaults) for `Answer`.
    pub(crate) answer: Json,
    /// Title of the button the timeout chose, for the run log.
    pub(crate) action_title: Option<String>,
}

impl ExpiredApproval {
    /// The `approval_timed_out` event stored in the run log.
    pub(crate) fn to_event(&self) -> Json {
        let (outcome, action) = match &self.on_timeout {
            TimeoutAction::Stop => ("stop", None),
            TimeoutAction::Answer { action } => ("answer", Some(action.clone())),
        };
        json!({
            "type": "approval_timed_out",
            "node_id": self.node_id,
            "frame": self.frame,
            "outcome": outcome,
            "action": action,
            "action_title": self.action_title,
        })
    }
}

/// The earliest `expires_at` of the `human_input` questions among `reasons`, if any has one.
pub(crate) fn earliest_deadline(reasons: Option<&Json>) -> Option<DateTime<Utc>> {
    reasons?
        .as_array()?
        .iter()
        .filter(|reason| text(reason, "kind") == Some(HUMAN_INPUT_PAUSE_KIND))
        .filter_map(|reason| DateTime::parse_from_rfc3339(text(reason, EXPIRES_AT_KEY)?).ok())
        .map(|expires_at| expires_at.with_timezone(&Utc))
        .min()
}

/// The `human_input` questions among `reasons` whose `expires_at` is at or before `now`.
pub(crate) fn find_expired_approvals(reasons: Option<&Json>, now: DateTime<Utc>) -> Vec<ExpiredApproval> {
    let Some(reasons) = reasons.and_then(Json::as_array) else { return Vec::new() };
    reasons
        .iter()
        .filter(|reason| text(reason, "kind") == Some(HUMAN_INPUT_PAUSE_KIND))
        .filter(|reason| {
            text(reason, EXPIRES_AT_KEY)
                .and_then(|expires_at| DateTime::parse_from_rfc3339(expires_at).ok())
                .is_some_and(|expires_at| expires_at <= now)
        })
        .filter_map(|reason| {
            let node_id = text(reason, "node_id")?.to_owned();
            let on_timeout = reason
                .get(ON_TIMEOUT_KEY)
                .and_then(|choice| serde_json::from_value(choice.clone()).ok())
                .unwrap_or(TimeoutAction::Stop);
            let data = reason.get("data").unwrap_or(&Json::Null);
            let (answer, action_title) = match &on_timeout {
                TimeoutAction::Stop => (Json::Null, None),
                TimeoutAction::Answer { action } => (
                    json!({"action": action, "values": default_values(data)}),
                    find_action_title(data, action).or_else(|| Some(action.clone())),
                ),
            };
            Some(ExpiredApproval {
                frame: text(reason, "frame").unwrap_or_default().to_owned(),
                node_id,
                on_timeout,
                answer,
                action_title,
            })
        })
        .collect()
}

fn default_values(data: &Json) -> Json {
    let values: Map<String, Json> = data
        .get("fields")
        .and_then(Json::as_array)
        .map(|fields| {
            fields
                .iter()
                .filter_map(|field| {
                    Some((text(field, "name")?.to_owned(), field.get("default").cloned().unwrap_or(Json::Null)))
                })
                .collect()
        })
        .unwrap_or_default();
    Json::Object(values)
}

fn find_action_title(data: &Json, action_id: &str) -> Option<String> {
    data.get("actions")?
        .as_array()?
        .iter()
        .find(|action| text(action, "id") == Some(action_id))
        .and_then(|action| text(action, "title"))
        .map(str::to_owned)
}

#[cfg(test)]
mod tests {
    use super::*;

    const FLOW: &str = r#"
version: "1"
name: timeouts
graph:
  nodes:
    - { id: start, type: start }
    - id: ask
      type: human-input
      prompt: "Send?"
      timeout_ms: 7200000
      on_timeout: { action: skip }
      actions: [{ id: send, title: Send }, { id: skip, title: Skip it }]
    - id: ask_forever
      type: human-input
      prompt: "Really?"
    - id: ask_unknown
      type: human-input
      prompt: "Hm?"
      timeout_ms: 1000
      on_timeout: { action: nope }
    - id: helper
      type: agent
      model: { provider: openai, name: gpt-4o-mini }
      instruction: "Help"
      tools: ["whatsapp-web/send_message", { provider: maps, name: "search places" }, "mcp/*"]
    - { id: end, type: end }
  edges:
    - { source: start, target: ask }
    - { source: ask, target: ask_forever, handle: send }
    - { source: ask_forever, target: ask_unknown }
    - { source: ask_unknown, target: helper }
    - { source: helper, target: end }
"#;

    fn now() -> DateTime<Utc> {
        DateTime::parse_from_rfc3339("2026-11-21T10:00:00Z").unwrap().with_timezone(&Utc)
    }

    #[test]
    fn approval_steps_get_a_deadline_and_their_timeout_action() {
        let settings = PauseSettings::from_flow(FLOW, &TrustedHosts::none());
        let mut reasons = json!([
            {"frame": "", "node_id": "ask", "kind": "human_input", "data": {"timeout_ms": null}},
            {"frame": "", "node_id": "ask_forever", "kind": "human_input", "data": {}},
            {"frame": "", "node_id": "ask_unknown", "kind": "human_input", "data": {}},
        ]);
        settings.enrich(&mut reasons, &HashMap::new(), now());
        assert_eq!(reasons[0][EXPIRES_AT_KEY], json!("2026-11-21T12:00:00+00:00"));
        assert_eq!(reasons[0][ON_TIMEOUT_KEY], json!({"kind": "answer", "action": "skip"}));
        assert!(reasons[1].get(EXPIRES_AT_KEY).is_none(), "no time limit, waits until answered");
        assert_eq!(reasons[2][ON_TIMEOUT_KEY], json!({"kind": "stop"}), "unknown button falls back to stop");
    }

    #[test]
    fn a_question_left_unanswered_keeps_its_deadline_across_a_resume() {
        let settings = PauseSettings::from_flow(FLOW, &TrustedHosts::none());
        let stored =
            json!([{"frame": "", "node_id": "ask", "kind": "human_input", "expires_at": "2026-11-21T10:30:00+00:00"}]);
        let carried = carried_deadlines(Some(&stored));
        let mut reasons = json!([{"frame": "", "node_id": "ask", "kind": "human_input", "data": {}}]);
        settings.enrich(&mut reasons, &carried, now());
        assert_eq!(reasons[0][EXPIRES_AT_KEY], json!("2026-11-21T10:30:00+00:00"));
    }

    #[test]
    fn tool_calls_get_provider_and_tool_and_hide_secrets() {
        let settings = PauseSettings::from_flow(FLOW, &TrustedHosts::none());
        let mut reasons = json!([{"frame": "", "node_id": "helper", "kind": "tool_approval", "data": {"calls": [
            {"id": "c1", "name": "send_message", "arguments": {"phone": "+62", "api_key": "abc", "headers": {"Authorization": "x"}, "note": "Bearer zzz"}},
            {"id": "c2", "name": "search_places", "arguments": {"query": "cafe"}},
            {"id": "c3", "name": "other", "arguments": "not json"}
        ]}}]);
        settings.enrich(&mut reasons, &HashMap::new(), now());
        let calls = &reasons[0]["data"]["calls"];
        assert_eq!(
            (calls[0]["provider"].as_str(), calls[0]["tool"].as_str()),
            (Some("whatsapp-web"), Some("send_message"))
        );
        assert_eq!(
            calls[0]["arguments"],
            json!({"phone": "+62", "api_key": REDACTED, "headers": {"Authorization": REDACTED}, "note": REDACTED})
        );
        assert_eq!(calls[1]["tool"], json!("search places"));
        assert!(calls[2].get("provider").is_none());
        assert_eq!(calls[2]["arguments"], json!("not json"));
    }

    #[test]
    fn expired_questions_carry_their_timeout_answer() {
        let reasons = json!([
            {"frame": "each[1]", "node_id": "ask", "kind": "human_input", "expires_at": "2026-11-21T09:59:00+00:00",
             "on_timeout": {"kind": "answer", "action": "skip"},
             "data": {"fields": [{"name": "note", "default": "hi"}], "actions": [{"id": "skip", "title": "Skip it"}]}},
            {"frame": "", "node_id": "later", "kind": "human_input", "expires_at": "2026-11-21T11:00:00+00:00"},
            {"frame": "", "node_id": "stop", "kind": "human_input", "expires_at": "2026-11-21T10:00:00+00:00"},
            {"frame": "", "node_id": "agent", "kind": "tool_approval", "expires_at": "2026-11-21T09:00:00+00:00"},
        ]);
        let expired = find_expired_approvals(Some(&reasons), now());
        assert_eq!(expired.len(), 2);
        assert_eq!(expired[0].answer, json!({"action": "skip", "values": {"note": "hi"}}));
        assert_eq!(expired[0].action_title.as_deref(), Some("Skip it"));
        assert_eq!(expired[0].to_event()["outcome"], json!("answer"));
        assert_eq!(expired[1].on_timeout, TimeoutAction::Stop);
        assert_eq!(expired[1].to_event()["outcome"], json!("stop"));
    }
}
