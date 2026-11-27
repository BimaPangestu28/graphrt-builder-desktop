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

use crate::plugins::operations::{FieldType, OfferedOperation};

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
            Self::Write { title, .. } | Self::Lookup { title, .. } | Self::Approve { title, .. } | Self::Use { title, .. } => {
                title
            }
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
}

/// The JSON schema the model's answer must follow. `operations` are the plugin operations
/// offered for this job; without any, the plan has no `use` step.
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
                    "required": ["name", "label", "long_text", "value"]
                }
            },
            "steps": {
                "type": "array",
                "minItems": 1,
                "maxItems": MAX_STEPS,
                "items": { "type": "object", "properties": step_properties, "required": required_in_step }
            },
            "schedule": {
                "type": "object",
                "properties": {
                    "repeat": { "type": "string", "enum": ["never", "hourly", "daily", "weekdays", "weekly"] },
                    "hour": { "type": "integer" }
                },
                "required": ["repeat", "hour"]
            }
        },
        "required": ["looks_up_the_web", "summary", "name", "inputs", "steps", "schedule"]
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
        if let (true, Some(operation)) = (kind == "use", operation) {
            if operation.sends && !rules.allows_approvals {
                return Err(format!(
                    "`{}` sends something, and this agent cannot ask the person first; leave that step out",
                    operation.kind
                ));
            }
            let title = if title.is_empty() { operation.title.clone() } else { title };
            let instruction = if instruction.is_empty() { operation.title.clone() } else { instruction };
            steps.push(PlanStep::Use { title, instruction, operation: operation.kind.clone(), fields: BTreeMap::new() });
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
    while matches!(steps.last(), Some(PlanStep::Approve { .. })) && steps.len() > 1 && !steps.iter().any(PlanStep::has_result) {
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
    Ok(Plan { summary, name: plain_text(&raw.name), inputs, steps, schedule: schedule(&raw.schedule) })
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
        match value {
            Some(value) => {
                fields.insert(field.name.clone(), value);
            }
            None if field.required => {
                let hint = if field.description.is_empty() { String::new() } else { format!(" ({})", field.description) };
                return Err(format!("the field \"{}\" is required{hint}; give it a value", field.name));
            }
            None => {}
        }
    }
    Ok(fields)
}

/// `value` as the field's type, or `None` when it is empty or not that type.
fn typed_value(value: &serde_json::Value, field_type: FieldType, plan: &Plan, step_index: usize) -> Option<serde_json::Value> {
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
    let without_scheme = single_braces.strip_prefix("https://").or_else(|| single_braces.strip_prefix("http://"));
    if let [UrlPart::Placeholder(written_name)] = placeholder_parts(without_scheme.unwrap_or(&single_braces)).as_slice() {
        let name = resolve_placeholder(written_name, inputs, inputs_are_fixed)?;
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
            UrlPart::Text(text) => template.push_str(text),
            UrlPart::Placeholder(written_name) => {
                let name = resolve_placeholder(written_name, inputs, inputs_are_fixed)?;
                template.push_str(&format!("{{{name}}}"));
            }
        }
    }
    Ok(LookupUrl { template, host: Some(host) })
}

fn resolve_placeholder(written_name: &str, inputs: &mut Vec<PlanInput>, inputs_are_fixed: bool) -> Result<String, String> {
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
    inputs.push(PlanInput { label: label_from_name(&name), name: name.clone(), long_text: false, value: String::new() });
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

