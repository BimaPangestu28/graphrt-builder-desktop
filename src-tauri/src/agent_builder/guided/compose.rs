//! Turns a checked [`Plan`] into a graphrt workflow document, and back.
//!
//! Everything the app knows better than the drafting model is written here and never
//! asked for: the model each step runs on, the node ids, the references between steps,
//! the edges, the outputs, and the question the person is asked before anything is sent.
//! A plan that passed [`super::plan::normalize`] therefore always gives a document that
//! compiles.
//!
//! The plan is saved as the document's first line (a YAML comment), so a later change in
//! the builder chat can edit the plan instead of the YAML ([`plan_of_document`]).

use std::collections::BTreeMap;

use serde::Serialize;

use super::plan::{field_parts, FieldPart, Plan, PlanInput, PlanStep};
use crate::credentials::ModelChoice;
use crate::plugins::operations::sends;
use crate::storage::models::AgentKind;

/// Characters of looked-up or plugin data handed to the next step. A local model reads
/// about 4,000 tokens in all, so a whole page would push the instructions out.
const MAX_MATERIAL_CHARS: usize = 6000;

/// Seconds a lookup may take.
const LOOKUP_READ_TIMEOUT_SECONDS: u32 = 30;

/// Start of the comment line that carries the plan.
const PLAN_COMMENT_PREFIX: &str = "# guided-plan: ";

/// The action that lets a run continue past a question.
const APPROVE_ACTION: &str = "approve";

const WRITER_ROLE: &str = "You do one step of a job for a business person. Do exactly what the task says, using \
the material given. Reply with only the result, ready to use: no introduction, no explanation of what you did.";

/// The outputs the app reads to hand a chat to the owner (`conversations::bot`).
const HANDOFF: &str = "handoff";
const HANDOFF_REASON: &str = "handoff_reason";

/// The language sentence is the one the chatbot guide asks for, word for word: shorter
/// wordings ("in the customer's language") made gpt-4o-mini answer English in Spanish.
const CHATBOT_ROLE: &str = "You answer a customer's chat message for a business. Answer exactly what the customer's \
message asks, using the business's own facts. Do what the task says. Reply with only the message to send to the customer. Write your reply in the same language as the customer's \
message: English if they write English, Indonesian if they write Indonesian, and so on.";

/// How a chatbot's steps read the customer's message.
const CHATBOT_MESSAGE_REFERENCE: &str = "{{#start.message#}}";

/// The input every chatbot has: the customer's message.
pub(super) fn chatbot_message_input() -> PlanInput {
    PlanInput {
        name: "message".to_owned(),
        label: "Customer message".to_owned(),
        long_text: true,
        value: String::new(),
    }
}

#[derive(Serialize)]
struct Document {
    version: &'static str,
    name: String,
    #[serde(skip_serializing_if = "String::is_empty")]
    description: String,
    graph: Graph,
}

#[derive(Serialize)]
struct Graph {
    nodes: Vec<Node>,
    edges: Vec<Edge>,
}

#[derive(Serialize)]
struct Edge {
    source: String,
    target: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    handle: Option<&'static str>,
}

#[derive(Serialize)]
struct Node {
    id: String,
    #[serde(rename = "type")]
    node_type: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    title: Option<String>,
    #[serde(flatten)]
    config: NodeConfig,
}

#[derive(Serialize)]
#[serde(untagged)]
enum NodeConfig {
    Start { variables: Vec<StartVariable> },
    Lookup { method: &'static str, url: String, timeout: LookupTimeout },
    Shorten { template: String, variables: Vec<TemplateVariable> },
    Write { model: Model, prompt_template: Vec<PromptMessage> },
    Ask { prompt: String, actions: Vec<AskAction> },
    Plugin(BTreeMap<String, serde_json::Value>),
    Answer { answer: String },
    End { outputs: Vec<EndOutput> },
}

#[derive(Serialize)]
struct StartVariable {
    variable: String,
    #[serde(rename = "type")]
    input_type: &'static str,
    required: bool,
    label: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    default: Option<String>,
}

#[derive(Serialize)]
struct LookupTimeout {
    connect: u32,
    read: u32,
}

#[derive(Serialize)]
struct TemplateVariable {
    variable: &'static str,
    value_selector: [String; 2],
}

#[derive(Serialize)]
struct Model {
    provider: String,
    name: String,
    completion_params: CompletionParams,
}

#[derive(Serialize)]
struct CompletionParams {
    temperature: f64,
}

#[derive(Serialize)]
struct PromptMessage {
    role: &'static str,
    text: String,
}

#[derive(Serialize)]
struct AskAction {
    id: &'static str,
    title: &'static str,
}

#[derive(Serialize)]
struct EndOutput {
    variable: &'static str,
    value_selector: [String; 2],
}

/// What an earlier step left for the later ones: a heading and the reference to its result.
struct Material {
    heading: String,
    reference: String,
}

/// Where the result of each plan step can be read, by step index.
#[derive(Default)]
struct StepResults {
    /// `[node id, output]` per step; `None` for a step without a result.
    selectors: Vec<Option<[String; 2]>>,
}

impl StepResults {
    fn reference(&self, step_index: usize) -> Option<String> {
        let [node, output] = self.selectors.get(step_index)?.as_ref()?;
        Some(format!("{{{{#{node}.{output}#}}}}"))
    }

    fn latest(&self) -> Option<String> {
        (0..self.selectors.len()).rev().find_map(|index| self.reference(index))
    }
}

/// The model every writing step of a document runs on.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(super) struct StepModel {
    /// graphrt `model.provider`, e.g. `ollama`.
    pub provider: String,
    pub name: String,
}

impl From<&ModelChoice> for StepModel {
    fn from(choice: &ModelChoice) -> Self {
        Self { provider: choice.provider.registry_name().to_owned(), name: choice.name.clone() }
    }
}

/// Builds the node list of a plan, one step at a time.
struct Builder<'a> {
    plan: &'a Plan,
    model: &'a StepModel,
    is_chatbot: bool,
    sending_operations: Vec<&'a str>,
    nodes: Vec<Node>,
    materials: Vec<Material>,
    results: StepResults,
    last_write_id: Option<String>,
}

/// The workflow document of `plan`, with every model step on `model`.
///
/// A `Chatbot` replies through an `answer` node; other kinds end on the last result. The
/// person is asked before every plugin step that sends or changes something and before
/// reading an address that is itself an input.
///
/// # Errors
/// `Err` with the serializer's message when the document cannot be written as YAML
/// (not expected for a checked plan).
pub(super) fn workflow_yaml(plan: &Plan, model: &StepModel, kind: AgentKind) -> Result<String, String> {
    let sending_operations: Vec<&str> = plan
        .steps
        .iter()
        .filter_map(|step| match step {
            PlanStep::Use { operation, .. } if sends(operation) => Some(operation.as_str()),
            _ => None,
        })
        .collect();
    let mut builder = Builder {
        plan,
        model,
        is_chatbot: kind == AgentKind::Chatbot,
        sending_operations,
        nodes: vec![Node {
            id: "start".to_owned(),
            node_type: "start".to_owned(),
            title: None,
            config: NodeConfig::Start { variables: plan.inputs.iter().map(start_variable).collect() },
        }],
        materials: plan
            .inputs
            .iter()
            .map(|input| Material {
                heading: input.label.clone(),
                reference: format!("{{{{#start.{}#}}}}", input.name),
            })
            .collect(),
        results: StepResults::default(),
        last_write_id: None,
    };
    for (index, step) in plan.steps.iter().enumerate() {
        builder.add_step(index, step);
    }
    let document = builder.finish();
    let yaml = serde_saphyr::to_string(&document).map_err(|error| error.to_string())?;
    let plan_json = serde_json::to_string(plan).map_err(|error| error.to_string())?;
    Ok(format!("{PLAN_COMMENT_PREFIX}{plan_json}\n{yaml}"))
}

impl Builder<'_> {
    fn add_step(&mut self, index: usize, step: &PlanStep) {
        let number = index + 1;
        let mut result = None;
        match step {
            PlanStep::Lookup { title, url } => {
                let lookup_id = format!("lookup_{number}");
                let shorten_id = format!("shorten_{number}");
                if url.host().is_none() {
                    // The address is whatever the person typed: ask before reading it.
                    let prompt = format!("Read this address?\n\n{}", url.to_graphrt_template());
                    self.ask(format!("confirm_{number}"), "Ask before reading the address".to_owned(), prompt);
                }
                self.nodes.push(Node {
                    id: lookup_id.clone(),
                    node_type: "http-request".to_owned(),
                    title: Some(title.clone()),
                    config: NodeConfig::Lookup {
                        method: "get",
                        url: url.to_graphrt_template(),
                        timeout: LookupTimeout { connect: 10, read: LOOKUP_READ_TIMEOUT_SECONDS },
                    },
                });
                // `text` is the page without markup; the first part of it has to be enough.
                self.shorten(
                    &shorten_id,
                    "Keep the first part of what was found",
                    "page",
                    [lookup_id, "text".to_owned()],
                );
                let heading = match url.host() {
                    Some(host) => format!("{title} (found on {host})"),
                    None => title.clone(),
                };
                self.materials.push(Material { heading, reference: format!("{{{{#{shorten_id}.output#}}}}") });
                result = Some([shorten_id, "output".to_owned()]);
            }
            PlanStep::Write { title, instruction } => {
                // A chatbot sends one reply: its writing steps are notes for that one reply, the
                // last step. llama3.2 planned a step per topic ("Answer: We open at 8", "Answer:
                // brownies 50k, cheesecake 120k"); the last one was the reply, so asked about the
                // cheesecake the bot answered with the brownies' price.
                if self.is_chatbot && Some(index) != self.last_write_index() {
                    self.results.selectors.push(None);
                    return;
                }
                let write_id = format!("write_{number}");
                let role = if self.is_chatbot { CHATBOT_ROLE } else { WRITER_ROLE };
                let request = if self.is_chatbot {
                    chatbot_request(&self.reply_notes(), &self.plan.job, &self.materials)
                } else {
                    writer_request(instruction, &self.plan.job, &self.materials)
                };
                self.nodes.push(Node {
                    id: write_id.clone(),
                    node_type: "llm".to_owned(),
                    title: Some(title.clone()),
                    config: NodeConfig::Write {
                        model: Model {
                            provider: self.model.provider.clone(),
                            name: self.model.name.clone(),
                            completion_params: CompletionParams { temperature: 0.3 },
                        },
                        prompt_template: vec![
                            PromptMessage { role: "system", text: role.to_owned() },
                            PromptMessage { role: "user", text: request },
                        ],
                    },
                });
                self.materials
                    .push(Material { heading: title.clone(), reference: format!("{{{{#{write_id}.text#}}}}") });
                self.last_write_id = Some(write_id.clone());
                result = Some([write_id, "text".to_owned()]);
            }
            PlanStep::Approve { title, question } => {
                let prompt = match self.results.latest() {
                    Some(latest) => format!("{question}\n\n{latest}"),
                    None => question.clone(),
                };
                self.ask(format!("approve_{number}"), title.clone(), prompt);
            }
            PlanStep::Use { title, operation, fields, .. } => {
                let use_id = format!("use_{number}");
                let rendered: BTreeMap<String, serde_json::Value> =
                    fields.iter().map(|(name, value)| (name.clone(), self.render_field(value))).collect();
                let sends = self.sending_operations.contains(&operation.as_str());
                let was_just_asked = matches!(
                    index.checked_sub(1).map(|before| &self.plan.steps[before]),
                    Some(PlanStep::Approve { .. })
                );
                if sends && !was_just_asked {
                    self.ask(
                        format!("confirm_{number}"),
                        format!("Ask before: {title}"),
                        sending_question(title, &rendered),
                    );
                }
                self.nodes.push(Node {
                    id: use_id.clone(),
                    node_type: operation.clone(),
                    title: Some(title.clone()),
                    config: NodeConfig::Plugin(rendered),
                });
                if sends {
                    result = Some([use_id, "data".to_owned()]);
                } else {
                    let shorten_id = format!("shorten_{number}");
                    self.shorten_data(&shorten_id, [use_id, "data".to_owned()]);
                    self.materials
                        .push(Material { heading: title.clone(), reference: format!("{{{{#{shorten_id}.output#}}}}") });
                    result = Some([shorten_id, "output".to_owned()]);
                }
            }
        }
        self.results.selectors.push(result);
    }

    /// Where the plan's last writing step is (a chatbot's reply).
    fn last_write_index(&self) -> Option<usize> {
        self.plan.steps.iter().rposition(|step| matches!(step, PlanStep::Write { .. }))
    }

    /// The instructions of every writing step, which a chatbot's one reply follows where they fit.
    fn reply_notes(&self) -> Vec<&str> {
        self.plan
            .steps
            .iter()
            .filter_map(|step| match step {
                PlanStep::Write { instruction, .. } => Some(instruction.as_str()),
                _ => None,
            })
            .collect()
    }

    /// A question to the person; only its approve action leads on.
    fn ask(&mut self, id: String, title: String, prompt: String) {
        self.nodes.push(Node {
            id,
            node_type: "human-input".to_owned(),
            title: Some(title),
            config: NodeConfig::Ask {
                prompt,
                actions: vec![
                    AskAction { id: APPROVE_ACTION, title: "Approve" },
                    AskAction { id: "skip", title: "Skip" },
                ],
            },
        });
    }

    fn shorten(&mut self, id: &str, title: &str, variable: &'static str, source: [String; 2]) {
        self.nodes.push(Node {
            id: id.to_owned(),
            node_type: "template-transform".to_owned(),
            title: Some(title.to_owned()),
            config: NodeConfig::Shorten {
                template: format!("{{{{ {variable}[:{MAX_MATERIAL_CHARS}] }}}}"),
                variables: vec![TemplateVariable { variable, value_selector: source }],
            },
        });
    }

    /// Plugin data is a list or an object: written out as JSON, then cut like a page.
    fn shorten_data(&mut self, id: &str, source: [String; 2]) {
        self.nodes.push(Node {
            id: id.to_owned(),
            node_type: "template-transform".to_owned(),
            title: Some("Keep the first part of what was found".to_owned()),
            config: NodeConfig::Shorten {
                template: format!("{{{{ (data | tojson)[:{MAX_MATERIAL_CHARS}] }}}}"),
                variables: vec![TemplateVariable { variable: "data", value_selector: source }],
            },
        });
    }

    /// A plugin field with its `{input}` and `{step_2}` placeholders as graphrt references.
    fn render_field(&self, value: &serde_json::Value) -> serde_json::Value {
        let serde_json::Value::String(text) = value else { return value.clone() };
        let mut rendered = String::new();
        for part in field_parts(text, self.plan) {
            match part {
                FieldPart::Text(text) => rendered.push_str(text),
                FieldPart::Input(name) => rendered.push_str(&format!("{{{{#start.{name}#}}}}")),
                // A later step, or one without a result, inserts nothing.
                FieldPart::StepResult(step_index) => {
                    if let Some(reference) = self.results.reference(step_index) {
                        rendered.push_str(&reference);
                    }
                }
            }
        }
        serde_json::Value::String(rendered)
    }

    fn finish(mut self) -> Document {
        let hands_over = self.is_chatbot && !self.plan.job_words.hand_over.is_empty();
        if hands_over {
            self.hand_over_step();
        }
        if let (true, Some(last_write_id)) = (self.is_chatbot, &self.last_write_id) {
            self.nodes.push(Node {
                id: "reply".to_owned(),
                node_type: "answer".to_owned(),
                title: Some("Send the reply".to_owned()),
                config: NodeConfig::Answer { answer: format!("{{{{#{last_write_id}.text#}}}}") },
            });
        }
        // What the person reads at the end: the last text written, else the last thing found.
        let result = match &self.last_write_id {
            Some(write_id) => Some([write_id.clone(), "text".to_owned()]),
            None => self.results.selectors.iter().rev().flatten().next().cloned(),
        };
        let mut outputs: Vec<EndOutput> =
            result.into_iter().map(|value_selector| EndOutput { variable: "result", value_selector }).collect();
        if hands_over {
            outputs.push(EndOutput { variable: HANDOFF, value_selector: [HANDOFF.to_owned(), "output".to_owned()] });
            outputs.push(EndOutput {
                variable: HANDOFF_REASON,
                value_selector: [HANDOFF_REASON.to_owned(), "output".to_owned()],
            });
        }
        self.nodes.push(Node {
            id: "end".to_owned(),
            node_type: "end".to_owned(),
            title: None,
            config: NodeConfig::End { outputs },
        });
        let edges = self
            .nodes
            .windows(2)
            .map(|pair| Edge {
                source: pair[0].id.clone(),
                target: pair[1].id.clone(),
                handle: (pair[0].node_type == "human-input").then_some(APPROVE_ACTION),
            })
            .collect();
        Document {
            version: "1",
            name: document_name(&self.plan.name),
            description: self.plan.summary.clone(),
            graph: Graph { nodes: self.nodes, edges },
        }
    }
}

impl Builder<'_> {
    /// For a chatbot whose job says when the owner takes over: a model step that answers
    /// yes or no for the customer's message, and the `handoff` / `handoff_reason` outputs
    /// the app reads to stop the bot and call the owner (as the full path's chatbots do).
    fn hand_over_step(&mut self) {
        let rule = self.plan.job_words.hand_over.clone();
        self.nodes.push(Node {
            id: "decide_handoff".to_owned(),
            node_type: "llm".to_owned(),
            title: Some("Decide whether the owner takes over".to_owned()),
            config: NodeConfig::Write {
                model: Model {
                    provider: self.model.provider.clone(),
                    name: self.model.name.clone(),
                    completion_params: CompletionParams { temperature: 0.0 },
                },
                prompt_template: vec![
                    PromptMessage {
                        role: "system",
                        text: "You decide whether a business owner must take over a customer chat. Answer only \
                               yes or no."
                            .to_owned(),
                    },
                    PromptMessage {
                        role: "user",
                        text: format!(
                            "The owner takes over when: {rule}\n\nCustomer message:\n{{{{#start.message#}}}}\n\n\
                             Must the owner take over this chat?"
                        ),
                    },
                ],
            },
        });
        self.nodes.push(Node {
            id: HANDOFF.to_owned(),
            node_type: "template-transform".to_owned(),
            title: Some("Hand over to the owner?".to_owned()),
            config: NodeConfig::Shorten {
                template: "{{ 'true' if 'yes' in answer | lower else 'false' }}".to_owned(),
                variables: vec![TemplateVariable {
                    variable: "answer",
                    value_selector: ["decide_handoff".to_owned(), "text".to_owned()],
                }],
            },
        });
        self.nodes.push(Node {
            id: HANDOFF_REASON.to_owned(),
            node_type: "template-transform".to_owned(),
            title: Some("Why the owner takes over".to_owned()),
            config: NodeConfig::Shorten { template: "owner_needed".to_owned(), variables: Vec::new() },
        });
    }
}

/// The plan a guided document was written from and the model its steps run on, when the
/// document still is that plan's: the comment is there, readable, and composing it again
/// gives the same document. A document changed by hand (in the Nodes view) no longer
/// matches and gives `None`, so those changes are never overwritten from an old plan.
///
/// The model is read from the document, not from the app's current default: a change in
/// the chat keeps the steps on the model they already use.
pub(super) fn plan_of_document(flow_yaml: &str, kind: AgentKind) -> Option<(Plan, StepModel)> {
    let first_line = flow_yaml.lines().next()?;
    let plan: Plan = serde_json::from_str(first_line.strip_prefix(PLAN_COMMENT_PREFIX)?).ok()?;
    let model = model_of_document(flow_yaml)?;
    let recomposed = workflow_yaml(&plan, &model, kind).ok()?;
    (recomposed.trim_end() == flow_yaml.trim_end()).then_some((plan, model))
}

/// The `model` of the document's first step that has one.
fn model_of_document(flow_yaml: &str) -> Option<StepModel> {
    let document: serde_json::Value = serde_saphyr::from_str(flow_yaml).ok()?;
    document.pointer("/graph/nodes")?.as_array()?.iter().find_map(|node| {
        let model = node.get("model")?;
        Some(StepModel {
            provider: model.get("provider")?.as_str()?.to_owned(),
            name: model.get("name")?.as_str()?.to_owned(),
        })
    })
}

fn start_variable(input: &PlanInput) -> StartVariable {
    StartVariable {
        variable: input.name.clone(),
        input_type: if input.long_text { "paragraph" } else { "text-input" },
        required: true,
        label: input.label.clone(),
        default: (!input.value.is_empty()).then(|| input.value.clone()),
    }
}

/// The user message of a writing step: the task, then every input and earlier result under its heading.
fn writer_request(instruction: &str, job: &str, materials: &[Material]) -> String {
    let mut request = format!("Task: {instruction}");
    if !job.is_empty() && job != instruction {
        request.push_str(&format!("\n\nThe whole job, as the person asked for it: {job}"));
    }
    for material in materials {
        request.push_str(&format!("\n\n{}:\n{}", material.heading, material.reference));
    }
    request
}

/// The user message of a chatbot's reply: the business's facts and the plan's notes, what
/// earlier steps found, and the customer's message last, right before the model writes, so
/// a small model answers that message and not the last fact it read.
fn chatbot_request(notes: &[&str], job: &str, materials: &[Material]) -> String {
    let mut request = "Task: reply to the customer's message at the end. Use only the facts that answer \
        what the customer asks; leave out the ones they did not ask about."
        .to_owned();
    if !job.is_empty() {
        request.push_str(&format!("\n\nThe business's facts, as the owner wrote them: {job}"));
    }
    let notes: Vec<&str> = notes.iter().copied().filter(|note| !note.is_empty() && *note != job).collect();
    if !notes.is_empty() {
        request.push_str("\n\nNotes for replies:");
        for note in notes {
            request.push_str(&format!("\n- {note}"));
        }
    }
    let (message, found): (Vec<&Material>, Vec<&Material>) =
        materials.iter().partition(|material| material.reference == CHATBOT_MESSAGE_REFERENCE);
    for material in found {
        request.push_str(&format!("\n\n{}:\n{}", material.heading, material.reference));
    }
    for material in message {
        request.push_str(&format!("\n\nThe customer's message, the one to answer:\n{}", material.reference));
    }
    request
}

/// What the person is asked before a plugin step sends: the step and every field it will use.
fn sending_question(title: &str, fields: &BTreeMap<String, serde_json::Value>) -> String {
    let mut question = format!("{title}?");
    for (name, value) in fields {
        let shown = match value {
            serde_json::Value::String(text) => text.clone(),
            other => other.to_string(),
        };
        question.push_str(&format!("\n\n{}:\n{shown}", field_label(name)));
    }
    question
}

/// `reply_to` → `Reply to`.
fn field_label(name: &str) -> String {
    let words = name.replace('_', " ");
    let mut characters = words.chars();
    match characters.next() {
        Some(first) => first.to_uppercase().chain(characters).collect(),
        None => String::new(),
    }
}

/// `Complaint Reply` → `complaint-reply`; `agent` when nothing usable is left.
fn document_name(display_name: &str) -> String {
    let mut name = String::new();
    for character in display_name.chars() {
        if character.is_ascii_alphanumeric() {
            name.push(character.to_ascii_lowercase());
        } else if !name.is_empty() && !name.ends_with('-') {
            name.push('-');
        }
    }
    let name = name.trim_end_matches('-');
    if name.is_empty() {
        "agent".to_owned()
    } else {
        name.to_owned()
    }
}

#[cfg(test)]
mod tests {
    use super::super::plan::{normalize, normalize_fields, parse, PlanRules};
    use super::*;
    use crate::credentials::ModelProvider;
    use crate::flow::{self, TrustedHosts};
    use crate::plugins::operations::tests::{list_messages_operation, send_email_operation};
    use crate::plugins::operations::OfferedOperation;

    fn local_model() -> StepModel {
        StepModel::from(&ModelChoice { provider: ModelProvider::Ollama, name: "llama3.2".into() })
    }

    fn plan_with(json_text: &str, operations: &[OfferedOperation], chatbot: bool) -> Plan {
        let message = chatbot_message_input();
        let rules = PlanRules {
            fixed_input: chatbot.then_some(&message),
            operations,
            allows_approvals: !chatbot,
            link_given: false,
        };
        normalize(parse(json_text).unwrap(), &rules).unwrap()
    }

    fn plan_from(json_text: &str, chatbot: bool) -> Plan {
        plan_with(json_text, &[], chatbot)
    }

    /// Node types of the document's steps, without `start` and `end`.
    fn step_types(yaml: &str) -> Vec<String> {
        let summary = flow::summarize_flow(yaml).unwrap_or_else(|error| panic!("{error}\n{yaml}"));
        summary
            .steps
            .into_iter()
            .map(|step| step.node_type)
            .filter(|node_type| !matches!(node_type.as_str(), "start" | "end"))
            .collect()
    }

    const LOOKUP_PLAN: &str = r#"{"looks_up_the_web": true, "summary": "Summarizes a Wikipedia page: \"quoted\" # not a comment",
        "name": "Wikipedia Summary", "inputs": [{"name": "topic", "label": "Topic: to look up", "long_text": false, "value": "Jakarta"}],
        "steps": [{"kind": "lookup", "title": "Get the page", "instruction": "", "url": "https://en.wikipedia.org/api/rest_v1/page/summary/{topic}"},
                  {"kind": "write", "title": "Write: a summary", "instruction": "Write two sentences - plain words, no \"jargon\"."}]}"#;

    #[test]
    fn a_lookup_plan_compiles_and_runs_on_the_users_model() {
        let yaml = workflow_yaml(&plan_from(LOOKUP_PLAN, false), &local_model(), AgentKind::Task).unwrap();
        assert_eq!(step_types(&yaml), ["http-request", "template-transform", "llm"], "{yaml}");
        let summary = flow::summarize_flow(&yaml).unwrap();
        assert_eq!(summary.model_providers, ["ollama"]);
        assert_eq!((summary.inputs[0].name.as_str(), summary.inputs[0].label.as_str()), ("topic", "Topic: to look up"));
        assert_eq!(
            summary.inputs[0].default_value,
            Some(serde_json::json!("Jakarta")),
            "the value the job names is the default"
        );
        assert!(yaml.contains("https://en.wikipedia.org/api/rest_v1/page/summary/{{#start.topic#}}"), "{yaml}");
        assert!(yaml.contains("- lookup_1\n      - text"), "the readable text of the page is what is kept: {yaml}");
        assert!(yaml.contains("{{#shorten_1.output#}}"), "the writer reads the shortened page: {yaml}");
        assert!(yaml.contains("name: wikipedia-summary"), "{yaml}");
        // Still a read-only lookup: with its host trusted it needs no approval.
        let trusted = TrustedHosts::from_entries(["en.wikipedia.org"]);
        assert!(flow::find_unapproved_steps(&yaml, &trusted).unwrap().is_empty(), "{yaml}");
        assert_eq!(flow::find_unapproved_steps(&yaml, &TrustedHosts::none()).unwrap().len(), 1);
    }

    #[test]
    fn a_link_the_person_gives_is_asked_about_before_it_is_read() {
        let plan = plan_from(
            r#"{"looks_up_the_web": true, "inputs": [{"name": "link", "label": "Link", "long_text": false}],
                "steps": [{"kind": "lookup", "title": "Read the article", "instruction": "", "url": "{link}"},
                          {"kind": "write", "title": "Summarize", "instruction": "Three points."}]}"#,
            false,
        );
        let yaml = workflow_yaml(&plan, &local_model(), AgentKind::Task).unwrap();
        assert_eq!(step_types(&yaml), ["human-input", "http-request", "template-transform", "llm"], "{yaml}");
        assert!(flow::find_unapproved_steps(&yaml, &TrustedHosts::none()).unwrap().is_empty(), "{yaml}");
        assert!(yaml.contains("handle: approve"), "only approving leads to the lookup: {yaml}");
    }

    #[test]
    fn later_steps_read_the_inputs_and_every_earlier_result() {
        let plan = plan_from(
            r#"{"inputs": [{"name": "notes", "label": "Meeting notes", "long_text": true}],
                "steps": [{"kind": "write", "title": "List the actions", "instruction": "List them."},
                          {"kind": "write", "title": "Add owners", "instruction": "Add an owner to each."}]}"#,
            false,
        );
        let yaml = workflow_yaml(&plan, &local_model(), AgentKind::Task).unwrap();
        assert_eq!(step_types(&yaml), ["llm", "llm"]);
        let second_step = yaml.split("id: write_2").nth(1).unwrap();
        assert!(second_step.contains("{{#start.notes#}}") && second_step.contains("{{#write_1.text#}}"), "{yaml}");
        assert!(yaml.contains("type: paragraph"), "{yaml}");
    }

    #[test]
    fn an_approval_shows_the_latest_result_and_only_approving_continues() {
        let plan = plan_from(
            r#"{"steps": [{"kind": "write", "title": "Draft the reply", "instruction": "Draft it."},
                          {"kind": "approve", "title": "Check the reply", "instruction": "Is this reply good?"},
                          {"kind": "write", "title": "Polish", "instruction": "Make it shorter."}]}"#,
            false,
        );
        let yaml = workflow_yaml(&plan, &local_model(), AgentKind::Task).unwrap();
        assert_eq!(step_types(&yaml), ["llm", "human-input", "llm"], "{yaml}");
        assert!(yaml.contains("Is this reply good?") && yaml.contains("{{#write_1.text#}}"), "{yaml}");
        let approve_edges: Vec<&str> = yaml.lines().filter(|line| line.contains("handle: approve")).collect();
        assert_eq!(approve_edges.len(), 1, "{yaml}");
    }

    /// A plan that writes a note and emails it, with the fields a model would give.
    fn email_plan(asks_first: bool) -> Plan {
        let operations = [send_email_operation()];
        let approval = if asks_first {
            r#"{"kind": "approve", "title": "Check the note", "instruction": "Send this note?"},"#
        } else {
            ""
        };
        let mut plan = plan_with(
            &format!(
                r#"{{"name": "Thank You Email", "inputs": [{{"name": "address", "label": "Email address", "long_text": false}}],
                    "steps": [{{"kind": "write", "title": "Write the note", "instruction": "Write a thank-you note."}}, {approval}
                              {{"kind": "use", "title": "Send the note", "instruction": "Email the note", "operation": "email.send_email"}}]}}"#
            ),
            &operations,
            false,
        );
        let send_index = plan.steps.len() - 1;
        let fields = normalize_fields(
            &operations[0],
            r#"{"to": "{address}", "subject": "Thank you: \"really\"", "text": "{step_1}"}"#,
            &plan,
            send_index,
        )
        .unwrap();
        if let PlanStep::Use { fields: step_fields, .. } = &mut plan.steps[send_index] {
            *step_fields = fields;
        }
        plan
    }

    #[test]
    fn the_person_is_asked_before_a_plugin_step_sends() {
        let yaml = workflow_yaml(&email_plan(false), &local_model(), AgentKind::Task).unwrap();
        assert!(yaml.contains("type: human-input") && yaml.contains("type: email.send_email"), "{yaml}");
        let ask_at = yaml.find("id: confirm_2").expect("the app adds the question");
        let send_at = yaml.find("id: use_2").unwrap();
        assert!(ask_at < send_at, "{yaml}");
        let question = &yaml[ask_at..send_at];
        assert!(
            question.contains("Send the note?")
                && question.contains("{{#start.address#}}")
                && question.contains("{{#write_1.text#}}"),
            "{yaml}"
        );
        let send_step = &yaml[send_at..];
        assert!(
            send_step.contains("to: '{{#start.address#}}'") || send_step.contains("to: \"{{#start.address#}}\""),
            "{yaml}"
        );
        assert!(send_step.contains("{{#write_1.text#}}"), "{yaml}");
        assert!(yaml.contains("- write_1\n      - text"), "the run shows what was written: {yaml}");
    }

    #[test]
    fn an_approval_the_plan_already_has_is_not_asked_twice() {
        let yaml = workflow_yaml(&email_plan(true), &local_model(), AgentKind::Task).unwrap();
        assert_eq!(yaml.matches("type: human-input").count(), 1, "{yaml}");
        assert!(yaml.contains("id: approve_2") && !yaml.contains("id: confirm_3"), "{yaml}");
    }

    #[test]
    fn what_a_plugin_read_is_cut_to_size_for_the_writer() {
        let operations = [list_messages_operation()];
        let mut plan = plan_with(
            r#"{"summary": "Sums up new mail.", "steps": [{"kind": "use", "title": "Get new mail", "instruction": "List unread mail", "operation": "email.list_messages"}]}"#,
            &operations,
            false,
        );
        if let PlanStep::Use { fields, .. } = &mut plan.steps[0] {
            fields.insert("limit".into(), serde_json::json!(5));
        }
        let yaml = workflow_yaml(&plan, &local_model(), AgentKind::Task).unwrap();
        assert!(!yaml.contains("type: human-input"), "reading needs no approval: {yaml}");
        assert!(yaml.contains("limit: 5"), "{yaml}");
        assert!(yaml.contains("(data | tojson)[:6000]") && yaml.contains("{{#shorten_1.output#}}"), "{yaml}");
    }

    #[test]
    fn a_chatbot_reads_the_message_and_replies_with_an_answer_step() {
        let plan =
            plan_from(r#"{"steps": [{"kind": "write", "title": "Reply", "instruction": "Answer kindly."}]}"#, true);
        let yaml = workflow_yaml(&plan, &local_model(), AgentKind::Chatbot).unwrap();
        let summary = flow::summarize_flow(&yaml).unwrap_or_else(|error| panic!("{error}\n{yaml}"));
        assert_eq!(summary.inputs[0].name, "message");
        assert_eq!(step_types(&yaml), ["llm", "answer"], "{yaml}");
        assert!(yaml.contains("{{#write_1.text#}}"), "{yaml}");
    }

    #[test]
    fn a_chatbot_sends_one_reply_whatever_writing_steps_its_plan_has() {
        // What llama3.2 planned for a bakery: one step per topic.
        let mut plan = plan_from(
            r#"{"steps": [{"kind": "write", "title": "Answer opening hours", "instruction": "Answer: We are open 8 to 17, closed Sunday."},
                          {"kind": "write", "title": "Provide cake prices", "instruction": "Answer: Our brownies cost 50k and our cheesecakes cost 120k."}]}"#,
            true,
        );
        plan.job = "Answer questions for my bakery (brownies 50k, cheesecake 120k).".to_owned();
        let yaml = workflow_yaml(&plan, &local_model(), AgentKind::Chatbot).unwrap();
        flow::summarize_flow(&yaml).unwrap_or_else(|error| panic!("{error}\n{yaml}"));
        assert_eq!(step_types(&yaml), ["llm", "answer"], "{yaml}");
        assert!(yaml.contains("{{#write_2.text#}}") && !yaml.contains("write_1"), "{yaml}");
        let notes = yaml.find("- Answer: We are open").unwrap_or_else(|| panic!("{yaml}"));
        let prices = yaml.find("- Answer: Our brownies").unwrap_or_else(|| panic!("{yaml}"));
        let facts = yaml.find("The business's facts, as the owner wrote them: Answer questions").unwrap();
        let message = yaml.find("The customer's message, the one to answer:").unwrap();
        assert!(facts < notes && notes < prices && prices < message, "the message comes last: {yaml}");
        assert!(yaml[message..].contains("{{#start.message#}}"), "{yaml}");
    }

    #[test]
    fn a_plan_without_inputs_or_name_still_compiles() {
        let plan = plan_from(r#"{"steps": [{"kind": "write", "title": "", "instruction": "Write a joke."}]}"#, false);
        let yaml = workflow_yaml(&plan, &local_model(), AgentKind::Task).unwrap();
        assert_eq!(step_types(&yaml), ["llm"]);
        assert!(yaml.contains("name: agent"), "{yaml}");
    }

    #[test]
    fn the_plan_is_read_back_from_its_document_until_the_document_is_changed_by_hand() {
        let plan = email_plan(true);
        let yaml = workflow_yaml(&plan, &local_model(), AgentKind::Task).unwrap();
        assert!(yaml.starts_with("# guided-plan: {"), "{yaml}");
        assert_eq!(plan_of_document(&yaml, AgentKind::Task), Some((plan.clone(), local_model())));

        // The comment still says the old instruction, the steps say a new one: the steps win.
        let steps_edited = yaml.replacen("Task: Write a thank-you note.", "Task: Write a short thank-you note.", 1);
        assert_ne!(steps_edited, yaml);
        assert_eq!(plan_of_document(&steps_edited, AgentKind::Task), None);
        assert_eq!(plan_of_document("version: \"1\"\nname: x\n", AgentKind::Task), None);
        assert_eq!(plan_of_document("# guided-plan: not json\nversion: \"1\"\n", AgentKind::Task), None);

        // Steps on another model are still this plan's document: the model is the document's.
        let other_model = StepModel { provider: "ollama".into(), name: "qwen2.5:14b".into() };
        let on_other_model = workflow_yaml(&plan, &other_model, AgentKind::Task).unwrap();
        assert_eq!(plan_of_document(&on_other_model, AgentKind::Task), Some((plan, other_model)));
    }
}
