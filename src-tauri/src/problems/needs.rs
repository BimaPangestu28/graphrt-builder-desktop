//! What an agent's workflow needs from this computer: model providers, `env.*`
//! values and plugins.
//!
//! Read from the raw document instead of the compiled graph, because a flow
//! that uses a plugin which failed to load does not compile, and that is
//! exactly when the user needs to be told which plugin is missing.

use std::collections::BTreeSet;

use serde_json::Value as Json;

/// One `env.*` declaration.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(super) struct EnvNeed {
    pub name: String,
    /// No default in the document, so a run cannot start without a stored value.
    pub required: bool,
}

/// What one workflow uses.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub(super) struct FlowNeeds {
    /// Provider names of model nodes, e.g. `openai`.
    pub model_providers: BTreeSet<String>,
    pub env: Vec<EnvNeed>,
    /// Plugin names, from node kinds such as `whatsapp-api.send_text`.
    pub plugins: BTreeSet<String>,
}

fn model_provider(config: &serde_json::Map<String, Json>) -> Option<String> {
    let provider = config.get("model")?.get("provider")?.as_str()?.trim();
    (!provider.is_empty()).then(|| provider.to_owned())
}

/// Parses `flow_yaml`; `None` when it is not a readable workflow document.
pub(super) fn read_flow_needs(flow_yaml: &str) -> Option<FlowNeeds> {
    let workflow = graphrt_core::Workflow::parse(flow_yaml).ok()?;
    let mut needs = FlowNeeds::default();
    for node in &workflow.graph.nodes {
        if let Some(provider) = model_provider(&node.config) {
            needs.model_providers.insert(provider);
        }
        if let Some((plugin_name, _)) = node.kind.split_once('.') {
            needs.plugins.insert(plugin_name.to_owned());
        }
    }
    needs.env = workflow
        .env
        .iter()
        .map(|declaration| EnvNeed {
            name: declaration.name.clone(),
            required: declaration.value.as_ref().is_none_or(|value| value.is_null()),
        })
        .collect();
    Some(needs)
}

/// The provider's product name for messages ("OpenAI key").
pub(super) fn provider_display_name(provider: &str) -> String {
    match provider {
        "openai" => "OpenAI".into(),
        "anthropic" => "Anthropic".into(),
        "gemini" => "Gemini".into(),
        "deepseek" => "DeepSeek".into(),
        "ollama" => "Ollama".into(),
        other => other.to_owned(),
    }
}
