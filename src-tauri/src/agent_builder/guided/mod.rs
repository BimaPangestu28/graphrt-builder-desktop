//! The guided drafting path for local models.
//!
//! The full path asks the model to write a whole graphrt workflow document from a prompt
//! of several thousand tokens. A local Ollama model reads about 4,000 tokens, so that
//! prompt reaches it cut off, and a small model cannot keep a long YAML document valid
//! anyway. Here the model only fills in a small plan (JSON constrained by a schema: which
//! inputs, which steps, what each step should do) and the app writes the document:
//!
//! - `coverage`: which builds take this path, and the checks of a plan against the job.
//! - `offer`: the plugin operations offered for a job.
//! - `prompt`: the short planning prompts.
//! - `plan`: the plan, and the app's own repairs of it.
//! - `compose`: the workflow document of a plan, and the plan of a document.
//!
//! A plan can write, look things up, ask the person, use a plugin operation and carry a
//! schedule. A change in the builder chat edits the plan the same way. The composed
//! document goes through the same checks as a drafted one ([`super::validate_draft`]).
//! When no usable plan comes out, the caller falls back to the full path, so this path
//! can only add working builds.

mod changes;
mod compose;
mod coverage;
mod offer;
mod plan;
mod prompt;
#[cfg(test)]
mod tests;

use std::time::Instant;

use graphrt_llm::{ChatDelta, ChatRequest, Message, ResponseFormat};

use self::plan::{Plan, PlanRules, PlanStep};
use super::live::{DraftPreview, MIN_PREVIEW_INTERVAL};
use super::prompt::AGENT_NAME_PREFIX;
use super::{
    model_error, report, validate_draft, BuildProgress, BuildStage, BuilderModel, DraftTrust, ProgressSink, ValidDraft,
};
use crate::error::AppResult;
use crate::flow::TrustedHosts;
use crate::plugins::operations::OfferedOperation;
use crate::storage::models::{Agent, AgentKind, MissedRunPolicy, NewTrigger};
use crate::storage::Database;

#[cfg(test)]
pub(super) use coverage::eval_path;
pub(super) use coverage::takes_guided_path;

/// Times the model is asked for a plan: the first answer and two corrections.
const MAX_PLAN_ATTEMPTS: usize = 3;

/// Times the model is asked for the fields of one plugin step.
const MAX_FIELDS_ATTEMPTS: usize = 2;

/// A plan is a few hundred tokens; this leaves room for long instructions.
const MAX_PLAN_TOKENS: u32 = 1500;

/// Low, so the plan follows the job instead of inventing extra steps.
const PLAN_TEMPERATURE: f64 = 0.2;

/// A new agent drafted from a plan.
pub(super) struct GuidedDraft {
    pub draft: ValidDraft,
    /// When the job says the agent runs by itself.
    pub schedule: Option<ScheduledRun>,
}

/// A schedule a plan asks for, ready to be saved for the new agent.
pub(super) struct ScheduledRun {
    cron_expression: String,
    in_words: String,
    /// The inputs whose value the job itself names, as a scheduled run's inputs.
    inputs: serde_json::Value,
}

/// What one planning round works with.
struct Planning<'a> {
    builder: &'a BuilderModel,
    /// The model the document's writing steps run on.
    step_model: compose::StepModel,
    kind: AgentKind,
    operations: Vec<OfferedOperation>,
    trusted_hosts: &'a TrustedHosts,
    /// The job in the person's words, to check a new plan against; `None` for a change,
    /// which only says what to change.
    description: Option<&'a str>,
    /// What the person wrote: the job, or the change. The plan's quotes must come from it.
    request: &'a str,
    /// The plan being changed: its plugin steps keep their fields where nothing before them moved.
    previous: Option<&'a Plan>,
    /// The person gives the agent a link to read (see [`PlanRules::link_given`]).
    link_given: bool,
    on_progress: ProgressSink<'a>,
}

/// Drafts a new agent from a plan the model fills in.
///
/// Returns `None` when the job is out of the plan's reach, or the model gave no usable
/// plan in [`MAX_PLAN_ATTEMPTS`] answers; the caller then drafts on the full path.
///
/// # Errors
/// `Model` when a model call fails (the full path would fail the same way).
pub(super) async fn draft(
    builder: &BuilderModel,
    description: &str,
    kind: AgentKind,
    on_progress: ProgressSink<'_>,
) -> AppResult<Option<GuidedDraft>> {
    let operations = offered_for(description, kind);
    log::info!(
        "operations offered for the plan: {}",
        operations.iter().map(|operation| operation.kind.as_str()).collect::<Vec<_>>().join(", ")
    );
    let no_trusted_hosts = TrustedHosts::none();
    let planning = Planning {
        builder,
        step_model: compose::StepModel::from(&builder.choice),
        kind,
        operations,
        trusted_hosts: &no_trusted_hosts,
        description: Some(description),
        request: description,
        previous: None,
        link_given: coverage::gives_a_link(description),
        on_progress,
    };
    let rules = planning.rules();
    let messages =
        vec![Message::system(prompt::system_prompt(&rules)), Message::user(prompt::plan_request(description))];
    let Some((plan, draft)) = planning.plan_until_valid(messages, "Drafting the steps").await? else { return Ok(None) };
    let schedule = plan.schedule.map(|schedule| ScheduledRun {
        cron_expression: schedule.cron_expression(),
        in_words: schedule.in_words(),
        inputs: plan
            .inputs
            .iter()
            .filter(|input| !input.value.is_empty())
            .map(|input| (input.name.clone(), serde_json::Value::String(input.value.clone())))
            .collect::<serde_json::Map<_, _>>()
            .into(),
    });
    Ok(Some(GuidedDraft { draft, schedule }))
}

/// Applies a change to an agent that was drafted from a plan, by changing the plan.
///
/// Returns `None` when the agent's document is not (or no longer) the document of a saved
/// plan, when the change is out of a plan's reach, or when no usable plan came back; the
/// caller then revises on the full path.
///
/// # Errors
/// `Model` when a model call fails.
pub(super) async fn revise(
    builder: &BuilderModel,
    agent: &Agent,
    instruction: &str,
    trusted_hosts: &TrustedHosts,
    on_progress: ProgressSink<'_>,
) -> AppResult<Option<ValidDraft>> {
    let Some((current_plan, step_model)) = compose::plan_of_document(&agent.flow_yaml, agent.kind) else {
        return Ok(None);
    };
    // The operations the change may add, and the ones the plan already uses.
    let mut operations = offered_for(instruction, agent.kind);
    let all_operations = crate::plugins::operations::offered_operations();
    for step in &current_plan.steps {
        let PlanStep::Use { operation, .. } = step else { continue };
        if operations.iter().any(|offered| &offered.kind == operation) {
            continue;
        }
        match all_operations.iter().find(|offered| &offered.kind == operation) {
            Some(offered) => operations.push(offered.clone()),
            // A plan step whose plugin is gone cannot be kept by a new plan.
            None => return Ok(None),
        }
    }
    let planning = Planning {
        builder,
        step_model,
        kind: agent.kind,
        operations,
        trusted_hosts,
        description: None,
        request: instruction,
        previous: Some(&current_plan),
        link_given: coverage::gives_a_link(&format!("{}\n{instruction}", agent.description))
            || current_plan
                .steps
                .iter()
                .any(|step| matches!(step, PlanStep::Lookup { url, .. } if url.host().is_none())),
        on_progress,
    };
    let rules = planning.rules();
    let current_plan_json = match serde_json::to_string(&plan_for_the_model(&current_plan)) {
        Ok(json) => json,
        Err(error) => {
            log::warn!("could not show the current plan to the model: {error}");
            return Ok(None);
        }
    };
    let messages = vec![
        Message::system(prompt::system_prompt(&rules)),
        Message::user(prompt::revision_request(&current_plan_json, instruction)),
    ];
    let Some((new_plan, mut draft)) = planning.plan_until_valid(messages, "Updating the steps").await? else {
        return Ok(None);
    };
    // What each changed step does now, and what the change asked for that is not there.
    let sentences = changes::describe_changes(&current_plan, &new_plan, instruction);
    if !sentences.is_empty() {
        draft.explanation = format!("{}\n- {}", draft.explanation, sentences.join("\n- ")).trim().to_owned();
    }
    Ok(Some(draft))
}

/// The schedule the description's own words ask for ("every morning"), for an agent drafted
/// on the full path, which has no plan to carry one. Its runs have no input values yet:
/// the person sets them when they turn the schedule on.
pub(super) fn schedule_in_words(description: &str) -> Option<ScheduledRun> {
    coverage::schedule_in_words(description).map(|schedule| ScheduledRun {
        cron_expression: schedule.cron_expression(),
        in_words: schedule.in_words(),
        inputs: serde_json::Value::Object(serde_json::Map::new()),
    })
}

/// Saves the schedule of a new agent, turned off: an agent the person has not tried yet
/// never starts by itself. Returns the sentence that tells them about it, or `None` when
/// it could not be saved (logged; the agent itself is fine).
pub(super) fn save_paused_schedule(db: &Database, agent: &Agent, schedule: &ScheduledRun) -> Option<String> {
    let timezone = iana_time_zone::get_timezone().unwrap_or_else(|_| "UTC".to_owned());
    let new_trigger = NewTrigger {
        agent_id: agent.id.clone(),
        cron_expression: schedule.cron_expression.clone(),
        timezone,
        missed_run_policy: MissedRunPolicy::Skip,
        inputs: schedule.inputs.clone(),
    };
    let saved =
        db.create_trigger(new_trigger, None).and_then(|trigger| db.set_trigger_enabled(&trigger.id, false, None));
    match saved {
        Ok(_) => Some(format!(
            "A schedule ({}) is saved but turned off: try the agent first, then turn the schedule on.",
            schedule.in_words
        )),
        Err(error) => {
            log::warn!("could not save the schedule of agent {}: {error}", agent.id);
            None
        }
    }
}

/// The plugin operations a plan for `description` may use. A chatbot cannot ask the
/// person before sending, so it is offered only operations that read.
fn offered_for(description: &str, kind: AgentKind) -> Vec<OfferedOperation> {
    let mut operations = offer::relevant_operations(crate::plugins::operations::offered_operations(), description);
    if kind == AgentKind::Chatbot {
        operations.retain(|operation| !operation.sends);
    }
    operations
}

/// The plan as the model writes one: the same fields as the schema, so it can copy what it keeps.
fn plan_for_the_model(plan: &Plan) -> serde_json::Value {
    let steps: Vec<serde_json::Value> = plan
        .steps
        .iter()
        .map(|step| match step {
            PlanStep::Write { title, instruction } => {
                serde_json::json!({"kind": "write", "title": title, "instruction": instruction, "url": "", "operation": ""})
            }
            PlanStep::Lookup { title, url } => {
                serde_json::json!({"kind": "lookup", "title": title, "instruction": "", "url": url.as_written(), "operation": ""})
            }
            PlanStep::Approve { title, question } => {
                serde_json::json!({"kind": "approve", "title": title, "instruction": question, "url": "", "operation": ""})
            }
            PlanStep::Use { title, instruction, operation, .. } => {
                serde_json::json!({"kind": "use", "title": title, "instruction": instruction, "url": "", "operation": operation})
            }
        })
        .collect();
    let (repeat, hour) = match plan.schedule {
        Some(schedule) => (serde_json::json!(schedule.repeat), schedule.hour),
        None => (serde_json::json!("never"), 0),
    };
    serde_json::json!({
        "looks_up_the_web": plan.steps.iter().any(|step| matches!(step, PlanStep::Lookup { .. })),
        "summary": plan.summary,
        "name": plan.name,
        "inputs": plan.inputs.iter().map(|input| serde_json::json!({
            "name": input.name, "label": input.label, "long_text": input.long_text, "value": input.value,
        })).collect::<Vec<_>>(),
        "steps": steps,
        "schedule": {"repeat": repeat, "hour": hour},
        "job_words": {"send": "", "when": "", "for_each": "", "files": "", "given": "", "hand_over": ""},
    })
}

impl Planning<'_> {
    fn rules(&self) -> PlanRules<'_> {
        static MESSAGE_INPUT: std::sync::LazyLock<plan::PlanInput> =
            std::sync::LazyLock::new(compose::chatbot_message_input);
        let is_chatbot = self.kind == AgentKind::Chatbot;
        PlanRules {
            fixed_input: is_chatbot.then_some(&*MESSAGE_INPUT),
            operations: &self.operations,
            allows_approvals: !is_chatbot,
            link_given: self.link_given,
        }
    }

    /// Asks for a plan until one passes every check, at most [`MAX_PLAN_ATTEMPTS`] times.
    async fn plan_until_valid(
        &self,
        mut messages: Vec<Message>,
        first_message: &str,
    ) -> AppResult<Option<(Plan, ValidDraft)>> {
        let rules = self.rules();
        let schema = plan::schema(&rules);
        for attempt in 1..=MAX_PLAN_ATTEMPTS {
            let (stage, stage_message) = if attempt == 1 {
                (BuildStage::Drafting, first_message)
            } else {
                (BuildStage::Repairing, "Fixing a problem in the draft")
            };
            report(self.on_progress, stage, stage_message);
            let reply = self.ask_for_json(&messages, "agent_plan", schema.clone(), true, stage, stage_message).await?;
            let check_message = if attempt == 1 { "Checking the steps" } else { "Checking it again" };
            report(self.on_progress, BuildStage::Checking, check_message);
            let checked = match self.checked_plan(&reply, &rules) {
                Ok(plan) => {
                    self.with_fields(plan, stage, stage_message).await?.and_then(|plan| self.checked_draft(plan))
                }
                Err(PlanProblem::OutOfReach(reason)) => {
                    log::info!("{reason}; drafting the full document instead");
                    return Ok(None);
                }
                Err(PlanProblem::Repair(problem)) => Err(problem),
            };
            let problem = match checked {
                Ok((plan, valid_draft)) => {
                    (self.on_progress)(BuildProgress {
                        stage,
                        message: stage_message.to_owned(),
                        draft: Some(DraftPreview {
                            explanation: valid_draft.explanation.clone(),
                            step_titles: valid_draft.summary.steps.iter().map(|step| step.title.clone()).collect(),
                            output_tokens: estimate_tokens(reply.len()),
                        }),
                    });
                    return Ok(Some((plan, valid_draft)));
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

    /// Reply → plan, checked against the rules and the job.
    fn checked_plan(&self, reply: &str, rules: &PlanRules<'_>) -> Result<Plan, PlanProblem> {
        let mut plan = plan::normalize(plan::parse(reply)?, rules)?;
        coverage::verify_job_words(&mut plan.job_words, self.request);
        prefer_offered_reading(&mut plan, &self.operations, self.request);
        // The fixed message of a chatbot is its given text already.
        if rules.fixed_input.is_none() {
            if let Some(input) = coverage::input_for_given_text(&plan) {
                plan.inputs.push(input);
            }
        }
        if let Some(reason) = coverage::out_of_reach(&plan.job_words, !self.operations.is_empty()) {
            return Err(PlanProblem::OutOfReach(reason));
        }
        plan.job = match (self.description, self.previous) {
            (Some(description), _) => plan::quotable(description),
            (None, Some(previous)) => previous.job.clone(),
            (None, None) => String::new(),
        };
        if self.description.is_some() {
            if let Some(problem) = coverage::missing_action(&plan) {
                // A small model rarely adds the step when asked again; the app adds the
                // sending operation offered for the job (best match first) itself.
                if !self.add_offered_sending_step(&mut plan, rules) {
                    return Err(PlanProblem::Repair(problem));
                }
            }
            plan.schedule = coverage::checked_schedule(&plan);
        }
        Ok(plan)
    }

    /// Appends a step with the best offered sending operation to a plan that writes
    /// something but sends nothing; `false` when there is none to add.
    fn add_offered_sending_step(&self, plan: &mut Plan, rules: &PlanRules<'_>) -> bool {
        let Some(operation) = self.operations.iter().find(|operation| operation.sends) else { return false };
        if !rules.allows_approvals || !plan.steps.iter().any(|step| matches!(step, PlanStep::Write { .. })) {
            return false;
        }
        log::info!("the plan sends nothing; adding the offered step {}", operation.kind);
        plan.steps.push(PlanStep::Use {
            title: operation.title.clone(),
            instruction: format!("{}: send what was written", operation.title),
            operation: operation.kind.clone(),
            fields: std::collections::BTreeMap::new(),
        });
        true
    }

    /// Fills in the fields of every plugin step. `Ok(Err(problem))` is a sentence for the
    /// model about the plan as a whole.
    async fn with_fields(
        &self,
        mut plan: Plan,
        stage: BuildStage,
        stage_message: &str,
    ) -> AppResult<Result<Plan, String>> {
        for index in 0..plan.steps.len() {
            let PlanStep::Use { operation, .. } = &plan.steps[index] else { continue };
            let Some(offered) = self.operations.iter().find(|offered| &offered.kind == operation) else {
                return Ok(Err(format!("`{operation}` is not one of the operations")));
            };
            let fields = match self.kept_fields(&plan, index) {
                Some(kept) => kept,
                None => match self.ask_for_fields(offered, &plan, index, stage, stage_message).await? {
                    Ok(fields) => fields,
                    Err(problem) => return Ok(Err(problem)),
                },
            };
            if let PlanStep::Use { fields: step_fields, .. } = &mut plan.steps[index] {
                *step_fields = fields;
            }
        }
        Ok(Ok(plan))
    }

    /// The fields of the same plugin step in the plan being changed, when the step and
    /// everything it can read (the inputs and the steps before it) are where they were.
    fn kept_fields(&self, plan: &Plan, index: usize) -> Option<std::collections::BTreeMap<String, serde_json::Value>> {
        let previous = self.previous?;
        if previous.inputs != plan.inputs || previous.steps.len() <= index {
            return None;
        }
        let same_kind = |old: &PlanStep, new: &PlanStep| std::mem::discriminant(old) == std::mem::discriminant(new);
        if !previous.steps[..index].iter().zip(&plan.steps[..index]).all(|(old, new)| same_kind(old, new)) {
            return None;
        }
        match (&previous.steps[index], &plan.steps[index]) {
            (
                PlanStep::Use { operation: old_operation, instruction: old_instruction, fields, .. },
                PlanStep::Use { operation, instruction, .. },
            ) if old_operation == operation && old_instruction == instruction && !fields.is_empty() => {
                Some(fields.clone())
            }
            _ => None,
        }
    }

    async fn ask_for_fields(
        &self,
        operation: &OfferedOperation,
        plan: &Plan,
        step_index: usize,
        stage: BuildStage,
        stage_message: &str,
    ) -> AppResult<Result<std::collections::BTreeMap<String, serde_json::Value>, String>> {
        let schema = plan::fields_schema(operation);
        let mut messages = vec![
            Message::system(prompt::fields_system_prompt()),
            Message::user(prompt::fields_request(operation, plan, step_index, self.request)),
        ];
        let mut last_problem = String::new();
        for _ in 0..MAX_FIELDS_ATTEMPTS {
            // Not strict: an operation's optional fields may be left out, which strict mode forbids.
            let reply =
                self.ask_for_json(&messages, "step_fields", schema.clone(), false, stage, stage_message).await?;
            match plan::normalize_fields(operation, &reply, plan, step_index) {
                Ok(fields) => return Ok(Ok(fields)),
                Err(problem) => {
                    log::info!("the fields of step {} are not usable: {problem}", step_index + 1);
                    messages.push(Message::assistant(reply));
                    messages.push(Message::user(prompt::fields_repair_request(&problem)));
                    last_problem = problem;
                }
            }
        }
        Ok(Err(format!(
            "step {} could not be filled in ({last_problem}); make its instruction simpler",
            step_index + 1
        )))
    }

    /// Plan → document → the builder's checks. `Err` is a sentence for the model.
    fn checked_draft(&self, plan: Plan) -> Result<(Plan, ValidDraft), String> {
        let flow_yaml = compose::workflow_yaml(&plan, &self.step_model, self.kind)?;
        // A lookup needs the user's trust in its host: proposed here, granted only by their click.
        let mut proposed_hosts: Vec<String> = Vec::new();
        for step in &plan.steps {
            let PlanStep::Lookup { url, .. } = step else { continue };
            let Some(host) = url.host() else { continue };
            if !self.trusted_hosts.allows(host, None) && !proposed_hosts.iter().any(|proposed| proposed == host) {
                proposed_hosts.push(host.to_owned());
            }
        }
        let trust = DraftTrust { trusted_hosts: self.trusted_hosts, proposed_hosts: &proposed_hosts };
        let summary = validate_draft(&flow_yaml, self.builder, &trust)?;
        let mut explanation = plan.summary.clone();
        for host in &proposed_hosts {
            explanation.push_str(&format!(" Trust {host} for lookups."));
        }
        let explanation = explanation.trim().to_owned();
        let name_line =
            if plan.name.is_empty() { String::new() } else { format!("{AGENT_NAME_PREFIX} {}\n", plan.name) };
        // The same shape as a full-path reply, so the name and document are read the same way.
        let reply = format!("{explanation}\n{name_line}```yaml\n{flow_yaml}```\n");
        Ok((plan, ValidDraft { reply, flow_yaml, summary, explanation }))
    }

    /// One model call whose answer is held to `schema`. While it streams, progress carries
    /// only a token count: the JSON itself is not something to show.
    async fn ask_for_json(
        &self,
        messages: &[Message],
        schema_name: &str,
        schema: serde_json::Value,
        strict: bool,
        stage: BuildStage,
        stage_message: &str,
    ) -> AppResult<String> {
        let mut retried = false;
        let response = loop {
            let request = ChatRequest::new(self.builder.choice.name.clone(), messages.to_vec())
                .with_max_tokens(MAX_PLAN_TOKENS)
                .with_temperature(PLAN_TEMPERATURE)
                .with_response_format(ResponseFormat::JsonSchema {
                    name: schema_name.to_owned(),
                    schema: schema.clone(),
                    strict,
                });
            let mut written_bytes = 0;
            let mut last_sent: Option<Instant> = None;
            let answer = match self.builder.model.chat(request).await {
                Ok(stream) => {
                    graphrt_llm::collect(stream, |delta| {
                        let ChatDelta::Text(text) = &delta else { return };
                        written_bytes += text.len();
                        let now = Instant::now();
                        if last_sent.is_some_and(|sent| now.duration_since(sent) < MIN_PREVIEW_INTERVAL) {
                            return;
                        }
                        last_sent = Some(now);
                        let draft =
                            DraftPreview { output_tokens: estimate_tokens(written_bytes), ..DraftPreview::default() };
                        (self.on_progress)(BuildProgress {
                            stage,
                            message: stage_message.to_owned(),
                            draft: Some(draft),
                        });
                    })
                    .await
                }
                Err(error) => Err(error),
            };
            match answer {
                Ok(response) => break response,
                Err(error) if !retried && super::is_dropped_connection(&error) => {
                    log::info!("the model call was cut off ({error}); asking once more");
                    retried = true;
                }
                Err(error) => return Err(model_error(&error)),
            }
        };
        log::debug!("builder model {schema_name} ({} chars):\n{}", response.text.len(), response.text);
        Ok(response.text)
    }
}

/// Replaces each lookup on a site the job does not name with the best offered operation that
/// only reads: the job matched that plugin, and a small model otherwise copies an example
/// address (a Wikipedia summary for an exchange rate) or guesses an API.
fn prefer_offered_reading(plan: &mut Plan, operations: &[OfferedOperation], job: &str) {
    let Some(operation) = operations.iter().find(|operation| !operation.sends) else { return };
    let job_words: Vec<String> = job
        .to_lowercase()
        .split(|character: char| !character.is_alphanumeric())
        .filter(|word| !word.is_empty())
        .map(str::to_owned)
        .collect();
    let summary = plan.summary.clone();
    for step in &mut plan.steps {
        let PlanStep::Lookup { title, url } = step else { continue };
        let Some(host) = url.host() else { continue };
        let named = host
            .split(['.', '-'])
            .filter(|label| label.len() >= 4 && !matches!(*label, "www" | "api" | "apis"))
            .any(|label| job_words.iter().any(|word| word == label));
        if named {
            continue;
        }
        log::info!("the lookup on {host} becomes the offered operation {}", operation.kind);
        let instruction = if summary.is_empty() { title.clone() } else { summary.clone() };
        *step = PlanStep::Use {
            title: title.clone(),
            instruction,
            operation: operation.kind.clone(),
            fields: std::collections::BTreeMap::new(),
        };
    }
}

/// Why a plan is not used.
enum PlanProblem {
    /// A sentence for the model; it is asked again.
    Repair(String),
    /// The job needs the full workflow format; asking again would not help.
    OutOfReach(&'static str),
}

impl From<String> for PlanProblem {
    fn from(problem: String) -> Self {
        Self::Repair(problem)
    }
}

/// About four bytes per token.
fn estimate_tokens(bytes: usize) -> u32 {
    u32::try_from(bytes.div_ceil(4)).unwrap_or(u32::MAX)
}
