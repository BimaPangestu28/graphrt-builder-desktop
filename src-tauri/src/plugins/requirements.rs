//! What an agent's workflow needs from plugins (screens 03 and 04 show it inline in the
//! build chat). CONTRACT: implemented by the backend owner; the frontend reads it through
//! `list_agent_plugin_requirements`. Mirrors `src/api/pluginRequirementTypes.ts`.

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RequirementPermissions {
    pub network: bool,
    pub secrets: bool,
    pub env: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PluginRequirement {
    pub name: String,
    pub description: String,
    pub used_by_steps: Vec<String>,
    pub permissions: RequirementPermissions,
    pub needs_browser: bool,
    pub warning: Option<String>,
    pub installed: bool,
    pub trusted: bool,
    pub trust_not_needed: bool,
    pub missing_config: Vec<String>,
    pub browser_ready: bool,
    pub ready: bool,
}
