//! Finds HTTP steps that call placeholder addresses (`api.example.com`, `*.invalid`,
//! `your-domain.com`…). Models copy them from examples; a run then fails with a DNS
//! error, so the builder sends such drafts back for a real service or a plugin.

use graphrt_core::graph::GraphNode;
use graphrt_core::Graph;
use serde_json::Value as Json;

/// Domains reserved for documentation (RFC 2606 / RFC 6761) and common stand-ins.
const PLACEHOLDER_DOMAINS: &[&str] = &["example.com", "example.org", "example.net", "example.edu"];
const PLACEHOLDER_TOP_LEVEL: &[&str] = &[".example", ".invalid", ".test", ".localhost"];
const PLACEHOLDER_WORDS: &[&str] = &["your-domain", "yourdomain", "your-api", "yourapi", "your-server", "placeholder"];

/// "<step title> (<host>)" for every HTTP step whose URL host is a placeholder.
pub(super) fn placeholder_http_steps(graph: &Graph) -> Vec<String> {
    placeholder_http_nodes(graph).into_iter().map(|(node, host)| format!("{} ({host})", step_label(node))).collect()
}

/// `(node id, host)` of every HTTP step whose URL host is a placeholder.
pub(super) fn placeholder_http_node_hosts(graph: &Graph) -> Vec<(String, String)> {
    placeholder_http_nodes(graph).into_iter().map(|(node, host)| (node.id.to_string(), host)).collect()
}

fn placeholder_http_nodes(graph: &Graph) -> Vec<(&GraphNode, String)> {
    graph
        .nodes()
        .iter()
        .filter(|node| node.kind == "http-request")
        .filter_map(|node| {
            let host = url_host(node.doc.config.get("url").and_then(Json::as_str)?)?;
            is_placeholder_host(&host).then_some((node, host))
        })
        .collect()
}

/// The lower-cased host of a URL, or `None` when it is built from a reference
/// (`{{#env.API_URL#}}/send`) and so cannot be judged.
fn url_host(url: &str) -> Option<String> {
    let without_scheme = url.trim().split_once("://").map_or(url.trim(), |(_, rest)| rest);
    let host = without_scheme.split(['/', '?', '#']).next()?.rsplit('@').next()?.split(':').next()?;
    if host.is_empty() || host.contains("{{") {
        return None;
    }
    Some(host.to_ascii_lowercase())
}

fn is_placeholder_host(host: &str) -> bool {
    PLACEHOLDER_DOMAINS.iter().any(|domain| host == *domain || host.ends_with(&format!(".{domain}")))
        || PLACEHOLDER_TOP_LEVEL.iter().any(|suffix| host.ends_with(suffix))
        || PLACEHOLDER_WORDS.iter().any(|word| host.contains(word))
}

fn step_label(node: &GraphNode) -> String {
    node.doc
        .title
        .as_deref()
        .map(str::trim)
        .filter(|title| !title.is_empty())
        .map_or_else(|| node.id.to_string(), str::to_owned)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn placeholder_hosts_are_recognised() {
        for host in
            ["example.com", "api.example.com", "hooks.example.org", "shop.invalid", "api.test", "my.your-domain.com"]
        {
            assert!(is_placeholder_host(host), "{host}");
        }
        for host in ["maps.googleapis.com", "graph.facebook.com", "api.deepseek.com", "examples.dev", "notexample.com"]
        {
            assert!(!is_placeholder_host(host), "{host}");
        }
    }

    #[test]
    fn hosts_are_read_from_urls_and_references_are_skipped() {
        assert_eq!(url_host("https://api.example.com/send?x=1").as_deref(), Some("api.example.com"));
        assert_eq!(url_host("http://user@Host.Example.com:8080/p").as_deref(), Some("host.example.com"));
        assert_eq!(url_host("{{#env.API_URL#}}/send"), None);
        assert_eq!(url_host("https://{{#start.host#}}/x"), None);
    }
}
