//! An agent's abilities: how it handles long conversations, whether it remembers the people
//! it serves, which other agents it may ask for help, and which tools are safe to call again
//! after a run was cut. Each is a setting of the agent's `agent` steps (and `llm` steps for
//! long conversations) in the workflow document; a change sets it on every step that can
//! use it and saves a new version, like the learning switch (`super::learning`).
//!
//! | Ability | Step setting (graphrt) | Steps |
//! | --- | --- | --- |
//! | Long conversations | `context_window` (`auto` when absent, `summarize`, `off`, `{max_tokens, summarize}`) | `agent`, `llm` |
//! | Remember conversations and customers | `long_term_memory: {agent: <this agent's id>, graph?}` | `agent` |
//! | Ask other agents for help | `subagents` (the allowlist), `max_parallel_subagents`, `max_subagent_calls` | `agent` |
//! | Safe to call again | `retry_safe_tools` | `agent` |
//!
//! A helper agent is listed by its id (the name `engine::helpers` links its workflow under),
//! with its name and description as what the model reads about it. The spending limit per run
//! is not part of the document: it is an agent setting (`engine::spending`).

use serde::{Deserialize, Serialize};
use serde_json::{Map, Value as Json};

use super::document::EditableDocument;
use super::{graph_from_workflow, record_in_chat, GraphContext, GraphSource, ProblemSeverity};
use crate::agent_builder::edit_lock;
use crate::engine::spending::{self, SpendingLimit};
use crate::error::{AppError, AppResult};
use crate::flow;
use crate::storage::models::Agent;
use crate::storage::Database;

const AGENT_STEP_KIND: &str = "agent";
const MODEL_STEP_KIND: &str = "llm";
const CONTEXT_KEY: &str = "context_window";
const MEMORY_KEY: &str = "long_term_memory";
const HELPERS_KEY: &str = "subagents";
const MAX_PARALLEL_KEY: &str = "max_parallel_subagents";
const MAX_CALLS_KEY: &str = "max_subagent_calls";
const RETRY_SAFE_KEY: &str = "retry_safe_tools";
/// Prefix of the version summary and chat entry of an abilities change.
pub const ABILITIES_EDIT_PREFIX: &str = "Abilities: ";

/// graphrt's defaults when the document sets none.
pub const DEFAULT_MAX_PARALLEL_HELPERS: u32 = 4;
pub const DEFAULT_MAX_HELPER_CALLS: u32 = 16;
/// Bounds the owner can choose.
pub const MAX_PARALLEL_HELPERS: u32 = 8;
pub const MAX_HELPER_CALLS: u32 = 50;
pub const MAX_HELPERS: usize = 10;
/// Smallest and largest input token budget for long conversations.
pub const MIN_CONTEXT_TOKENS: u64 = 2_000;
pub const MAX_CONTEXT_TOKENS: u64 = 2_000_000;
/// Longest description of a helper the model reads, in characters.
const MAX_HELPER_DESCRIPTION_CHARS: usize = 300;
/// Most tools marked safe to call again.
const MAX_RETRY_SAFE_TOOLS: usize = 50;

/// What a step does when a conversation outgrows the model.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ContextMode {
    /// Old tool results and the oldest turns make room (graphrt's default).
    Auto,
    /// As `auto`, and what is removed is first summarized by the model.
    Summarize,
    /// Nothing is removed: a conversation that does not fit fails the step.
    Off,
}

/// How the agent handles long conversations.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ContextSetting {
    pub mode: ContextMode,
    /// Input tokens a request may use (advanced); `None` trims only when the model refuses.
    pub max_tokens: Option<u64>,
}

/// Whether the agent remembers the people it serves.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MemorySetting {
    pub enabled: bool,
    /// Also keep a graph of who and what the notes name (one small model call per note).
    pub graph: bool,
}

/// Which agents it may ask for help, and how much.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HelpersSetting {
    /// The allowlist: the model can only ask these agents.
    pub agent_ids: Vec<String>,
    /// Helpers working at the same time.
    pub max_parallel: u32,
    /// Requests for help in one run of a step.
    pub max_calls: u32,
}

/// One change of the abilities card.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case", rename_all_fields = "camelCase")]
pub enum AbilityChange {
    Context { mode: ContextMode, max_tokens: Option<u64> },
    Memory { enabled: bool, graph: bool },
    Helpers { agent_ids: Vec<String>, max_parallel: u32, max_calls: u32 },
    RetrySafeTools { tools: Vec<String> },
}

/// Why an agent cannot be a helper.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum HelperUnavailable {
    /// Its workflow does not compile.
    Broken,
    /// It needs a file or a secret to start, which another agent cannot hand over.
    NeedsFileOrSecret,
}

/// An agent the owner can pick as a helper.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HelperChoice {
    pub agent_id: String,
    pub name: String,
    pub description: String,
    pub unavailable: Option<HelperUnavailable>,
}

/// The abilities card: what is set, and what can be chosen.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentAbilities {
    pub agent_id: String,
    /// Steps that choose their own tools (memory, helpers and retries need one).
    pub agent_steps: usize,
    /// Steps that talk to a model (long conversations need one).
    pub model_steps: usize,
    pub context: ContextSetting,
    pub memory: MemorySetting,
    pub helpers: HelpersSetting,
    /// Every other agent, in the order of the agent list.
    pub helper_choices: Vec<HelperChoice>,
    pub retry_safe_tools: Vec<String>,
    /// The tools the agent's steps may use (`provider/name`, patterns as written).
    pub tool_choices: Vec<String>,
    pub spending: SpendingLimit,
    /// The stored limit could not be read: runs are refused until it is set again.
    pub spending_unreadable: bool,
    /// The steps say different things (the builder or the Nodes view set them apart); a change
    /// here sets them all alike.
    pub steps_differ: bool,
    /// `provider/model` the agent uses that the app has no price for: a money limit cannot
    /// count them (only the token limit does).
    pub unpriced_models: Vec<String>,
}

/// The abilities of `agent_id`.
///
/// # Errors
/// `NotFound` for an unknown agent; `Workflow` when its document cannot be read.
pub fn agent_abilities(db: &Database, agent_id: &str) -> AppResult<AgentAbilities> {
    let agent = db.get_agent(agent_id)?;
    let document = EditableDocument::parse(&agent.flow_yaml)?;
    let nodes = &document.workflow.graph.nodes;
    let agent_steps: Vec<&Map<String, Json>> =
        nodes.iter().filter(|node| node.kind == AGENT_STEP_KIND).map(|node| &node.config).collect();
    let model_steps: Vec<&Map<String, Json>> = nodes
        .iter()
        .filter(|node| node.kind == AGENT_STEP_KIND || node.kind == MODEL_STEP_KIND)
        .map(|node| &node.config)
        .collect();
    let helper_choices = db
        .list_agents()?
        .iter()
        .filter(|other| other.id != agent.id)
        .map(|other| HelperChoice {
            agent_id: other.id.clone(),
            name: other.name.clone(),
            description: other.description.clone(),
            unavailable: helper_unavailable(&other.flow_yaml),
        })
        .collect();
    // A change here sets every step alike, but the builder or the Nodes view can make them
    // differ: an ability counts as on when any step has it, so nothing in use is hidden.
    let contexts: Vec<ContextSetting> = model_steps.iter().map(|config| read_context(config)).collect();
    let memories: Vec<MemorySetting> = agent_steps.iter().map(|config| read_memory(config)).collect();
    let helper_settings: Vec<HelpersSetting> = agent_steps.iter().map(|config| read_helpers(config)).collect();
    let retry_lists: Vec<Vec<String>> =
        agent_steps.iter().map(|config| read_strings(config.get(RETRY_SAFE_KEY))).collect();
    let context = contexts.iter().copied().find(|context| *context != AUTO_CONTEXT).unwrap_or(AUTO_CONTEXT);
    let memory = MemorySetting {
        enabled: memories.iter().any(|memory| memory.enabled),
        graph: memories.iter().any(|memory| memory.enabled && memory.graph),
    };
    let helpers = match helper_settings.iter().find(|helpers| !helpers.agent_ids.is_empty()) {
        Some(first) => HelpersSetting { agent_ids: listed_helpers(&agent.flow_yaml)?, ..first.clone() },
        None => no_helpers(),
    };
    let mut retry_safe_tools: Vec<String> = Vec::new();
    for tool in retry_lists.iter().flatten() {
        if !retry_safe_tools.contains(tool) {
            retry_safe_tools.push(tool.clone());
        }
    }
    let steps_differ =
        !all_same(&contexts) || !all_same(&memories) || !all_same(&helper_settings) || !all_same(&retry_lists);
    // An unreadable limit must not hide the editor that can set it again.
    let (spending, spending_unreadable) = match spending::load(db, agent_id) {
        Ok(limit) => (limit, false),
        Err(error) => {
            log::error!("could not read the spending limit of agent {agent_id}: {error}");
            (SpendingLimit::default(), true)
        }
    };
    Ok(AgentAbilities {
        agent_id: agent.id.clone(),
        agent_steps: agent_steps.len(),
        model_steps: model_steps.len(),
        context,
        memory,
        helpers,
        helper_choices,
        retry_safe_tools,
        tool_choices: tool_choices(&agent_steps),
        spending,
        spending_unreadable,
        steps_differ,
        unpriced_models: unpriced_models(&model_steps),
    })
}

fn all_same<T: PartialEq>(values: &[T]) -> bool {
    values.windows(2).all(|pair| pair.first() == pair.last())
}

/// The agents `flow_yaml`'s steps may ask for help, each once, in document order.
///
/// # Errors
/// `Workflow` when the document cannot be read.
pub fn listed_helpers(flow_yaml: &str) -> AppResult<Vec<String>> {
    let document = EditableDocument::parse(flow_yaml)?;
    let mut helpers = Vec::new();
    for node in document.workflow.graph.nodes.iter().filter(|node| node.kind == AGENT_STEP_KIND) {
        for helper in read_helpers(&node.config).agent_ids {
            if !helpers.contains(&helper) {
                helpers.push(helper);
            }
        }
    }
    Ok(helpers)
}

/// Takes a deleted agent off the helpers of every agent that listed it (a new version of each),
/// so their runs and chatbot replies keep working. Returns the agents changed; an agent that
/// cannot be changed now (the builder is editing it) is logged and keeps the entry, and its
/// runs then say which helper is gone.
pub fn remove_helper_everywhere(db: &Database, removed_agent_id: &str, context: &GraphContext<'_>) -> Vec<String> {
    let agents = match db.list_agents() {
        Ok(agents) => agents,
        Err(error) => {
            log::error!("could not list the agents that asked deleted agent {removed_agent_id} for help: {error}");
            return Vec::new();
        }
    };
    let mut changed = Vec::new();
    for agent in agents {
        let Ok(helpers) = listed_helpers(&agent.flow_yaml) else { continue };
        if !helpers.iter().any(|helper| helper == removed_agent_id) {
            continue;
        }
        let current = match agent_abilities(db, &agent.id) {
            Ok(abilities) => abilities.helpers,
            Err(error) => {
                log::error!("could not read the helpers of agent {}: {error}", agent.id);
                continue;
            }
        };
        let change = AbilityChange::Helpers {
            agent_ids: helpers.into_iter().filter(|helper| helper != removed_agent_id).collect(),
            max_parallel: current.max_parallel,
            max_calls: current.max_calls,
        };
        match set_ability(db, &agent.id, &change, context) {
            Ok(_) => changed.push(agent.id),
            Err(error) => {
                log::error!("could not take deleted agent {removed_agent_id} off the helpers of {}: {error}", agent.id)
            }
        }
    }
    changed
}

/// Applies one change to every step that can use it, saved as a new version. Saves nothing
/// when the steps already say so.
///
/// # Errors
/// - `BuilderBusy` while a chat change of this agent runs.
/// - `NotFound` for an unknown agent or helper; `InvalidInput` for a value outside its
///   bounds, a helper that cannot help, or an agent with no step that can use the ability.
/// - `InvalidGraph` when the change gives the agent a problem it did not have.
pub fn set_ability(
    db: &Database,
    agent_id: &str,
    change: &AbilityChange,
    context: &GraphContext<'_>,
) -> AppResult<AgentAbilities> {
    if edit_lock::is_builder_editing(agent_id) {
        return Err(AppError::BuilderBusy);
    }
    let agent = db.get_agent(agent_id)?;
    let planned = plan_change(db, &agent, change)?;
    let base = EditableDocument::parse(&agent.flow_yaml)?;
    let mut workflow = base.workflow.clone();
    let mut changed_step_ids = Vec::new();
    let mut capable_steps = 0;
    for step in workflow.graph.nodes.iter_mut().filter(|node| planned.kinds.contains(&node.kind.as_str())) {
        capable_steps += 1;
        let before = step.config.clone();
        for (key, value) in &planned.values {
            match value {
                Some(value) => step.config.insert((*key).to_owned(), value.clone()),
                None => step.config.remove(*key),
            };
        }
        if step.config != before {
            changed_step_ids.push(step.id.clone());
        }
    }
    if capable_steps == 0 {
        return Err(AppError::InvalidInput(format!(
            "{} cannot do this the way it is built: {}",
            agent.name, planned.missing_step
        )));
    }
    if !changed_step_ids.is_empty() {
        save_new_version(db, &agent, &base, &workflow, &changed_step_ids, &planned.summary, context)?;
    }
    agent_abilities(db, agent_id)
}

/// Step settings a change writes (`None` removes the key), and on which step kinds.
struct PlannedChange {
    kinds: &'static [&'static str],
    values: Vec<(&'static str, Option<Json>)>,
    summary: String,
    missing_step: &'static str,
}

const AGENT_STEPS_ONLY: &[&str] = &[AGENT_STEP_KIND];
const MODEL_STEPS: &[&str] = &[AGENT_STEP_KIND, MODEL_STEP_KIND];
const NO_AGENT_STEP: &str = "no step chooses its own tools";

fn plan_change(db: &Database, agent: &Agent, change: &AbilityChange) -> AppResult<PlannedChange> {
    match change {
        AbilityChange::Context { mode, max_tokens } => {
            let setting = ContextSetting { mode: *mode, max_tokens: *max_tokens };
            Ok(PlannedChange {
                kinds: MODEL_STEPS,
                values: vec![(CONTEXT_KEY, context_value(setting)?)],
                summary: format!("{ABILITIES_EDIT_PREFIX}long conversations {}", describe_context(setting)),
                missing_step: "no step talks to an AI model",
            })
        }
        AbilityChange::Memory { enabled, graph } => {
            // Whose memory it is comes from the host (the agent's id), never from the document.
            let value = enabled.then(|| match graph {
                true => serde_json::json!({ "graph": true }),
                false => Json::from("auto"),
            });
            let summary = match (enabled, graph) {
                (false, _) => "no longer remembers conversations and customers",
                (true, false) => "remembers conversations and customers",
                (true, true) => "remembers conversations and customers, with a memory graph",
            };
            Ok(PlannedChange {
                kinds: AGENT_STEPS_ONLY,
                values: vec![(MEMORY_KEY, value)],
                summary: format!("{ABILITIES_EDIT_PREFIX}{summary}"),
                missing_step: NO_AGENT_STEP,
            })
        }
        AbilityChange::Helpers { agent_ids, max_parallel, max_calls } => {
            let entries = helper_entries(db, agent, agent_ids)?;
            check_range("helpers at the same time", *max_parallel, 1..=MAX_PARALLEL_HELPERS)?;
            check_range("requests for help per run", *max_calls, 1..=MAX_HELPER_CALLS)?;
            let listed = !entries.is_empty();
            let non_default = |value: u32, default: u32| (listed && value != default).then(|| Json::from(value));
            let summary = match entries.len() {
                0 => "asks no other agent for help".to_owned(),
                count => format!("may ask {count} other agent(s) for help"),
            };
            Ok(PlannedChange {
                kinds: AGENT_STEPS_ONLY,
                values: vec![
                    (HELPERS_KEY, listed.then(|| Json::Array(entries))),
                    (MAX_PARALLEL_KEY, non_default(*max_parallel, DEFAULT_MAX_PARALLEL_HELPERS)),
                    (MAX_CALLS_KEY, non_default(*max_calls, DEFAULT_MAX_HELPER_CALLS)),
                ],
                summary: format!("{ABILITIES_EDIT_PREFIX}{summary}"),
                missing_step: NO_AGENT_STEP,
            })
        }
        AbilityChange::RetrySafeTools { tools } => {
            let tools = clean_tool_names(tools)?;
            let summary = match tools.len() {
                0 => "no tool is called again after an interrupted run".to_owned(),
                count => format!("{count} tool(s) may be called again after an interrupted run"),
            };
            Ok(PlannedChange {
                kinds: AGENT_STEPS_ONLY,
                values: vec![(RETRY_SAFE_KEY, (!tools.is_empty()).then(|| Json::from(tools)))],
                summary: format!("{ABILITIES_EDIT_PREFIX}{summary}"),
                missing_step: NO_AGENT_STEP,
            })
        }
    }
}

fn check_range(what: &str, value: u32, range: std::ops::RangeInclusive<u32>) -> AppResult<()> {
    match range.contains(&value) {
        true => Ok(()),
        false => Err(AppError::InvalidInput(format!(
            "{what} must be between {} and {}, got {value}",
            range.start(),
            range.end()
        ))),
    }
}

const AUTO_CONTEXT: ContextSetting = ContextSetting { mode: ContextMode::Auto, max_tokens: None };

/// The document value of a context setting (`None`: graphrt's default, the key is removed).
fn context_value(setting: ContextSetting) -> AppResult<Option<Json>> {
    let Some(max_tokens) = setting.max_tokens else {
        return Ok(match setting.mode {
            ContextMode::Auto => None,
            ContextMode::Summarize => Some(Json::from("summarize")),
            ContextMode::Off => Some(Json::from("off")),
        });
    };
    if !(MIN_CONTEXT_TOKENS..=MAX_CONTEXT_TOKENS).contains(&max_tokens) {
        return Err(AppError::InvalidInput(format!(
            "the context budget must be between {MIN_CONTEXT_TOKENS} and {MAX_CONTEXT_TOKENS} tokens, got {max_tokens}"
        )));
    }
    match setting.mode {
        ContextMode::Off => {
            Err(AppError::InvalidInput("a context budget needs trimming on: choose automatic or summarize".to_owned()))
        }
        mode => {
            let mut object = Map::new();
            object.insert("max_tokens".to_owned(), Json::from(max_tokens));
            if mode == ContextMode::Summarize {
                object.insert("summarize".to_owned(), Json::Bool(true));
            }
            Ok(Some(Json::Object(object)))
        }
    }
}

fn describe_context(setting: ContextSetting) -> String {
    let mode = match setting.mode {
        ContextMode::Auto => "trimmed automatically",
        ContextMode::Summarize => "summarized",
        ContextMode::Off => "never trimmed",
    };
    match setting.max_tokens {
        Some(tokens) => format!("{mode}, up to {tokens} tokens"),
        None => mode.to_owned(),
    }
}

fn read_context(config: &Map<String, Json>) -> ContextSetting {
    match config.get(CONTEXT_KEY) {
        None => AUTO_CONTEXT,
        Some(Json::String(text)) => match text.as_str() {
            "summarize" => ContextSetting { mode: ContextMode::Summarize, max_tokens: None },
            "off" => ContextSetting { mode: ContextMode::Off, max_tokens: None },
            _ => AUTO_CONTEXT,
        },
        Some(Json::Object(fields)) => {
            let summarize = fields.get("summarize").is_some_and(|summarize| summarize != &Json::Bool(false));
            ContextSetting {
                mode: if summarize { ContextMode::Summarize } else { ContextMode::Auto },
                max_tokens: fields.get("max_tokens").and_then(Json::as_u64),
            }
        }
        Some(_) => AUTO_CONTEXT,
    }
}

fn read_memory(config: &Map<String, Json>) -> MemorySetting {
    match config.get(MEMORY_KEY) {
        None => MemorySetting { enabled: false, graph: false },
        Some(value) if !read_memory_value(value) => MemorySetting { enabled: false, graph: false },
        Some(Json::Object(fields)) => MemorySetting {
            enabled: true,
            graph: fields.get("graph").is_some_and(|graph| graph != &Json::Bool(false) && !graph.is_null()),
        },
        Some(_) => MemorySetting { enabled: true, graph: false },
    }
}

fn no_helpers() -> HelpersSetting {
    HelpersSetting {
        agent_ids: Vec::new(),
        max_parallel: DEFAULT_MAX_PARALLEL_HELPERS,
        max_calls: DEFAULT_MAX_HELPER_CALLS,
    }
}

fn read_helpers(config: &Map<String, Json>) -> HelpersSetting {
    let agent_ids = match config.get(HELPERS_KEY) {
        Some(Json::Array(entries)) => {
            entries.iter().filter_map(|entry| entry.get("workflow").and_then(Json::as_str).map(str::to_owned)).collect()
        }
        _ => Vec::new(),
    };
    // A value outside what the card can save shows as the default, so saving it back works.
    let read_u32 = |key: &str, default: u32, max: u32| {
        config
            .get(key)
            .and_then(Json::as_u64)
            .and_then(|value| u32::try_from(value).ok())
            .filter(|value| (1..=max).contains(value))
            .unwrap_or(default)
    };
    HelpersSetting {
        agent_ids,
        max_parallel: read_u32(MAX_PARALLEL_KEY, DEFAULT_MAX_PARALLEL_HELPERS, MAX_PARALLEL_HELPERS),
        max_calls: read_u32(MAX_CALLS_KEY, DEFAULT_MAX_HELPER_CALLS, MAX_HELPER_CALLS),
    }
}

fn read_strings(value: Option<&Json>) -> Vec<String> {
    match value {
        Some(Json::Array(items)) => items.iter().filter_map(Json::as_str).map(str::to_owned).collect(),
        _ => Vec::new(),
    }
}

/// The `subagents` entries for `agent_ids`, checked: other agents that exist and can help.
fn helper_entries(db: &Database, agent: &Agent, agent_ids: &[String]) -> AppResult<Vec<Json>> {
    if agent_ids.len() > MAX_HELPERS {
        return Err(AppError::InvalidInput(format!("an agent can ask at most {MAX_HELPERS} other agents for help")));
    }
    let mut entries = Vec::new();
    let mut seen = Vec::new();
    for helper_id in agent_ids {
        if seen.contains(helper_id) {
            continue;
        }
        seen.push(helper_id.clone());
        if helper_id == &agent.id {
            return Err(AppError::InvalidInput(format!("{} cannot ask itself for help", agent.name)));
        }
        let helper = db.get_agent(helper_id)?;
        if let Some(reason) = helper_unavailable(&helper.flow_yaml) {
            let why = match reason {
                HelperUnavailable::Broken => "its steps have a problem to fix first",
                HelperUnavailable::NeedsFileOrSecret => "it needs a file or a secret to start",
            };
            return Err(AppError::InvalidInput(format!("{} cannot help other agents: {why}", helper.name)));
        }
        let mut entry = Map::new();
        entry.insert("workflow".to_owned(), Json::String(helper.id.clone()));
        entry.insert("description".to_owned(), Json::String(helper_description(&helper)));
        entries.push(Json::Object(entry));
    }
    Ok(entries)
}

/// What the model reads about a helper: its name, and what it does when it says so.
fn helper_description(helper: &Agent) -> String {
    let description = helper.description.split_whitespace().collect::<Vec<_>>().join(" ");
    let text = match description.is_empty() {
        true => helper.name.trim().to_owned(),
        false => format!("{}: {description}", helper.name.trim()),
    };
    text.chars().take(MAX_HELPER_DESCRIPTION_CHARS).collect()
}

/// Why an agent with `flow_yaml` cannot be started by another agent, if it cannot.
fn helper_unavailable(flow_yaml: &str) -> Option<HelperUnavailable> {
    let summary = match flow::summarize_flow(flow_yaml) {
        Ok(summary) => summary,
        Err(_) => return Some(HelperUnavailable::Broken),
    };
    let needs_file_or_secret = summary
        .inputs
        .iter()
        .any(|input| input.required && matches!(input.input_type.as_str(), "file" | "file-list" | "secret"));
    needs_file_or_secret.then_some(HelperUnavailable::NeedsFileOrSecret)
}

fn clean_tool_names(tools: &[String]) -> AppResult<Vec<String>> {
    let mut cleaned: Vec<String> = Vec::new();
    for tool in tools {
        let tool = tool.trim();
        let is_name = tool == "*"
            || tool.split_once('/').is_some_and(|(provider, name)| !provider.is_empty() && !name.is_empty());
        if !is_name || tool.chars().any(char::is_whitespace) {
            return Err(AppError::InvalidInput(format!("`{tool}` is not a tool name (provider/name)")));
        }
        if !cleaned.iter().any(|known| known == tool) {
            cleaned.push(tool.to_owned());
        }
    }
    if cleaned.len() > MAX_RETRY_SAFE_TOOLS {
        return Err(AppError::InvalidInput(format!(
            "at most {MAX_RETRY_SAFE_TOOLS} tools can be marked safe to repeat"
        )));
    }
    Ok(cleaned)
}

/// The tools the agent steps list, as `provider/name` (patterns kept as written).
fn tool_choices(agent_steps: &[&Map<String, Json>]) -> Vec<String> {
    let mut tools: Vec<String> = Vec::new();
    for config in agent_steps {
        let Some(Json::Array(listed)) = config.get("tools") else { continue };
        for tool in listed {
            let name = match tool {
                Json::String(name) => Some(name.clone()),
                Json::Object(fields) => {
                    match (fields.get("provider").and_then(Json::as_str), fields.get("name").and_then(Json::as_str)) {
                        (Some(provider), Some(name)) => Some(format!("{provider}/{name}")),
                        _ => None,
                    }
                }
                _ => None,
            };
            if let Some(name) = name.filter(|name| !tools.contains(name)) {
                tools.push(name);
            }
        }
    }
    tools
}

/// The default user of `long_term_memory`: the person the run serves.
const DEFAULT_MEMORY_USER: &str = "{{#sys.user_id#}}";

/// Refuses a document whose memory would not be the running agent's own: a step that names
/// another memory agent, or another user than the person the run serves. The app always
/// gives a run its agent's memory (`engine::preparation`), so such a setting could only come
/// from a hand edit or a shared copy, and would read or write notes the owner cannot see
/// here. `agent_id` is `None` for a workflow that is no agent's, which has no memory.
///
/// # Errors
/// `InvalidInput` naming the step; `Workflow` when the document cannot be read.
pub fn check_memory_scope(flow_yaml: &str, agent_id: Option<&str>) -> AppResult<()> {
    let document = EditableDocument::parse(flow_yaml)?;
    for node in document.workflow.graph.nodes.iter().filter(|node| node.kind == AGENT_STEP_KIND) {
        let Some(memory) = node.config.get(MEMORY_KEY).filter(|memory| read_memory_value(memory)) else { continue };
        let refuse = |why: &str| {
            Err(AppError::InvalidInput(format!(
                "step `{}` {why}: turn \"Remember conversations and customers\" off and on again in the agent's abilities",
                node.id
            )))
        };
        if agent_id.is_none() {
            return refuse("remembers people, but this workflow belongs to no agent");
        }
        if let Json::Object(fields) = memory {
            let names_other_agent = fields.get("agent").is_some_and(|agent| agent.as_str() != agent_id);
            if names_other_agent {
                return refuse("keeps its memory under another agent");
            }
            let names_other_user = fields.get("user").is_some_and(|user| user.as_str() != Some(DEFAULT_MEMORY_USER));
            if names_other_user {
                return refuse("chooses whose memory it reads itself");
            }
        }
    }
    Ok(())
}

/// Whether a `long_term_memory` value turns memory on.
fn read_memory_value(value: &Json) -> bool {
    !matches!(value, Json::Null | Json::Bool(false)) && value.as_str() != Some("off")
}

/// Paid models the steps use that `engine::prices` has no price for.
fn unpriced_models(model_steps: &[&Map<String, Json>]) -> Vec<String> {
    let mut unpriced: Vec<String> = Vec::new();
    for config in model_steps {
        let Some(model) = config.get("model") else { continue };
        let (Some(provider), Some(name)) =
            (model.get("provider").and_then(Json::as_str), model.get("name").and_then(Json::as_str))
        else {
            continue;
        };
        let key = format!("{provider}/{name}");
        if crate::engine::prices::is_paid_provider(provider)
            && !crate::engine::prices::has_list_price(provider, name)
            && !unpriced.contains(&key)
        {
            unpriced.push(key);
        }
    }
    unpriced
}

fn save_new_version(
    db: &Database,
    agent: &Agent,
    base: &EditableDocument,
    workflow: &graphrt_core::Workflow,
    changed_step_ids: &[String],
    summary: &str,
    context: &GraphContext<'_>,
) -> AppResult<()> {
    let flow_yaml = base.to_yaml(workflow)?;
    let saved_document = EditableDocument::parse(&flow_yaml)?;
    let version = agent.current_version;
    let source = GraphSource { agent_id: &agent.id, version, latest_version: version };
    let base_problems = graph_from_workflow(source, &base.workflow, context).problems;
    let new_problems: Vec<_> = graph_from_workflow(source, &saved_document.workflow, context)
        .problems
        .into_iter()
        .filter(|problem| problem.severity == ProblemSeverity::Error)
        .filter(|problem| {
            !base_problems.iter().any(|known| {
                known.code == problem.code && known.node_id == problem.node_id && known.message == problem.message
            })
        })
        .collect();
    if !new_problems.is_empty() {
        return Err(AppError::InvalidGraph(new_problems));
    }
    // graphrt reads the new settings the way a run will (an unknown helper is refused at run).
    flow::compile_flow(&flow_yaml)?;
    let saved_agent = db.update_agent_flow_from_version(&agent.id, version, &flow_yaml, summary)?;
    record_in_chat(db, &agent.id, summary, changed_step_ids, (version, saved_agent.current_version));
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::storage::models::{AgentKind, NewAgent};

    const STEPS: &str = r#"
version: "1"
name: support
graph:
  nodes:
    - { id: start, type: start, variables: [{ variable: question, type: paragraph, required: true }] }
    - { id: helper, type: agent, model: { provider: openai, name: gpt-4o-mini }, query: "{{#start.question#}}", tools: [crm/search, { provider: mail, name: send }] }
    - id: polish
      type: llm
      model: { provider: ollama, name: llama3.2 }
      prompt_template: [{ role: user, text: "{{#helper.text#}}" }]
    - { id: end, type: end, outputs: [{ variable: result, value_selector: [polish, text], value_type: string }] }
  edges:
    - { source: start, target: helper }
    - { source: helper, target: polish }
    - { source: polish, target: end }
"#;
    const NEEDS_A_FILE: &str = r#"
version: "1"
name: reader
graph:
  nodes:
    - { id: start, type: start, variables: [{ variable: document, type: file, required: true }] }
    - { id: end, type: end, outputs: [{ variable: text, value_selector: [start, document], value_type: string }] }
  edges:
    - { source: start, target: end }
"#;

    fn create(db: &Database, name: &str, description: &str, flow_yaml: &str) -> String {
        let new_agent = NewAgent {
            name: name.into(),
            kind: AgentKind::Task,
            description: description.into(),
            flow_yaml: flow_yaml.into(),
        };
        db.create_agent(new_agent).unwrap().id
    }

    fn step_config(db: &Database, agent_id: &str, step_id: &str) -> Map<String, Json> {
        let document = EditableDocument::parse(&db.get_agent(agent_id).unwrap().flow_yaml).unwrap();
        document.workflow.graph.nodes.into_iter().find(|node| node.id == step_id).unwrap().config
    }

    #[test]
    fn a_new_agent_has_the_runtime_defaults_and_lists_its_tools_and_other_agents() {
        let db = Database::open_in_memory().unwrap();
        let agent_id = create(&db, "Support", "", STEPS);
        let other =
            create(&db, "Stock checker", "Checks stock", include_str!("../../fixtures/flows/simple_answer.yaml"));
        create(&db, "Reader", "", NEEDS_A_FILE);

        let abilities = agent_abilities(&db, &agent_id).unwrap();

        assert_eq!((abilities.agent_steps, abilities.model_steps), (1, 2));
        assert_eq!(abilities.context, AUTO_CONTEXT);
        assert_eq!(abilities.memory, MemorySetting { enabled: false, graph: false });
        assert_eq!(abilities.helpers, no_helpers());
        assert_eq!(abilities.tool_choices, ["crm/search", "mail/send"]);
        // gpt-4o-mini has a price, a model on this computer costs nothing.
        assert!(abilities.unpriced_models.is_empty());
        let choices: Vec<_> =
            abilities.helper_choices.iter().map(|choice| (choice.name.as_str(), choice.unavailable)).collect();
        assert!(choices.contains(&("Stock checker", None)), "{choices:?}");
        assert!(choices.contains(&("Reader", Some(HelperUnavailable::NeedsFileOrSecret))), "{choices:?}");
        assert!(!abilities.helper_choices.iter().any(|choice| choice.agent_id == agent_id), "not itself");
        assert_eq!(
            abilities
                .helper_choices
                .iter()
                .find(|choice| choice.agent_id == other)
                .map(|choice| choice.description.as_str()),
            Some("Checks stock")
        );
    }

    #[test]
    fn each_change_writes_the_runtime_setting_on_the_steps_that_use_it_and_reads_back() {
        let db = Database::open_in_memory().unwrap();
        let agent_id = create(&db, "Support", "", STEPS);
        let helper_id = create(
            &db,
            "Stock checker",
            "Checks\nstock   levels",
            include_str!("../../fixtures/flows/simple_answer.yaml"),
        );
        let registry = flow::draft_node_registry();
        let context = GraphContext::new(&registry);

        set_ability(
            &db,
            &agent_id,
            &AbilityChange::Context { mode: ContextMode::Summarize, max_tokens: Some(60_000) },
            &context,
        )
        .unwrap();
        set_ability(&db, &agent_id, &AbilityChange::Memory { enabled: true, graph: true }, &context).unwrap();
        let helpers = AbilityChange::Helpers {
            agent_ids: vec![helper_id.clone(), helper_id.clone()],
            max_parallel: 2,
            max_calls: 16,
        };
        set_ability(&db, &agent_id, &helpers, &context).unwrap();
        let abilities = set_ability(
            &db,
            &agent_id,
            &AbilityChange::RetrySafeTools { tools: vec![" crm/search ".into()] },
            &context,
        )
        .unwrap();

        assert_eq!(abilities.context, ContextSetting { mode: ContextMode::Summarize, max_tokens: Some(60_000) });
        assert_eq!(abilities.memory, MemorySetting { enabled: true, graph: true });
        assert_eq!(
            abilities.helpers,
            HelpersSetting { agent_ids: vec![helper_id.clone()], max_parallel: 2, max_calls: 16 }
        );
        assert_eq!(abilities.retry_safe_tools, ["crm/search"]);
        let agent_step = step_config(&db, &agent_id, "helper");
        assert_eq!(agent_step.get(CONTEXT_KEY), Some(&serde_json::json!({"max_tokens": 60_000, "summarize": true})));
        // Whose memory it is comes from the host, never from the document.
        assert_eq!(agent_step.get(MEMORY_KEY), Some(&serde_json::json!({"graph": true})));
        assert_eq!(
            agent_step.get(HELPERS_KEY),
            Some(&serde_json::json!([{"workflow": helper_id, "description": "Stock checker: Checks stock levels"}]))
        );
        assert_eq!(agent_step.get(MAX_PARALLEL_KEY), Some(&serde_json::json!(2)));
        assert_eq!(agent_step.get(MAX_CALLS_KEY), None, "the default is left out");
        // Long conversations apply to the `llm` step too; memory and helpers do not.
        let model_step = step_config(&db, &agent_id, "polish");
        assert!(model_step.contains_key(CONTEXT_KEY) && !model_step.contains_key(MEMORY_KEY));
        assert_eq!(listed_helpers(&db.get_agent(&agent_id).unwrap().flow_yaml).unwrap(), [helper_id]);
        // One version per change.
        assert_eq!(db.get_agent(&agent_id).unwrap().current_version, 5);
    }

    #[test]
    fn turning_abilities_off_removes_the_settings_and_an_unchanged_save_keeps_the_version() {
        let db = Database::open_in_memory().unwrap();
        let agent_id = create(&db, "Support", "", STEPS);
        let registry = flow::draft_node_registry();
        let context = GraphContext::new(&registry);
        set_ability(&db, &agent_id, &AbilityChange::Memory { enabled: true, graph: false }, &context).unwrap();
        set_ability(&db, &agent_id, &AbilityChange::Memory { enabled: true, graph: false }, &context).unwrap();
        assert_eq!(db.get_agent(&agent_id).unwrap().current_version, 2, "already on: nothing saved");

        set_ability(&db, &agent_id, &AbilityChange::Memory { enabled: false, graph: false }, &context).unwrap();
        set_ability(&db, &agent_id, &AbilityChange::Context { mode: ContextMode::Auto, max_tokens: None }, &context)
            .unwrap();
        let flow_yaml = db.get_agent(&agent_id).unwrap().flow_yaml;
        assert!(!flow_yaml.contains(MEMORY_KEY) && !flow_yaml.contains(CONTEXT_KEY), "{flow_yaml}");
    }

    #[test]
    fn helpers_that_cannot_help_and_values_out_of_bounds_are_refused() {
        let db = Database::open_in_memory().unwrap();
        let agent_id = create(&db, "Support", "", STEPS);
        let reader = create(&db, "Reader", "", NEEDS_A_FILE);
        let registry = flow::draft_node_registry();
        let context = GraphContext::new(&registry);
        let helpers =
            |agent_ids: Vec<String>, max_parallel| AbilityChange::Helpers { agent_ids, max_parallel, max_calls: 16 };

        let itself = set_ability(&db, &agent_id, &helpers(vec![agent_id.clone()], 4), &context);
        assert!(matches!(itself, Err(AppError::InvalidInput(message)) if message.contains("itself")));
        let needs_file = set_ability(&db, &agent_id, &helpers(vec![reader], 4), &context);
        assert!(matches!(needs_file, Err(AppError::InvalidInput(message)) if message.contains("file or a secret")));
        assert!(matches!(
            set_ability(&db, &agent_id, &helpers(vec!["gone".into()], 4), &context),
            Err(AppError::NotFound(_))
        ));
        assert!(matches!(
            set_ability(&db, &agent_id, &helpers(Vec::new(), 0), &context),
            Err(AppError::InvalidInput(_))
        ));
        let off_with_budget = AbilityChange::Context { mode: ContextMode::Off, max_tokens: Some(10_000) };
        assert!(matches!(set_ability(&db, &agent_id, &off_with_budget, &context), Err(AppError::InvalidInput(_))));
        let bad_tool = AbilityChange::RetrySafeTools { tools: vec!["search".into()] };
        assert!(matches!(set_ability(&db, &agent_id, &bad_tool, &context), Err(AppError::InvalidInput(_))));
        assert_eq!(db.get_agent(&agent_id).unwrap().current_version, 1, "nothing was saved");
    }

    #[test]
    fn an_agent_without_an_agent_step_cannot_remember_but_a_model_step_trims_context() {
        let db = Database::open_in_memory().unwrap();
        let agent_id = create(&db, "Answer", "", include_str!("../../fixtures/flows/simple_answer.yaml"));
        let registry = flow::draft_node_registry();
        let context = GraphContext::new(&registry);
        let memory = set_ability(&db, &agent_id, &AbilityChange::Memory { enabled: true, graph: false }, &context);
        assert!(matches!(memory, Err(AppError::InvalidInput(message)) if message.contains("chooses its own tools")));
        set_ability(&db, &agent_id, &AbilityChange::Context { mode: ContextMode::Off, max_tokens: None }, &context)
            .unwrap();
        assert_eq!(agent_abilities(&db, &agent_id).unwrap().context.mode, ContextMode::Off);
    }

    #[test]
    fn a_document_that_points_memory_elsewhere_is_refused() {
        let with_memory = |memory: &str| {
            STEPS.replace(
                "query: \"{{#start.question#}}\",",
                &format!("query: \"{{{{#start.question#}}}}\", long_term_memory: {memory},"),
            )
        };
        assert!(check_memory_scope(&with_memory("auto"), Some("a1")).is_ok());
        assert!(check_memory_scope(&with_memory("{ graph: true }"), Some("a1")).is_ok());
        assert!(check_memory_scope(&with_memory("{ agent: a1 }"), Some("a1")).is_ok(), "its own name is fine");
        assert!(check_memory_scope(STEPS, None).is_ok(), "no memory, no agent needed");
        let other_agent = check_memory_scope(&with_memory("{ agent: someone-else }"), Some("a1"));
        assert!(matches!(other_agent, Err(AppError::InvalidInput(message)) if message.contains("another agent")));
        let chosen_user = check_memory_scope(&with_memory("{ user: \"{{#start.question#}}\" }"), Some("a1"));
        assert!(matches!(chosen_user, Err(AppError::InvalidInput(message)) if message.contains("whose memory")));
        assert!(matches!(check_memory_scope(&with_memory("auto"), None), Err(AppError::InvalidInput(_))));
    }

    #[test]
    fn a_deleted_helper_is_taken_off_every_agent_that_asked_it() {
        let db = Database::open_in_memory().unwrap();
        let lead = create(&db, "Support", "", STEPS);
        let kept = create(&db, "Stock checker", "", include_str!("../../fixtures/flows/simple_answer.yaml"));
        let gone = create(&db, "Invoices", "", include_str!("../../fixtures/flows/simple_answer.yaml"));
        let registry = flow::draft_node_registry();
        let context = GraphContext::new(&registry);
        let helpers =
            AbilityChange::Helpers { agent_ids: vec![kept.clone(), gone.clone()], max_parallel: 3, max_calls: 9 };
        set_ability(&db, &lead, &helpers, &context).unwrap();
        db.delete_agent(&gone).unwrap();

        assert_eq!(remove_helper_everywhere(&db, &gone, &context), [lead.clone()]);

        assert_eq!(
            agent_abilities(&db, &lead).unwrap().helpers,
            HelpersSetting { agent_ids: vec![kept], max_parallel: 3, max_calls: 9 }
        );
        assert!(remove_helper_everywhere(&db, &gone, &context).is_empty(), "nothing left to change");
    }

    #[test]
    fn steps_set_apart_by_hand_count_as_on_and_say_so() {
        let db = Database::open_in_memory().unwrap();
        let two_steps = STEPS.replace(
            "    - id: polish\n      type: llm",
            "    - { id: second, type: agent, model: { provider: openai, name: gpt-4o-mini }, query: \"{{#helper.text#}}\", long_term_memory: auto, max_parallel_subagents: 0 }\n    - id: polish\n      type: llm",
        );
        let agent_id = create(&db, "Support", "", &two_steps);
        let abilities = agent_abilities(&db, &agent_id).unwrap();
        assert!(abilities.memory.enabled, "the second step remembers");
        assert!(abilities.steps_differ);
        let one_step = create(&db, "Plain", "", STEPS);
        assert!(!agent_abilities(&db, &one_step).unwrap().steps_differ);
    }

    #[test]
    fn an_unreadable_spending_limit_still_shows_the_card() {
        let db = Database::open_in_memory().unwrap();
        let agent_id = create(&db, "Support", "", STEPS);
        db.set_agent_setting(&agent_id, spending::SPENDING_LIMIT_KEY, &serde_json::json!("lots")).unwrap();
        let abilities = agent_abilities(&db, &agent_id).unwrap();
        assert!(abilities.spending_unreadable);
        assert_eq!(abilities.spending, SpendingLimit::default());
    }

    #[test]
    fn the_ui_bounds_match_the_backend() {
        let ui = include_str!("../../../src/api/abilitiesTypes.ts");
        for (name, value) in [
            ("defaultMaxParallel", u64::from(DEFAULT_MAX_PARALLEL_HELPERS)),
            ("defaultMaxCalls", u64::from(DEFAULT_MAX_HELPER_CALLS)),
            ("maxParallel", u64::from(MAX_PARALLEL_HELPERS)),
            ("maxCalls", u64::from(MAX_HELPER_CALLS)),
            ("maxHelpers", MAX_HELPERS as u64),
            ("minContextTokens", MIN_CONTEXT_TOKENS),
            ("maxContextTokens", MAX_CONTEXT_TOKENS),
            ("minTokens", spending::MIN_TOKENS),
            ("maxTokens", spending::MAX_TOKENS),
            ("minCostMicros", spending::MIN_COST_MICROS),
            ("maxCostMicros", spending::MAX_COST_MICROS),
        ] {
            let grouped = value
                .to_string()
                .as_bytes()
                .rchunks(3)
                .rev()
                .map(|chunk| String::from_utf8_lossy(chunk).into_owned())
                .collect::<Vec<_>>()
                .join("_");
            assert!(ui.contains(&format!("{name}: {grouped},")), "{name} should be {grouped} in abilitiesTypes.ts");
        }
    }

    #[test]
    fn a_change_is_parsed_from_the_ui_shape() {
        let change: AbilityChange = serde_json::from_value(
            serde_json::json!({"kind": "helpers", "agentIds": ["a"], "maxParallel": 2, "maxCalls": 3}),
        )
        .unwrap();
        assert_eq!(change, AbilityChange::Helpers { agent_ids: vec!["a".into()], max_parallel: 2, max_calls: 3 });
        let context: AbilityChange =
            serde_json::from_value(serde_json::json!({"kind": "context", "mode": "summarize", "maxTokens": null}))
                .unwrap();
        assert_eq!(context, AbilityChange::Context { mode: ContextMode::Summarize, max_tokens: None });
    }
}
