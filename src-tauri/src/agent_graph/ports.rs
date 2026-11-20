//! Node ports (edge handles) derived from the node kind and config, following the
//! graphrt engine rules:
//!
//! - `if-else`: one exit per `cases[].case_id`, plus `false` (Else). A legacy
//!   single-case config (top-level `conditions`) exits through `true` / `false`.
//! - `human-input`: one exit per `actions[].id` (default `submit`).
//! - `question-classifier`: one exit per `classes[].id`.
//! - kinds whose descriptor lists fixed handles: those.
//! - `end`, `loop-end`: no exit. Everything else: the default `source` exit.
//! - every node: `fail-branch` when `on_error` is `fail-branch`.
//!
//! `start` and the body markers (`iteration-start`, `loop-start`) take no input.

use graphrt_core::catalog::{Handles, NodeDescriptor};
use graphrt_core::graph::{FAIL_BRANCH, SOURCE_HANDLE};
use serde_json::{Map, Value as Json};

use super::model::{NodePort, NodePorts, OnErrorStrategy, PortRole};

/// Handle of a node's only input.
pub const TARGET_HANDLE: &str = "target";
/// if-else exit taken when no case matches.
pub const ELSE_HANDLE: &str = "false";
/// Legacy single-case if-else exit.
const LEGACY_CASE_HANDLE: &str = "true";
/// Default human-input action.
const DEFAULT_ACTION: &str = "submit";

/// Kinds that take no incoming edge.
const NO_INPUT_KINDS: &[&str] = &["start", "iteration-start", "loop-start"];
/// Kinds with no exit.
const NO_OUTPUT_KINDS: &[&str] = &["end", "loop-end"];

/// Ports of one node.
pub(super) fn node_ports(
    kind: &str,
    config: &Map<String, Json>,
    on_error: OnErrorStrategy,
    descriptor: Option<&NodeDescriptor>,
) -> NodePorts {
    let inputs =
        if NO_INPUT_KINDS.contains(&kind) { Vec::new() } else { vec![port(TARGET_HANDLE, "", PortRole::Input)] };
    let mut outputs = exit_ports(kind, config, descriptor);
    if on_error == OnErrorStrategy::FailBranch {
        outputs.push(port(FAIL_BRANCH, "On error", PortRole::FailBranch));
    }
    NodePorts { inputs, outputs }
}

fn exit_ports(kind: &str, config: &Map<String, Json>, descriptor: Option<&NodeDescriptor>) -> Vec<NodePort> {
    if NO_OUTPUT_KINDS.contains(&kind) {
        return Vec::new();
    }
    match kind {
        "if-else" => if_else_ports(config),
        "human-input" => action_ports(config),
        "question-classifier" => list_ports(config, "classes", "id", &["label", "name"]),
        _ => match descriptor.map(|descriptor| &descriptor.handles) {
            Some(Handles::Fixed { handles }) => {
                handles.iter().map(|handle| port(handle, handle, PortRole::Branch)).collect()
            }
            _ => vec![port(SOURCE_HANDLE, "", PortRole::Default)],
        },
    }
}

fn if_else_ports(config: &Map<String, Json>) -> Vec<NodePort> {
    let mut ports = list_ports(config, "cases", "case_id", &[]);
    if ports.is_empty() && config.contains_key("conditions") {
        ports.push(port(LEGACY_CASE_HANDLE, "If", PortRole::Branch));
    }
    ports.push(port(ELSE_HANDLE, "Else", PortRole::Else));
    ports
}

fn action_ports(config: &Map<String, Json>) -> Vec<NodePort> {
    let ports = list_ports(config, "actions", "id", &["title"]);
    if ports.is_empty() {
        return vec![port(DEFAULT_ACTION, "Submit", PortRole::Branch)];
    }
    ports
}

/// One branch port per item of `config[list_key]` with a string `id_key`, labelled
/// by the first non-empty `label_keys` field (else the id).
fn list_ports(config: &Map<String, Json>, list_key: &str, id_key: &str, label_keys: &[&str]) -> Vec<NodePort> {
    let Some(items) = config.get(list_key).and_then(Json::as_array) else { return Vec::new() };
    items
        .iter()
        .filter_map(|item| {
            let id = item.get(id_key).and_then(Json::as_str).filter(|id| !id.is_empty())?;
            let label = label_keys
                .iter()
                .filter_map(|key| item.get(*key).and_then(Json::as_str))
                .map(str::trim)
                .find(|label| !label.is_empty())
                .unwrap_or(id);
            Some(port(id, label, PortRole::Branch))
        })
        .collect()
}

fn port(id: &str, label: &str, role: PortRole) -> NodePort {
    NodePort { id: id.to_owned(), label: label.to_owned(), role }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn ports_of(kind: &str, config: Json, on_error: OnErrorStrategy) -> NodePorts {
        node_ports(kind, config.as_object().unwrap(), on_error, None)
    }

    fn output_ids(ports: &NodePorts) -> Vec<&str> {
        ports.outputs.iter().map(|port| port.id.as_str()).collect()
    }

    #[test]
    fn branch_kinds_get_one_exit_per_configured_branch() {
        let cases = json!({ "cases": [{ "case_id": "big" }, { "case_id": "small" }] });
        let actions = json!({ "actions": [{ "id": "send", "title": "Send" }, { "id": "skip" }] });
        let classes = json!({ "classes": [{ "id": "c1", "name": "Billing" }] });

        assert_eq!(output_ids(&ports_of("if-else", cases, OnErrorStrategy::Fail)), ["big", "small", "false"]);
        let approval = ports_of("human-input", actions, OnErrorStrategy::Fail);
        assert_eq!(output_ids(&approval), ["send", "skip"]);
        assert_eq!(approval.outputs[0].label, "Send");
        assert_eq!(approval.outputs[1].label, "skip");
        assert_eq!(ports_of("question-classifier", classes, OnErrorStrategy::Fail).outputs[0].label, "Billing");
    }

    #[test]
    fn defaults_and_legacy_forms() {
        assert_eq!(output_ids(&ports_of("human-input", json!({}), OnErrorStrategy::Fail)), ["submit"]);
        assert_eq!(
            output_ids(&ports_of("if-else", json!({ "conditions": [] }), OnErrorStrategy::Fail)),
            ["true", "false"]
        );
        assert_eq!(output_ids(&ports_of("llm", json!({}), OnErrorStrategy::Fail)), ["source"]);
        assert!(ports_of("end", json!({}), OnErrorStrategy::Fail).outputs.is_empty());
    }

    #[test]
    fn inputs_and_the_error_exit() {
        assert!(ports_of("start", json!({}), OnErrorStrategy::Fail).inputs.is_empty());
        assert!(ports_of("iteration-start", json!({}), OnErrorStrategy::Fail).inputs.is_empty());
        let failing = ports_of("http-request", json!({}), OnErrorStrategy::FailBranch);
        assert_eq!(failing.inputs[0].id, "target");
        assert_eq!(output_ids(&failing), ["source", "fail-branch"]);
        assert_eq!(failing.outputs[1].role, PortRole::FailBranch);
    }

    #[test]
    fn fixed_descriptor_handles_are_used() {
        let descriptor = NodeDescriptor::new("router.route", "Route", graphrt_core::catalog::NodeCategory::Other)
            .handles(Handles::Fixed { handles: vec!["short".into(), "long".into()] });
        let ports = node_ports("router.route", &Map::new(), OnErrorStrategy::Fail, Some(&descriptor));
        assert_eq!(output_ids(&ports), ["short", "long"]);
    }
}
