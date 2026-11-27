//! The plan a local model fills in, and the app's own repairs of it.
//!
//! The model answers a small JSON schema (the provider constrains the output to it), so
//! the reply always parses. What a small model still gets wrong is content: a name with
//! spaces, `{{topic}}` instead of `{topic}`, an address that uses an input it never
//! declared, a plan that ends on a lookup. [`normalize`] repairs everything that has one
//! obvious fix and reports the rest as a short sentence for the model.
//!
//! A plan is also what a later change in the builder chat works on: it is saved with the
//! document ([`super::compose`]) and the model edits the plan, not the YAML.

use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};
use serde_json::json;

use crate::plugins::operations::{FieldType, OfferedOperation, OperationField};

/// Most steps kept from a plan; a guided agent is a short job.
pub(super) const MAX_STEPS: usize = 6;
/// Most inputs kept from a plan.
const MAX_INPUTS: usize = 5;
/// Longest input name kept.
const MAX_INPUT_NAME_CHARS: usize = 32;
/// Hour a schedule runs at when the plan gives none that makes sense.
const DEFAULT_SCHEDULE_HOUR: u8 = 8;

/// Node ids graphrt reserves, plus the ids the composed document uses itself.
const RESERVED_INPUT_NAMES: &[&str] = &["sys", "env", "conversation", "start", "end", "item", "index"];

/// The model's answer, as it arrives. Every field is optional so a sloppy answer still parses.
#[derive(Debug, Default, Deserialize)]
pub(super) struct RawPlan {
    #[serde(default)]
    looks_up_the_web: bool,
    #[serde(default)]
    summary: String,
    #[serde(default)]
    name: String,
    #[serde(default)]
    inputs: Vec<RawInput>,
    #[serde(default)]
    steps: Vec<RawStep>,
    #[serde(default)]
    schedule: RawSchedule,
    #[serde(default)]
    job_words: JobWords,
}

/// Words the model copied from the job as the reason for a decision, or empty: what tells
/// the app that the job sends something, runs on a schedule, repeats for each item of a
/// list, or works on files. The app keeps a quote only when the job holds it
/// ([`super::coverage::verify_job_words`]), so any language works and nothing is invented.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub(super) struct JobWords {
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub send: String,
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub when: String,
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub for_each: String,
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub files: String,
}

impl JobWords {
    pub(super) fn is_empty(&self) -> bool {
        self.send.is_empty() && self.when.is_empty() && self.for_each.is_empty() && self.files.is_empty()
    }
}

#[derive(Debug, Default, Deserialize)]
struct RawInput {
    #[serde(default)]
    name: String,
    #[serde(default)]
    label: String,
    #[serde(default)]
    long_text: bool,
    #[serde(default)]
    value: String,
}

#[derive(Debug, Default, Deserialize)]
struct RawStep {
    #[serde(default)]
    kind: String,
    #[serde(default)]
    title: String,
    #[serde(default)]
    instruction: String,
    #[serde(default)]
    url: String,
    #[serde(default)]
    operation: String,
}

#[derive(Debug, Default, Deserialize)]
struct RawSchedule {
    #[serde(default)]
    repeat: String,
    #[serde(default)]
    hour: i64,
}

/// A checked plan: every name is a valid id, every address only reads declared inputs,
/// every plugin step names an offered operation, and some step produces a result.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub(super) struct Plan {
    /// One plain sentence about the agent; may be empty.
    pub summary: String,
    /// The agent's display name; may be empty (the builder then derives one).
    pub name: String,
    pub inputs: Vec<PlanInput>,
    pub steps: Vec<PlanStep>,
    /// When the agent should run by itself, if the job says so.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub schedule: Option<Schedule>,
    /// The job's own words behind the plan's decisions (checked against the job).
    #[serde(default, skip_serializing_if = "JobWords::is_empty")]
    pub job_words: JobWords,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub(super) struct PlanInput {
    /// A graphrt variable name: lowercase letters, digits and `_`.
    pub name: String,
    pub label: String,
    pub long_text: bool,
    /// The value the job itself names ("Jakarta"); empty when the person types it each run.
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub value: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub(super) enum PlanStep {
    /// A model step: `instruction` says what to produce.
    Write { title: String, instruction: String },
    /// A read-only lookup of a web address.
    Lookup { title: String, url: LookupUrl },
    /// The run stops and asks the person; only "approve" continues.
    Approve { title: String, question: String },
    /// A plugin step. `fields` are the operation's own fields; text values may hold
    /// `{input}` and `{step_2}` placeholders. Empty until the model filled them in.
    Use {
        title: String,
        instruction: String,
        operation: String,
        #[serde(default)]
        fields: BTreeMap<String, serde_json::Value>,
    },
}

impl PlanStep {
    pub(super) fn title(&self) -> &str {
        match self {
            Self::Write { title, .. }
            | Self::Lookup { title, .. }
            | Self::Approve { title, .. }
            | Self::Use { title, .. } => title,
        }
    }

    /// Whether later steps can read something this step produced.
    pub(super) fn has_result(&self) -> bool {
        !matches!(self, Self::Approve { .. })
    }
}

/// An `https` address. `{name}` parts read inputs.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub(super) struct LookupUrl {
    /// The address with `{name}` placeholders, e.g. `https://host/page/{topic}`.
    template: String,
    /// The site, written out in the address; `None` when the whole address is an input
    /// (a link the person pastes), which the app asks about before reading.
    host: Option<String>,
}

impl LookupUrl {
    pub(super) fn host(&self) -> Option<&str> {
        self.host.as_deref()
    }

    /// The address as a plan writes it, with `{name}` placeholders.
    pub(super) fn as_written(&self) -> &str {
        &self.template
    }

    /// The address as a graphrt template: `{topic}` becomes `{{#start.topic#}}`.
    pub(super) fn to_graphrt_template(&self) -> String {
        let mut rendered = String::new();
        for part in placeholder_parts(&self.template) {
            match part {
                UrlPart::Text(text) => rendered.push_str(text),
                UrlPart::Placeholder(name) => rendered.push_str(&format!("{{{{#start.{name}#}}}}")),
            }
        }
        rendered
    }
}

/// When a scheduled agent runs.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub(super) struct Schedule {
    pub repeat: Repeat,
    /// Hour of the day, 0 to 23 (not used by `Hourly`).
    pub hour: u8,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub(super) enum Repeat {
    Hourly,
    Daily,
    Weekdays,
    Weekly,
}

impl Schedule {
    /// A daily schedule at the default hour, for a job that says "every day" in words the
    /// plan did not turn into a schedule.
    pub(super) fn daily() -> Self {
        Self { repeat: Repeat::Daily, hour: DEFAULT_SCHEDULE_HOUR }
    }

    /// The cron expression (with seconds) the scheduler stores. `Weekly` runs on Monday.
    pub(super) fn cron_expression(self) -> String {
        match self.repeat {
            Repeat::Hourly => "0 0 * * * *".to_owned(),
            Repeat::Daily => format!("0 0 {} * * *", self.hour),
            Repeat::Weekdays => format!("0 0 {} * * Mon-Fri", self.hour),
            Repeat::Weekly => format!("0 0 {} * * Mon", self.hour),
        }
    }

    /// "every day at 08:00", for the sentence that tells the person about the schedule.
    pub(super) fn in_words(self) -> String {
        match self.repeat {
            Repeat::Hourly => "every hour".to_owned(),
            Repeat::Daily => format!("every day at {:02}:00", self.hour),
            Repeat::Weekdays => format!("Monday to Friday at {:02}:00", self.hour),
            Repeat::Weekly => format!("every Monday at {:02}:00", self.hour),
        }
    }
}

/// What a plan may contain, beyond writing and lookups.
#[derive(Debug, Clone, Copy)]
pub(super) struct PlanRules<'a> {
    /// An input the agent has whatever the model wrote (a chatbot's `message`); the model's
    /// own inputs are then ignored.
    pub fixed_input: Option<&'a PlanInput>,
    /// The plugin operations offered for this job; a `use` step must name one of them.
    pub operations: &'a [OfferedOperation],
    /// Whether the agent may stop and ask the person (a chatbot cannot).
    pub allows_approvals: bool,
    /// Whether the person gives the agent a link to read; only then is the prompt told
    /// that a lookup's address may be just an input (a small model otherwise writes
    /// `{topic}` as the address of a Wikipedia lookup).
    pub link_given: bool,
}

/// The JSON schema the model's answer must follow. `operations` are the plugin operations
/// offered for this job; without any, the plan has no `use` step. Every object lists all
/// its properties as required and allows no others, as OpenAI's strict mode asks.
pub(super) fn schema(rules: &PlanRules<'_>) -> serde_json::Value {
    let mut kinds = vec!["write", "lookup"];
    if rules.allows_approvals {
        kinds.push("approve");
    }
    let mut step_properties = json!({
        "kind": { "type": "string", "enum": kinds },
        "title": { "type": "string" },
        "instruction": { "type": "string" },
        "url": { "type": "string" }
    });
    let mut required_in_step = vec!["kind", "title", "instruction", "url"];
    if !rules.operations.is_empty() {
        let mut operation_names: Vec<&str> = vec![""];
        operation_names.extend(rules.operations.iter().map(|operation| operation.kind.as_str()));
        step_properties["kind"]["enum"].as_array_mut().into_iter().for_each(|kinds| kinds.push(json!("use")));
        step_properties["operation"] = json!({ "type": "string", "enum": operation_names });
        required_in_step.push("operation");
    }
    json!({
        "type": "object",
        "properties": {
            "looks_up_the_web": { "type": "boolean" },
            "summary": { "type": "string" },
            "name": { "type": "string" },
            "inputs": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": {
                        "name": { "type": "string" },
                        "label": { "type": "string" },
                        "long_text": { "type": "boolean" },
                        "value": { "type": "string" }
                    },
                    "required": ["name", "label", "long_text", "value"],
                    "additionalProperties": false
                }
            },
            "steps": {
                "type": "array",
                "minItems": 1,
                "maxItems": MAX_STEPS,
                "items": {
                    "type": "object",
                    "properties": step_properties,
                    "required": required_in_step,
                    "additionalProperties": false
                }
            },
            "schedule": {
                "type": "object",
                "properties": {
                    "repeat": { "type": "string", "enum": ["never", "hourly", "daily", "weekdays", "weekly"] },
                    "hour": { "type": "integer" }
                },
                "required": ["repeat", "hour"],
                "additionalProperties": false
            },
            "job_words": {
                "type": "object",
                "properties": {
                    "send": { "type": "string" },
                    "when": { "type": "string" },
                    "for_each": { "type": "string" },
                    "files": { "type": "string" }
                },
                "required": ["send", "when", "for_each", "files"],
                "additionalProperties": false
            }
        },
        "required": ["looks_up_the_web", "summary", "name", "inputs", "steps", "schedule", "job_words"],
        "additionalProperties": false
    })
}

/// The JSON object in a model reply. Text around it (a code fence, a sentence) is ignored.
///
/// # Errors
/// A sentence for the model when the answer holds no JSON object.
fn json_object(reply: &str) -> Result<&str, String> {
    match (reply.find('{'), reply.rfind('}')) {
        (Some(start), Some(end)) if start < end => Ok(&reply[start..=end]),
        _ => Err("the reply was not a JSON object".to_owned()),
    }
}

/// Reads the model's plan.
///
/// # Errors
/// A sentence for the model when the answer is not a JSON object.
pub(super) fn parse(reply: &str) -> Result<RawPlan, String> {
    serde_json::from_str(json_object(reply)?).map_err(|error| format!("the reply was not valid JSON ({error})"))
}

/// Checks and repairs a raw plan.
///
/// Lookup steps are dropped when the plan says the job does not read the web (small
/// models add them to plain writing jobs), a `use` step must name an offered operation,
/// and a plan whose last result is not text for the person gets a closing writing step
/// where the kind of agent needs one.
///
/// # Errors
/// One sentence for the model when something has no obvious fix: no usable step, or an
/// address that is not a public `https` address.
pub(super) fn normalize(raw: RawPlan, rules: &PlanRules<'_>) -> Result<Plan, String> {
    let inputs_are_fixed = rules.fixed_input.is_some();
    let mut inputs: Vec<PlanInput> = rules.fixed_input.into_iter().cloned().collect();
    if !inputs_are_fixed {
        for raw_input in raw.inputs.into_iter().take(MAX_INPUTS) {
            let Some(name) = input_name(&raw_input.name).or_else(|| input_name(&raw_input.label)) else { continue };
            if inputs.iter().any(|input| input.name == name) {
                continue;
            }
            let label = plain_text(&raw_input.label);
            let label = if label.is_empty() { label_from_name(&name) } else { label };
            inputs.push(PlanInput { name, label, long_text: raw_input.long_text, value: plain_text(&raw_input.value) });
        }
    }

    let mut steps: Vec<PlanStep> = Vec::new();
    for raw_step in raw.steps.into_iter().take(MAX_STEPS) {
        let title = plain_text(&raw_step.title);
        let instruction = plain_text(&raw_step.instruction);
        let kind = raw_step.kind.trim().to_ascii_lowercase();
        if kind == "lookup" && !raw_step.url.trim().is_empty() {
            if !raw.looks_up_the_web {
                continue;
            }
            // "Look up" the email address the person gives: nothing to read there.
            if bare_placeholder(&raw_step.url)
                .and_then(|name| inputs.iter().find(|input| input.name == name))
                .is_some_and(holds_an_address_or_number)
            {
                continue;
            }
            // `{topic}` as the address of a Wikipedia lookup: the plugin offered for the job
            // that reads it is what was meant (a small model rarely writes the address out).
            if let Some(operation) = reading_operation_for_bare_input(&raw_step.url, &inputs, rules) {
                let title = if title.is_empty() { operation.title.clone() } else { title };
                let instruction = if instruction.is_empty() { title.clone() } else { instruction };
                let placeholder = bare_placeholder(&raw_step.url).unwrap_or_default();
                steps.push(PlanStep::Use {
                    title,
                    instruction: format!("{instruction} (for {{{placeholder}}})"),
                    operation: operation.kind.clone(),
                    fields: BTreeMap::new(),
                });
                continue;
            }
            let url = lookup_url(&raw_step.url, &mut inputs, inputs_are_fixed)?;
            let title = match (title.is_empty(), url.host()) {
                (false, _) => title,
                (true, Some(host)) => format!("Look up on {host}"),
                (true, None) => "Read the page".to_owned(),
            };
            steps.push(PlanStep::Lookup { title, url });
            continue;
        }
        if kind == "approve" {
            let asks_twice = matches!(steps.last(), Some(PlanStep::Approve { .. }));
            if !rules.allows_approvals || asks_twice {
                continue;
            }
            let question = if instruction.is_empty() { title.clone() } else { instruction };
            let question = if question.is_empty() { "Continue?".to_owned() } else { question };
            let title = if title.is_empty() { "Ask before continuing".to_owned() } else { title };
            steps.push(PlanStep::Approve { title, question });
            continue;
        }
        let wanted_operation = raw_step.operation.trim();
        let operation = rules.operations.iter().find(|offered| offered.kind.eq_ignore_ascii_case(wanted_operation));
        // "Take my meeting notes …" offers the "Meeting Notes" recorder; when the notes are a
        // text the person pastes, that input is the material and there is nothing to read.
        if kind == "use" && operation.is_some_and(|operation| reads_what_an_input_holds(operation, &inputs)) {
            continue;
        }
        if let (true, Some(operation)) = (kind == "use", operation) {
            if operation.sends && !rules.allows_approvals {
                return Err(format!(
                    "`{}` sends something, and this agent cannot ask the person first; leave that step out",
                    operation.kind
                ));
            }
            let title = if title.is_empty() { operation.title.clone() } else { title };
            let instruction = if instruction.is_empty() { operation.title.clone() } else { instruction };
            steps.push(PlanStep::Use {
                title,
                instruction,
                operation: operation.kind.clone(),
                fields: BTreeMap::new(),
            });
            continue;
        }
        // A step that names no offered operation (or no address) is a writing step if it says what to write.
        let instruction = if instruction.is_empty() { title.clone() } else { instruction };
        if instruction.is_empty() {
            continue;
        }
        let title = if title.is_empty() { "Write the result".to_owned() } else { title };
        steps.push(PlanStep::Write { title, instruction });
    }
    while matches!(steps.last(), Some(PlanStep::Approve { .. }))
        && steps.len() > 1
        && !steps.iter().any(PlanStep::has_result)
    {
        steps.pop();
    }
    if !steps.iter().any(PlanStep::has_result) {
        return Err("the plan has no step with an instruction; give at least one \"write\" step".to_owned());
    }
    let summary = plain_text(&raw.summary);
    if needs_closing_write(&steps, rules) {
        let instruction = if summary.is_empty() {
            "Write the result the person asked for from what was found, in a few clear sentences.".to_owned()
        } else {
            format!("Using what was found, do this: {summary}")
        };
        steps.push(PlanStep::Write { title: "Write the result".to_owned(), instruction });
    }
    let job_words = JobWords {
        send: plain_text(&raw.job_words.send),
        when: plain_text(&raw.job_words.when),
        for_each: plain_text(&raw.job_words.for_each),
        files: plain_text(&raw.job_words.files),
    };
    Ok(Plan { summary, name: plain_text(&raw.name), inputs, steps, schedule: schedule(&raw.schedule), job_words })
}

/// Whether the plan must end on a writing step it does not have: when what it found last
/// is raw material (a looked-up page, data a plugin read), or when the agent is a chatbot,
/// whose reply is always written.
fn needs_closing_write(steps: &[PlanStep], rules: &PlanRules<'_>) -> bool {
    let has_write = steps.iter().any(|step| matches!(step, PlanStep::Write { .. }));
    if rules.fixed_input.is_some() && !has_write {
        return true;
    }
    match steps.iter().rev().find(|step| step.has_result()) {
        Some(PlanStep::Lookup { .. }) => true,
        Some(PlanStep::Use { operation, .. }) => {
            !has_write && rules.operations.iter().any(|offered| &offered.kind == operation && !offered.sends)
        }
        _ => false,
    }
}

fn schedule(raw: &RawSchedule) -> Option<Schedule> {
    let repeat = match raw.repeat.trim().to_ascii_lowercase().as_str() {
        "hourly" => Repeat::Hourly,
        "daily" => Repeat::Daily,
        "weekdays" => Repeat::Weekdays,
        "weekly" => Repeat::Weekly,
        _ => return None,
    };
    let hour = u8::try_from(raw.hour).ok().filter(|hour| *hour <= 23).unwrap_or(DEFAULT_SCHEDULE_HOUR);
    Some(Schedule { repeat, hour })
}

/// The JSON schema for the fields of one plugin step: the operation's own simple fields.
pub(super) fn fields_schema(operation: &OfferedOperation) -> serde_json::Value {
    let mut properties = serde_json::Map::new();
    for field in &operation.fields {
        properties.insert(field.name.clone(), json!({ "type": field.field_type.json_schema_type() }));
    }
    let required: Vec<&str> =
        operation.fields.iter().filter(|field| field.required).map(|field| field.name.as_str()).collect();
    json!({ "type": "object", "properties": properties, "required": required })
}

/// Checks the fields the model gave for the plugin step at `step_index` of `plan`.
///
/// Only the operation's own fields are kept, each with its declared type. In text,
/// `{{name}}` is read as `{name}`; a placeholder that names neither an input nor an
/// earlier step becomes the latest earlier result when there is exactly one to mean, and
/// plain words otherwise.
///
/// # Errors
/// One sentence for the model when a required field is missing or empty.
pub(super) fn normalize_fields(
    operation: &OfferedOperation,
    reply: &str,
    plan: &Plan,
    step_index: usize,
) -> Result<BTreeMap<String, serde_json::Value>, String> {
    let given: serde_json::Map<String, serde_json::Value> =
        serde_json::from_str(json_object(reply)?).map_err(|error| format!("the reply was not valid JSON ({error})"))?;
    let mut fields = BTreeMap::new();
    for field in &operation.fields {
        let value = given.get(&field.name).and_then(|value| typed_value(value, field.field_type, plan, step_index));
        let value = if operation.sends { guarded_sending_value(field, value, plan, step_index) } else { value };
        match value {
            Some(value) => {
                fields.insert(field.name.clone(), value);
            }
            None if field.required => {
                let hint =
                    if field.description.is_empty() { String::new() } else { format!(" ({})", field.description) };
                return Err(format!("the field \"{}\" is required{hint}; give it a value", field.name));
            }
            None => {}
        }
    }
    if operation.sends {
        drop_repeated_recipients(operation, &mut fields);
    }
    Ok(fields)
}

/// Removes optional recipient fields (`cc`, `bcc`) that repeat a required one, and an
/// `html` body that repeats `text`: a small model copies one value into every field.
fn drop_repeated_recipients(operation: &OfferedOperation, fields: &mut BTreeMap<String, serde_json::Value>) {
    let is_recipient = |field: &&OperationField| RECIPIENT_FIELDS.contains(&field.name.as_str());
    let required: Vec<serde_json::Value> = operation
        .fields
        .iter()
        .filter(is_recipient)
        .filter(|field| field.required)
        .filter_map(|field| fields.get(&field.name).cloned())
        .collect();
    for field in operation.fields.iter().filter(is_recipient).filter(|field| !field.required) {
        if fields.get(&field.name).is_some_and(|value| required.contains(value)) {
            fields.remove(&field.name);
        }
    }
    // The same written text as `html` too would send plain text as a web page.
    if fields.contains_key("html") && fields.get("html") == fields.get("text") {
        fields.remove("html");
    }
}

/// Field names that say who receives what is sent.
const RECIPIENT_FIELDS: &[&str] = &[
    "to",
    "cc",
    "bcc",
    "recipient",
    "recipients",
    "email",
    "email_address",
    "to_email",
    "phone",
    "phone_number",
    "number",
    "chat_id",
];

/// Field names whose value must be one line.
const SINGLE_LINE_FIELDS: &[&str] = &["subject", "title"];

/// Field names that hold the text that is sent.
const MESSAGE_FIELDS: &[&str] = &["text", "body", "message", "content"];

/// Words of an input's name or label that say it holds an address or a number to send to.
const ADDRESS_INPUT_WORDS: &[&str] =
    &["email", "mail", "address", "recipient", "to", "phone", "number", "chat", "alamat", "penerima", "nomor", "surel"];

/// What the app itself decides in a field of a step that sends, whatever the model wrote:
///
/// - A recipient is an input the person fills in. An address the model wrote out (a small
///   model invents `sari@example.com`) or an earlier step's text there is replaced by the
///   one input that holds an address, or dropped when there is none (a required field is
///   then reported missing).
/// - The text that is sent is the latest earlier written result when the model left the
///   field out or wrote fixed words: the plan wrote that text to send it.
fn guarded_sending_value(
    field: &OperationField,
    value: Option<serde_json::Value>,
    plan: &Plan,
    step_index: usize,
) -> Option<serde_json::Value> {
    if field.field_type != FieldType::Text {
        return value;
    }
    let text = value.as_ref().and_then(serde_json::Value::as_str).unwrap_or_default();
    if RECIPIENT_FIELDS.contains(&field.name.as_str()) {
        let parts = field_parts(text, plan);
        let names_only_inputs = !parts.is_empty()
            && parts.iter().all(|part| match part {
                FieldPart::Input(_) => true,
                FieldPart::Text(words) => {
                    !words.contains('@') && words.chars().filter(char::is_ascii_digit).count() < 6
                }
                FieldPart::StepResult(_) => false,
            })
            && parts.iter().any(|part| matches!(part, FieldPart::Input(_)));
        if names_only_inputs {
            return value;
        }
        return address_input(plan).map(|name| json!(format!("{{{name}}}")));
    }
    if SINGLE_LINE_FIELDS.contains(&field.name.as_str()) {
        // A subject is one line; a model's step result or its own text may hold several.
        return value.map(|value| match value {
            serde_json::Value::String(text) => json!(text.split_whitespace().collect::<Vec<_>>().join(" ")),
            other => other,
        });
    }
    if MESSAGE_FIELDS.contains(&field.name.as_str()) {
        let reads_a_result = field_parts(text, plan).iter().any(|part| matches!(part, FieldPart::StepResult(_)));
        if reads_a_result {
            return value;
        }
        let latest_written = (0..step_index.min(plan.steps.len()))
            .rev()
            .find(|index| matches!(plan.steps[*index], PlanStep::Write { .. }));
        return match latest_written {
            Some(index) => Some(json!(format!("{{step_{}}}", index + 1))),
            None => value,
        };
    }
    value
}

/// The one input that holds an address or a number to send to, by its name or label.
fn address_input(plan: &Plan) -> Option<&str> {
    let holds_an_address = |input: &&PlanInput| {
        format!("{} {}", input.name, input.label)
            .to_lowercase()
            .split(|character: char| !character.is_alphanumeric())
            .any(|word| ADDRESS_INPUT_WORDS.contains(&word))
    };
    match plan.inputs.iter().filter(holds_an_address).collect::<Vec<_>>().as_slice() {
        [only] => Some(only.name.as_str()),
        _ => None,
    }
}

/// `value` as the field's type, or `None` when it is empty or not that type.
fn typed_value(
    value: &serde_json::Value,
    field_type: FieldType,
    plan: &Plan,
    step_index: usize,
) -> Option<serde_json::Value> {
    match field_type {
        FieldType::Text => {
            let text = match value {
                serde_json::Value::String(text) => text.clone(),
                serde_json::Value::Number(number) => number.to_string(),
                _ => return None,
            };
            let text = repair_placeholders(text.trim(), plan, step_index);
            (!text.is_empty()).then(|| json!(text))
        }
        FieldType::Boolean => match value {
            serde_json::Value::Bool(_) => Some(value.clone()),
            serde_json::Value::String(text) if text.eq_ignore_ascii_case("true") => Some(json!(true)),
            serde_json::Value::String(text) if text.eq_ignore_ascii_case("false") => Some(json!(false)),
            _ => None,
        },
        FieldType::Integer => match value {
            serde_json::Value::Number(number) => number.as_i64().map(|integer| json!(integer)),
            serde_json::Value::String(text) => text.trim().parse::<i64>().ok().map(|integer| json!(integer)),
            _ => None,
        },
        FieldType::Number => match value {
            serde_json::Value::Number(_) => Some(value.clone()),
            serde_json::Value::String(text) => text.trim().parse::<f64>().ok().map(|number| json!(number)),
            _ => None,
        },
    }
}

/// What a `{placeholder}` in a plugin field stands for.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(super) enum FieldPart<'a> {
    Text(&'a str),
    /// An input, by its variable name.
    Input(&'a str),
    /// The result of the step at this index of the plan.
    StepResult(usize),
}

/// Splits a field's text into words and the placeholders [`repair_placeholders`] left in it.
pub(super) fn field_parts<'a>(text: &'a str, plan: &'a Plan) -> Vec<FieldPart<'a>> {
    placeholder_parts(text)
        .into_iter()
        .map(|part| match part {
            UrlPart::Text(text) => FieldPart::Text(text),
            UrlPart::Placeholder(name) => match step_number(name) {
                Some(number) if number >= 1 && number <= plan.steps.len() => FieldPart::StepResult(number - 1),
                _ if plan.inputs.iter().any(|input| input.name == name) => FieldPart::Input(name),
                // Never left by `repair_placeholders`; a plan edited by hand could hold one.
                _ => FieldPart::Text(name),
            },
        })
        .collect()
}

/// `step_2` (also `step2`, `step 2`) is 2.
fn step_number(placeholder: &str) -> Option<usize> {
    let rest = placeholder.trim().to_ascii_lowercase();
    let digits = rest.strip_prefix("step")?.trim_start_matches(['_', ' ', '-']);
    digits.parse().ok()
}

/// Makes every `{placeholder}` of a field name an input or an earlier step with a result.
fn repair_placeholders(text: &str, plan: &Plan, step_index: usize) -> String {
    let single_braces = text.replace("{{#start.", "{").replace("#}}", "}").replace("{{", "{").replace("}}", "}");
    let earlier_results: Vec<usize> =
        (0..step_index.min(plan.steps.len())).filter(|index| plan.steps[*index].has_result()).collect();
    let mut repaired = String::new();
    for part in placeholder_parts(&single_braces) {
        match part {
            UrlPart::Text(text) => repaired.push_str(text),
            UrlPart::Placeholder(written) => {
                let as_input = input_name(written).filter(|name| plan.inputs.iter().any(|input| &input.name == name));
                let as_step = step_number(written).filter(|number| earlier_results.contains(&number.wrapping_sub(1)));
                match (as_step, as_input, earlier_results.as_slice()) {
                    (Some(number), _, _) => repaired.push_str(&format!("{{step_{number}}}")),
                    (None, Some(name), _) => repaired.push_str(&format!("{{{name}}}")),
                    // "{result}", "{summary}", "{step_9}": the one earlier result is what is meant.
                    (None, None, [only]) => repaired.push_str(&format!("{{step_{}}}", only + 1)),
                    (None, None, _) => repaired.push_str(written),
                }
            }
        }
    }
    repaired
}

/// Checks a lookup address and makes its placeholders name declared inputs.
///
/// A placeholder that names no input becomes the only input when there is exactly one,
/// and otherwise a new input (unless `inputs_are_fixed`, as for a chatbot, where it
/// becomes the first input). An address that is one placeholder and nothing else is a
/// link the person gives.
fn lookup_url(raw_url: &str, inputs: &mut Vec<PlanInput>, inputs_are_fixed: bool) -> Result<LookupUrl, String> {
    let trimmed = raw_url.trim().trim_matches(|character| matches!(character, '"' | '\'' | '`' | '<' | '>'));
    // `{{topic}}` and `{{#start.topic#}}` mean `{topic}`.
    let single_braces = trimmed.replace("{{#start.", "{").replace("#}}", "}").replace("{{", "{").replace("}}", "}");
    let single_braces = without_trailing_junk(&single_braces);
    let without_scheme = single_braces.strip_prefix("https://").or_else(|| single_braces.strip_prefix("http://"));
    if let [UrlPart::Placeholder(written_name)] = placeholder_parts(without_scheme.unwrap_or(&single_braces)).as_slice()
    {
        let name = resolve_placeholder(written_name, inputs, inputs_are_fixed)?;
        // `{topic}` holding "Jakarta" is no address: only a link the person gives can be one.
        if !inputs.iter().any(|input| input.name == name && is_a_link(input)) {
            return Err(format!(
                "the lookup address is only {{{name}}}, and {name} is not a link the person gives; write the \
                 site's full address with {{{name}}} in it, for example \
                 https://en.wikipedia.org/api/rest_v1/page/summary/{{{name}}} for a Wikipedia summary"
            ));
        }
        return Ok(LookupUrl { template: format!("{{{name}}}"), host: None });
    }
    let with_scheme = match single_braces.split_once("://") {
        Some(("https", _)) => single_braces.clone(),
        Some(("http", rest)) => format!("https://{rest}"),
        Some(_) => return Err(format!("`{trimmed}` is not a web address; a lookup needs an https address")),
        None => format!("https://{single_braces}"),
    };
    if with_scheme.chars().any(char::is_whitespace) {
        return Err(format!("the lookup address `{trimmed}` contains spaces; write one https address"));
    }
    let after_scheme = &with_scheme["https://".len()..];
    let host = after_scheme.split(['/', '?', '#']).next().unwrap_or_default().to_ascii_lowercase();
    let host_is_written_out = host.contains('.')
        && !host.starts_with('.')
        && !host.ends_with('.')
        && host.chars().all(|character| character.is_ascii_alphanumeric() || matches!(character, '.' | '-'));
    if !host_is_written_out {
        return Err(format!(
            "the lookup address `{trimmed}` must start with a real site such as https://en.wikipedia.org; only \
             the part after the site may use an input like {{topic}}"
        ));
    }
    let lowered = with_scheme.to_ascii_lowercase();
    if ["api_key", "apikey", "api-key", "your_", "your-", "token=", "appid=", "access_key"]
        .iter()
        .any(|marker| lowered.contains(marker))
    {
        return Err(format!(
            "the lookup address `{trimmed}` needs a key or account; use a public address that needs no key, or \
             leave the lookup out"
        ));
    }
    let mut template = String::new();
    for part in placeholder_parts(&with_scheme) {
        match part {
            UrlPart::Text(text) if text.contains(['{', '}']) => {
                return Err(format!(
                    "the lookup address `{trimmed}` has a brace that is not around an input name; write it as one \
                     https address with inputs as {{name}}"
                ));
            }
            UrlPart::Text(text) => template.push_str(text),
            UrlPart::Placeholder(written_name) => {
                let name = resolve_placeholder(written_name, inputs, inputs_are_fixed)?;
                template.push_str(&format!("{{{name}}}"));
            }
        }
    }
    let template = with_inputs_for_their_values(template, host.len(), inputs);
    Ok(LookupUrl { template, host: Some(host) })
}

/// `url` without what a model sometimes leaves after it: a comma, an opening brace or
/// bracket, or a closing brace that closes nothing (`…/summary/Jakarta},{`).
fn without_trailing_junk(url: &str) -> String {
    let mut url = url.trim_end().to_owned();
    loop {
        let unmatched_close = url.ends_with('}') && url.matches('}').count() > url.matches('{').count();
        if url.ends_with([',', '{', '[', ']', ' ']) || unmatched_close {
            url.pop();
        } else {
            return url;
        }
    }
}

/// `template` with a path segment or query value that is exactly the value of an input
/// (`…/summary/Jakarta` when the input `topic` holds "Jakarta") as that input, so the agent
/// looks up what the person types and not only what the job named. `host_length` is the
/// length of the site's name.
fn with_inputs_for_their_values(template: String, host_length: usize, inputs: &[PlanInput]) -> String {
    let after_host = "https://".len() + host_length;
    let (site, rest) = template.split_at(after_host.min(template.len()));
    let mut rest = rest.to_owned();
    for input in inputs {
        let value = input.value.trim();
        let is_url_safe = !value.is_empty()
            && value.chars().all(|character| character.is_alphanumeric() || matches!(character, '_' | '-' | '.'));
        if !is_url_safe {
            continue;
        }
        let mut replaced = String::new();
        let mut remaining = rest.as_str();
        while let Some(position) = remaining.find(value) {
            let before = remaining[..position].chars().next_back();
            let after = remaining[position + value.len()..].chars().next();
            let whole = matches!(before, Some('/' | '=')) && matches!(after, None | Some('/' | '?' | '&' | '#'));
            replaced.push_str(&remaining[..position]);
            if whole {
                replaced.push_str(&format!("{{{}}}", input.name));
            } else {
                replaced.push_str(value);
            }
            remaining = &remaining[position + value.len()..];
        }
        replaced.push_str(remaining);
        rest = replaced;
    }
    format!("{site}{rest}")
}

/// Whether the plugin of `operation` is named like a long text input: the person gives that
/// material, so a step of that plugin would fetch it again from somewhere else. (Its name
/// alone, "wait_for_meeting", counts as sending, so it is not asked whether it reads.)
fn reads_what_an_input_holds(operation: &OfferedOperation, inputs: &[PlanInput]) -> bool {
    let lowercase_words = |text: &str| -> Vec<String> {
        text.to_lowercase()
            .split(|character: char| !character.is_alphanumeric())
            .filter(|word| word.chars().count() >= 3)
            .map(str::to_owned)
            .collect()
    };
    let plugin_words = lowercase_words(&operation.plugin);
    !plugin_words.is_empty()
        && inputs.iter().filter(|input| input.long_text).any(|input| {
            let input_words = lowercase_words(&format!("{} {}", input.name, input.label));
            plugin_words.iter().all(|word| {
                input_words.iter().any(|input_word| input_word.trim_end_matches('s') == word.trim_end_matches('s'))
            })
        })
}

/// The input name a lookup address consists of, when it is one placeholder and nothing
/// else (`{topic}`, `{{topic}}`, `https://{topic}`).
fn bare_placeholder(raw_url: &str) -> Option<String> {
    let trimmed = raw_url.trim().trim_matches(|character| matches!(character, '"' | '\'' | '`' | '<' | '>'));
    let single_braces = trimmed.replace("{{#start.", "{").replace("#}}", "}").replace("{{", "{").replace("}}", "}");
    let without_scheme = single_braces.strip_prefix("https://").or_else(|| single_braces.strip_prefix("http://"));
    match placeholder_parts(without_scheme.unwrap_or(&single_braces)).as_slice() {
        [UrlPart::Placeholder(name)] => input_name(name),
        _ => None,
    }
}

/// The best offered operation that only reads, when a lookup address is just an input that
/// holds no link (see [`is_a_link`]). Offered operations come best match first.
fn reading_operation_for_bare_input<'a>(
    raw_url: &str,
    inputs: &[PlanInput],
    rules: &'a PlanRules<'_>,
) -> Option<&'a OfferedOperation> {
    let name = bare_placeholder(raw_url)?;
    let input = inputs.iter().find(|input| input.name == name).or_else(|| (inputs.len() == 1).then(|| &inputs[0]))?;
    if is_a_link(input) {
        return None;
    }
    rules.operations.iter().find(|operation| !operation.sends)
}

/// Words of an input's name or label that say it holds a web address.
/// "address" and "alamat" are left out: they name an email address as often as a web one.
const LINK_WORDS: &[&str] = &["link", "url", "page", "website", "site", "web", "tautan", "halaman"];

/// Words that say an input holds an email address or a number, never a link.
const NOT_LINK_WORDS: &[&str] = &["email", "mail", "surel", "phone", "telepon", "nomor", "number"];

/// Whether `input` is a link the person gives: its name or label says so, or its value is one.
/// Whether `input` holds an email address or a number (its name or label says so).
fn holds_an_address_or_number(input: &PlanInput) -> bool {
    format!("{} {}", input.name, input.label)
        .to_lowercase()
        .split(|character: char| !character.is_alphanumeric())
        .any(|word| NOT_LINK_WORDS.contains(&word))
}

fn is_a_link(input: &PlanInput) -> bool {
    if holds_an_address_or_number(input) {
        return false;
    }
    format!("{} {}", input.name, input.label)
        .to_lowercase()
        .split(|character: char| !character.is_alphanumeric())
        .any(|word| LINK_WORDS.contains(&word))
        || input.value.starts_with("http://")
        || input.value.starts_with("https://")
}

fn resolve_placeholder(
    written_name: &str,
    inputs: &mut Vec<PlanInput>,
    inputs_are_fixed: bool,
) -> Result<String, String> {
    let wanted = input_name(written_name);
    if let Some(known) = wanted.as_ref().and_then(|name| inputs.iter().find(|input| &input.name == name)) {
        return Ok(known.name.clone());
    }
    if inputs.len() == 1 || (inputs_are_fixed && !inputs.is_empty()) {
        return Ok(inputs[0].name.clone());
    }
    let Some(name) = wanted else {
        return Err(format!("the lookup address uses `{{{written_name}}}`, which is not the name of an input"));
    };
    inputs.push(PlanInput {
        label: label_from_name(&name),
        name: name.clone(),
        long_text: false,
        value: String::new(),
    });
    Ok(name)
}

enum UrlPart<'a> {
    Text(&'a str),
    Placeholder(&'a str),
}

/// Splits `https://host/{a}/x` into text and `{name}` placeholders. An unclosed `{` is text.
fn placeholder_parts(template: &str) -> Vec<UrlPart<'_>> {
    let mut parts = Vec::new();
    let mut rest = template;
    while let Some(open) = rest.find('{') {
        let Some(close) = rest[open..].find('}').map(|offset| open + offset) else { break };
        if open > 0 {
            parts.push(UrlPart::Text(&rest[..open]));
        }
        parts.push(UrlPart::Placeholder(&rest[open + 1..close]));
        rest = &rest[close + 1..];
    }
    if !rest.is_empty() {
        parts.push(UrlPart::Text(rest));
    }
    parts
}

/// A graphrt variable name from what the model wrote: `Product Description` → `product_description`.
/// `None` when nothing usable is left.
fn input_name(written: &str) -> Option<String> {
    let mut name = String::new();
    for character in written.trim().chars() {
        if name.chars().count() >= MAX_INPUT_NAME_CHARS {
            break;
        }
        if character.is_ascii_alphanumeric() {
            name.push(character.to_ascii_lowercase());
        } else if !name.is_empty() && !name.ends_with('_') {
            name.push('_');
        }
    }
    let name = name.trim_end_matches('_').to_owned();
    if name.is_empty() {
        return None;
    }
    let starts_with_letter = name.chars().next().is_some_and(|character| character.is_ascii_alphabetic());
    let name = if starts_with_letter { name } else { format!("input_{name}") };
    Some(if RESERVED_INPUT_NAMES.contains(&name.as_str()) { format!("{name}_text") } else { name })
}

/// `product_description` → `Product description`.
fn label_from_name(name: &str) -> String {
    let words = name.replace('_', " ");
    let mut characters = words.chars();
    match characters.next() {
        Some(first) => first.to_uppercase().chain(characters).collect(),
        None => String::new(),
    }
}

/// Model text made safe to put into a workflow: one line of plain words, and no `{{` / `}}`,
/// which graphrt would read as a reference to another step.
fn plain_text(written: &str) -> String {
    let single_braces = written.replace("{{", "{").replace("}}", "}").replace("{#", "{").replace("#}", "}");
    single_braces.split_whitespace().collect::<Vec<_>>().join(" ")
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::plugins::operations::tests::{list_messages_operation, send_email_operation};

    const NO_OPERATIONS: &[OfferedOperation] = &[];

    fn task_rules(operations: &[OfferedOperation]) -> PlanRules<'_> {
        PlanRules { fixed_input: None, operations, allows_approvals: true, link_given: false }
    }

    fn normalized(json_text: &str) -> Result<Plan, String> {
        normalize(parse(json_text)?, &task_rules(NO_OPERATIONS))
    }

    fn write_step(title: &str, instruction: &str) -> PlanStep {
        PlanStep::Write { title: title.into(), instruction: instruction.into() }
    }

    fn input(name: &str, label: &str) -> PlanInput {
        PlanInput { name: name.into(), label: label.into(), long_text: false, value: String::new() }
    }

    #[test]
    fn a_tidy_plan_is_kept_as_written() {
        let plan = normalized(
            r#"{"looks_up_the_web": false, "summary": "Writes a polite reply.", "name": "Complaint Reply",
                "inputs": [{"name": "complaint", "label": "The complaint", "long_text": true, "value": ""}],
                "steps": [{"kind": "write", "title": "Write the reply", "instruction": "Write a polite reply.", "url": ""}],
                "schedule": {"repeat": "never", "hour": 0}}"#,
        )
        .unwrap();
        assert_eq!(plan.name, "Complaint Reply");
        assert_eq!(plan.summary, "Writes a polite reply.");
        assert_eq!(plan.inputs, [PlanInput { long_text: true, ..input("complaint", "The complaint") }]);
        assert_eq!(plan.steps, [write_step("Write the reply", "Write a polite reply.")]);
        assert_eq!(plan.schedule, None);
    }

    #[test]
    fn text_around_the_json_is_ignored() {
        let reply = "Here is the plan:\n```json\n{\"steps\": [{\"kind\": \"write\", \"instruction\": \"Do it\"}]}\n```";
        assert_eq!(normalized(reply).unwrap().steps, [write_step("Write the result", "Do it")]);
        assert!(parse("no plan here").is_err());
        assert!(parse("{ broken").is_err());
    }

    #[test]
    fn input_names_become_variable_names_and_stay_unique() {
        let plan = normalized(
            r#"{"inputs": [{"name": "Product Description", "label": "", "long_text": false},
                           {"name": "product-description", "label": "Again", "long_text": false},
                           {"name": "2nd", "label": "Second", "long_text": false},
                           {"name": "start", "label": "Reserved", "long_text": false, "value": " Jakarta "},
                           {"name": "???", "label": "", "long_text": false}],
                "steps": [{"kind": "write", "title": "T", "instruction": "I"}]}"#,
        )
        .unwrap();
        let names: Vec<&str> = plan.inputs.iter().map(|input| input.name.as_str()).collect();
        assert_eq!(names, ["product_description", "input_2nd", "start_text"]);
        assert_eq!(plan.inputs[0].label, "Product description");
        assert_eq!(plan.inputs[2].value, "Jakarta");
    }

    #[test]
    fn references_written_by_the_model_are_defused() {
        let plan = normalized(
            r#"{"steps": [{"kind": "write", "title": "Use {{#start.topic#}}", "instruction": "Summarize {{topic}}\nin two   lines"}]}"#,
        )
        .unwrap();
        assert_eq!(plan.steps, [write_step("Use {start.topic}", "Summarize {topic} in two lines")]);
    }

    #[test]
    fn lookup_placeholders_are_matched_to_inputs() {
        let plan = normalized(
            r#"{"looks_up_the_web": true, "inputs": [{"name": "topic", "label": "Topic", "long_text": false}],
                "steps": [{"kind": "lookup", "title": "Get the page", "instruction": "x",
                           "url": "http://en.wikipedia.org/api/rest_v1/page/summary/{{Topic}}"},
                          {"kind": "write", "title": "Summarize", "instruction": "Two sentences."}]}"#,
        )
        .unwrap();
        let PlanStep::Lookup { url, .. } = &plan.steps[0] else { panic!("lookup expected: {:?}", plan.steps) };
        assert_eq!(url.host(), Some("en.wikipedia.org"));
        assert_eq!(url.to_graphrt_template(), "https://en.wikipedia.org/api/rest_v1/page/summary/{{#start.topic#}}");
    }

    #[test]
    fn an_unknown_placeholder_uses_the_only_input_or_becomes_a_new_one() {
        let one_input = normalized(
            r#"{"looks_up_the_web": true, "inputs": [{"name": "city", "label": "City", "long_text": false}],
                "steps": [{"kind": "lookup", "title": "", "instruction": "", "url": "https://wttr.in/{place}?format=3"}]}"#,
        )
        .unwrap();
        let PlanStep::Lookup { url, title } = &one_input.steps[0] else { panic!("lookup expected") };
        assert_eq!(url.to_graphrt_template(), "https://wttr.in/{{#start.city#}}?format=3");
        assert_eq!(title, "Look up on wttr.in");

        let no_input = normalized(
            r#"{"looks_up_the_web": true, "inputs": [],
                "steps": [{"kind": "lookup", "title": "L", "instruction": "", "url": "wttr.in/{place}"}]}"#,
        )
        .unwrap();
        assert_eq!(no_input.inputs, [input("place", "Place")]);
    }

    #[test]
    fn an_address_that_is_only_an_input_is_a_link_the_person_gives() {
        for written in ["{link}", "{{link}}", "https://{link}"] {
            let plan = normalized(&format!(
                r#"{{"looks_up_the_web": true, "inputs": [{{"name": "link", "label": "Link", "long_text": false}}],
                    "steps": [{{"kind": "lookup", "title": "", "instruction": "", "url": "{written}"}}]}}"#
            ))
            .unwrap();
            let PlanStep::Lookup { url, title } = &plan.steps[0] else { panic!("lookup expected") };
            assert_eq!((url.host(), url.to_graphrt_template().as_str()), (None, "{{#start.link#}}"), "{written}");
            assert_eq!(title, "Read the page");
        }
    }

    #[test]
    fn an_address_that_is_only_an_input_holding_a_name_is_sent_back() {
        let problem = normalized(
            r#"{"looks_up_the_web": true, "inputs": [{"name": "topic", "label": "Topic to look up", "long_text": false, "value": "Jakarta"}],
                "steps": [{"kind": "lookup", "title": "L", "instruction": "", "url": "{topic}"}]}"#,
        )
        .unwrap_err();
        assert!(problem.contains("not a link") && problem.contains("summary/{topic}"), "{problem}");
        let page = normalized(
            r#"{"looks_up_the_web": true, "inputs": [{"name": "source", "label": "Source", "long_text": false, "value": "https://example.org/a"}],
                "steps": [{"kind": "lookup", "title": "L", "instruction": "", "url": "{source}"}]}"#,
        );
        assert!(page.is_ok(), "{page:?}");
        // "Alamat email" is an address, not a link: llama3.2 "looked it up" in an Indonesian
        // sending job. The step is left out.
        let email = normalized(
            r#"{"looks_up_the_web": true, "inputs": [{"name": "alamat", "label": "Alamat email", "long_text": false, "value": ""}],
                "steps": [{"kind": "lookup", "title": "L", "instruction": "", "url": "{alamat}"},
                          {"kind": "write", "title": "W", "instruction": "Summarize.", "url": ""}]}"#,
        );
        let plan = email.unwrap_or_else(|problem| panic!("{problem}"));
        assert!(!plan.steps.iter().any(|step| matches!(step, PlanStep::Lookup { .. })), "{plan:?}");
    }

    /// Every object of `schema` requires all its properties and allows no others.
    fn assert_strict(schema: &serde_json::Value, path: &str) {
        if schema.get("type").and_then(serde_json::Value::as_str) == Some("object") {
            let properties = schema["properties"].as_object().unwrap_or_else(|| panic!("{path}: no properties"));
            let mut required: Vec<&str> =
                schema["required"].as_array().unwrap().iter().filter_map(serde_json::Value::as_str).collect();
            let mut names: Vec<&str> = properties.keys().map(String::as_str).collect();
            required.sort_unstable();
            names.sort_unstable();
            assert_eq!(required, names, "{path}");
            assert_eq!(schema["additionalProperties"], json!(false), "{path}");
            for (name, property) in properties {
                assert_strict(property, &format!("{path}.{name}"));
            }
        }
        if let Some(items) = schema.get("items") {
            assert_strict(items, &format!("{path}[]"));
        }
    }

    #[test]
    fn the_plan_schema_is_valid_for_openai_strict_mode() {
        let operations = [send_email_operation()];
        assert_strict(&schema(&task_rules(&[])), "plan");
        assert_strict(&schema(&task_rules(&operations)), "plan with operations");
    }

    #[test]
    fn a_lookup_address_loses_trailing_junk_and_reads_the_input_the_job_named() {
        // As gpt-4o-mini wrote it in a guided plan.
        let plan = normalized(
            r#"{"looks_up_the_web": true, "inputs": [{"name": "topic", "label": "Topic to look up", "long_text": false, "value": "Jakarta"}],
                "steps": [{"kind": "lookup", "title": "L", "instruction": "", "url": "https://en.wikipedia.org/api/rest_v1/page/summary/Jakarta},{"}]}"#,
        )
        .unwrap();
        let PlanStep::Lookup { url, .. } = &plan.steps[0] else { panic!("lookup expected") };
        assert_eq!(url.to_graphrt_template(), "https://en.wikipedia.org/api/rest_v1/page/summary/{{#start.topic#}}");

        let in_a_word = normalized(
            r#"{"looks_up_the_web": true, "inputs": [{"name": "city", "label": "City", "long_text": false, "value": "Jakarta"}],
                "steps": [{"kind": "lookup", "title": "L", "instruction": "", "url": "https://wttr.in/NotJakarta?q=Jakarta&format=3"}]}"#,
        )
        .unwrap();
        let PlanStep::Lookup { url, .. } = &in_a_word.steps[0] else { panic!("lookup expected") };
        assert_eq!(url.to_graphrt_template(), "https://wttr.in/NotJakarta?q={{#start.city#}}&format=3");

        let stray = normalized(
            r#"{"looks_up_the_web": true, "inputs": [],
                "steps": [{"kind": "lookup", "title": "L", "instruction": "", "url": "https://a.org/x}y"}]}"#,
        );
        assert!(stray.unwrap_err().contains("brace"));
    }

    #[test]
    fn a_plugin_named_like_the_pasted_material_is_not_read() {
        let mut recorder = list_messages_operation();
        recorder.kind = "meeting-notes.wait_for_meeting".into();
        recorder.sends = true;
        recorder.plugin = "meeting-notes".into();
        let operations = [recorder];
        let rules = task_rules(&operations);
        let raw = parse(
            r#"{"looks_up_the_web": false, "inputs": [{"name": "notes", "label": "Meeting notes", "long_text": true, "value": ""}],
                "steps": [{"kind": "use", "title": "Get the notes", "instruction": "", "url": "", "operation": "meeting-notes.wait_for_meeting"},
                          {"kind": "write", "title": "List action items", "instruction": "List the action items with owners.", "url": "", "operation": ""}]}"#,
        )
        .unwrap();

        let plan = normalize(raw, &rules).unwrap();

        assert_eq!(plan.steps.len(), 1, "{plan:?}");
        assert!(matches!(plan.steps[0], PlanStep::Write { .. }));
    }

    #[test]
    fn a_lookup_of_a_name_becomes_the_offered_plugin_step_that_reads_it() {
        let operations = [send_email_operation(), list_messages_operation()];
        let rules = task_rules(&operations);
        let raw = parse(
            r#"{"looks_up_the_web": true, "inputs": [{"name": "topic", "label": "Topic to look up", "long_text": false, "value": "Jakarta"}],
                "steps": [{"kind": "lookup", "title": "Get the summary", "instruction": "", "url": "{topic}"}]}"#,
        )
        .unwrap();

        let plan = normalize(raw, &rules).unwrap();

        let PlanStep::Use { operation, instruction, .. } = &plan.steps[0] else { panic!("use expected: {plan:?}") };
        assert_eq!(operation, &list_messages_operation().kind, "the one that only reads");
        assert!(instruction.contains("{topic}"), "{instruction}");
        assert!(matches!(plan.steps.last(), Some(PlanStep::Write { .. })), "what it read is written up");
    }

    #[test]
    fn a_plan_that_ends_on_a_lookup_gets_a_writing_step() {
        let plan = normalized(
            r#"{"looks_up_the_web": true, "summary": "Tells the weather.",
                "steps": [{"kind": "lookup", "title": "L", "instruction": "", "url": "https://wttr.in/Jakarta"}]}"#,
        )
        .unwrap();
        assert_eq!(plan.steps.len(), 2);
        assert_eq!(plan.steps[1], write_step("Write the result", "Using what was found, do this: Tells the weather."));
    }

    #[test]
    fn lookups_are_dropped_when_the_job_does_not_read_the_web() {
        let plan = normalized(
            r#"{"looks_up_the_web": false,
                "steps": [{"kind": "write", "title": "Write", "instruction": "Write it."},
                          {"kind": "lookup", "title": "Check grammar", "instruction": "x", "url": "https://www.example.com/g"}]}"#,
        )
        .unwrap();
        assert_eq!(plan.steps, [write_step("Write", "Write it.")]);
    }

    #[test]
    fn addresses_without_an_obvious_fix_are_reported_in_plain_words() {
        let with_url = |url: &str| {
            normalized(&format!(
                r#"{{"looks_up_the_web": true, "steps": [{{"kind": "lookup", "title": "L", "instruction": "", "url": "{url}"}}]}}"#
            ))
        };
        assert!(with_url("https://{site}/page").unwrap_err().contains("real site"));
        assert!(with_url("ftp://files.example.org/a").unwrap_err().contains("https address"));
        assert!(with_url("https://api.weather.com/v1?appid=YOUR_API_KEY").unwrap_err().contains("needs a key"));
        assert!(with_url("https://a.org/x y").unwrap_err().contains("spaces"));
    }

    #[test]
    fn a_plan_without_usable_steps_is_reported() {
        assert!(normalized(r#"{"steps": []}"#).unwrap_err().contains("no step"));
        assert!(normalized(r#"{"steps": [{"kind": "write", "title": "", "instruction": " "}]}"#).is_err());
        assert!(normalized(r#"{"steps": [{"kind": "approve", "title": "Ask", "instruction": "OK?"}]}"#).is_err());
    }

    #[test]
    fn a_chatbot_reads_only_the_message_and_never_asks() {
        let message = PlanInput { long_text: true, ..input("message", "Customer message") };
        let rules = PlanRules {
            fixed_input: Some(&message),
            operations: NO_OPERATIONS,
            allows_approvals: false,
            link_given: false,
        };
        let raw = parse(
            r#"{"looks_up_the_web": true, "inputs": [{"name": "question", "label": "Q", "long_text": false}],
                "steps": [{"kind": "lookup", "title": "L", "instruction": "", "url": "https://wttr.in/{city}"},
                          {"kind": "approve", "title": "Ask", "instruction": "Send?"},
                          {"kind": "write", "title": "Reply", "instruction": "Answer."}]}"#,
        )
        .unwrap();
        let plan = normalize(raw, &rules).unwrap();
        assert_eq!(plan.inputs, std::slice::from_ref(&message));
        assert_eq!(plan.steps.len(), 2, "the approval is left out: {:?}", plan.steps);
        let PlanStep::Lookup { url, .. } = &plan.steps[0] else { panic!("lookup expected") };
        assert_eq!(url.to_graphrt_template(), "https://wttr.in/{{#start.message#}}");

        let sends = [send_email_operation()];
        let rules =
            PlanRules { fixed_input: Some(&message), operations: &sends, allows_approvals: false, link_given: false };
        let raw = parse(r#"{"steps": [{"kind": "use", "title": "Send", "instruction": "Send it", "operation": "email.send_email"}]}"#).unwrap();
        assert!(normalize(raw, &rules).unwrap_err().contains("cannot ask the person first"));
    }

    #[test]
    fn approvals_are_kept_once_and_get_a_question() {
        let plan = normalized(
            r#"{"steps": [{"kind": "write", "title": "Draft", "instruction": "Draft it."},
                          {"kind": "approve", "title": "", "instruction": ""},
                          {"kind": "approve", "title": "Again", "instruction": "Sure?"},
                          {"kind": "write", "title": "Finish", "instruction": "Finish it."}]}"#,
        )
        .unwrap();
        assert_eq!(plan.steps.len(), 3);
        assert_eq!(
            plan.steps[1],
            PlanStep::Approve { title: "Ask before continuing".into(), question: "Continue?".into() }
        );
    }

    #[test]
    fn a_plugin_step_must_name_an_offered_operation() {
        let operations = [send_email_operation()];
        let plan = normalize(
            parse(
                r#"{"steps": [{"kind": "write", "title": "Write the note", "instruction": "Write it."},
                              {"kind": "use", "title": "", "instruction": "Send the note", "operation": "EMAIL.send_email"},
                              {"kind": "use", "title": "Post it", "instruction": "Post the note", "operation": "slack.post_message"}]}"#,
            )
            .unwrap(),
            &task_rules(&operations),
        )
        .unwrap();
        assert_eq!(
            plan.steps[1],
            PlanStep::Use {
                title: "Send email".into(),
                instruction: "Send the note".into(),
                operation: "email.send_email".into(),
                fields: BTreeMap::new()
            }
        );
        // An operation nobody offered is not invented: what is left is a writing step.
        assert_eq!(plan.steps[2], write_step("Post it", "Post the note"));
    }

    #[test]
    fn data_a_plugin_read_is_written_up_for_the_person() {
        let operations = [list_messages_operation()];
        let plan = normalize(
            parse(r#"{"summary": "Lists new mail.", "steps": [{"kind": "use", "title": "Get mail", "instruction": "List unread mail", "operation": "email.list_messages"}]}"#).unwrap(),
            &task_rules(&operations),
        )
        .unwrap();
        assert_eq!(plan.steps.len(), 2);
        assert!(
            matches!(&plan.steps[1], PlanStep::Write { instruction, .. } if instruction.contains("Lists new mail."))
        );
    }

    #[test]
    fn schedules_are_read_and_kept_sane() {
        let with_schedule = |schedule: &str| {
            normalized(&format!(
                r#"{{"steps": [{{"kind": "write", "title": "T", "instruction": "I"}}], "schedule": {schedule}}}"#
            ))
            .unwrap()
            .schedule
        };
        assert_eq!(with_schedule(r#"{"repeat": "never", "hour": 9}"#), None);
        assert_eq!(
            with_schedule(r#"{"repeat": "daily", "hour": 7}"#),
            Some(Schedule { repeat: Repeat::Daily, hour: 7 })
        );
        assert_eq!(
            with_schedule(r#"{"repeat": "Weekdays", "hour": 99}"#),
            Some(Schedule { repeat: Repeat::Weekdays, hour: 8 })
        );
        assert_eq!(with_schedule(r#"{"repeat": "sometimes", "hour": 9}"#), None);
        assert_eq!(Schedule { repeat: Repeat::Weekdays, hour: 7 }.cron_expression(), "0 0 7 * * Mon-Fri");
        assert_eq!(Schedule { repeat: Repeat::Hourly, hour: 7 }.cron_expression(), "0 0 * * * *");
        assert_eq!(Schedule { repeat: Repeat::Weekly, hour: 9 }.in_words(), "every Monday at 09:00");
        for repeat in [Repeat::Hourly, Repeat::Daily, Repeat::Weekdays, Repeat::Weekly] {
            let cron = Schedule { repeat, hour: 8 }.cron_expression();
            crate::scheduler::next_fire_after(&cron, "Asia/Jakarta", chrono::Utc::now())
                .unwrap_or_else(|error| panic!("{cron}: {error}"));
        }
    }

    fn sending_plan() -> Plan {
        Plan {
            summary: String::new(),
            name: String::new(),
            inputs: vec![input("address", "Email address")],
            steps: vec![
                write_step("Write the note", "Write it."),
                PlanStep::Approve { title: "Ask".into(), question: "OK?".into() },
                PlanStep::Use {
                    title: "Send".into(),
                    instruction: "Send it".into(),
                    operation: "email.send_email".into(),
                    fields: BTreeMap::new(),
                },
            ],
            schedule: None,
            job_words: Default::default(),
        }
    }

    #[test]
    fn plugin_fields_keep_their_types_and_only_the_operations_own_fields() {
        let fields = normalize_fields(
            &send_email_operation(),
            r#"{"to": "{{address}}", "subject": " Thank you ", "text": "Hello,\n{step_1}", "bcc": "boss@example.com", "html": ""}"#,
            &sending_plan(),
            2,
        )
        .unwrap();
        assert_eq!(fields.keys().map(String::as_str).collect::<Vec<_>>(), ["subject", "text", "to"]);
        assert_eq!(fields["to"], json!("{address}"));
        assert_eq!(fields["subject"], json!("Thank you"));
        assert_eq!(fields["text"], json!("Hello,\n{step_1}"));

        let typed = normalize_fields(
            &list_messages_operation(),
            r#"{"limit": "5", "unseen_only": "true"}"#,
            &sending_plan(),
            0,
        )
        .unwrap();
        assert_eq!((&typed["limit"], &typed["unseen_only"]), (&json!(5), &json!(true)));
        let untyped =
            normalize_fields(&list_messages_operation(), r#"{"limit": "many", "unseen_only": 1}"#, &sending_plan(), 0)
                .unwrap();
        assert!(untyped.is_empty(), "values of the wrong type are left out: {untyped:?}");
    }

    #[test]
    fn placeholders_in_fields_name_an_input_or_an_earlier_result() {
        let text_of = |written: &str| {
            let reply = serde_json::to_string(&json!({"to": "{address}", "subject": "S", "text": written})).unwrap();
            normalize_fields(&send_email_operation(), &reply, &sending_plan(), 2).unwrap()["text"].clone()
        };
        // The approval at step 2 has no result, a later step is not there yet: the one earlier result is meant.
        assert_eq!(text_of("{result}"), json!("{step_1}"));
        assert_eq!(text_of("{step_2} and {step 3} and {step1}"), json!("{step_1} and {step_1} and {step_1}"));
        assert_eq!(text_of("{{#start.Address#}}: {note}"), json!("{address}: {step_1}"));

        let plan = sending_plan();
        let parts = field_parts("Hi {address}, {step_1} {step_9}", &plan);
        assert_eq!(
            parts,
            [
                FieldPart::Text("Hi "),
                FieldPart::Input("address"),
                FieldPart::Text(", "),
                FieldPart::StepResult(0),
                FieldPart::Text(" "),
                FieldPart::Text("step_9")
            ]
        );
    }

    #[test]
    fn the_recipient_and_the_sent_text_of_a_sending_step_are_the_apps_choice() {
        // As llama3.2 filled it in the app: an invented address, a step's text as the
        // recipient, and no message at all.
        let fields = normalize_fields(
            &send_email_operation(),
            r#"{"subject": "Order Confirmation", "to": "{step_1}, Sari W <sari@example.com}"}"#,
            &sending_plan(),
            2,
        )
        .unwrap();
        assert_eq!(fields["to"], json!("{address}"));
        assert_eq!(fields["text"], json!("{step_1}"));
        let copied = normalize_fields(
            &send_email_operation(),
            r#"{"subject": "S", "to": "{address}", "cc": "{address}", "text": "{step_1}"}"#,
            &sending_plan(),
            2,
        )
        .unwrap();
        assert!(!copied.contains_key("cc"), "{copied:?}");
        let mut with_html = send_email_operation();
        with_html.fields.push(OperationField {
            name: "html".into(),
            description: String::new(),
            required: false,
            field_type: FieldType::Text,
        });
        let both = normalize_fields(
            &with_html,
            r#"{"subject": "S", "to": "{address}", "text": "{step_1}", "html": "{step_1}"}"#,
            &sending_plan(),
            2,
        )
        .unwrap();
        assert!(!both.contains_key("html"), "{both:?}");

        let fixed_words = normalize_fields(
            &send_email_operation(),
            r#"{"subject": "S", "to": "budi@example.test", "text": "Thank you!"}"#,
            &sending_plan(),
            2,
        )
        .unwrap();
        assert_eq!((&fixed_words["to"], &fixed_words["text"]), (&json!("{address}"), &json!("{step_1}")));
        let two_lines = normalize_fields(
            &send_email_operation(),
            r#"{"subject": "Ringkasan\nrapat", "to": "{address}"}"#,
            &sending_plan(),
            2,
        )
        .unwrap();
        assert_eq!(two_lines["subject"], json!("Ringkasan rapat"));

        let mut no_address_input = sending_plan();
        no_address_input.inputs = vec![input("notes", "Meeting notes")];
        let problem =
            normalize_fields(&send_email_operation(), r#"{"subject": "S", "to": "a@b.test"}"#, &no_address_input, 2)
                .unwrap_err();
        assert!(problem.contains("\"to\" is required"), "{problem}");
    }

    #[test]
    fn a_missing_required_field_is_reported_with_its_description() {
        let mut no_address_input = sending_plan();
        no_address_input.inputs = vec![input("notes", "Notes")];
        let problem =
            normalize_fields(&send_email_operation(), r#"{"subject": "Hi", "to": " "}"#, &no_address_input, 2)
                .unwrap_err();
        assert!(problem.contains("\"to\" is required") && problem.contains("Recipients"), "{problem}");
        assert!(normalize_fields(&send_email_operation(), "not json", &sending_plan(), 2).is_err());
    }

    #[test]
    fn a_plan_survives_being_saved_and_read_back() {
        let mut plan = sending_plan();
        plan.schedule = Some(Schedule::daily());
        plan.inputs[0].value = "team@example.com".into();
        if let PlanStep::Use { fields, .. } = &mut plan.steps[2] {
            fields.insert("to".into(), json!("{address}"));
        }
        let saved = serde_json::to_string(&plan).unwrap();
        assert_eq!(serde_json::from_str::<Plan>(&saved).unwrap(), plan);
    }
}
