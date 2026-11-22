//! "Build agent" from a plain-language request (screens 02 → 03 → 04).
//!
//! Asks the default model for a graphrt workflow document, validates it with
//! `flow::compile_draft` (catalog plugins that are not installed are accepted;
//! the user installs them afterwards), and on failure sends graphrt's error back to the model
//! to repair it (up to [`MAX_REPAIR_ATTEMPTS`]). Progress goes to the caller so
//! screen 03 can tick its checklist.
//!
//! Layout:
//! - `prompt`: system and user prompts (rules, format guide, fixture examples).
//! - `extract`: pulls the YAML document and the agent name out of a model reply.
//! - `kind`: infers the agent kind when the user did not pick one.
//! - `diff`: compares two flow summaries for the revision summary.
//! - `history`: saves the builder chat (requests and replies) per agent.
//! - `edit_lock`: which agents a revision is changing (the Nodes view waits meanwhile).
//! - `stop`: "Stop the builder" cancels a running chat revision.
//!
//! The public functions resolve the model from the user's credentials; the
//! `*_with_model` functions hold the logic and take any [`ChatModel`], so tests
//! drive them with `graphrt_llm::mock::MockModel`.

pub(crate) mod diff;
pub mod edit_lock;
mod extract;
pub mod history;
mod kind;
mod live;
mod prompt;
pub mod stop;
#[cfg(test)]
mod tests;

use std::sync::Arc;
use std::time::Instant;

use graphrt_llm::{ChatModel, ChatRequest, LlmError, Message};
use serde::{Deserialize, Serialize};

use crate::credentials::{self, CredentialStore, ModelChoice, ModelProvider};
use crate::error::{AppError, AppResult};
use crate::flow::{self, FlowSummary};
use crate::storage::models::{Agent, AgentKind, NewAgent};
use crate::storage::Database;

pub use live::DraftPreview;

pub const MAX_REPAIR_ATTEMPTS: usize = 2;

/// Upper bound on a drafted document's length; a full workflow fits easily.
const MAX_REPLY_TOKENS: u32 = 8192;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BuildRequest {
    pub description: String,
    /// `None` lets the builder pick (it infers the kind from the description).
    pub kind: Option<AgentKind>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum BuildStage {
    Understanding,
    Drafting,
    Checking,
    Repairing,
    Done,
}

/// One progress update for screen 03.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BuildProgress {
    pub stage: BuildStage,
    pub message: String,
    /// What the model has written so far, while it drafts or repairs.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub draft: Option<DraftPreview>,
}

/// Result of a chat edit on screen 04.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RevisionResult {
    pub agent: Agent,
    /// What changed, in plain words: "Changed 2 steps: ...".
    pub summary: String,
    /// Ids of steps that were added or changed, to highlight them.
    pub changed_step_ids: Vec<String>,
    /// The model's own opening words about the change; may be empty.
    pub explanation: String,
}

/// Progress callback shared by the builder functions.
type ProgressSink<'a> = &'a (dyn Fn(BuildProgress) + Send + Sync);

/// The model that drafts documents, and which providers a document may use.
#[derive(Debug, Clone)]
pub(crate) struct BuilderModel {
    pub model: Arc<dyn ChatModel>,
    /// Model written into new model nodes, and the one that drafts.
    pub choice: ModelChoice,
    /// Providers with a configured client; model nodes must use one of these.
    pub available_providers: Vec<String>,
}

/// Generates, validates and saves a new draft agent.
pub async fn build_agent(
    db: &Database,
    credentials: &CredentialStore,
    request: BuildRequest,
    on_progress: &(dyn Fn(BuildProgress) + Send + Sync),
) -> AppResult<Agent> {
    let builder = resolve_builder_model(db, credentials)?;
    build_agent_with_model(db, &builder, request, on_progress).await
}

/// Applies a plain-language change to an agent's flow and saves it as a new version.
pub async fn revise_agent(
    db: &Database,
    credentials: &CredentialStore,
    agent_id: &str,
    instruction: &str,
    on_progress: &(dyn Fn(BuildProgress) + Send + Sync),
) -> AppResult<RevisionResult> {
    let builder = resolve_builder_model(db, credentials)?;
    revise_agent_with_model(db, &builder, agent_id, instruction, on_progress).await
}

/// [`revise_agent`] for a request typed in the builder chat: the request and the
/// builder's reply (or the failure) are saved to the agent's chat history. The user
/// can stop it meanwhile ([`stop::stop_revisions`]): it then ends with `AppError::Stopped`,
/// saves nothing and notes "Stopped by you" in the chat.
pub async fn revise_agent_from_chat(
    db: &Database,
    credentials: &CredentialStore,
    agent_id: &str,
    instruction: &str,
    on_progress: &(dyn Fn(BuildProgress) + Send + Sync),
) -> AppResult<RevisionResult> {
    let revision = revise_agent(db, credentials, agent_id, instruction, on_progress);
    stoppable_revision_with_history(db, agent_id, instruction, revision).await
}

/// Runs a chat revision that the user can stop, and saves it to the chat history.
pub(crate) async fn stoppable_revision_with_history(
    db: &Database,
    agent_id: &str,
    instruction: &str,
    revision: impl std::future::Future<Output = AppResult<RevisionResult>>,
) -> AppResult<RevisionResult> {
    let stoppable = stop::run_stoppable(agent_id, revision);
    history::revise_with_chat_history(db, agent_id, instruction, stoppable).await
}

/// Picks the default model and its client from the user's stored keys.
///
/// # Errors
/// `MissingCredentials` when no provider is configured; `Model` when the
/// default provider has no client in the registry.
fn resolve_builder_model(db: &Database, credentials: &CredentialStore) -> AppResult<BuilderModel> {
    let choice = credentials::default_model(credentials, db)?;
    let registry = credentials::build_model_registry(credentials, db)?;
    let provider_name = provider_name(choice.provider);
    let model = registry
        .get(provider_name)
        .map_err(|error| AppError::Model(format!("the {provider_name} model is not available: {error}")))?;
    let available_providers = registry.names().map(str::to_owned).collect();
    Ok(BuilderModel { model, choice, available_providers })
}

/// graphrt `model.provider` name of a provider (same as its serde name).
fn provider_name(provider: ModelProvider) -> &'static str {
    match provider {
        ModelProvider::Openai => "openai",
        ModelProvider::Anthropic => "anthropic",
        ModelProvider::Gemini => "gemini",
        ModelProvider::Deepseek => "deepseek",
        ModelProvider::Ollama => "ollama",
        ModelProvider::ClaudeCodeCli => "claude-code-cli",
        ModelProvider::CodexCli => "codex-cli",
    }
}

/// [`build_agent`] with an explicit model.
pub(crate) async fn build_agent_with_model(
    db: &Database,
    builder: &BuilderModel,
    request: BuildRequest,
    on_progress: ProgressSink<'_>,
) -> AppResult<Agent> {
    let description = request.description.trim();
    if description.is_empty() {
        return Err(AppError::InvalidInput("describe what the agent should do".into()));
    }
    report(on_progress, BuildStage::Understanding, "Understanding the job");
    let kind = request.kind.unwrap_or_else(|| kind::infer_kind(description));
    log::info!("building a {kind:?} agent with {}/{}", provider_name(builder.choice.provider), builder.choice.name);
    let messages = vec![
        Message::system(prompt::build_system_prompt(&builder.choice, &saved_secret_names(db))),
        Message::user(prompt::build_request(description, kind)),
    ];
    report(on_progress, BuildStage::Drafting, "Drafting the steps");
    let draft = draft_until_valid(builder, messages, on_progress, "Drafting the steps").await?;
    let name = extract::agent_name(&draft.reply)
        .or_else(|| extract::document_name(&draft.flow_yaml))
        .unwrap_or_else(|| extract::name_from_description(description));
    let name = extract::humanize_name(&name);
    let done_message = with_plugin_note("Your agent is ready", &draft.flow_yaml);
    let agent =
        db.create_agent(NewAgent { name, kind, description: description.to_owned(), flow_yaml: draft.flow_yaml })?;
    history::record_build(db, &agent, &draft.explanation);
    report(on_progress, BuildStage::Done, &done_message);
    Ok(agent)
}

/// [`revise_agent`] with an explicit model.
pub(crate) async fn revise_agent_with_model(
    db: &Database,
    builder: &BuilderModel,
    agent_id: &str,
    instruction: &str,
    on_progress: ProgressSink<'_>,
) -> AppResult<RevisionResult> {
    let instruction = instruction.trim();
    if instruction.is_empty() {
        return Err(AppError::InvalidInput("describe the change".into()));
    }
    // Hand edits in the Nodes view wait while this revision runs (released on every return).
    let _edit_guard = edit_lock::begin_builder_edit(agent_id);
    report(on_progress, BuildStage::Understanding, "Understanding the change");
    let agent = db.get_agent(agent_id)?;
    let before = current_summary(&agent);
    let messages = vec![
        Message::system(prompt::revision_system_prompt(&builder.choice, &saved_secret_names(db))),
        Message::user(prompt::revision_request(&agent.flow_yaml, instruction)),
    ];
    report(on_progress, BuildStage::Drafting, "Updating the steps");
    let draft = draft_until_valid(builder, messages, on_progress, "Updating the steps").await?;
    if extract::same_document(&draft.flow_yaml, &agent.flow_yaml) {
        return Err(AppError::InvalidInput("No changes were needed".into()));
    }
    let changes = diff::compare_flows(&before, &draft.summary);
    let updated_agent = db.update_agent_flow(agent_id, &draft.flow_yaml, &changes.summary)?;
    report(on_progress, BuildStage::Done, &with_plugin_note("Your change is ready", &draft.flow_yaml));
    Ok(RevisionResult {
        agent: updated_agent,
        summary: changes.summary,
        changed_step_ids: changes.changed_step_ids,
        explanation: draft.explanation,
    })
}

/// Names of the secrets the user saved, for the builder prompt. A read failure only
/// drops the hint (logged), it never stops a build.
fn saved_secret_names(db: &Database) -> Vec<String> {
    crate::workflow_secrets::saved::saved_secret_names(db).unwrap_or_else(|error| {
        log::warn!("could not read the saved secret names for the builder: {error}");
        Vec::new()
    })
}

/// Summary of the stored flow; an unreadable stored flow counts as having no steps,
/// so every step of the revision shows up as added.
fn current_summary(agent: &Agent) -> FlowSummary {
    flow::summarize_flow(&agent.flow_yaml).unwrap_or_else(|error| {
        log::warn!("stored flow of agent {} does not compile: {error}", agent.id);
        FlowSummary { steps: Vec::new(), inputs: Vec::new(), model_providers: Vec::new(), env: Vec::new() }
    })
}

/// A drafted document that passed validation.
struct ValidDraft {
    /// The model's full reply (holds the agent name line).
    reply: String,
    flow_yaml: String,
    summary: FlowSummary,
    /// The reply's plain-language opening (the last round's, after repairs).
    explanation: String,
}

/// Asks the model, then validates; on a problem sends the reply and the error
/// back for a fix, up to [`MAX_REPAIR_ATTEMPTS`] times.
///
/// # Errors
/// `Model` when a model call fails; `Workflow` with the last problem when the
/// document is still invalid after every repair attempt.
async fn draft_until_valid(
    builder: &BuilderModel,
    mut messages: Vec<Message>,
    on_progress: ProgressSink<'_>,
    drafting_message: &str,
) -> AppResult<ValidDraft> {
    let mut reply = ask_model(builder, &messages, on_progress, BuildStage::Drafting, drafting_message).await?;
    let mut repair_attempts = 0;
    loop {
        let check_message = if repair_attempts == 0 { "Checking the steps" } else { "Checking it again" };
        report(on_progress, BuildStage::Checking, check_message);
        let flow_yaml = extract::workflow_yaml(&reply);
        let problem = match validate_draft(&flow_yaml, builder) {
            Ok(summary) => {
                let explanation = live::opening_text(&reply);
                return Ok(ValidDraft { reply, flow_yaml, summary, explanation });
            }
            Err(problem) => problem,
        };
        log::info!("drafted workflow is invalid (attempt {}): {problem}", repair_attempts + 1);
        if repair_attempts >= MAX_REPAIR_ATTEMPTS {
            return Err(AppError::Workflow(format!(
                "the drafted agent is still not valid after {MAX_REPAIR_ATTEMPTS} fixes: {problem}"
            )));
        }
        repair_attempts += 1;
        report(on_progress, BuildStage::Repairing, "Fixing a problem in the draft");
        messages.push(Message::assistant(reply));
        messages.push(Message::user(prompt::repair_request(&problem)));
        reply =
            ask_model(builder, &messages, on_progress, BuildStage::Repairing, "Fixing a problem in the draft").await?;
    }
}

/// Compiles the document and checks its model nodes use configured providers.
/// `Err` holds a message meant for the model to fix.
fn validate_draft(flow_yaml: &str, builder: &BuilderModel) -> Result<FlowSummary, String> {
    let summary = flow::summarize_flow(flow_yaml).map_err(|error| match error {
        AppError::InvalidInput(_) => "the reply did not contain a workflow document".to_owned(),
        other => other.to_string(),
    })?;
    let unavailable: Vec<&str> = summary
        .model_providers
        .iter()
        .map(String::as_str)
        .filter(|provider| !builder.available_providers.iter().any(|available| available == provider))
        .collect();
    if !unavailable.is_empty() {
        return Err(format!(
            "model nodes use provider(s) {} that are not set up on this computer; use provider `{}` with model `{}`",
            unavailable.join(", "),
            provider_name(builder.choice.provider),
            builder.choice.name
        ));
    }
    // Local CLI providers answer text only: no tool-calling agent steps, no images.
    let capability_gaps = flow::find_local_cli_capability_gaps(flow_yaml).map_err(|error| error.to_string())?;
    if !capability_gaps.is_empty() {
        return Err(format!(
            "{}. Local CLI providers cannot call tools or read images: use an `llm` step instead of an `agent` \
             step with tools, or give that step a provider with an API key",
            capability_gaps.join("; ")
        ));
    }
    // Placeholder hosts (copied from examples) can only fail at run time.
    let placeholders = flow::find_placeholder_http_steps(flow_yaml).map_err(|error| error.to_string())?;
    if !placeholders.is_empty() {
        return Err(format!(
            "these steps call placeholder addresses that do not exist: {}. Use the real API of the service, or a \
             plugin step if a listed plugin covers it; if neither is available, read the address from an \
             `env` value (e.g. `{{{{#env.SEND_URL#}}}}`) and say in your opening sentence which service or plugin \
             the user should connect",
            placeholders.join(", ")
        ));
    }
    // The app promises to ask before anything is sent, so a draft that can send
    // without stopping at an approval goes back to the model.
    let unapproved = flow::find_unapproved_sending_steps(flow_yaml).map_err(|error| error.to_string())?;
    if !unapproved.is_empty() {
        return Err(format!(
            "these steps send data without asking the user first: {}. Put a `human-input` approval step before \
             each of them on every path (only its approve action may lead to the sending step)",
            unapproved.join(", ")
        ));
    }
    Ok(summary)
}

/// One model call; returns the reply text. While it streams, `stage` progress
/// carries a [`DraftPreview`] of what has been written so far.
async fn ask_model(
    builder: &BuilderModel,
    messages: &[Message],
    on_progress: ProgressSink<'_>,
    stage: BuildStage,
    message: &str,
) -> AppResult<String> {
    let request = ChatRequest::new(builder.choice.name.clone(), messages.to_vec()).with_max_tokens(MAX_REPLY_TOKENS);
    let stream = builder.model.chat(request).await.map_err(|error| model_error(&error))?;
    let mut watcher = live::DraftWatcher::new();
    let send_preview = |draft: DraftPreview| {
        on_progress(BuildProgress { stage, message: message.to_owned(), draft: Some(draft) });
    };
    let response = graphrt_llm::collect(stream, |delta| {
        if let Some(preview) = watcher.push(delta, Instant::now()) {
            send_preview(preview);
        }
    })
    .await
    .map_err(|error| model_error(&error))?;
    send_preview(watcher.preview());
    log::debug!("builder model reply ({} chars):\n{}", response.text.len(), response.text);
    Ok(response.text)
}

fn model_error(error: &LlmError) -> AppError {
    AppError::Model(format!("the model could not draft the agent: {error}"))
}

/// "Your agent is ready · needs 2 plugins" when the flow uses plugins that are
/// not installed yet (the build chat then asks to install them).
fn with_plugin_note(message: &str, flow_yaml: &str) -> String {
    match flow::find_missing_plugins(flow_yaml).len() {
        0 => message.to_owned(),
        1 => format!("{message} · needs 1 plugin"),
        count => format!("{message} · needs {count} plugins"),
    }
}

fn report(on_progress: ProgressSink<'_>, stage: BuildStage, message: &str) {
    on_progress(BuildProgress { stage, message: message.to_owned(), draft: None });
}
