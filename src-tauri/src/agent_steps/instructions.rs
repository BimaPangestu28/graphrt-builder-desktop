//! Builder instructions for "Add" on screen 12 and "Add member" on screen 13.
//!
//! Both go through the normal revision (`agent_builder::revise_agent`), so the
//! change is validated, saved as a new version with a summary and can be undone
//! from the version history. The instruction names the exact provider, tool
//! name and input names, so the model only decides where the step goes and
//! which earlier values feed its inputs.

use super::{AgentSignature, AGENT_TOOL_PROVIDER};
use crate::storage::models::Agent;

/// Nested runs wait longer than the default node timeout (2 minutes).
const AGENT_STEP_TIMEOUT_MS: u64 = 10 * 60 * 1000;

/// Instruction that adds `step_agent` as a `tool` step.
///
/// `placement` is the user's words for where it goes, e.g. "after Search Google Maps".
pub fn add_step_instruction(step_agent: &Agent, signature: &AgentSignature, placement: Option<&str>) -> String {
    let input_lines = if signature.inputs.is_empty() {
        "  (it needs no inputs)".to_owned()
    } else {
        signature
            .inputs
            .iter()
            .map(|input| {
                let required = if input.required { "required" } else { "optional" };
                format!("  - `{}` ({required}): {}", input.name, input.label)
            })
            .collect::<Vec<_>>()
            .join("\n")
    };
    let outputs = if signature.outputs.is_empty() {
        "nothing".to_owned()
    } else {
        signature.outputs.iter().map(|output| format!("`{output}`")).collect::<Vec<_>>().join(", ")
    };
    let placement = placement
        .map(str::trim)
        .filter(|placement| !placement.is_empty())
        .map_or_else(|| "where it fits the job best".to_owned(), str::to_owned);
    format!(
        "Add a step that runs my agent \"{name}\" {placement}. Use a `tool` node with \
         `provider_id: {AGENT_TOOL_PROVIDER}`, `tool_name: {id}`, `title: {title}` and `timeout_ms: {AGENT_STEP_TIMEOUT_MS}`. \
         Pass its inputs in `tool_parameters`, taking each value from the earlier step that has it:\n{input_lines}\n\
         It gives back {outputs}; later steps read them as `{{{{#<step id>.json.<output>#}}}}`. \
         Connect it with edges so it runs, and keep every other step as it is.",
        name = step_agent.name,
        id = step_agent.id,
        title = quoted_title(&step_agent.name),
    )
}

/// Instruction that adds `member` to the coordinator `agent` node's tools.
pub fn add_team_member_instruction(member: &Agent, coordinator_step_id: Option<&str>) -> String {
    let coordinator = coordinator_step_id.map_or_else(
        || "Add an `agent` node that coordinates the team if there is none, and".to_owned(),
        |step_id| format!("In the `agent` node `{step_id}`,"),
    );
    format!(
        "{coordinator} add `{AGENT_TOOL_PROVIDER}/{id}` to its `tools` list so it can hand work to my agent \
         \"{name}\" ({description}). Mention in its `instruction` when to use that member. \
         Keep the other tools and steps as they are.",
        id = member.id,
        name = member.name,
        description = member.description.trim(),
    )
}

/// "Run <name>" as a YAML-safe double-quoted string.
fn quoted_title(agent_name: &str) -> String {
    let escaped = agent_name.replace('\\', "\\\\").replace('"', "\\\"");
    format!("\"Run {escaped}\"")
}
