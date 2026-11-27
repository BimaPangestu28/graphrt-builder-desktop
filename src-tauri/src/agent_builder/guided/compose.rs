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

const CHATBOT_ROLE: &str = "You answer a customer's chat message for a business. Do exactly what the task says. \
Reply with only the message to send to the customer, in the customer's language.";

/// The input every chatbot has: the customer's message.
pub(super) fn chatbot_message_input() -> PlanInput {
    PlanInput { name: "message".to_owned(), label: "Customer message".to_owned(), long_text: true, value: String::new() }
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

/// Builds the node list of a plan, one step at a time.
struct Builder<'a> {
    plan: &'a Plan,
    model: &'a ModelChoice,
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
pub(super) fn workflow_yaml(plan: &Plan, model: &ModelChoice, kind: AgentKind) -> Result<String, String> {
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
            .map(|input| Material { heading: input.label.clone(), reference: format!("{{{{#start.{}#}}}}", input.name) })
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
                self.shorten(&shorten_id, "Keep the first part of what was found", "page", [lookup_id, "text".to_owned()]);
                let heading = match url.host() {
                    Some(host) => format!("{title} (found on {host})"),
                    None => title.clone(),
                };
                self.materials.push(Material { heading, reference: format!("{{{{#{shorten_id}.output#}}}}") });
                result = Some([shorten_id, "output".to_owned()]);
            }
            PlanStep::Write { title, instruction } => {
                let write_id = format!("write_{number}");
                let role = if self.is_chatbot { CHATBOT_ROLE } else { WRITER_ROLE };
                self.nodes.push(Node {
                    id: write_id.clone(),
                    node_type: "llm".to_owned(),
                    title: Some(title.clone()),
                    config: NodeConfig::Write {
                        model: Model {
                            provider: self.model.provider.registry_name().to_owned(),
                            name: self.model.name.clone(),
                            completion_params: CompletionParams { temperature: 0.3 },
                        },
                        prompt_template: vec![
                            PromptMessage { role: "system", text: role.to_owned() },
                            PromptMessage { role: "user", text: writer_request(instruction, &self.materials) },
                        ],
                    },
                });
                self.materials.push(Material { heading: title.clone(), reference: format!("{{{{#{write_id}.text#}}}}") });
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
                let was_just_asked = matches!(index.checked_sub(1).map(|before| &self.plan.steps[before]), Some(PlanStep::Approve { .. }));
                if sends && !was_just_asked {
                    self.ask(format!("confirm_{number}"), format!("Ask before: {title}"), sending_question(title, &rendered));
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
                    self.materials.push(Material { heading: title.clone(), reference: format!("{{{{#{shorten_id}.output#}}}}") });
                    result = Some([shorten_id, "output".to_owned()]);
                }
            }
        }
        self.results.selectors.push(result);
    }

    /// A question to the person; only its approve action leads on.
    fn ask(&mut self, id: String, title: String, prompt: String) {
        self.nodes.push(Node {
            id,
            node_type: "human-input".to_owned(),
            title: Some(title),
            config: NodeConfig::Ask {
                prompt,
                actions: vec![AskAction { id: APPROVE_ACTION, title: "Approve" }, AskAction { id: "skip", title: "Skip" }],
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
                FieldPart::StepResult(step_index) => match self.results.reference(step_index) {
                    Some(reference) => rendered.push_str(&reference),
                    // A later step, or one without a result: nothing to insert.
                    None => {}
                },
            }
        }
        serde_json::Value::String(rendered)
    }

    fn finish(mut self) -> Document {
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
        let outputs = result.into_iter().map(|value_selector| EndOutput { variable: "result", value_selector }).collect();
        self.nodes.push(Node { id: "end".to_owned(), node_type: "end".to_owned(), title: None, config: NodeConfig::End { outputs } });
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

/// The plan a guided document was written from, when the document still is that plan's:
/// the comment is there, readable, and composing it again gives the same document. A
/// document changed by hand (in the Nodes view) no longer matches and gives `None`, so
/// those changes are never overwritten from an old plan.
pub(super) fn plan_of_document(flow_yaml: &str, model: &ModelChoice, kind: AgentKind) -> Option<Plan> {
    let first_line = flow_yaml.lines().next()?;
    let plan: Plan = serde_json::from_str(first_line.strip_prefix(PLAN_COMMENT_PREFIX)?).ok()?;
    let recomposed = workflow_yaml(&plan, model, kind).ok()?;
    (recomposed.trim_end() == flow_yaml.trim_end()).then_some(plan)
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
fn writer_request(instruction: &str, materials: &[Material]) -> String {
    let mut request = format!("Task: {instruction}");
    for material in materials {
        request.push_str(&format!("\n\n{}:\n{}", material.heading, material.reference));
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
