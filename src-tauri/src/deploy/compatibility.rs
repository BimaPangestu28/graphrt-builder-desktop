//! "Before it can go online": what in an agent cannot run online, in plain words, with a
//! one-click fix where the app has one. Pure: [`check_compatibility`] only reads the facts the
//! command gathers (`gather` in `mod.rs`), so every rule is unit-tested here.
//!
//! Rules:
//! - AI models that live on this computer (Ollama, Claude Code and the other AI CLIs) block;
//!   the fix switches them to a connected API provider (a normal new version, undoable).
//! - WhatsApp Web (a phone session linked to this computer) blocks; the fix asks the builder to
//!   switch to the WhatsApp Business plugin (`whatsapp-api`) when that plugin is available.
//! - Other plugins that need a browser or a linked session on this computer block, no fix.
//! - Keys the agent needs but that are not saved block (the person adds them in Connections).
//! - Knowledge is information only: a copy is taken now. Other plugins and saved keys are fine.

use serde::{Deserialize, Serialize};

use crate::credentials::ModelProvider;

/// The WhatsApp Web plugin: a personal phone linked by QR code to this computer.
pub const WHATSAPP_WEB_PLUGIN: &str = "whatsapp-web";
/// The official WhatsApp Business (Cloud API) plugin that works online.
pub const WHATSAPP_CLOUD_PLUGIN: &str = "whatsapp-api";

/// A plugin the agent uses, as the plugin requirements describe it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PluginFacts {
    pub name: String,
    pub display_name: String,
    pub needs_browser: bool,
    pub needs_session: bool,
}

/// One key that would be copied to the provider (see `plan.rs`).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct KeyFacts {
    pub friendly_name: String,
    pub is_saved: bool,
}

/// Everything the rules look at, gathered from the agent and the app.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct CompatibilityFacts {
    /// Provider names of the agent's model steps, e.g. `openai`, `claude-code-cli`.
    pub model_providers: Vec<String>,
    pub plugins: Vec<PluginFacts>,
    pub uses_knowledge: bool,
    pub keys: Vec<KeyFacts>,
    /// API providers with a saved key, best first (the switch target is the first).
    pub connected_api_providers: Vec<ModelProvider>,
    /// The WhatsApp Business plugin is installed or in the catalog.
    pub whatsapp_cloud_available: bool,
    /// The agent's abilities (`agent_graph::abilities`) that online servers must support.
    pub abilities: AbilitiesInUse,
    /// The graphrt tools that put the agent online run memory, helpers, long conversation
    /// handling and spending limits (graphrt after 0.6.3).
    pub online_runs_abilities: bool,
}

/// Which of the agent's abilities it uses.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct AbilitiesInUse {
    pub memory: bool,
    pub helpers: bool,
    /// Long conversations are handled otherwise than graphrt's default.
    pub custom_long_conversations: bool,
    pub spending_limit: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum CompatibilityLevel {
    /// Must change before going online.
    Blocker,
    /// Fine, but worth knowing.
    Info,
    /// Fine.
    Ok,
}

/// A one-click fix the app can apply.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case", rename_all_fields = "camelCase")]
pub enum CompatibilityFix {
    /// Rewrites the model steps using `from_provider` to `to_provider` (its recommended model).
    SwitchModel { from_provider: String, to_provider: ModelProvider, to_provider_name: String },
    /// Prefills the builder with a request to use WhatsApp Business instead of WhatsApp Web.
    SwitchWhatsAppToCloud,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CompatibilityItem {
    /// Stable id, e.g. `model:claude-code-cli`, `plugin:whatsapp-web`, `knowledge`.
    pub id: String,
    pub level: CompatibilityLevel,
    pub title: String,
    pub detail: String,
    pub fix: Option<CompatibilityFix>,
    /// Label of the fix button, e.g. "Use OpenAI (already connected)".
    pub fix_label: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CompatibilityReport {
    /// No blocker left: the agent can go online.
    pub ready: bool,
    /// Blockers first, then information, then what is fine.
    pub items: Vec<CompatibilityItem>,
}

/// What people call an API provider.
pub fn api_provider_display_name(provider: ModelProvider) -> &'static str {
    match provider {
        ModelProvider::Openai => "OpenAI",
        ModelProvider::Anthropic => "Anthropic (Claude API)",
        ModelProvider::Gemini => "Google Gemini",
        ModelProvider::Deepseek => "DeepSeek",
        _ => provider.registry_name(),
    }
}

/// A model provider that only exists on this computer: Ollama or an AI CLI.
pub fn is_local_model_provider(provider_name: &str) -> bool {
    provider_name == ModelProvider::Ollama.registry_name()
        || crate::local_cli::LocalCli::from_provider_name(provider_name).is_some()
}

fn local_provider_display_name(provider_name: &str) -> String {
    if provider_name == ModelProvider::Ollama.registry_name() {
        return "Ollama".into();
    }
    crate::local_cli::LocalCli::from_provider_name(provider_name)
        .map_or_else(|| provider_name.to_owned(), |cli| cli.display_name().to_owned())
}

fn model_item(provider_name: &str, connected: &[ModelProvider]) -> CompatibilityItem {
    let local_name = local_provider_display_name(provider_name);
    let id = format!("model:{provider_name}");
    match connected.first() {
        Some(&target) => {
            let target_name = api_provider_display_name(target);
            CompatibilityItem {
                id,
                level: CompatibilityLevel::Blocker,
                title: format!("{local_name} only works on this computer — use {target_name} instead"),
                detail: format!(
                    "Your agent writes with {local_name}, which is installed here. Online, it needs an AI service you've connected."
                ),
                fix: Some(CompatibilityFix::SwitchModel {
                    from_provider: provider_name.to_owned(),
                    to_provider: target,
                    to_provider_name: target_name.to_owned(),
                }),
                fix_label: Some(format!("Use {target_name} (already connected)")),
            }
        }
        None => CompatibilityItem {
            id,
            level: CompatibilityLevel::Blocker,
            title: format!("{local_name} only works on this computer — connect an AI service first"),
            detail: "Online, your agent needs an AI service such as OpenAI. Add its key in Connections › AI models, then check again.".into(),
            fix: None,
            fix_label: None,
        },
    }
}

fn plugin_item(plugin: &PluginFacts, whatsapp_cloud_available: bool) -> CompatibilityItem {
    let id = format!("plugin:{}", plugin.name);
    if plugin.name == WHATSAPP_WEB_PLUGIN {
        return CompatibilityItem {
            id,
            level: CompatibilityLevel::Blocker,
            title: "WhatsApp on your phone can't be used online — switch to WhatsApp Business (official)".into(),
            detail: "Your personal WhatsApp is linked to this computer. Online agents use the official WhatsApp Business connection. You'll need a WhatsApp Business account.".into(),
            fix: whatsapp_cloud_available.then_some(CompatibilityFix::SwitchWhatsAppToCloud),
            fix_label: whatsapp_cloud_available.then(|| "Switch to WhatsApp Business".to_owned()),
        };
    }
    if plugin.needs_browser || plugin.needs_session {
        let reason =
            if plugin.needs_browser { "a browser on this computer" } else { "a sign-in linked to this computer" };
        return CompatibilityItem {
            id,
            level: CompatibilityLevel::Blocker,
            title: format!("{} needs {reason}, so it can't run online", plugin.display_name),
            detail: "Keep this agent on this computer, or ask the builder to do this step another way.".into(),
            fix: None,
            fix_label: None,
        };
    }
    CompatibilityItem {
        id,
        level: CompatibilityLevel::Ok,
        title: format!("{} goes with it", plugin.display_name),
        detail: "Its settings are copied safely with your keys.".into(),
        fix: None,
        fix_label: None,
    }
}

fn key_item(key: &KeyFacts) -> CompatibilityItem {
    if key.is_saved {
        return CompatibilityItem {
            id: format!("key:{}", key.friendly_name),
            level: CompatibilityLevel::Ok,
            title: format!("{} can be copied safely", key.friendly_name),
            detail: "It goes straight to the provider's safe storage.".into(),
            fix: None,
            fix_label: None,
        };
    }
    CompatibilityItem {
        id: format!("key:{}", key.friendly_name),
        level: CompatibilityLevel::Blocker,
        title: format!("{} is missing", key.friendly_name),
        detail: "Add it in Connections first, then check again.".into(),
        fix: None,
        fix_label: None,
    }
}

/// The checklist for one agent. Each model provider and plugin is listed once.
pub fn check_compatibility(facts: &CompatibilityFacts) -> CompatibilityReport {
    let mut items = Vec::new();
    let mut seen_models: Vec<&str> = Vec::new();
    for provider_name in &facts.model_providers {
        if is_local_model_provider(provider_name) && !seen_models.contains(&provider_name.as_str()) {
            seen_models.push(provider_name);
            items.push(model_item(provider_name, &facts.connected_api_providers));
        }
    }
    for plugin in &facts.plugins {
        items.push(plugin_item(plugin, facts.whatsapp_cloud_available));
    }
    if facts.uses_knowledge {
        items.push(CompatibilityItem {
            id: "knowledge".into(),
            level: CompatibilityLevel::Info,
            title: "Your knowledge will go with it".into(),
            detail: "A copy is taken now. If you edit it later, update the online version.".into(),
            fix: None,
            fix_label: None,
        });
    }
    items.extend(facts.keys.iter().map(key_item));
    items.extend(ability_items(facts.abilities, facts.online_runs_abilities));
    items.sort_by_key(|item| match item.level {
        CompatibilityLevel::Blocker => 0,
        CompatibilityLevel::Info => 1,
        CompatibilityLevel::Ok => 2,
    });
    let ready = items.iter().all(|item| item.level != CompatibilityLevel::Blocker);
    CompatibilityReport { ready, items }
}

/// What the online version cannot do yet of the agent's abilities. Helpers and the spending
/// limit are named whatever the tools can do: putting an agent online sends neither the
/// helper agents' workflows nor the limit (an agent setting, not part of the workflow) yet.
fn ability_items(abilities: AbilitiesInUse, online_runs_abilities: bool) -> Vec<CompatibilityItem> {
    let item = |id: &str, level, title: &str, detail: &str| CompatibilityItem {
        id: id.to_owned(),
        level,
        title: title.to_owned(),
        detail: detail.to_owned(),
        fix: None,
        fix_label: None,
    };
    let mut items = Vec::new();
    if abilities.helpers {
        items.push(item(
            "ability:helpers",
            CompatibilityLevel::Blocker,
            "Asking other agents for help only works on this computer for now",
            "The online version of Graphrt cannot start helper agents yet. Turn off \"Ask other agents for help\" in \
             the agent's abilities to put it online, or keep it on this computer.",
        ));
    }
    if abilities.memory && !online_runs_abilities {
        items.push(item(
            "ability:memory",
            CompatibilityLevel::Info,
            "It will not remember customers online yet",
            "Online, it answers without what it remembers here. What it remembers on this computer stays here.",
        ));
    }
    if abilities.spending_limit {
        items.push(item(
            "ability:spending",
            CompatibilityLevel::Info,
            "The spending limit per run applies on this computer only for now",
            "Online runs are not stopped at the limit yet. Your AI provider's own limits still apply.",
        ));
    }
    if abilities.custom_long_conversations && !online_runs_abilities {
        items.push(item(
            "ability:context",
            CompatibilityLevel::Info,
            "Long conversations are handled the standard way online",
            "Your choice for long conversations applies on this computer only for now.",
        ));
    }
    items
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn abilities_the_online_version_lacks_are_named_and_helpers_block() {
        let abilities =
            AbilitiesInUse { memory: true, helpers: true, custom_long_conversations: true, spending_limit: true };
        let facts = CompatibilityFacts { abilities, ..CompatibilityFacts::default() };
        let report = check_compatibility(&facts);
        assert!(!report.ready);
        let ids: Vec<_> = report.items.iter().map(|item| (item.id.as_str(), item.level)).collect();
        assert_eq!(ids[0], ("ability:helpers", CompatibilityLevel::Blocker));
        assert!(ids.contains(&("ability:memory", CompatibilityLevel::Info)), "{ids:?}");

        let memory_only = CompatibilityFacts {
            abilities: AbilitiesInUse { memory: true, ..AbilitiesInUse::default() },
            ..CompatibilityFacts::default()
        };
        assert!(check_compatibility(&memory_only).ready, "memory alone does not block");
        assert!(ids.contains(&("ability:spending", CompatibilityLevel::Info)), "{ids:?}");
        assert!(ids.contains(&("ability:context", CompatibilityLevel::Info)), "{ids:?}");
        // Newer tools run memory and long conversations; helpers and the limit are not sent yet.
        let supported = CompatibilityFacts { abilities, online_runs_abilities: true, ..CompatibilityFacts::default() };
        let left: Vec<_> = check_compatibility(&supported).items.into_iter().map(|item| item.id).collect();
        assert_eq!(left, ["ability:helpers", "ability:spending"]);
    }

    fn plugin(name: &str, needs_browser: bool, needs_session: bool) -> PluginFacts {
        PluginFacts { name: name.into(), display_name: format!("{name} plugin"), needs_browser, needs_session }
    }

    #[test]
    fn an_agent_on_api_models_with_saved_keys_is_ready() {
        let report = check_compatibility(&CompatibilityFacts {
            model_providers: vec!["openai".into()],
            keys: vec![KeyFacts { friendly_name: "Your OpenAI key".into(), is_saved: true }],
            connected_api_providers: vec![ModelProvider::Openai],
            ..CompatibilityFacts::default()
        });
        assert!(report.ready);
        assert_eq!(report.items.len(), 1);
        assert_eq!(report.items[0].title, "Your OpenAI key can be copied safely");
    }

    #[test]
    fn local_models_block_and_offer_the_first_connected_provider() {
        let report = check_compatibility(&CompatibilityFacts {
            model_providers: vec!["claude-code-cli".into(), "claude-code-cli".into(), "ollama".into()],
            connected_api_providers: vec![ModelProvider::Openai, ModelProvider::Gemini],
            ..CompatibilityFacts::default()
        });
        assert!(!report.ready);
        assert_eq!(report.items.len(), 2, "one item per provider");
        assert_eq!(report.items[0].title, "Claude Code only works on this computer — use OpenAI instead");
        assert_eq!(report.items[0].fix_label.as_deref(), Some("Use OpenAI (already connected)"));
        assert_eq!(
            report.items[1].fix,
            Some(CompatibilityFix::SwitchModel {
                from_provider: "ollama".into(),
                to_provider: ModelProvider::Openai,
                to_provider_name: "OpenAI".into()
            })
        );
    }

    #[test]
    fn local_models_without_a_connected_service_have_no_fix() {
        let report = check_compatibility(&CompatibilityFacts {
            model_providers: vec!["codex-cli".into()],
            ..CompatibilityFacts::default()
        });
        assert_eq!(report.items[0].fix, None);
        assert!(report.items[0].title.contains("connect an AI service first"));
    }

    #[test]
    fn whatsapp_web_switches_only_when_whatsapp_business_is_available() {
        let facts = CompatibilityFacts { plugins: vec![plugin(WHATSAPP_WEB_PLUGIN, true, true)], ..Default::default() };
        let without = check_compatibility(&facts);
        assert_eq!(without.items[0].level, CompatibilityLevel::Blocker);
        assert_eq!(without.items[0].fix, None);
        let with = check_compatibility(&CompatibilityFacts { whatsapp_cloud_available: true, ..facts });
        assert_eq!(with.items[0].fix, Some(CompatibilityFix::SwitchWhatsAppToCloud));
    }

    #[test]
    fn browser_plugins_block_and_other_plugins_go_along() {
        let report = check_compatibility(&CompatibilityFacts {
            plugins: vec![plugin("google-maps", false, false), plugin("web-scraper", true, false)],
            ..Default::default()
        });
        assert_eq!(
            report.items[0].title,
            "web-scraper plugin needs a browser on this computer, so it can't run online"
        );
        assert_eq!(report.items[1].level, CompatibilityLevel::Ok);
        assert!(!report.ready);
    }

    #[test]
    fn knowledge_is_information_and_missing_keys_block() {
        let report = check_compatibility(&CompatibilityFacts {
            uses_knowledge: true,
            keys: vec![KeyFacts { friendly_name: "Your OpenAI key".into(), is_saved: false }],
            ..Default::default()
        });
        assert_eq!(report.items[0].title, "Your OpenAI key is missing");
        assert_eq!(report.items[1].level, CompatibilityLevel::Info);
        assert!(!report.ready);
        let only_knowledge = check_compatibility(&CompatibilityFacts { uses_knowledge: true, ..Default::default() });
        assert!(only_knowledge.ready, "knowledge alone never blocks");
    }

    #[test]
    fn fixes_serialize_for_the_ui() {
        let fix = CompatibilityFix::SwitchModel {
            from_provider: "ollama".into(),
            to_provider: ModelProvider::Anthropic,
            to_provider_name: "Anthropic".into(),
        };
        assert_eq!(
            serde_json::to_value(&fix).unwrap(),
            serde_json::json!({ "kind": "switch_model", "fromProvider": "ollama", "toProvider": "anthropic", "toProviderName": "Anthropic" })
        );
    }
}
