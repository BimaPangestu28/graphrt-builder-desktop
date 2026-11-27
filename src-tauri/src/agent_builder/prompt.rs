//! Prompts for drafting, repairing and revising workflow documents.
//!
//! The system prompt is: role, rules, the workflow format guide, and two
//! fixture flows as worked examples. User text is fenced with `<<<`/`>>>` so the
//! model reads it as a job description rather than as instructions to it.

use super::provider_name;
use crate::credentials::ModelChoice;
use crate::flow::{self, TrustedHosts};
use crate::storage::models::AgentKind;

const EXAMPLE_SIMPLE_ANSWER: &str = include_str!("../../fixtures/flows/simple_answer.yaml");
const EXAMPLE_APPROVAL_LOOP: &str = include_str!("../../fixtures/flows/approval_loop.yaml");
/// A working chatbot (answer branch and hand-off branch), shown only when building a chatbot:
/// without it, models invented hand-off shapes graphrt rejects (`template: true` as a YAML
/// boolean, literal text as an `end` selector, conditions inside `{{#…#}}`).
pub(super) const EXAMPLE_CHATBOT: &str = include_str!("../../fixtures/flows/chatbot_handoff.yaml");

/// Extra guidance per feature area (run outputs, knowledge, chatbots, agents as
/// tools...), each in its own Markdown file under `guides/` so features can be
/// added without editing the shared rules. Rendered in this order.
// One entry per line (the trailing comments keep rustfmt from joining them),
// so parallel features add guides without conflicting.
const DOMAIN_GUIDES: &[&str] = &[
    include_str!("guides/run_outputs.md"), // end-node outputs: summary, items, counters
    include_str!("guides/chatbot.md"),     // chatbot conversations
    include_str!("guides/agents_as_tools.md"), // other agents as tool steps and team members
    include_str!("guides/knowledge.md"),   // knowledge-retrieval over the user's knowledge bases
    include_str!("guides/trusted_lookups.md"), // read-only lookups on trusted hosts, "Trust <host>" proposals
    include_str!("guides/plugin_triggers.md"), // agents started by plugin events (start inputs = event fields)
    include_str!("guides/visuals.md"),     // cards, charts, tables, KPI tiles and diagrams from the ui-render plugin
    include_str!("guides/files.md"),       // reading attached files and pictures, handing files back
];

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
- The app also counts as sending: any `http-request` (GET included) whose URL, params, headers, authorization or \
body reads a `{{#…#}}` value (except a read-only lookup on a trusted host, see below), `tool` steps and plugin \
steps that change something, and `agent` steps with such tools unless `require_approval` lists each of them. \
Put a `human-input` before those too. A `human-input` with a \
time limit (`expire_after_ms`) must use `on_expire: stop` or a button that does not lead to a sending step.
- Keys and tokens for third-party services go under `env` with `type: secret` and are read as `{{#env.NAME#}}`. \
Never write a real or made-up key into the document.
- Every `llm`, `agent`, `question-classifier` and `parameter-extractor` node uses \
`model: { provider: {provider}, name: {model} }`. The examples use other models; do not copy those.
- Give every step a short `title` in plain words, e.g. \"Find cafes on Google Maps\", \"Write a short message\".
- Use the best-known public API for each outside service and keep requests simple. Prefer a plugin step \
(installed or not yet installed) when one covers the service. Never use placeholder addresses such as example.com or your-domain.com: the \
URLs in the examples below are placeholders and must not be copied. If no real API or plugin is available, read \
the address from an `env` value and say in your opening sentence what the user needs to connect.
- Every node must be reachable from `start`, and every reference must name an existing node and output.
- Keep the flow as small as the job allows and finish with an `end` node that outputs the useful results.";

const BUILD_REPLY_FORMAT: &str = "\
Reply in exactly this format and nothing else:
<one or two short sentences, in plain words for a non-programmer, saying what the agent will do and where it \
will ask them first; no markdown>
Agent name: <2 to 5 plain words naming the agent, written like a title for a person, e.g. \
Cafe Offers in Bandar Lampung; never snake_case or kebab-case>
```yaml
<the complete workflow document>
```";

const REVISION_REPLY_FORMAT: &str = "\
Start with one or two short sentences, in plain words for a non-programmer, saying what you changed (no \
markdown). Then reply with the complete updated workflow document inside one ```yaml fence and nothing else. \
Keep the ids of steps you do not change, and change only what the request needs. Existing model nodes keep their model unless \
the request is about the model; new model nodes follow the model rule above.";

/// System prompt for drafting a new agent. `saved_secret_names` are the secrets the
/// user saved in the app (names only, never values). A new agent trusts no hosts yet.
pub(super) fn build_system_prompt(model: &ModelChoice, saved_secret_names: &[String]) -> String {
    system_prompt(model, BUILD_REPLY_FORMAT, saved_secret_names, &TrustedHosts::none())
}

/// System prompt for revising an existing agent; `trusted_hosts` are the agent's trusted lookup hosts.
pub(super) fn revision_system_prompt(
    model: &ModelChoice,
    saved_secret_names: &[String],
    trusted_hosts: &TrustedHosts,
) -> String {
    system_prompt(model, REVISION_REPLY_FORMAT, saved_secret_names, trusted_hosts)
}

fn system_prompt(
    model: &ModelChoice,
    reply_format: &str,
    saved_secret_names: &[String],
    trusted_hosts: &TrustedHosts,
) -> String {
    let rules = SHARED_RULES.replace("{provider}", provider_name(model.provider)).replace("{model}", &model.name);
    let rules = append_domain_guides(rules);
    let rules = append_plugin_guide(rules);
    let rules = append_mcp_guide(rules);
    let rules = append_saved_secrets_guide(rules, saved_secret_names);
    let rules = append_trusted_hosts_guide(rules, trusted_hosts);
    let rules = append_local_cli_guide(rules, model);
    format!(
        "{ROLE}\n\n# Rules\n{rules}\n\n# Reply format\n{reply_format}\n\n# Workflow format\n{guide}\n\n\
         # Example: answer one question\n```yaml\n{simple_answer}\n```\n\n\
         # Example: find businesses and message each one after approval\n```yaml\n{approval_loop}\n```\n",
        guide = flow::workflow_format_guide().trim_end(),
        simple_answer = EXAMPLE_SIMPLE_ANSWER.trim_end(),
        approval_loop = EXAMPLE_APPROVAL_LOOP.trim_end(),
    )
}

/// A local CLI model (Claude Code, Codex) answers text only: tell the builder to keep
/// model steps to plain text so the draft can run on it.
fn append_local_cli_guide(rules: String, model: &ModelChoice) -> String {
    let Some(cli) = model.provider.local_cli() else { return rules };
    format!(
        "{rules}\n- The model `{provider}` is {name} running on the user's computer: it answers text (and JSON) \
         only. It cannot call tools and cannot read images, so do not write `agent` steps with `tools` or \
         `vision` for it; use `llm` steps (structured output is fine) and do the tool work with other steps.",
        provider = cli.provider_name(),
        name = cli.display_name()
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

/// Adds the plugins' step types, installed and from the catalog (dynamic, unlike [`DOMAIN_GUIDES`]).
fn append_plugin_guide(rules: String) -> String {
    let guide = crate::plugins::installed_plugins_guide();
    if guide.is_empty() {
        rules
    } else {
        format!("{rules}\n{guide}")
    }
}

/// Most saved secret names listed, so a long list cannot crowd out the rules.
const MAX_SAVED_SECRET_NAMES: usize = 50;

/// Adds the names of the secrets the user saved, so the model reuses them instead of
/// inventing new names for a credential the user already has.
fn append_saved_secrets_guide(rules: String, saved_secret_names: &[String]) -> String {
    if saved_secret_names.is_empty() {
        return rules;
    }
    let listed_names = saved_secret_names
        .iter()
        .take(MAX_SAVED_SECRET_NAMES)
        .map(|name| format!("`{name}`"))
        .collect::<Vec<_>>()
        .join(", ");
    format!(
        "{rules}\n- Secrets the user already saved in the app (Connections > Advanced > Secrets; values are \
         never shown to you): {listed_names}. When the job needs one of these credentials (a server login, API \
         token, database password), declare it under `env` with `type: secret` using exactly that name and read \
         it as `{{{{#env.NAME#}}}}`, e.g. `{{{{#env.{example}#}}}}`. Pick the name that best matches what the user \
         describes; only add a new secret name when none of these fits.",
        example = saved_secret_names[0],
    )
}

/// Lists the hosts the user trusts for this agent's lookups (names only).
fn append_trusted_hosts_guide(rules: String, trusted_hosts: &TrustedHosts) -> String {
    if trusted_hosts.is_empty() {
        return format!("{rules}\n- This agent trusts no hosts for lookups yet.");
    }
    let listed_hosts = trusted_hosts.entries().iter().map(|host| format!("`{host}`")).collect::<Vec<_>>().join(", ");
    format!(
        "{rules}\n- Hosts the user trusts for this agent's read-only lookups: {listed_hosts} (`*.domain` covers \
         its subdomains). Lookups on them need no `human-input`."
    )
}

/// Adds the configured MCP servers' tools (dynamic, like the plugin guide).
fn append_mcp_guide(rules: String) -> String {
    let guide = crate::mcp::prompt_guide::configured_servers_guide();
    if guide.is_empty() {
        rules
    } else {
        format!("{rules}\n{guide}")
    }
}

/// First user message for a new agent.
pub(super) fn build_request(description: &str, kind: AgentKind) -> String {
    let request =
        format!("Build this agent.\n\nKind: {}\n\nWhat it should do:\n<<<\n{description}\n>>>", kind_guidance(kind));
    match kind {
        AgentKind::Chatbot => format!(
            "{request}\n\nA working chatbot to start from: keep its shape (one `answer` step per branch, each \
             reading the step right before it, and the hand-off steps exactly as written), and change the \
             classes, facts and wording to this job:\n```yaml\n{}\n```",
            EXAMPLE_CHATBOT.trim_end()
        ),
        AgentKind::Task | AgentKind::Chain | AgentKind::Team => request,
    }
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

/// Follow-up after validation failed; `problem` is graphrt's error (or ours), `format_help`
/// the format guide sections about what the problem names (see `repair::format_help`).
pub(super) fn repair_request(problem: &str, format_help: &[String]) -> String {
    let help = if format_help.is_empty() {
        String::new()
    } else {
        format!("\n\nThe format of what the problem is about:\n\n{}", format_help.join("\n\n"))
    };
    format!(
        "graphrt could not use that document. The problem:\n\n{problem}{help}\n\n\
         Fix it and reply again in the same format: one short plain sentence saying what you fixed, then the \
         complete corrected document."
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
