//! Turns a checked [`Plan`] into a graphrt workflow document.
//!
//! Everything the app knows better than the drafting model is written here and never
//! asked for: the model each step runs on, the node ids, the references between steps,
//! the edges and the outputs. A plan that passed [`super::plan::normalize`] therefore
//! always gives a document that compiles.

use serde::Serialize;

use super::plan::{Plan, PlanInput, PlanStep};
use crate::credentials::ModelChoice;
use crate::storage::models::AgentKind;

/// Characters of a looked-up page handed to the next step. A local model reads about
/// 4,000 tokens in all, so a whole web page would push the instructions out.
const MAX_LOOKUP_CHARS: usize = 6000;

/// Seconds a lookup may take.
const LOOKUP_READ_TIMEOUT_SECONDS: u32 = 30;

/// Sent with every lookup. Public sites (Wikipedia among them) refuse requests that do not
/// say who is asking, and data addresses answer with JSON or text when asked for it.
const LOOKUP_HEADERS: &str = concat!(
    "User-Agent: graphrt-desktop/",
    env!("CARGO_PKG_VERSION"),
    " (https://github.com/Graphrt/graphrt-builder-desktop)\nAccept: application/json, text/plain;q=0.9, */*;q=0.5"
);

const WRITER_ROLE: &str = "You do one step of a job for a business person. Do exactly what the task says, using \
the material given. Reply with only the result, ready to use: no introduction, no explanation of what you did.";

const CHATBOT_ROLE: &str = "You answer a customer's chat message for a business. Do exactly what the task says. \
Reply with only the message to send to the customer, in the customer's language.";

/// The input every chatbot has: the customer's message.
pub(super) fn chatbot_message_input() -> PlanInput {
    PlanInput { name: "message".to_owned(), label: "Customer message".to_owned(), long_text: true }
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
}

#[derive(Serialize)]
struct Node {
    id: String,
    #[serde(rename = "type")]
    node_type: &'static str,
    #[serde(skip_serializing_if = "Option::is_none")]
    title: Option<String>,
    #[serde(flatten)]
    config: NodeConfig,
}

#[derive(Serialize)]
#[serde(untagged)]
enum NodeConfig {
    Start { variables: Vec<StartVariable> },
    Lookup { method: &'static str, url: String, headers: &'static str, timeout: LookupTimeout },
    Shorten { template: String, variables: Vec<TemplateVariable> },
    Write { model: Model, prompt_template: Vec<PromptMessage> },
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
struct EndOutput {
    variable: &'static str,
    value_selector: [String; 2],
    value_type: &'static str,
}

/// What an earlier step left for the later ones: a heading and the reference to its result.
struct Material {
    heading: String,
    reference: String,
}

/// The workflow document of `plan`, with every model step on `model`.
///
/// A `Chatbot` replies through an `answer` node; other kinds end on the last step's text.
///
/// # Errors
/// `Err` with the serializer's message when the document cannot be written as YAML
/// (not expected for a checked plan).
pub(super) fn workflow_yaml(plan: &Plan, model: &ModelChoice, kind: AgentKind) -> Result<String, String> {
    let is_chatbot = kind == AgentKind::Chatbot;
    let mut nodes = vec![Node {
        id: "start".to_owned(),
        node_type: "start",
        title: None,
        config: NodeConfig::Start { variables: plan.inputs.iter().map(start_variable).collect() },
    }];
    let mut materials: Vec<Material> = plan
        .inputs
        .iter()
        .map(|input| Material { heading: input.label.clone(), reference: format!("{{{{#start.{}#}}}}", input.name) })
        .collect();
    let mut last_write_id = String::new();
    for (index, step) in plan.steps.iter().enumerate() {
        let number = index + 1;
        match step {
            PlanStep::Lookup { title, url } => {
                let lookup_id = format!("lookup_{number}");
                let shorten_id = format!("shorten_{number}");
                nodes.push(Node {
                    id: lookup_id.clone(),
                    node_type: "http-request",
                    title: Some(title.clone()),
                    config: NodeConfig::Lookup {
                        method: "get",
                        url: url.to_graphrt_template(),
                        headers: LOOKUP_HEADERS,
                        timeout: LookupTimeout { connect: 10, read: LOOKUP_READ_TIMEOUT_SECONDS },
                    },
                });
                nodes.push(Node {
                    id: shorten_id.clone(),
                    node_type: "template-transform",
                    title: Some("Keep the first part of what was found".to_owned()),
                    config: NodeConfig::Shorten {
                        template: format!("{{{{ page[:{MAX_LOOKUP_CHARS}] }}}}"),
                        variables: vec![TemplateVariable { variable: "page", value_selector: [lookup_id, "body".to_owned()] }],
                    },
                });
                materials.push(Material {
                    heading: format!("{title} (found on {})", url.host()),
                    reference: format!("{{{{#{shorten_id}.output#}}}}"),
                });
            }
            PlanStep::Write { title, instruction } => {
                let write_id = format!("write_{number}");
                nodes.push(Node {
                    id: write_id.clone(),
                    node_type: "llm",
                    title: Some(title.clone()),
                    config: NodeConfig::Write {
                        model: Model {
                            provider: model.provider.registry_name().to_owned(),
                            name: model.name.clone(),
                            completion_params: CompletionParams { temperature: 0.3 },
                        },
                        prompt_template: vec![
                            PromptMessage { role: "system", text: if is_chatbot { CHATBOT_ROLE } else { WRITER_ROLE }.to_owned() },
                            PromptMessage { role: "user", text: writer_request(instruction, &materials) },
                        ],
                    },
                });
                materials.push(Material { heading: title.clone(), reference: format!("{{{{#{write_id}.text#}}}}") });
                last_write_id = write_id;
            }
        }
    }
    if is_chatbot {
        nodes.push(Node {
            id: "reply".to_owned(),
            node_type: "answer",
            title: Some("Send the reply".to_owned()),
            config: NodeConfig::Answer { answer: format!("{{{{#{last_write_id}.text#}}}}") },
        });
    }
    nodes.push(Node {
        id: "end".to_owned(),
        node_type: "end",
        title: None,
        config: NodeConfig::End {
            outputs: vec![EndOutput {
                variable: "result",
                value_selector: [last_write_id, "text".to_owned()],
                value_type: "string",
            }],
        },
    });
    let edges = nodes
        .windows(2)
        .map(|pair| Edge { source: pair[0].id.clone(), target: pair[1].id.clone() })
        .collect();
    let document = Document {
        version: "1",
        name: document_name(&plan.name),
        description: plan.summary.clone(),
        graph: Graph { nodes, edges },
    };
    serde_saphyr::to_string(&document).map_err(|error| error.to_string())
}

fn start_variable(input: &PlanInput) -> StartVariable {
    StartVariable {
        variable: input.name.clone(),
        input_type: if input.long_text { "paragraph" } else { "text-input" },
        required: true,
        label: input.label.clone(),
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
    if name.is_empty() { "agent".to_owned() } else { name.to_owned() }
}

#[cfg(test)]
mod tests {
    use super::super::plan::{normalize, parse};
    use super::*;
    use crate::credentials::ModelProvider;
    use crate::flow;

    fn local_model() -> ModelChoice {
        ModelChoice { provider: ModelProvider::Ollama, name: "llama3.2".into() }
    }

    fn plan_from(json_text: &str, chatbot: bool) -> Plan {
        let message = chatbot_message_input();
        normalize(parse(json_text).unwrap(), chatbot.then_some(&message)).unwrap()
    }

    const LOOKUP_PLAN: &str = r#"{"looks_up_the_web": true, "summary": "Summarizes a Wikipedia page: \"quoted\" # not a comment",
        "name": "Wikipedia Summary", "inputs": [{"name": "topic", "label": "Topic: to look up", "long_text": false}],
        "steps": [{"kind": "lookup", "title": "Get the page", "instruction": "", "url": "https://en.wikipedia.org/api/rest_v1/page/summary/{topic}"},
                  {"kind": "write", "title": "Write: a summary", "instruction": "Write two sentences - plain words, no \"jargon\"."}]}"#;

    #[test]
    fn a_lookup_plan_compiles_and_runs_on_the_users_model() {
        let yaml = workflow_yaml(&plan_from(LOOKUP_PLAN, false), &local_model(), AgentKind::Task).unwrap();
        let summary = flow::summarize_flow(&yaml).unwrap_or_else(|error| panic!("{error}\n{yaml}"));
        let types: Vec<&str> = summary
            .steps
            .iter()
            .map(|step| step.node_type.as_str())
            .filter(|node_type| !matches!(*node_type, "start" | "end"))
            .collect();
        assert_eq!(types, ["http-request", "template-transform", "llm"], "{yaml}");
        assert_eq!(summary.model_providers, ["ollama"]);
        assert_eq!(summary.inputs.len(), 1);
        assert_eq!((summary.inputs[0].name.as_str(), summary.inputs[0].label.as_str()), ("topic", "Topic: to look up"));
        assert!(yaml.contains("https://en.wikipedia.org/api/rest_v1/page/summary/{{#start.topic#}}"), "{yaml}");
        assert!(yaml.contains("{{#shorten_1.output#}}"), "the writer reads the shortened page: {yaml}");
        assert!(yaml.contains("name: wikipedia-summary"), "{yaml}");
        assert!(yaml.contains("User-Agent: graphrt-desktop/"), "sites refuse lookups without one: {yaml}");
        // Still a read-only lookup: with its host trusted it needs no approval.
        let trusted = crate::flow::TrustedHosts::from_entries(["en.wikipedia.org"]);
        assert!(flow::find_unapproved_steps(&yaml, &trusted).unwrap().is_empty(), "{yaml}");
        assert_eq!(flow::find_unapproved_steps(&yaml, &crate::flow::TrustedHosts::none()).unwrap().len(), 1);
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
        flow::summarize_flow(&yaml).unwrap_or_else(|error| panic!("{error}\n{yaml}"));
        let second_step = yaml.split("id: write_2").nth(1).unwrap();
        assert!(second_step.contains("{{#start.notes#}}") && second_step.contains("{{#write_1.text#}}"), "{yaml}");
        assert!(yaml.contains("type: paragraph"), "{yaml}");
    }

    #[test]
    fn a_chatbot_reads_the_message_and_replies_with_an_answer_step() {
        let plan = plan_from(r#"{"steps": [{"kind": "write", "title": "Reply", "instruction": "Answer kindly."}]}"#, true);
        let yaml = workflow_yaml(&plan, &local_model(), AgentKind::Chatbot).unwrap();
        let summary = flow::summarize_flow(&yaml).unwrap_or_else(|error| panic!("{error}\n{yaml}"));
        assert_eq!(summary.inputs[0].name, "message");
        assert!(summary.steps.iter().any(|step| step.node_type == "answer"), "{yaml}");
        assert!(yaml.contains("{{#write_1.text#}}"), "{yaml}");
    }

    #[test]
    fn a_plan_without_inputs_or_name_still_compiles() {
        let plan = plan_from(r#"{"steps": [{"kind": "write", "title": "", "instruction": "Write a joke."}]}"#, false);
        let yaml = workflow_yaml(&plan, &local_model(), AgentKind::Task).unwrap();
        flow::summarize_flow(&yaml).unwrap_or_else(|error| panic!("{error}\n{yaml}"));
        assert!(yaml.contains("name: agent"), "{yaml}");
    }
}
