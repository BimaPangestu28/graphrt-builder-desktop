//! What a repair request shows the model besides the problem: the format guide's
//! sections for the node types the problem is about.
//!
//! graphrt's errors name the step and often only the serde complaint ("data did not
//! match any variant of untagged enum Repr", "missing field `value_selector`"). Measured
//! with gpt-4.1-mini, the model then guessed the shape again and often traded one error
//! for another (moving `value_selector` from the variables to the step and back) until
//! the repairs ran out. With the right section next to the problem it can copy the shape.

use serde_json::Value as Json;

use crate::flow::guide_sections;

/// Most sections one repair request carries, so a problem naming many steps stays short.
const MAX_SECTIONS: usize = 4;

/// Format guide sections for the problem: each node type it names (`` node `x` (end) ``,
/// or a step id found in `flow_yaml`), edges for an edge problem, and per-node options
/// for `on_error` / `retry`. Each section once, in the order the problem names them.
pub(super) fn format_help(problem: &str, flow_yaml: &str) -> Vec<String> {
    let node_types = node_types_by_id(flow_yaml);
    let mut sections: Vec<String> = Vec::new();
    let mut push = |section: Option<String>| {
        if let Some(section) = section {
            if !sections.contains(&section) && sections.len() < MAX_SECTIONS {
                sections.push(section);
            }
        }
    };
    for (name, kind_after) in backticked_names(problem) {
        let kind = kind_after.or_else(|| node_types.iter().find(|(id, _)| id == name).map(|(_, kind)| kind.as_str()));
        if let Some(kind) = kind {
            push(guide_sections::node_section(kind));
        }
    }
    let lowered = problem.to_lowercase();
    if lowered.contains("edge") || lowered.contains("handle") {
        push(guide_sections::edges_section());
    }
    if lowered.contains("on_error") || lowered.contains("strategy") || lowered.contains("retry") {
        push(guide_sections::options_section());
    }
    sections
}

/// Every `` `name` `` in `text`, with the word in parentheses right after it when there
/// is one (graphrt writes `` node `reply` (answer) ``).
fn backticked_names(text: &str) -> Vec<(&str, Option<&str>)> {
    let mut names = Vec::new();
    let mut parts = text.split('`');
    // Odd parts are inside backticks; the part after each one may start with " (kind)".
    let _ = parts.next();
    while let (Some(name), after) = (parts.next(), parts.next()) {
        let kind = after
            .and_then(|after| after.strip_prefix(" ("))
            .and_then(|rest| rest.split_once(')'))
            .map(|(kind, _)| kind)
            .filter(|kind| !kind.is_empty() && !kind.contains(' '));
        names.push((name, kind));
    }
    names
}

/// `(id, type)` of each node of the document, nested steps included; empty when it does not parse.
fn node_types_by_id(flow_yaml: &str) -> Vec<(String, String)> {
    let Ok(document) = serde_saphyr::from_str::<Json>(flow_yaml) else { return Vec::new() };
    let Some(nodes) = document.pointer("/graph/nodes").and_then(Json::as_array) else { return Vec::new() };
    nodes
        .iter()
        .filter_map(|node| Some((node.get("id")?.as_str()?.to_owned(), node.get("type")?.as_str()?.to_owned())))
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    const DRAFT: &str =
        "graph:\n  nodes:\n    - { id: handoff, type: end }\n    - { id: tidy, type: template-transform }\n";

    #[test]
    fn shows_the_section_of_the_node_type_graphrt_names() {
        let help = format_help("workflow error: node `handoff` (end): data did not match any variant", DRAFT);
        assert_eq!(help.len(), 1);
        assert!(help[0].starts_with("`end` - run outputs:"), "{}", help[0]);
        assert!(help[0].contains("value_selector"));
    }

    #[test]
    fn finds_the_type_of_a_step_named_without_one() {
        let help = format_help("workflow error: invalid node `tidy`: missing field `value_selector`", DRAFT);
        assert!(help[0].starts_with("`template-transform`"), "{help:?}");
        assert!(help[0].contains("variables: [{ variable: cafes, value_selector"), "{help:?}");
    }

    #[test]
    fn adds_edges_and_options_when_the_problem_is_about_them() {
        let help = format_help("invalid node `tidy`: unknown `on_error` strategy `fail-run`", DRAFT);
        assert!(help.iter().any(|section| section.starts_with("## Per-node options")), "{help:?}");
        let help = format_help("edge `a-b`: node `a` (llm) has no handle `yes`", DRAFT);
        assert!(help[0].starts_with("`llm`"), "{help:?}");
        assert!(help.iter().any(|section| section.starts_with("## Edges")), "{help:?}");
    }

    #[test]
    fn says_nothing_extra_for_a_problem_it_cannot_place() {
        assert!(format_help("the reply did not contain a workflow document", "not yaml").is_empty());
    }

    #[test]
    fn every_node_type_of_the_guide_has_a_section() {
        for kind in [
            "start",
            "end",
            "answer",
            "llm",
            "agent",
            "tool",
            "question-classifier",
            "parameter-extractor",
            "http-request",
            "human-input",
            "if-else",
            "template-transform",
            "list-operator",
            "knowledge-retrieval",
            "variable-aggregator",
            "iteration",
            "loop",
        ] {
            let section = guide_sections::node_section(kind).unwrap_or_else(|| panic!("no section for {kind}"));
            assert!(!section.contains("\n`end` -") || kind == "end", "{kind} runs into the next section");
        }
        let human_input = guide_sections::node_section("human-input").unwrap();
        assert!(human_input.contains("on_expire: stop"), "{human_input}");
        assert!(!human_input.contains("if-else"), "{human_input}");
    }
}
