//! The guided drafting path for local models.
//!
//! The full path asks the model to write a whole graphrt workflow document from a prompt
//! of several thousand tokens. A local Ollama model reads about 4,000 tokens, so that
//! prompt reaches it cut off, and a small model cannot keep a long YAML document valid
//! anyway. Here the model only fills in a small plan (JSON constrained by a schema: which
//! inputs, which steps, what each step should do) and the app writes the document:
//!
//! - `route`: which builds take this path.
//! - `prompt`: the short planning prompt.
//! - `plan`: the plan, and the app's own repairs of it.
//! - `compose`: the workflow document of a plan.
//!
//! The composed document goes through the same checks as a drafted one
//! ([`super::validate_draft`]). When no usable plan comes out, the caller falls back to
//! the full path, so this path can only add working builds.

mod compose;
mod plan;
mod prompt;
mod route;

use std::time::Instant;

use graphrt_llm::{ChatDelta, ChatRequest, Message, ResponseFormat};

use super::live::{DraftPreview, MIN_PREVIEW_INTERVAL};
use super::prompt::AGENT_NAME_PREFIX;
use super::{model_error, report, validate_draft, BuildProgress, BuildStage, BuilderModel, DraftTrust, ProgressSink, ValidDraft};
use crate::error::AppResult;
use crate::flow::TrustedHosts;
use crate::storage::models::AgentKind;

pub(super) use route::takes_guided_path;

/// Times the model is asked for a plan: the first answer and two corrections.
const MAX_PLAN_ATTEMPTS: usize = 3;

/// A plan is a few hundred tokens; this leaves room for long instructions.
const MAX_PLAN_TOKENS: u32 = 1500;

/// Low, so the plan follows the job instead of inventing extra steps.
const PLAN_TEMPERATURE: f64 = 0.2;

/// Drafts a new agent from a plan the model fills in.
///
/// Returns `None` when the model gave no usable plan in [`MAX_PLAN_ATTEMPTS`] answers;
/// the caller then drafts on the full path.
///
/// # Errors
/// `Model` when a model call fails (the full path would fail the same way).
pub(super) async fn draft(
    builder: &BuilderModel,
    description: &str,
    kind: AgentKind,
    on_progress: ProgressSink<'_>,
) -> AppResult<Option<ValidDraft>> {
    let message_input = compose::chatbot_message_input();
    let fixed_input = (kind == AgentKind::Chatbot).then_some(&message_input);
    let mut messages =
        vec![Message::system(prompt::system_prompt(kind)), Message::user(prompt::plan_request(description))];
    let no_trusted_hosts = TrustedHosts::none();
    for attempt in 1..=MAX_PLAN_ATTEMPTS {
        let (stage, stage_message) = if attempt == 1 {
            (BuildStage::Drafting, "Drafting the steps")
        } else {
            (BuildStage::Repairing, "Fixing a problem in the draft")
        };
        report(on_progress, stage, stage_message);
        let reply = ask_for_plan(builder, &messages, on_progress, stage, stage_message).await?;
        let check_message = if attempt == 1 { "Checking the steps" } else { "Checking it again" };
        report(on_progress, BuildStage::Checking, check_message);
        let problem = match checked_draft(&reply, builder, kind, fixed_input, &no_trusted_hosts) {
            Ok(valid_draft) => {
                on_progress(BuildProgress {
                    stage,
                    message: stage_message.to_owned(),
                    draft: Some(DraftPreview {
                        explanation: valid_draft.explanation.clone(),
                        step_titles: valid_draft.summary.steps.iter().map(|step| step.title.clone()).collect(),
                        output_tokens: estimate_tokens(reply.len()),
                    }),
                });
                return Ok(Some(valid_draft));
            }
            Err(problem) => problem,
        };
        log::info!("the plan is not usable (attempt {attempt}): {problem}");
        messages.push(Message::assistant(reply));
        messages.push(Message::user(prompt::repair_request(&problem)));
    }
    log::info!("no usable plan after {MAX_PLAN_ATTEMPTS} answers; drafting the full document instead");
    Ok(None)
}

/// Plan → document → the builder's checks. `Err` is a sentence for the model.
fn checked_draft(
    reply: &str,
    builder: &BuilderModel,
    kind: AgentKind,
    fixed_input: Option<&plan::PlanInput>,
    trusted_hosts: &TrustedHosts,
) -> Result<ValidDraft, String> {
    let plan = plan::normalize(plan::parse(reply)?, fixed_input)?;
    let flow_yaml = compose::workflow_yaml(&plan, &builder.choice, kind)?;
    // A lookup needs the user's trust in its host: proposed here, granted only by their click.
    let mut proposed_hosts: Vec<String> = Vec::new();
    for step in &plan.steps {
        if let plan::PlanStep::Lookup { url, .. } = step {
            if !proposed_hosts.iter().any(|host| host == url.host()) {
                proposed_hosts.push(url.host().to_owned());
            }
        }
    }
    let trust = DraftTrust { trusted_hosts, proposed_hosts: &proposed_hosts };
    let summary = validate_draft(&flow_yaml, builder, &trust)?;
    let mut explanation = plan.summary.clone();
    for host in &proposed_hosts {
        explanation.push_str(&format!(" Trust {host} for lookups."));
    }
    let explanation = explanation.trim().to_owned();
    let name_line = if plan.name.is_empty() { String::new() } else { format!("{AGENT_NAME_PREFIX} {}\n", plan.name) };
    // The same shape as a full-path reply, so the name and document are read the same way.
    let reply = format!("{explanation}\n{name_line}```yaml\n{flow_yaml}```\n");
    Ok(ValidDraft { reply, flow_yaml, summary, explanation })
}

/// One model call for a plan. While it streams, progress carries only a token count:
/// the JSON itself is not something to show.
async fn ask_for_plan(
    builder: &BuilderModel,
    messages: &[Message],
    on_progress: ProgressSink<'_>,
    stage: BuildStage,
    stage_message: &str,
) -> AppResult<String> {
    let request = ChatRequest::new(builder.choice.name.clone(), messages.to_vec())
        .with_max_tokens(MAX_PLAN_TOKENS)
        .with_temperature(PLAN_TEMPERATURE)
        .with_response_format(ResponseFormat::JsonSchema {
            name: "agent_plan".to_owned(),
            schema: plan::schema(),
            strict: true,
        });
    let stream = builder.model.chat(request).await.map_err(|error| model_error(&error))?;
    let mut written_bytes = 0;
    let mut last_sent: Option<Instant> = None;
    let response = graphrt_llm::collect(stream, |delta| {
        let ChatDelta::Text(text) = &delta else { return };
        written_bytes += text.len();
        let now = Instant::now();
        if last_sent.is_some_and(|sent| now.duration_since(sent) < MIN_PREVIEW_INTERVAL) {
            return;
        }
        last_sent = Some(now);
        let draft = DraftPreview { output_tokens: estimate_tokens(written_bytes), ..DraftPreview::default() };
        on_progress(BuildProgress { stage, message: stage_message.to_owned(), draft: Some(draft) });
    })
    .await
    .map_err(|error| model_error(&error))?;
    log::debug!("builder model plan ({} chars):\n{}", response.text.len(), response.text);
    Ok(response.text)
}

/// About four bytes per token.
fn estimate_tokens(bytes: usize) -> u32 {
    u32::try_from(bytes.div_ceil(4)).unwrap_or(u32::MAX)
}

#[cfg(test)]
mod tests;
