//! Chatbot setup (screen 14): persona, hand-off rules, knowledge and channels
//! of one chatbot agent, saved per agent and applied to every bot reply.
//!
//! Design: the settings live in `agent_settings` (key [`SETTINGS_KEY`]) and are
//! applied at reply time, not written into the agent's workflow. Each bot turn
//! (`conversations::ConversationManager`) overlays the stored flow in memory
//! ([`overlay`]): every `llm` / `agent` step gets the brief (persona, rules and,
//! when needed, knowledge passages) as a system message read from
//! `{{#sys.chatbot_brief#}}`, `question-classifier` steps get the hand-off rules
//! in their instruction, and `knowledge-retrieval` steps search exactly the
//! attached knowledge bases. Hand-offs whose reason maps to a rule that is off
//! are dropped by the host ([`HandoffRules::allows`]), so a switched-off rule
//! holds even when the model ignores its instructions.
//!
//! Why an overlay rather than writing the setup into the flow: saving is instant and
//! needs no model call, the builder keeps showing the flow the person built, and the
//! rules apply to any chatbot flow, whatever its step names. Until the setup is saved
//! once, the bot runs its flow unchanged (`is_saved: false`).
//!
//! A save that changes what the bot says (persona, hand-off rules, knowledge) is a new
//! agent version with the same flow and that setup
//! (`storage::chatbot_setups`), so it is checked, released, put online and gone back to
//! like any other change. The online copy gets the setup of its released version baked
//! into its workflow ([`flow_for_online`]). Switching a channel off is not a version.

pub mod brief;
pub mod overlay;
pub mod reply;
#[cfg(test)]
mod tests;

use serde::{Deserialize, Serialize};

use crate::conversations::bot::{
    ASKED_FOR_PERSON_REASON, NOT_SURE_REASON, ORDER_TO_CONFIRM_REASON, SOUNDS_UPSET_REASON,
};
use crate::error::{AppError, AppResult};
use crate::knowledge::records::{self, StoredKnowledgeBase};
use crate::storage::models::{Agent, AgentKind};
use crate::storage::Database;

/// `agent_settings` key of the chatbot setup.
pub const SETTINGS_KEY: &str = "chatbot_setup";
/// Channels a chatbot can answer on besides the in-app test channel, in display order.
pub const CUSTOMER_CHANNELS: &[(&str, &str)] = &[
    ("telegram", "Telegram"),
    ("whatsapp", "WhatsApp Business"),
    ("whatsapp-web", "Personal WhatsApp"),
    ("slack", "Slack"),
    ("teams", "Microsoft Teams"),
];

/// Whether a channel is connected for a chatbot, and the account it answers as.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct ChannelLink {
    pub connected: bool,
    /// E.g. `@toko_kue_bot` or a phone number.
    pub account: Option<String>,
}

impl From<bool> for ChannelLink {
    fn from(connected: bool) -> Self {
        Self { connected, account: None }
    }
}

/// Tells, for a channel id, how it is connected for the chatbot being described.
pub type ChannelLinks<'a> = &'a dyn Fn(&str) -> ChannelLink;

const MAX_DISPLAY_NAME_CHARS: usize = 80;
const MAX_TONE_CHARS: usize = 120;
const MAX_INSTRUCTIONS_CHARS: usize = 4000;

/// Who the bot is to customers.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct ChatbotPersona {
    /// Name customers see, e.g. "Admin Catering".
    pub display_name: String,
    /// How it writes, e.g. "Formal".
    pub tone: String,
    /// What it should do, in the owner's words.
    pub instructions: String,
}

/// When the bot passes the chat to the owner. Each rule maps to a hand-off
/// reason of the chatbot convention (`guides/chatbot.md`).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct HandoffRules {
    /// `asked_for_person`
    pub asks_for_person: bool,
    /// `not_sure`
    pub not_in_knowledge: bool,
    /// `order_to_confirm`
    pub order_ready: bool,
    /// `sounds_upset`
    pub sounds_upset: bool,
}

impl Default for HandoffRules {
    /// Every rule on: the flow's own hand-offs all go through.
    fn default() -> Self {
        Self { asks_for_person: true, not_in_knowledge: true, order_ready: true, sounds_upset: true }
    }
}

impl HandoffRules {
    /// Each rule with its hand-off reason and plain words, in display order.
    pub fn entries(&self) -> [(bool, &'static str, &'static str); 4] {
        [
            (self.asks_for_person, ASKED_FOR_PERSON_REASON, "the customer asks for a person"),
            (self.not_in_knowledge, NOT_SURE_REASON, "the answer is not in the knowledge"),
            (self.order_ready, ORDER_TO_CONFIRM_REASON, "an order is ready to confirm"),
            (self.sounds_upset, SOUNDS_UPSET_REASON, "the customer sounds upset"),
        ]
    }

    /// Whether a hand-off with `reason` goes through. Reasons that match no
    /// rule (plain words, none) always do: the owner never misses those.
    pub fn allows(&self, reason: Option<&str>) -> bool {
        let Some(reason) = reason.map(str::trim) else { return true };
        self.entries().iter().find(|(_, rule_reason, _)| *rule_reason == reason).is_none_or(|(enabled, _, _)| *enabled)
    }
}

/// Everything the owner sets on the chatbot setup screen.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct ChatbotSettings {
    pub persona: ChatbotPersona,
    pub handoff_rules: HandoffRules,
    /// Knowledge bases the bot answers from (ids), in the order attached.
    pub knowledge_base_ids: Vec<String>,
    /// Connected channels the owner switched off for this chatbot.
    pub disabled_channels: Vec<String>,
}

/// A customer channel as shown under "Where it answers".
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatbotChannel {
    pub id: String,
    pub name: String,
    /// The channel is connected for this chatbot (its Telegram bot, its online copy...).
    pub connected: bool,
    /// Connected and not switched off for this chatbot.
    pub enabled: bool,
    /// The account the channel answers as, e.g. `@toko_kue_bot`.
    pub detail: Option<String>,
}

/// The setup screen's data.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatbotSetup {
    pub agent_id: String,
    /// Stored settings, or the defaults derived from the agent when never saved.
    pub settings: ChatbotSettings,
    /// False until saved once; until then the bot runs its flow unchanged.
    pub is_saved: bool,
    pub channels: Vec<ChatbotChannel>,
}

/// The saved settings of a chatbot, or `None` when never saved.
///
/// # Errors
/// Storage errors, or `Serialization` for a corrupt stored value.
pub fn load_saved_settings(db: &Database, agent_id: &str) -> AppResult<Option<ChatbotSettings>> {
    db.get_agent_setting(agent_id, SETTINGS_KEY)?
        .map(|stored| serde_json::from_value(stored).map_err(AppError::from))
        .transpose()
}

/// The setup of `agent_id`; `is_connected` tells which channel adapters exist.
///
/// # Errors
/// `NotFound` for an unknown agent; `InvalidInput` when it is not a chatbot.
pub fn get_chatbot_setup(db: &Database, agent_id: &str, is_connected: ChannelLinks<'_>) -> AppResult<ChatbotSetup> {
    let agent = ensure_chatbot(db, agent_id)?;
    let saved = load_saved_settings(db, agent_id)?;
    let is_saved = saved.is_some();
    let settings = match saved {
        Some(settings) => settings,
        None => default_settings(&agent, &records::list_knowledge_bases(db)?),
    };
    let channels = describe_channels(&settings, is_connected);
    Ok(ChatbotSetup { agent_id: agent.id, settings, is_saved, channels })
}

/// Validates and stores the settings; the next bot reply uses them.
///
/// # Errors
/// `NotFound` for an unknown agent or knowledge base; `InvalidInput` when the
/// agent is not a chatbot or a field is too long.
pub fn save_chatbot_settings(
    db: &Database,
    agent_id: &str,
    settings: ChatbotSettings,
    is_connected: ChannelLinks<'_>,
) -> AppResult<ChatbotSetup> {
    ensure_chatbot(db, agent_id)?;
    let settings = normalize_settings(db, settings)?;
    let value = serde_json::to_value(&settings)?;
    let saved = load_saved_settings(db, agent_id)?;
    if saved.as_ref().is_none_or(|saved| changes_answers(saved, &settings)) {
        db.save_chatbot_setup_version(agent_id, SETTINGS_KEY, &value, SETUP_CHANGE_SUMMARY)?;
    } else {
        db.set_agent_setting(agent_id, SETTINGS_KEY, &value)?;
    }
    get_chatbot_setup(db, agent_id, is_connected)
}

/// Version summary of a saved chatbot setup.
pub const SETUP_CHANGE_SUMMARY: &str = "Changed the chatbot setup";

/// Whether `next` changes what the bot answers (not only where it answers).
fn changes_answers(saved: &ChatbotSettings, next: &ChatbotSettings) -> bool {
    saved.persona != next.persona
        || saved.handoff_rules != next.handoff_rules
        || saved.knowledge_base_ids != next.knowledge_base_ids
}

/// The workflow the online copy (or an exported agent file) runs for `agent` at its
/// version: a chatbot's setup of that version overlaid with its texts in `env`
/// ([`overlay::overlay_for_online`]), the stored flow for other agents and for chatbots
/// whose setup was never saved by then.
///
/// A flow without a retrieval step gets one for the attached knowledge (on this computer the
/// host looks the passages up), so the online copy answers from the same knowledge.
///
/// # Errors
/// `Workflow` when the flow cannot be overlaid; `Serialization` for a corrupt stored setup.
pub fn flow_for_online(db: &Database, agent: &Agent) -> AppResult<String> {
    if agent.kind != AgentKind::Chatbot {
        return Ok(agent.flow_yaml.clone());
    }
    let Some(stored) = db.chatbot_setup_at_version(&agent.id, agent.current_version)? else {
        return Ok(agent.flow_yaml.clone());
    };
    let settings: ChatbotSettings = serde_json::from_value(stored)?;
    let knowledge_bases = reply::attached_knowledge_bases(db, &settings)?;
    let passages = reply::passage_count(&knowledge_bases);
    let knowledge_base_ids: Vec<String> = knowledge_bases.into_iter().map(|base| base.id).collect();
    let texts = overlay::OnlineTexts {
        brief: brief::chatbot_brief(&settings, None),
        handoff_rules: brief::handoff_rules_text(&settings.handoff_rules),
    };
    overlay::overlay_for_online(&agent.flow_yaml, &knowledge_base_ids, &texts, passages)
}

/// Adds a knowledge base to the chatbot (saving the setup if it never was).
///
/// # Errors
/// As [`save_chatbot_settings`].
pub fn attach_knowledge_base(
    db: &Database,
    agent_id: &str,
    knowledge_base_id: &str,
    is_connected: ChannelLinks<'_>,
) -> AppResult<ChatbotSetup> {
    let mut settings = get_chatbot_setup(db, agent_id, is_connected)?.settings;
    if !settings.knowledge_base_ids.iter().any(|attached| attached == knowledge_base_id) {
        settings.knowledge_base_ids.push(knowledge_base_id.to_owned());
    }
    save_chatbot_settings(db, agent_id, settings, is_connected)
}

/// Removes a knowledge base from the chatbot; its retrieval steps stop searching it.
///
/// # Errors
/// As [`save_chatbot_settings`].
pub fn detach_knowledge_base(
    db: &Database,
    agent_id: &str,
    knowledge_base_id: &str,
    is_connected: ChannelLinks<'_>,
) -> AppResult<ChatbotSetup> {
    let mut settings = get_chatbot_setup(db, agent_id, is_connected)?.settings;
    settings.knowledge_base_ids.retain(|attached| attached != knowledge_base_id);
    save_chatbot_settings(db, agent_id, settings, is_connected)
}

/// Whether the chatbot answers on `channel` (always for channels it never switched off).
///
/// # Errors
/// Storage errors.
pub fn is_channel_enabled(db: &Database, agent_id: &str, channel: &str) -> AppResult<bool> {
    Ok(load_saved_settings(db, agent_id)?
        .is_none_or(|settings| !settings.disabled_channels.iter().any(|disabled| disabled == channel)))
}

fn ensure_chatbot(db: &Database, agent_id: &str) -> AppResult<Agent> {
    let agent = db.get_agent(agent_id)?;
    if agent.kind != AgentKind::Chatbot {
        return Err(AppError::InvalidInput(format!("{} is not a chatbot", agent.name)));
    }
    Ok(agent)
}

/// Defaults for a never-saved chatbot: its name, what the owner asked for when building
/// it (the agent's description, as a starting point to edit), every rule on, and the
/// knowledge bases its retrieval steps already search.
fn default_settings(agent: &Agent, knowledge_bases: &[StoredKnowledgeBase]) -> ChatbotSettings {
    let referenced = overlay::referenced_dataset_ids(&agent.flow_yaml);
    let knowledge_base_ids = knowledge_bases
        .iter()
        .filter(|base| referenced.iter().any(|reference| reference == &base.id || reference == &base.name))
        .map(|base| base.id.clone())
        .collect();
    ChatbotSettings {
        persona: ChatbotPersona {
            display_name: agent.name.clone(),
            instructions: agent.description.trim().chars().take(MAX_INSTRUCTIONS_CHARS).collect(),
            ..ChatbotPersona::default()
        },
        handoff_rules: HandoffRules::default(),
        knowledge_base_ids,
        disabled_channels: Vec::new(),
    }
}

fn normalize_settings(db: &Database, settings: ChatbotSettings) -> AppResult<ChatbotSettings> {
    let persona = ChatbotPersona {
        display_name: bounded_text(&settings.persona.display_name, MAX_DISPLAY_NAME_CHARS, "the name")?,
        tone: bounded_text(&settings.persona.tone, MAX_TONE_CHARS, "the tone")?,
        instructions: bounded_text(&settings.persona.instructions, MAX_INSTRUCTIONS_CHARS, "the instructions")?,
    };
    let mut knowledge_base_ids: Vec<String> = Vec::new();
    for knowledge_base_id in settings.knowledge_base_ids {
        records::get_knowledge_base(db, &knowledge_base_id)?;
        if !knowledge_base_ids.contains(&knowledge_base_id) {
            knowledge_base_ids.push(knowledge_base_id);
        }
    }
    let mut disabled_channels: Vec<String> = settings
        .disabled_channels
        .into_iter()
        .filter(|channel| CUSTOMER_CHANNELS.iter().any(|(known, _)| known == channel))
        .collect();
    disabled_channels.dedup();
    Ok(ChatbotSettings { persona, handoff_rules: settings.handoff_rules, knowledge_base_ids, disabled_channels })
}

fn bounded_text(text: &str, max_chars: usize, what: &str) -> AppResult<String> {
    let trimmed = text.trim();
    if trimmed.chars().count() > max_chars {
        return Err(AppError::InvalidInput(format!("{what} is at most {max_chars} characters")));
    }
    Ok(trimmed.to_owned())
}

fn describe_channels(settings: &ChatbotSettings, is_connected: ChannelLinks<'_>) -> Vec<ChatbotChannel> {
    CUSTOMER_CHANNELS
        .iter()
        .map(|(id, name)| {
            let link = is_connected(id);
            let connected = link.connected;
            let switched_off = settings.disabled_channels.iter().any(|disabled| disabled == id);
            ChatbotChannel {
                id: (*id).to_owned(),
                name: (*name).to_owned(),
                connected,
                enabled: connected && !switched_off,
                detail: link.account.filter(|_| connected),
            }
        })
        .collect()
}
