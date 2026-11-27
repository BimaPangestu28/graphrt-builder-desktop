//! Finds which stored agents a workflow calls through the `agents` tool provider:
//! `tool` nodes with `provider_id: agents`, and `agent` nodes listing `agents/<id>`
//! (or `agents/*`) in their `tools`.

use graphrt_core::graph::GraphNode;
use graphrt_core::Graph;
use serde_json::Value as Json;

use super::AGENT_TOOL_PROVIDER;

/// Agents one node (or a whole flow) may call.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct AgentReferences {
    /// Agent ids named explicitly, in document order, without duplicates.
    pub agent_ids: Vec<String>,
    /// `agents/*`: every stored agent is offered.
    pub includes_every_agent: bool,
}

impl AgentReferences {
    fn push(&mut self, agent_id: &str) {
        if agent_id == "*" {
            self.includes_every_agent = true;
        } else if !self.agent_ids.iter().any(|known| known == agent_id) {
            self.agent_ids.push(agent_id.to_owned());
        }
    }

    fn extend(&mut self, other: AgentReferences) {
        other.agent_ids.iter().for_each(|agent_id| self.push(agent_id));
        self.includes_every_agent |= other.includes_every_agent;
    }

    /// True when `agent_id` is called (explicitly or through `agents/*`).
    pub fn mentions(&self, agent_id: &str) -> bool {
        self.includes_every_agent || self.agent_ids.iter().any(|known| known == agent_id)
    }
}

/// Every agent the flow calls, from all its `tool` and `agent` nodes.
pub fn flow_references(graph: &Graph) -> AgentReferences {
    let mut references = AgentReferences::default();
    for node in graph.nodes() {
        references.extend(node_references(node));
    }
    references
}

/// Agents one node calls.
pub fn node_references(node: &GraphNode) -> AgentReferences {
    let config = &node.doc.config;
    let mut references = AgentReferences::default();
    match &*node.kind {
        "tool" => {
            let provider = ["provider_id", "provider", "provider_name"]
                .iter()
                .find_map(|field| config.get(*field).and_then(Json::as_str));
            if provider == Some(AGENT_TOOL_PROVIDER) {
                if let Some(tool_name) = config.get("tool_name").and_then(Json::as_str) {
                    references.push(tool_name);
                }
            }
        }
        "agent" => {
            for tool in config.get("tools").and_then(Json::as_array).into_iter().flatten() {
                if let Some(agent_id) = agent_tool_reference(tool) {
                    references.push(agent_id);
                }
            }
        }
        _ => {}
    }
    references
}

/// The agent id of an `agent`-node tool reference to the `agents` provider.
fn agent_tool_reference(tool: &Json) -> Option<&str> {
    match tool {
        Json::String(path) => {
            let (provider, name) = path.split_once('/')?;
            (provider == AGENT_TOOL_PROVIDER).then_some(name)
        }
        Json::Object(pair) => {
            let provider = pair.get("provider").and_then(Json::as_str)?;
            (provider == AGENT_TOOL_PROVIDER).then(|| pair.get("name").and_then(Json::as_str)).flatten()
        }
        _ => None,
    }
}
