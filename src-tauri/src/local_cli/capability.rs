//! What a step asks of its model that a local CLI cannot do, found before a run.
//!
//! The CLIs answer plain text (structured output and "Extract parameters" work through
//! JSON replies), but they cannot call graphrt tools for a "Run an agent" step, and
//! graphrt does not hand them images.

use serde_json::{Map, Value};

use super::LocalCli;

/// A step a local CLI provider cannot run, and why.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct CapabilityGap {
    pub cli: LocalCli,
    /// E.g. "can't call tools".
    pub reason: &'static str,
}

impl CapabilityGap {
    /// "Run an agent uses Claude Code (on this computer), which can't call tools: pick an API model for this step".
    pub fn message(&self, step_title: &str) -> String {
        format!(
            "{step_title} uses {} (on this computer), which {}: pick an API model for this step",
            self.cli.display_name(),
            self.reason
        )
    }
}

/// The gap of one node (`kind` + its config) whose `model.provider` is a local CLI.
pub fn capability_gap(kind: &str, config: &Map<String, Value>) -> Option<CapabilityGap> {
    let provider = config.get("model")?.get("provider")?.as_str()?.trim();
    let cli = LocalCli::from_provider_name(provider)?;
    if kind == "agent" && has_tools(config) {
        return Some(CapabilityGap { cli, reason: "can't call tools" });
    }
    if reads_images(config) {
        return Some(CapabilityGap { cli, reason: "can't read images" });
    }
    None
}

/// Whether data flowing out of a step whose `model.provider` is `provider` must be
/// approved before a sending step (email, message, HTTP request, ...) uses it.
///
/// `true` for a local CLI that may have run a command despite graphrt's switches (Codex:
/// see `adapters/codex.rs`); `false` for the other CLIs, API providers and unknown names.
/// Meant for the approval-before-send validators.
///
/// @example `provider_output_needs_send_approval("codex-cli") == true`
pub fn provider_output_needs_send_approval(provider: &str) -> bool {
    LocalCli::from_provider_name(provider.trim()).is_some_and(|cli| cli.adapter().output_needs_send_approval())
}

/// [`provider_output_needs_send_approval`] for one node's config (its `model.provider`).
pub fn output_needs_send_approval(config: &Map<String, Value>) -> bool {
    config
        .get("model")
        .and_then(|model| model.get("provider"))
        .and_then(Value::as_str)
        .is_some_and(provider_output_needs_send_approval)
}

fn has_tools(config: &Map<String, Value>) -> bool {
    match config.get("tools") {
        Some(Value::Array(tools)) => !tools.is_empty(),
        Some(Value::Object(tools)) => !tools.is_empty(),
        Some(Value::String(tool)) => !tool.trim().is_empty(),
        _ => false,
    }
}

/// `vision: {enabled: true}` (or `vision: true`).
fn reads_images(config: &Map<String, Value>) -> bool {
    match config.get("vision") {
        Some(Value::Bool(enabled)) => *enabled,
        Some(Value::Object(vision)) => vision.get("enabled").and_then(Value::as_bool).unwrap_or(false),
        _ => false,
    }
}
