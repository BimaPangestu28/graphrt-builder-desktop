//! "Build agent" from a plain-language request (screens 02 → 03 → 04).
//!
//! Asks the default model for a graphrt workflow document, validates it with
//! `flow::compile_flow`, and on failure sends graphrt's error back to the model
//! to repair it (up to [`MAX_REPAIR_ATTEMPTS`]). Progress goes to the caller so
//! screen 03 can tick its checklist.
//!
//! Layout:
//! - `prompt`: system and user prompts (rules, format guide, fixture examples).
//! - `extract`: pulls the YAML document and the agent name out of a model reply.
//! - `kind`: infers the agent kind when the user did not pick one.
//! - `diff`: compares two flow summaries for the revision summary.
//!
//! The public functions resolve the model from the user's credentials; the
//! `*_with_model` functions hold the logic and take any [`ChatModel`], so tests
//! drive them with `graphrt_llm::mock::MockModel`.

pub(crate) mod diff;
mod extract;
mod kind;
mod prompt;
#[cfg(test)]
mod tests;

use std::sync::Arc;

use graphrt_llm::{ChatModel, ChatRequest, LlmError, Message};
use serde::{Deserialize, Serialize};

use crate::credentials::{self, CredentialStore, ModelChoice, ModelProvider};
use crate::error::{AppError, AppResult};
use crate::flow::{self, FlowSummary};
use crate::storage::models::{Agent, AgentKind, NewAgent};
use crate::storage::Database;

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
        Message::system(prompt::build_system_prompt(&builder.choice)),
        Message::user(prompt::build_request(description, kind)),
    ];
    report(on_progress, BuildStage::Drafting, "Drafting the steps");
    let draft = draft_until_valid(builder, messages, on_progress).await?;
    let name = extract::agent_name(&draft.reply)
        .or_else(|| extract::document_name(&draft.flow_yaml))
        .unwrap_or_else(|| extract::name_from_description(description));
    let agent =
        db.create_agent(NewAgent { name, kind, description: description.to_owned(), flow_yaml: draft.flow_yaml })?;
    report(on_progress, BuildStage::Done, "Your agent is ready");
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
    report(on_progress, BuildStage::Understanding, "Understanding the change");
    let agent = db.get_agent(agent_id)?;
    let before = current_summary(&agent);
    let messages = vec![
        Message::system(prompt::revision_system_prompt(&builder.choice)),
        Message::user(prompt::revision_request(&agent.flow_yaml, instruction)),
    ];
    report(on_progress, BuildStage::Drafting, "Updating the steps");
    let draft = draft_until_valid(builder, messages, on_progress).await?;
    if extract::same_document(&draft.flow_yaml, &agent.flow_yaml) {
        return Err(AppError::InvalidInput("No changes were needed".into()));
    }
    let changes = diff::compare_flows(&before, &draft.summary);
    let updated_agent = db.update_agent_flow(agent_id, &draft.flow_yaml, &changes.summary)?;
    report(on_progress, BuildStage::Done, "Your change is ready");
    Ok(RevisionResult { agent: updated_agent, summary: changes.summary, changed_step_ids: changes.changed_step_ids })
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
) -> AppResult<ValidDraft> {
    let mut reply = ask_model(builder, &messages).await?;
    let mut repair_attempts = 0;
    loop {
        let check_message = if repair_attempts == 0 { "Checking the steps" } else { "Checking it again" };
        report(on_progress, BuildStage::Checking, check_message);
        let flow_yaml = extract::workflow_yaml(&reply);
        let problem = match validate_draft(&flow_yaml, builder) {
            Ok(summary) => return Ok(ValidDraft { reply, flow_yaml, summary }),
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
        reply = ask_model(builder, &messages).await?;
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

/// One model call; returns the reply text.
async fn ask_model(builder: &BuilderModel, messages: &[Message]) -> AppResult<String> {
    let request = ChatRequest::new(builder.choice.name.clone(), messages.to_vec()).with_max_tokens(MAX_REPLY_TOKENS);
    let stream = builder.model.chat(request).await.map_err(|error| model_error(&error))?;
    let response = graphrt_llm::collect(stream, |_| {}).await.map_err(|error| model_error(&error))?;
    log::debug!("builder model reply ({} chars):\n{}", response.text.len(), response.text);
    Ok(response.text)
}

fn model_error(error: &LlmError) -> AppError {
    AppError::Model(format!("the model could not draft the agent: {error}"))
}

fn report(on_progress: ProgressSink<'_>, stage: BuildStage, message: &str) {
    on_progress(BuildProgress { stage, message: message.to_owned() });
}
