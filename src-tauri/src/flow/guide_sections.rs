//! Parts of the workflow format guide (`format_guide.md`) for one node type, or for
//! edges, so a repair request can show the model the exact shape it got wrong.
//!
//! A node section starts at a line opening with that type in backticks
//! (`` `end` - run outputs: ``) and runs until the next such line or heading.

use super::WORKFLOW_FORMAT_GUIDE;

const NODES_HEADING: &str = "## Nodes";
const EDGES_HEADING: &str = "## Edges";
const OPTIONS_HEADING: &str = "## Per-node options";

/// The guide's section about node type `kind` (e.g. `end`, `template-transform`), if it has one.
pub fn node_section(kind: &str) -> Option<String> {
    let nodes_part = WORKFLOW_FORMAT_GUIDE.split_once(NODES_HEADING)?.1;
    let header = format!("`{kind}`");
    let mut lines = nodes_part.lines().skip_while(|line| !starts_section(line, &header));
    let first = lines.next()?;
    let mut section = vec![first];
    section.extend(lines.take_while(|line| !line.starts_with("##") && section_type(line).is_none()));
    Some(section.join("\n").trim_end().to_owned())
}

/// The guide's "Edges" section.
pub fn edges_section() -> Option<String> {
    heading_section(EDGES_HEADING)
}

/// The guide's "Per-node options" section (`retry`, `timeout_ms`, `on_error`).
pub fn options_section() -> Option<String> {
    heading_section(OPTIONS_HEADING)
}

fn heading_section(heading: &str) -> Option<String> {
    let rest = WORKFLOW_FORMAT_GUIDE.split_once(heading)?.1;
    let body = rest.split("\n## ").next()?;
    Some(format!("{heading}{}", body.trim_end()))
}

fn starts_section(line: &str, header: &str) -> bool {
    line.starts_with(header) && line[header.len()..].starts_with([' ', ','])
}

/// The node type a section header line names (`` `llm` - ask a model `` gives `llm`).
fn section_type(line: &str) -> Option<&str> {
    let rest = line.strip_prefix('`')?;
    let (kind, after) = rest.split_once('`')?;
    let is_header = after.starts_with(" -") || after.starts_with(" (");
    (is_header && !kind.is_empty() && !kind.contains(' ')).then_some(kind)
}
