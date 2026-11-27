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
//! - `guided`: the short path for local models: the model fills in a small plan and the app
//!   writes the document (new agents made of writing and lookup steps).
//! - `kind`: infers the agent kind when the user did not pick one.
//! - `diff`: compares two flow summaries for the revision summary.
//! - `history`: saves the builder chat (requests and replies) per agent.
//! - `edit_lock`: which agents a revision is changing (the Nodes view waits meanwhile).
//! - `stop`: "Stop the builder" cancels a running chat revision.
//! - `whole_response`: model steps read a looked-up response whole, not by a guessed path.
//!
//! The public functions resolve the model from the user's credentials; the
//! `*_with_model` functions hold the logic and take any [`ChatModel`], so tests
//! drive them with `graphrt_llm::mock::MockModel`.

pub(crate) mod diff;
pub mod edit_lock;
mod extract;
mod guided;
pub mod history;
mod kind;
mod live;
#[cfg(test)]
mod live_eval;
mod prompt;
mod repair;
pub mod stop;
#[cfg(test)]
mod tests;
mod whole_response;

use std::sync::Arc;
use std::time::Instant;

use graphrt_llm::{ChatModel, ChatRequest, LlmError, Message};
use serde::{Deserialize, Serialize};

use crate::credentials::{self, CredentialStore, ModelChoice, ModelProvider};
use crate::error::{AppError, AppResult};
use crate::flow::{self, FlowSummary, TrustedHosts};
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
    provider.registry_name()
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
    // A local model fills in a small plan and the app writes the document; anything
    // that path does not cover, or does not get a usable plan for, is drafted in full.
    let guided_draft = if guided::takes_guided_path(&builder.choice, kind) {
        guided::draft(builder, description, kind, on_progress).await?
    } else {
        None
    };
    let (draft, schedule) = match guided_draft {
        Some(guided) => (guided.draft, guided.schedule),
        None => {
            let messages = vec![
                Message::system(prompt::build_system_prompt(&builder.choice, &saved_secret_names(db), description)),
                Message::user(prompt::build_request(description, kind)),
            ];
            report(on_progress, BuildStage::Drafting, "Drafting the steps");
            let trusted_hosts = TrustedHosts::none();
            (draft_until_valid(builder, messages, on_progress, "Drafting the steps", &trusted_hosts).await?, None)
        }
    };
    let name = extract::agent_name(&draft.reply)
        .or_else(|| extract::document_name(&draft.flow_yaml))
        .unwrap_or_else(|| extract::name_from_description(description));
    let name = extract::humanize_name(&name);
    let done_message = with_plugin_note("Your agent is ready", &draft.flow_yaml);
    let agent =
        db.create_agent(NewAgent { name, kind, description: description.to_owned(), flow_yaml: draft.flow_yaml })?;
    // A schedule the job asks for is saved turned off, and the person is told so.
    let schedule_note = schedule.and_then(|schedule| guided::save_paused_schedule(db, &agent, &schedule));
    let explanation = match schedule_note {
        Some(note) => format!("{} {note}", draft.explanation).trim().to_owned(),
        None => draft.explanation,
    };
    history::record_build(db, &agent, &explanation);
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
    // Read from the database, never from the draft: the model cannot trust a host.
    let trusted_hosts = db.trusted_lookup_hosts(agent_id)?;
    // An agent drafted from a plan is changed by changing the plan; anything else, and a
    // change that gets no usable plan, is revised as a whole document.
    let guided_draft = if guided::takes_guided_path(&builder.choice, agent.kind) {
        guided::revise(builder, &agent, instruction, &trusted_hosts, on_progress).await?
    } else {
        None
    };
    let draft = match guided_draft {
        Some(draft) => draft,
        None => {
            let messages = vec![
                Message::system(prompt::revision_system_prompt(
                    &builder.choice,
                    &saved_secret_names(db),
                    &trusted_hosts,
                    &format!("{}\n{instruction}", agent.description),
                    &agent.flow_yaml,
                )),
                Message::user(prompt::revision_request(&agent.flow_yaml, instruction)),
            ];
            report(on_progress, BuildStage::Drafting, "Updating the steps");
            draft_until_valid(builder, messages, on_progress, "Updating the steps", &trusted_hosts).await?
        }
    };
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
/// `Model` when a model call fails; `DraftNotValid` with the last problem when the
/// document is still invalid after every repair attempt.
async fn draft_until_valid(
    builder: &BuilderModel,
    mut messages: Vec<Message>,
    on_progress: ProgressSink<'_>,
    drafting_message: &str,
    trusted_hosts: &TrustedHosts,
) -> AppResult<ValidDraft> {
    let mut reply = ask_model(builder, &messages, on_progress, BuildStage::Drafting, drafting_message).await?;
    let mut repair_attempts = 0;
    loop {
        let check_message = if repair_attempts == 0 { "Checking the steps" } else { "Checking it again" };
        report(on_progress, BuildStage::Checking, check_message);
        let written = extract::workflow_yaml(&reply);
        let written = flow::quote_text_fields(&written).unwrap_or(written);
        let flow_yaml = use_available_models(written, builder);
        // A model step that reads a guessed path into a response gets the whole response instead.
        let flow_yaml = whole_response::read_whole_responses(flow_yaml);
        let explanation = live::opening_text(&reply);
        let proposed_hosts = extract::proposed_trusted_hosts(&explanation);
        let trust = DraftTrust { trusted_hosts, proposed_hosts: &proposed_hosts };
        let problem = match validate_draft(&flow_yaml, builder, &trust) {
            Ok(summary) => return Ok(ValidDraft { reply, flow_yaml, summary, explanation }),
            Err(problem) => problem,
        };
        log::info!("drafted workflow is invalid (attempt {}): {problem}", repair_attempts + 1);
        if repair_attempts >= MAX_REPAIR_ATTEMPTS {
            return Err(AppError::DraftNotValid { problem });
        }
        repair_attempts += 1;
        report(on_progress, BuildStage::Repairing, "Fixing a problem in the draft");
        messages.push(Message::assistant(reply));
        messages.push(Message::user(prompt::repair_request(&problem, &repair::format_help(&problem, &flow_yaml))));
        reply =
            ask_model(builder, &messages, on_progress, BuildStage::Repairing, "Fixing a problem in the draft").await?;
    }
}

/// `flow_yaml` with the model steps that name a provider this computer has not set up moved
/// to the builder's own model.
///
/// The prompt tells the model which provider and model to write, but its worked examples
/// use others, and a small local model copies those and then fails to correct them in the
/// repair rounds ("still not valid after 2 fixes: model nodes use provider(s) openai").
/// Which model runs a step is the app's knowledge, not the drafting model's, so the app
/// fixes it instead of asking again. Steps on a provider that is set up are left alone.
fn use_available_models(flow_yaml: String, builder: &BuilderModel) -> String {
    let Ok(summary) = flow::summarize_flow(&flow_yaml) else { return flow_yaml };
    let mut document = flow_yaml;
    for provider in &summary.model_providers {
        if builder.available_providers.contains(provider) {
            continue;
        }
        let (to_provider, to_model) = (provider_name(builder.choice.provider), builder.choice.name.as_str());
        match crate::deploy::fixes::switch_model_provider(&document, provider, to_provider, to_model) {
            Ok((switched, steps)) => {
                log::info!("the draft used {provider}, which is not set up: moved {steps} step(s) to {to_provider}");
                document = switched;
            }
            Err(error) => log::warn!("could not move the draft's {provider} steps to {to_provider}: {error}"),
        }
    }
    document
}

/// Which hosts a draft's lookups may use without an approval.
#[derive(Debug, Clone, Copy)]
pub(crate) struct DraftTrust<'a> {
    /// The agent's trusted lookup hosts (stored in the app, none for a new agent).
    pub trusted_hosts: &'a TrustedHosts,
    /// Hosts the reply proposes with "Trust <host> for lookups". A lookup on one of
    /// them is accepted without an approval because the user sees the proposal as a
    /// button: it stays untrusted, and runs refuse it, until the user clicks.
    pub proposed_hosts: &'a [String],
}

/// Compiles the document and checks its model nodes use configured providers.
/// `Err` holds a message meant for the model to fix.
fn validate_draft(flow_yaml: &str, builder: &BuilderModel, trust: &DraftTrust<'_>) -> Result<FlowSummary, String> {
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
    let template_problems = flow::find_template_problems(flow_yaml).map_err(|error| error.to_string())?;
    if !template_problems.is_empty() {
        return Err(template_problems.join("; "));
    }
    // graphrt accepts reading a step that has not run yet; the value is then empty
    // (a chatbot built like that answers nothing).
    let unrun = flow::find_unrun_references(flow_yaml).map_err(|error| error.to_string())?;
    if !unrun.is_empty() {
        let problems: Vec<String> = unrun.iter().map(flow::UnrunReference::message).collect();
        return Err(format!(
            "{}. Connect the edges so every step you read runs before the step that reads it (for example \
             classifier -> `llm` step -> `answer` step), or read a step that does",
            problems.join("; ")
        ));
    }
    // The app promises to ask before anything is sent, so a draft that can send
    // without stopping at an approval goes back to the model.
    let unapproved = flow::find_unapproved_steps(flow_yaml, trust.trusted_hosts).map_err(|error| error.to_string())?;
    let blocking: Vec<&flow::UnapprovedStep> = unapproved
        .iter()
        .filter(|step| step.trustable_host.as_ref().is_none_or(|host| !trust.proposed_hosts.contains(host)))
        .collect();
    if !blocking.is_empty() {
        return Err(unapproved_steps_problem(&blocking));
    }
    // An approval that answers by itself when its time runs out does not ask anyone.
    let timeouts = flow::find_timeouts_that_send(flow_yaml, trust.trusted_hosts).map_err(|error| error.to_string())?;
    if !timeouts.is_empty() {
        return Err(format!("{}. An approval must never send by itself", timeouts.join("; ")));
    }
    Ok(summary)
}

/// The repair message for steps that send without an approval; lookups on a host
/// that is not trusted get the two ways out (approval, or proposing to trust it).
fn unapproved_steps_problem(steps: &[&flow::UnapprovedStep]) -> String {
    let labels: Vec<&str> = steps.iter().map(|step| step.label.as_str()).collect();
    let mut problem = format!(
        "these steps send data without asking the user first: {}. Put a `human-input` approval step before \
         each of them on every path (only its approve action may lead to the sending step). Steps that send \
         include POST/PUT/PATCH/DELETE requests, any `http-request` whose URL, params, headers, authorization \
         or body reads a `{{{{#…#}}}}` value (unless it is a read-only lookup on a trusted host), plugin and \
         `tool` steps that send or change something, and `agent` steps with such tools unless \
         `require_approval` lists every one of them",
        labels.join(", ")
    );
    for step in steps {
        if let Some(host) = &step.trustable_host {
            problem.push_str(&format!(
                ". {label} is a read-only lookup on {host}, which the user has not trusted: either put a \
                 `human-input` before it, or keep it as it is and end your opening sentences with the line \
                 `Trust {host} for lookups` so the user can trust it (chatbots cannot ask, so for them always \
                 propose trusting the host)",
                label = step.label
            ));
        }
    }
    problem
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
        if let Some(preview) = watcher.push(&delta, Instant::now()) {
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
