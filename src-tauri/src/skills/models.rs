//! What the Skills screens read and send (camelCase on the wire).
//!
//! These are views over `graphrt_skill`'s entries: tool references get the names people
//! know, findings keep their stable `code` so the UI can translate them, and nothing
//! here carries file hashes or store paths except [`SkillReview::review_id`], which the UI
//! only hands back.

use serde::{Deserialize, Serialize};

/// Where an installed skill came from.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum SkillSource {
    /// Downloaded from the signed catalog.
    Catalog,
    /// Written in the app ("Create a skill").
    Authored,
    /// Anything else (installed with the graphrt command line tool, or learned).
    Other,
}

impl From<graphrt_skill::OriginKind> for SkillSource {
    fn from(kind: graphrt_skill::OriginKind) -> Self {
        match kind {
            graphrt_skill::OriginKind::Catalog => Self::Catalog,
            graphrt_skill::OriginKind::Authored => Self::Authored,
            graphrt_skill::OriginKind::Local | graphrt_skill::OriginKind::Learned => Self::Other,
        }
    }
}

/// How an allowed tool may be used.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ToolPermissionMode {
    /// Every use waits for the person's OK (the default).
    #[default]
    Ask,
    /// The agent may use it without asking.
    Allow,
}

/// One tool the person allows a skill to use. A tool that is not listed is not allowed.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ToolPermission {
    /// The tool as the skill asks for it (`provider/tool`).
    pub tool: String,
    #[serde(default)]
    pub mode: ToolPermissionMode,
}

/// A tool a skill asks for, with the names people know.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SkillToolRequest {
    /// The reference to send back in a [`ToolPermission`].
    pub tool: String,
    /// The plugin or connection that provides it, e.g. "WhatsApp Cloud API".
    pub provider_label: String,
    /// What it does, e.g. "Send message"; "Everything it can do" for a whole provider.
    pub action_label: String,
    /// Whether every action of the provider is asked for.
    pub covers_everything: bool,
    /// Whether this computer has the plugin or connection that provides it.
    pub available: bool,
}

/// How serious a finding of the safety check is.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum FindingSeverity {
    Info,
    Warning,
    /// Stops the install until the person confirms once more.
    Blocking,
}

/// Something the safety check noticed in a skill's text.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SkillFinding {
    pub severity: FindingSeverity,
    /// Stable code the UI translates, e.g. `hides_from_user`.
    pub code: String,
    /// The runtime's English sentence, shown for codes the UI does not know.
    pub message: String,
    pub file: Option<String>,
    pub line: Option<u32>,
}

/// What an update changes compared with the installed copy.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SkillUpdateChanges {
    /// Tools the new version asks for that the installed one did not.
    pub added_tools: Vec<SkillToolRequest>,
    /// Tools the installed version asked for that the new one no longer does.
    pub removed_tools: Vec<SkillToolRequest>,
    pub changed_files: Vec<String>,
    pub added_files: Vec<String>,
    pub removed_files: Vec<String>,
    /// Whether the new version is identical to the installed one.
    pub nothing_changed: bool,
}

/// A skill before it is installed: everything the confirmation screens show.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SkillReview {
    pub name: String,
    pub display_name: String,
    /// What the skill is for, in its author's words.
    pub description: String,
    pub source: SkillSource,
    pub publisher: Option<String>,
    pub version: Option<String>,
    /// Identifies exactly what was reviewed. The install sends it back, and is refused
    /// when the skill is no longer the one shown. Never displayed.
    pub review_id: String,
    pub requested_tools: Vec<SkillToolRequest>,
    /// Tools of other products the skill mentions; they cannot be used here.
    pub unsupported_tools: Vec<String>,
    /// Whether it carries script files (never run).
    pub has_scripts: bool,
    pub findings: Vec<SkillFinding>,
    /// A finding stops the install until the person confirms once more.
    pub needs_extra_confirmation: bool,
    /// Set when a skill of this name is installed: what installing changes.
    pub update: Option<SkillUpdateChanges>,
    /// For a skill written in the app: the instructions that will be saved.
    pub instructions: Option<String>,
}

/// An installed skill.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InstalledSkill {
    pub name: String,
    pub display_name: String,
    pub description: String,
    /// Off: no agent is offered this skill.
    pub enabled: bool,
    pub source: SkillSource,
    pub publisher: Option<String>,
    /// Whether it came from the signed catalog.
    pub verified: bool,
    pub version: Option<String>,
    /// RFC 3339, or `None` when unknown.
    pub installed_at: Option<String>,
    pub requested_tools: Vec<SkillToolRequest>,
    /// What the person allowed; a requested tool missing here is not allowed.
    pub permissions: Vec<ToolPermission>,
    pub unsupported_tools: Vec<String>,
    pub has_scripts: bool,
    pub findings: Vec<SkillFinding>,
}

/// A skill of the catalog with its install state.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CatalogSkillEntry {
    pub name: String,
    pub display_name: String,
    pub description: String,
    pub version: Option<String>,
    pub publisher: Option<String>,
    pub installed: bool,
    /// The catalog has a newer version than the installed copy.
    pub update_available: bool,
}

/// The catalog's skills.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SkillCatalog {
    pub skills: Vec<CatalogSkillEntry>,
    /// The catalog could not be fetched; this is the last saved copy.
    pub from_cache: bool,
}

/// "Create a skill": the draft as the person left it after reading and editing it.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AuthoredSkillInput {
    /// The skill's name as people say it, e.g. "Refund policy".
    pub title: String,
    /// When the agent should use it, in one or two sentences.
    pub description: String,
    /// What the agent should do (Markdown).
    pub instructions: String,
    /// Tools the draft asks for; each must be one this computer has. Asking allows nothing.
    #[serde(default)]
    pub requested_tools: Vec<String>,
}

/// What a draft is written from.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum SkillDraftSource {
    /// What the agent should do, in the person's own words.
    Description { text: String },
    /// A pasted conversation that shows how it should go.
    Conversation { text: String },
}

/// A draft the model wrote, for the person to read and edit.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SkillDraftView {
    pub title: String,
    pub description: String,
    pub instructions: String,
    pub requested_tools: Vec<String>,
}
