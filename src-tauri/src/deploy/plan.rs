//! Which keys an online copy of an agent needs ("Keys that will be copied"), by friendly name.
//!
//! Each becomes one `--secret NAME` of `graphrt deploy`; its value travels only as the
//! environment variable `NAME` of the graphrt process (see `cli.rs`), read here from the
//! keychain at deploy time and never stored anywhere else.

use serde::{Deserialize, Serialize};

use crate::credentials::{CredentialStore, ModelProvider};
use crate::error::AppResult;
use crate::flow::FlowEnvVar;

/// Where a key's value is read from.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum KeySource {
    ProviderKey(ModelProvider),
    WorkflowSecret(String),
    PluginConfig { plugin: String, variable: String },
}

/// One key to copy.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct KeyToCopy {
    /// The environment variable the online agent reads, e.g. `OPENAI_API_KEY`.
    pub env_name: String,
    pub friendly_name: String,
    /// Why the agent needs it, e.g. "So it can write answers".
    pub purpose: String,
    pub source: KeySource,
    pub is_saved: bool,
}

/// What the Review screen lists (no values).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct KeyToCopyView {
    pub friendly_name: String,
    pub purpose: String,
    pub is_saved: bool,
    /// For developers (Advanced): the variable name.
    pub env_name: String,
}

impl KeyToCopy {
    pub fn view(&self) -> KeyToCopyView {
        KeyToCopyView {
            friendly_name: self.friendly_name.clone(),
            purpose: self.purpose.clone(),
            is_saved: self.is_saved,
            env_name: self.env_name.clone(),
        }
    }
}

/// The variable graphrt reads an API provider's key from; `None` for local providers.
pub fn provider_key_env_name(provider: ModelProvider) -> Option<&'static str> {
    match provider {
        ModelProvider::Openai => Some("OPENAI_API_KEY"),
        ModelProvider::Anthropic => Some("ANTHROPIC_API_KEY"),
        ModelProvider::Gemini => Some("GEMINI_API_KEY"),
        ModelProvider::Deepseek => Some("DEEPSEEK_API_KEY"),
        _ => None,
    }
}

/// "OPENAI_API_KEY" → "Openai api key": a readable fallback name.
pub fn humanize_env_name(name: &str) -> String {
    let lower = name.replace('_', " ").to_lowercase();
    let mut characters = lower.chars();
    characters.next().map_or_else(String::new, |first| first.to_uppercase().chain(characters).collect())
}

/// A plugin the agent uses and the settings it reads (`permissions.env`).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PluginSettings {
    pub name: String,
    pub display_name: String,
    pub variables: Vec<String>,
}

/// The keys to copy, without duplicates (a workflow secret wins over a plugin setting of the
/// same name). Plugins that cannot run online (`skip_plugins`) bring none.
///
/// # Errors
/// `Credentials` when the keychain cannot be read.
pub fn keys_to_copy(
    credentials: &CredentialStore,
    model_providers: &[String],
    env: &[FlowEnvVar],
    plugins: &[PluginSettings],
) -> AppResult<Vec<KeyToCopy>> {
    let mut keys: Vec<KeyToCopy> = Vec::new();
    let mut push = |key: KeyToCopy| {
        if !keys.iter().any(|known| known.env_name == key.env_name) {
            keys.push(key);
        }
    };
    for provider_name in model_providers {
        let Ok(provider) = serde_json::from_value::<ModelProvider>(serde_json::Value::String(provider_name.clone()))
        else {
            continue;
        };
        let Some(env_name) = provider_key_env_name(provider) else { continue };
        push(KeyToCopy {
            env_name: env_name.to_owned(),
            friendly_name: format!("Your {} key", super::compatibility::api_provider_display_name(provider)),
            purpose: "So it can write answers".into(),
            source: KeySource::ProviderKey(provider),
            is_saved: credentials.read_provider_key_for_deploy(provider)?.is_some(),
        });
    }
    for variable in env {
        let is_saved = credentials.has_workflow_secret(&variable.name)?;
        if variable.has_default && !is_saved {
            continue;
        }
        push(KeyToCopy {
            env_name: variable.name.clone(),
            friendly_name: variable.description.clone().unwrap_or_else(|| humanize_env_name(&variable.name)),
            purpose: "Used by your agent's steps".into(),
            source: KeySource::WorkflowSecret(variable.name.clone()),
            is_saved,
        });
    }
    for plugin in plugins {
        for variable in &plugin.variables {
            push(KeyToCopy {
                env_name: variable.clone(),
                friendly_name: format!(
                    "{} access ({})",
                    plugin.display_name,
                    humanize_env_name(variable).to_lowercase()
                ),
                purpose: format!("So {} works online", plugin.display_name),
                source: KeySource::PluginConfig { plugin: plugin.name.clone(), variable: variable.clone() },
                is_saved: credentials.has_plugin_config(&plugin.name, variable)?,
            });
        }
    }
    Ok(keys)
}

/// Reads one key's value from the keychain (deploy time only).
pub fn read_key_value(credentials: &CredentialStore, key: &KeyToCopy) -> AppResult<Option<String>> {
    match &key.source {
        KeySource::ProviderKey(provider) => credentials.read_provider_key_for_deploy(*provider),
        KeySource::WorkflowSecret(name) => credentials.read_workflow_secret(name),
        KeySource::PluginConfig { plugin, variable } => credentials.read_plugin_config(plugin, variable),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn env(name: &str, has_default: bool) -> FlowEnvVar {
        FlowEnvVar { name: name.into(), description: None, is_secret: true, has_default }
    }

    #[test]
    fn lists_provider_workflow_and_plugin_keys_once_by_friendly_name() {
        let credentials = CredentialStore::in_memory();
        credentials.set_api_key(ModelProvider::Openai, "sk-test").unwrap();
        credentials.set_workflow_secret("SHOP_TOKEN", "t").unwrap();
        let plugins = vec![PluginSettings {
            name: "whatsapp-api".into(),
            display_name: "WhatsApp Business".into(),
            variables: vec!["WHATSAPP_CLOUD_ACCESS_TOKEN".into(), "SHOP_TOKEN".into()],
        }];
        let keys = keys_to_copy(
            &credentials,
            &["openai".into(), "openai".into(), "claude-code-cli".into()],
            &[env("SHOP_TOKEN", false), env("OPTIONAL_FLAG", true)],
            &plugins,
        )
        .unwrap();
        let names: Vec<&str> = keys.iter().map(|key| key.env_name.as_str()).collect();
        assert_eq!(names, ["OPENAI_API_KEY", "SHOP_TOKEN", "WHATSAPP_CLOUD_ACCESS_TOKEN"]);
        assert_eq!(keys[0].friendly_name, "Your OpenAI key");
        assert!(keys[0].is_saved && keys[1].is_saved);
        assert!(!keys[2].is_saved, "the plugin setting is not saved yet");
        assert_eq!(keys[1].friendly_name, "Shop token");
        assert_eq!(read_key_value(&credentials, &keys[0]).unwrap().as_deref(), Some("sk-test"));
    }

    #[test]
    fn humanizes_variable_names() {
        assert_eq!(humanize_env_name("WHATSAPP_CLOUD_ACCESS_TOKEN"), "Whatsapp cloud access token");
        assert_eq!(humanize_env_name(""), "");
    }
}
