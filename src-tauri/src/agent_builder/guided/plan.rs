//! The plan a local model fills in, and the app's own repairs of it.
//!
//! The model answers a small JSON schema (the provider constrains the output to it), so
//! the reply always parses. What a small model still gets wrong is content: a name with
//! spaces, `{{topic}}` instead of `{topic}`, an address that uses an input it never
//! declared, a plan that ends on a lookup. [`normalize`] repairs everything that has one
//! obvious fix and reports the rest as a short sentence for the model.

use serde::Deserialize;
use serde_json::json;

/// Most steps kept from a plan; a guided agent is a short job.
pub(super) const MAX_STEPS: usize = 5;
/// Most inputs kept from a plan.
const MAX_INPUTS: usize = 5;
/// Longest input name kept.
const MAX_INPUT_NAME_CHARS: usize = 32;

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
}

#[derive(Debug, Default, Deserialize)]
struct RawInput {
    #[serde(default)]
    name: String,
    #[serde(default)]
    label: String,
    #[serde(default)]
    long_text: bool,
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
}

/// A checked plan: every name is a valid id and every address only reads declared inputs.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(super) struct Plan {
    /// One plain sentence about the agent; may be empty.
    pub summary: String,
    /// The agent's display name; may be empty (the builder then derives one).
    pub name: String,
    pub inputs: Vec<PlanInput>,
    /// At least one step, and the last one writes.
    pub steps: Vec<PlanStep>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(super) struct PlanInput {
    /// A graphrt variable name: lowercase letters, digits and `_`.
    pub name: String,
    pub label: String,
    pub long_text: bool,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(super) enum PlanStep {
    /// A model step: `instruction` says what to produce.
    Write { title: String, instruction: String },
    /// A read-only lookup of a public address.
    Lookup { title: String, url: LookupUrl },
}

/// An `https` address whose host is written out; `{name}` parts read inputs.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(super) struct LookupUrl {
    /// The address with `{name}` placeholders, e.g. `https://host/page/{topic}`.
    template: String,
    host: String,
}

impl LookupUrl {
    pub(super) fn host(&self) -> &str {
        &self.host
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

/// The JSON schema the model's answer must follow.
pub(super) fn schema() -> serde_json::Value {
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
                        "long_text": { "type": "boolean" }
                    },
                    "required": ["name", "label", "long_text"]
                }
            },
            "steps": {
                "type": "array",
                "minItems": 1,
                "maxItems": MAX_STEPS,
                "items": {
                    "type": "object",
                    "properties": {
                        "kind": { "type": "string", "enum": ["write", "lookup"] },
                        "title": { "type": "string" },
                        "instruction": { "type": "string" },
                        "url": { "type": "string" }
                    },
                    "required": ["kind", "title", "instruction", "url"]
                }
            }
        },
        "required": ["looks_up_the_web", "summary", "name", "inputs", "steps"]
    })
}

/// Reads the model's answer. Text around the JSON object (a code fence, a sentence) is ignored.
///
/// # Errors
/// A sentence for the model when the answer holds no JSON object.
pub(super) fn parse(reply: &str) -> Result<RawPlan, String> {
    let object = match (reply.find('{'), reply.rfind('}')) {
        (Some(start), Some(end)) if start < end => &reply[start..=end],
        _ => return Err("the reply was not a JSON object".to_owned()),
    };
    serde_json::from_str(object).map_err(|error| format!("the reply was not valid JSON ({error})"))
}

/// Checks and repairs a raw plan.
///
/// `must_have_input` names an input the agent needs whatever the model wrote (a chatbot's
/// `message`). Lookup steps are dropped when the plan says the job does not read the web:
/// small models add them to plain writing jobs.
///
/// # Errors
/// One sentence for the model when something has no obvious fix: no usable step, or an
/// address that is not a public `https` address.
pub(super) fn normalize(raw: RawPlan, must_have_input: Option<&PlanInput>) -> Result<Plan, String> {
    let mut inputs: Vec<PlanInput> = Vec::new();
    if let Some(required) = must_have_input {
        inputs.push(required.clone());
    }
    for raw_input in raw.inputs.into_iter().take(MAX_INPUTS) {
        // A chatbot reads only the customer's message.
        if must_have_input.is_some() {
            break;
        }
        let Some(name) = input_name(&raw_input.name).or_else(|| input_name(&raw_input.label)) else { continue };
        if inputs.iter().any(|input| input.name == name) {
            continue;
        }
        let label = plain_text(&raw_input.label);
        let label = if label.is_empty() { label_from_name(&name) } else { label };
        inputs.push(PlanInput { name, label, long_text: raw_input.long_text });
    }

    let mut steps: Vec<PlanStep> = Vec::new();
    for raw_step in raw.steps.into_iter().take(MAX_STEPS) {
        let title = plain_text(&raw_step.title);
        let instruction = plain_text(&raw_step.instruction);
        let is_lookup = raw_step.kind.trim().eq_ignore_ascii_case("lookup") && !raw_step.url.trim().is_empty();
        if is_lookup {
            if !raw.looks_up_the_web {
                continue;
            }
            let url = lookup_url(&raw_step.url, &mut inputs, must_have_input.is_some())?;
            let title = if title.is_empty() { format!("Look up on {}", url.host()) } else { title };
            steps.push(PlanStep::Lookup { title, url });
            continue;
        }
        let instruction = if instruction.is_empty() { title.clone() } else { instruction };
        if instruction.is_empty() {
            continue;
        }
        let title = if title.is_empty() { "Write the result".to_owned() } else { title };
        steps.push(PlanStep::Write { title, instruction });
    }
    if steps.is_empty() {
        return Err("the plan has no step with an instruction; give at least one \"write\" step".to_owned());
    }
    let summary = plain_text(&raw.summary);
    if matches!(steps.last(), Some(PlanStep::Lookup { .. })) {
        let instruction = if summary.is_empty() {
            "Write the result the person asked for from what was looked up, in a few clear sentences.".to_owned()
        } else {
            format!("Using what was looked up, do this: {summary}")
        };
        steps.push(PlanStep::Write { title: "Write the result".to_owned(), instruction });
    }
    Ok(Plan { summary, name: plain_text(&raw.name), inputs, steps })
}

/// Checks a lookup address and makes its placeholders name declared inputs.
///
/// A placeholder that names no input becomes the only input when there is exactly one,
/// and otherwise a new input (unless `inputs_are_fixed`, as for a chatbot, where it
/// becomes the first input).
fn lookup_url(raw_url: &str, inputs: &mut Vec<PlanInput>, inputs_are_fixed: bool) -> Result<LookupUrl, String> {
    let trimmed = raw_url.trim().trim_matches(|character| matches!(character, '"' | '\'' | '`' | '<' | '>'));
    // `{{topic}}` and `{{#start.topic#}}` mean `{topic}`.
    let single_braces = trimmed.replace("{{#start.", "{").replace("#}}", "}").replace("{{", "{").replace("}}", "}");
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
    Ok(LookupUrl { template, host })
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
    inputs.push(PlanInput { label: label_from_name(&name), name: name.clone(), long_text: false });
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

    fn normalized(json_text: &str) -> Result<Plan, String> {
        normalize(parse(json_text)?, None)
    }

    fn write_step(title: &str, instruction: &str) -> PlanStep {
        PlanStep::Write { title: title.into(), instruction: instruction.into() }
    }

    #[test]
    fn a_tidy_plan_is_kept_as_written() {
        let plan = normalized(
            r#"{"looks_up_the_web": false, "summary": "Writes a polite reply.", "name": "Complaint Reply",
                "inputs": [{"name": "complaint", "label": "The complaint", "long_text": true}],
                "steps": [{"kind": "write", "title": "Write the reply", "instruction": "Write a polite reply.", "url": ""}]}"#,
        )
        .unwrap();
        assert_eq!(plan.name, "Complaint Reply");
        assert_eq!(plan.summary, "Writes a polite reply.");
        assert_eq!(plan.inputs, [PlanInput { name: "complaint".into(), label: "The complaint".into(), long_text: true }]);
        assert_eq!(plan.steps, [write_step("Write the reply", "Write a polite reply.")]);
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
                           {"name": "start", "label": "Reserved", "long_text": false},
                           {"name": "???", "label": "", "long_text": false}],
                "steps": [{"kind": "write", "title": "T", "instruction": "I"}]}"#,
        )
        .unwrap();
        let names: Vec<&str> = plan.inputs.iter().map(|input| input.name.as_str()).collect();
        assert_eq!(names, ["product_description", "input_2nd", "start_text"]);
        assert_eq!(plan.inputs[0].label, "Product description");
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
        assert_eq!(url.host(), "en.wikipedia.org");
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
        assert_eq!(no_input.inputs, [PlanInput { name: "place".into(), label: "Place".into(), long_text: false }]);
    }

    #[test]
    fn a_plan_that_ends_on_a_lookup_gets_a_writing_step() {
        let plan = normalized(
            r#"{"looks_up_the_web": true, "summary": "Tells the weather.",
                "steps": [{"kind": "lookup", "title": "L", "instruction": "", "url": "https://wttr.in/Jakarta"}]}"#,
        )
        .unwrap();
        assert_eq!(plan.steps.len(), 2);
        assert_eq!(plan.steps[1], write_step("Write the result", "Using what was looked up, do this: Tells the weather."));
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
    }

    #[test]
    fn a_chatbot_reads_only_the_message() {
        let message = PlanInput { name: "message".into(), label: "Customer message".into(), long_text: true };
        let raw = parse(
            r#"{"looks_up_the_web": true, "inputs": [{"name": "question", "label": "Q", "long_text": false}],
                "steps": [{"kind": "lookup", "title": "L", "instruction": "", "url": "https://wttr.in/{city}"},
                          {"kind": "write", "title": "Reply", "instruction": "Answer."}]}"#,
        )
        .unwrap();
        let plan = normalize(raw, Some(&message)).unwrap();
        assert_eq!(plan.inputs, [message]);
        let PlanStep::Lookup { url, .. } = &plan.steps[0] else { panic!("lookup expected") };
        assert_eq!(url.to_graphrt_template(), "https://wttr.in/{{#start.message#}}");
    }
}
