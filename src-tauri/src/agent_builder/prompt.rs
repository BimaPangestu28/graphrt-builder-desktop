//! Prompts for drafting, repairing and revising workflow documents.
//!
//! The system prompt is: role, rules, the workflow format guide, and two
//! fixture flows as worked examples. User text is fenced with `<<<`/`>>>` so the
//! model reads it as a job description rather than as instructions to it.

use super::provider_name;
use crate::credentials::ModelChoice;
use crate::flow;
use crate::storage::models::AgentKind;

const EXAMPLE_SIMPLE_ANSWER: &str = include_str!("../../fixtures/flows/simple_answer.yaml");
const EXAMPLE_APPROVAL_LOOP: &str = include_str!("../../fixtures/flows/approval_loop.yaml");

/// Extra guidance per feature area (run outputs, knowledge, chatbots, agents as
/// tools...), each in its own Markdown file under `guides/` so features can be
/// added without editing the shared rules. Rendered in this order.
const DOMAIN_GUIDES: &[&str] = &[include_str!("guides/agents_as_tools.md")];

/// Prefix of the line carrying the agent's display name in a build reply.
pub(super) const AGENT_NAME_PREFIX: &str = "Agent name:";

const ROLE: &str = "You design automation agents for graphrt desktop. People who are not programmers \
describe a job in plain words; you turn it into a graphrt workflow document that the app runs on their \
computer. They see every step before anything runs, so steps must be clear and safe.";

/// Rules shared by drafting and revising. `{provider}`/`{model}` are filled in.
const SHARED_RULES: &str = "\
- Output valid graphrt workflow YAML only. Use only the node types and fields described in the format guide below.
- The `start` node declares, as inputs, everything a person may want to change between runs: places, \
search keywords, the message or offer to send, how many items. Never hard-code those. Give each input a plain `label`.
- Any step that contacts people or acts for the user in the outside world (sends a message, WhatsApp, SMS, \
email or post, submits a form) or spends money (orders, pays, books) must come right after a `human-input` step \
that shows exactly what will be sent or bought, with actions such as `send` and `skip`. Connect only the approving \
action to that step. Inside an `iteration` that contains `human-input`, set `is_parallel: false`.
- Keys and tokens for third-party services go under `env` with `type: secret` and are read as `{{#env.NAME#}}`. \
Never write a real or made-up key into the document.
- Every `llm`, `agent`, `question-classifier` and `parameter-extractor` node uses \
`model: { provider: {provider}, name: {model} }`. The examples use other models; do not copy those.
- Give every step a short `title` in plain words, e.g. \"Find cafes on Google Maps\", \"Write a short message\".
- Use the best-known public API for each outside service and keep requests simple.
- Every node must be reachable from `start`, and every reference must name an existing node and output.
- Keep the flow as small as the job allows and finish with an `end` node that outputs the useful results.";

const BUILD_REPLY_FORMAT: &str = "\
Reply in exactly this format and nothing else:
Agent name: <2 to 5 plain words naming the agent>
```yaml
<the complete workflow document>
```";

const REVISION_REPLY_FORMAT: &str = "\
Reply with the complete updated workflow document inside one ```yaml fence and nothing else. Keep the ids of \
steps you do not change, and change only what the request needs. Existing model nodes keep their model unless \
the request is about the model; new model nodes follow the model rule above.";

/// System prompt for drafting a new agent.
pub(super) fn build_system_prompt(model: &ModelChoice) -> String {
    system_prompt(model, BUILD_REPLY_FORMAT)
}

/// System prompt for revising an existing agent.
pub(super) fn revision_system_prompt(model: &ModelChoice) -> String {
    system_prompt(model, REVISION_REPLY_FORMAT)
}

fn system_prompt(model: &ModelChoice, reply_format: &str) -> String {
    let rules = SHARED_RULES.replace("{provider}", provider_name(model.provider)).replace("{model}", &model.name);
    let rules = append_domain_guides(rules);
    format!(
        "{ROLE}\n\n# Rules\n{rules}\n\n# Reply format\n{reply_format}\n\n# Workflow format\n{guide}\n\n\
         # Example: answer one question\n```yaml\n{simple_answer}\n```\n\n\
         # Example: find businesses and message each one after approval\n```yaml\n{approval_loop}\n```\n",
        guide = flow::workflow_format_guide().trim_end(),
        simple_answer = EXAMPLE_SIMPLE_ANSWER.trim_end(),
        approval_loop = EXAMPLE_APPROVAL_LOOP.trim_end(),
    )
}

/// Adds every non-empty domain guide after the shared rules.
fn append_domain_guides(rules: String) -> String {
    DOMAIN_GUIDES
        .iter()
        .map(|guide| guide.trim())
        .filter(|guide| !guide.is_empty())
        .fold(rules, |combined, guide| format!("{combined}\n{guide}"))
}

/// First user message for a new agent.
pub(super) fn build_request(description: &str, kind: AgentKind) -> String {
    format!("Build this agent.\n\nKind: {}\n\nWhat it should do:\n<<<\n{description}\n>>>", kind_guidance(kind))
}

/// How each kind of agent is usually shaped.
fn kind_guidance(kind: AgentKind) -> &'static str {
    match kind {
        AgentKind::Task => "task - runs once from its start inputs to its outputs.",
        AgentKind::Chatbot => {
            "chatbot - answers chat messages. The start node has a `message` paragraph input, and the reply \
             is sent with an `answer` node. Use `question-classifier` if different topics need different handling."
        }
        AgentKind::Chain => {
            "chain - a sequence of distinct stages where each stage's result feeds the next \
             (for example research, then write, then review)."
        }
        AgentKind::Team => {
            "team - several `agent` nodes with different instructions each handle part of the job, \
             and their results are combined at the end."
        }
    }
}

/// Follow-up after validation failed; `problem` is graphrt's error (or ours).
pub(super) fn repair_request(problem: &str) -> String {
    format!(
        "graphrt could not use that document. The problem:\n\n{problem}\n\n\
         Fix it and reply again in the same format, with the complete corrected document."
    )
}

/// First user message for a revision.
pub(super) fn revision_request(current_yaml: &str, instruction: &str) -> String {
    let current_yaml = current_yaml.trim_end();
    format!(
        "Here is the agent's current workflow document:\n```yaml\n{current_yaml}\n```\n\n\
         Change it as follows:\n<<<\n{instruction}\n>>>"
    )
}
