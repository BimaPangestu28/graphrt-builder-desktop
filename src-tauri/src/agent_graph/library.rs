//! The node library: every kind the desktop registers (graphrt builtins,
//! graphrt-llm, graphrt-http, graphrt-rag, installed plugins) plus the node
//! kinds of catalog plugins that are not installed, built from the registry's
//! descriptors rather than a hard-coded list.
//!
//! Names are the app's names for builtins (`flow::node_kind_title`: "Ask a model")
//! and the catalog / manifest titles for plugin kinds. Kinds graphrt has but the
//! desktop does not offer (`code`, `document-extractor`, `system-one`) are left
//! out; body markers and `variable-assigner` are listed but not offered.

use std::collections::{HashMap, HashSet};

use graphrt_core::catalog::{Handles, NodeDescriptor};
use graphrt_core::Registry;
use serde::{Deserialize, Serialize};
use serde_json::Value as Json;

use crate::flow;

/// Kinds graphrt knows that the desktop never offers.
const NOT_OFFERED_KINDS: &[&str] = &["code", "document-extractor", "system-one"];
/// Kinds created with something else and never added from the library.
const UNLISTED_KINDS: &[&str] = &["iteration-start", "loop-start", "variable-assigner"];

/// Builtin kinds per group, in library order.
const BUILTIN_GROUPS: &[(NodeKindGroup, &[&str])] = &[
    (NodeKindGroup::StartAndFinish, &["start", "end", "answer"]),
    (NodeKindGroup::Ai, &["llm", "agent", "question-classifier", "parameter-extractor", "knowledge-retrieval"]),
    (NodeKindGroup::Connect, &["http-request", "tool"]),
    (NodeKindGroup::DecideAndWait, &["if-else", "human-input"]),
    (NodeKindGroup::Repeat, &["iteration", "loop", "loop-end"]),
    (
        NodeKindGroup::Data,
        &["template-transform", "list-operator", "variable-aggregator", "assigner", "variable-assigner"],
    ),
    (NodeKindGroup::Hidden, &["iteration-start", "loop-start"]),
];

/// Section of the library a kind is listed in.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum NodeKindGroup {
    StartAndFinish,
    Ai,
    Connect,
    DecideAndWait,
    Repeat,
    Data,
    /// Plugin actions (installed or from the catalog).
    Plugin,
    /// Body markers created with their container.
    Hidden,
    /// Registered kinds the app has no section for.
    Other,
}

/// One node kind of the library.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NodeKindInfo {
    /// Node `type` in workflow documents.
    pub kind: String,
    /// The app's name for it ("Ask a model", "Send WhatsApp message").
    pub display_name: String,
    pub group: NodeKindGroup,
    pub description: String,
    /// Icon hint from the descriptor (`brain`, `globe`...), cosmetic.
    pub icon: Option<String>,
    /// JSON Schema of the node's `config` (`{}` when the kind publishes none).
    pub config_schema: Json,
    /// Declared outputs; kinds with `dynamicOutputs` add more from their config.
    pub outputs: Vec<NodeKindOutput>,
    pub dynamic_outputs: bool,
    pub ports: NodeKindPorts,
    /// Owns a body (iteration, loop).
    pub container: bool,
    /// Shown in the Add node palette.
    pub offered: bool,
    /// Sends data out: the builder's rule wants an approval step before it.
    pub sends_data: bool,
    /// `builtin`, the crate name, or `plugin:<name>`.
    pub source: String,
    pub plugin: Option<NodeKindPlugin>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NodeKindOutput {
    pub name: String,
    /// graphrt value type: `string`, `number`, `array[object]`, `any`...
    pub value_type: String,
    pub description: String,
    /// Streamed while the step runs.
    pub streaming: bool,
}

/// How the kind's ports are derived (the exact ports of a node come with the graph).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NodeKindPorts {
    /// Takes an incoming arrow (false for `start` and body markers).
    pub has_input: bool,
    /// `none` (End, Stop repeating), `single` (one `source` exit), `fixed` or `dynamic`.
    pub exits: ExitRule,
    /// The exits of a `fixed` kind.
    pub fixed_handles: Vec<String>,
    /// For `dynamic` kinds: which config field lists the exits (`cases[].case_id + "false"`).
    pub config_path: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ExitRule {
    None,
    Single,
    Fixed,
    Dynamic,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NodeKindPlugin {
    /// Technical name, e.g. `whatsapp-web`.
    pub name: String,
    /// What people see, e.g. "WhatsApp Web".
    pub display_name: String,
    /// False for catalog plugins: adding the step asks to install (and approve) it first.
    pub installed: bool,
}

/// Where the library comes from.
pub struct LibrarySources<'a> {
    /// Every kind that compiles in a draft: [`flow::draft_node_registry`].
    pub registry: &'a Registry,
    /// Kinds that can run (installed plugins): [`flow::node_registry`].
    pub runnable_kinds: &'a HashSet<String>,
    /// Plugin display names by technical name (installed and catalog).
    pub plugin_display_names: &'a HashMap<String, String>,
}

/// Every kind of the library, builtin groups first (in the app's order), then
/// plugin actions by plugin and kind.
pub fn node_library(sources: &LibrarySources<'_>) -> Vec<NodeKindInfo> {
    let mut kinds: Vec<NodeKindInfo> = sources
        .registry
        .descriptors()
        .into_iter()
        .filter(|descriptor| !NOT_OFFERED_KINDS.contains(&descriptor.kind.as_str()))
        .map(|descriptor| kind_info(&descriptor, sources))
        .collect();
    kinds.sort_by_key(sort_key);
    kinds
}

fn kind_info(descriptor: &NodeDescriptor, sources: &LibrarySources<'_>) -> NodeKindInfo {
    let plugin = plugin_of(descriptor).map(|name| NodeKindPlugin {
        display_name: sources
            .plugin_display_names
            .get(&name)
            .cloned()
            .unwrap_or_else(|| crate::plugins::display_name::humanize_plugin_name(&name)),
        installed: sources.runnable_kinds.contains(&descriptor.kind),
        name,
    });
    let group = if plugin.is_some() { NodeKindGroup::Plugin } else { builtin_group(&descriptor.kind) };
    NodeKindInfo {
        kind: descriptor.kind.clone(),
        display_name: display_name(descriptor, plugin.is_some()),
        group,
        description: descriptor.description.clone(),
        icon: descriptor.icon.clone(),
        config_schema: descriptor.config_schema.clone(),
        outputs: descriptor
            .outputs
            .iter()
            .map(|output| NodeKindOutput {
                name: output.name.clone(),
                value_type: serde_json::to_value(output.ty)
                    .ok()
                    .and_then(|value| value.as_str().map(str::to_owned))
                    .unwrap_or_else(|| "any".to_owned()),
                description: output.description.clone(),
                streaming: output.streaming,
            })
            .collect(),
        dynamic_outputs: descriptor.dynamic_outputs,
        ports: kind_ports(descriptor),
        container: descriptor.container,
        offered: group != NodeKindGroup::Hidden && !UNLISTED_KINDS.contains(&descriptor.kind.as_str()),
        sends_data: flow::is_sending_node(&descriptor.kind, &serde_json::Map::new(), &flow::TrustedHosts::none()),
        source: descriptor.source.clone(),
        plugin,
    }
}

/// Plugin name of a plugin kind: from the descriptor source (`plugin:<name>`), else
/// the kind prefix when the source names no plugin (`whatsapp-web.send_message`).
fn plugin_of(descriptor: &NodeDescriptor) -> Option<String> {
    if let Some(name) = descriptor.source.strip_prefix("plugin:") {
        return Some(name.to_owned());
    }
    let (prefix, _) = descriptor.kind.split_once('.')?;
    graphrt_plugin::is_valid_name(prefix).then(|| prefix.to_owned())
}

fn display_name(descriptor: &NodeDescriptor, is_plugin: bool) -> String {
    if is_plugin && !descriptor.title.trim().is_empty() && !descriptor.is_bare() {
        return descriptor.title.trim().to_owned();
    }
    if is_plugin {
        let operation = descriptor.kind.split_once('.').map_or(descriptor.kind.as_str(), |(_, operation)| operation);
        return flow::node_kind_title(operation);
    }
    flow::node_kind_title(&descriptor.kind)
}

fn kind_ports(descriptor: &NodeDescriptor) -> NodeKindPorts {
    let kind = descriptor.kind.as_str();
    let has_input = !matches!(kind, "start" | "iteration-start" | "loop-start");
    let (exits, fixed_handles, config_path) = match &descriptor.handles {
        _ if matches!(kind, "end" | "loop-end") => (ExitRule::None, Vec::new(), None),
        Handles::Fixed { handles } => (ExitRule::Fixed, handles.clone(), None),
        Handles::Dynamic { config_path } => (ExitRule::Dynamic, Vec::new(), config_path.clone()),
        _ => (ExitRule::Single, Vec::new(), None),
    };
    NodeKindPorts { has_input, exits, fixed_handles, config_path }
}

fn builtin_group(kind: &str) -> NodeKindGroup {
    BUILTIN_GROUPS.iter().find(|(_, kinds)| kinds.contains(&kind)).map_or(NodeKindGroup::Other, |(group, _)| *group)
}

/// (group order, position in the group, plugin, kind).
fn sort_key(info: &NodeKindInfo) -> (usize, usize, String, String) {
    let group_order = [
        NodeKindGroup::StartAndFinish,
        NodeKindGroup::Ai,
        NodeKindGroup::Connect,
        NodeKindGroup::DecideAndWait,
        NodeKindGroup::Repeat,
        NodeKindGroup::Data,
        NodeKindGroup::Other,
        NodeKindGroup::Plugin,
        NodeKindGroup::Hidden,
    ];
    let group_index = group_order.iter().position(|group| *group == info.group).unwrap_or(group_order.len());
    let position = BUILTIN_GROUPS
        .iter()
        .find_map(|(_, kinds)| kinds.iter().position(|kind| *kind == info.kind))
        .unwrap_or(usize::MAX);
    let plugin = info.plugin.as_ref().map(|plugin| plugin.name.clone()).unwrap_or_default();
    (group_index, position, plugin, info.kind.clone())
}
