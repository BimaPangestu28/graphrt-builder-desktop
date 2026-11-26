//! The builder prompt's dynamic section: the configured MCP servers and their tools.

use super::McpServerDefinition;

/// Most tools listed per server (the model can still use `<server>/*`).
const MAX_TOOLS_PER_SERVER: usize = 25;
/// Description excerpt length per tool.
const MAX_DESCRIPTION_CHARS: usize = 160;

const SECTION_HEADER: &str = "\
- MCP servers configured in the app (Connections > Advanced) add the tools listed below. Call one with a \
`tool` node (`provider_id: <server>`, `tool_name: <tool>`, arguments in `tool_parameters`) or give an `agent` \
node `tools: [<server>/<tool>]` (or `<server>/*` for all of them). Their keys are configured in the app: never \
put them in `env` or in the document. Tools that send, post, create, update or delete follow the approval rule \
above (`require_approval`).";

/// The section for the published servers, or an empty string when none are configured.
pub fn configured_servers_guide() -> String {
    servers_guide(&super::current())
}

/// The section for `definitions`.
pub(crate) fn servers_guide(definitions: &[McpServerDefinition]) -> String {
    if definitions.is_empty() {
        return String::new();
    }
    let mut section = SECTION_HEADER.to_owned();
    for definition in definitions {
        if definition.known_tools.is_empty() {
            section.push_str(&format!(
                "\n  Server `{}`: tools not checked yet; use `{}/*` in an agent node.",
                definition.name, definition.name
            ));
            continue;
        }
        section.push_str(&format!("\n  Server `{}`:", definition.name));
        for tool in definition.known_tools.iter().take(MAX_TOOLS_PER_SERVER) {
            let description = one_line(&tool.description, MAX_DESCRIPTION_CHARS);
            if description.is_empty() {
                section.push_str(&format!("\n  - `{}`", tool.name));
            } else {
                section.push_str(&format!("\n  - `{}`: {description}", tool.name));
            }
        }
        let hidden_count = definition.known_tools.len().saturating_sub(MAX_TOOLS_PER_SERVER);
        if hidden_count > 0 {
            section.push_str(&format!("\n  - and {hidden_count} more (use `{}/*`)", definition.name));
        }
    }
    for definition in definitions {
        let plugin_guide = plugin_guide(definition);
        if !plugin_guide.is_empty() {
            section.push('\n');
            section.push_str(&plugin_guide);
        }
    }
    section
}

/// Longest plugin guide put into the builder prompt.
const MAX_GUIDE_CHARS: usize = 12_000;

/// The rules a server from an MCP preset plugin adds: its approval rule and
/// the plugin's guide (`{server}` replaced by the server name). Empty for
/// servers added by hand.
pub(crate) fn plugin_guide(definition: &McpServerDefinition) -> String {
    let Some(plugin) = &definition.plugin else { return String::new() };
    let server = &definition.name;
    let approval = &definition.approval;
    let quoted = |names: &[String]| names.iter().map(|name| format!("`{name}`")).collect::<Vec<_>>().join(", ");
    let mut rules = format!("- Server `{server}` comes from the {plugin} plugin.");
    if !approval.read_only.is_empty() {
        rules.push_str(&format!(" Only these tools read and run without asking: {}", quoted(&approval.read_only)));
        if !approval.without_approval.is_empty() {
            rules.push_str(&format!(
                ", plus {} (the user let them run on their own)",
                quoted(&approval.without_approval)
            ));
        }
        rules.push('.');
    }
    if approval.default_asks {
        rules.push_str(&format!(
            " Every other `{server}` tool sends or changes something: list each one the agent may call in \
             `require_approval`, and list the agent's tools one by one (`{server}/find_jobs`, ...) rather than `{server}/*`."
        ));
    }
    if let Some(guide) = &definition.guide {
        let text: String = guide.replace("{server}", server).chars().take(MAX_GUIDE_CHARS).collect();
        rules.push('\n');
        rules.push_str(text.trim_end());
    }
    rules
}

fn one_line(text: &str, max_chars: usize) -> String {
    let collapsed = text.split_whitespace().collect::<Vec<_>>().join(" ");
    if collapsed.chars().count() <= max_chars {
        return collapsed;
    }
    let cut: String = collapsed.chars().take(max_chars).collect();
    format!("{}…", cut.trim_end())
}
