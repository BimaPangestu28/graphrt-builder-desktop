//! Fields graphrt reads as text, written by a model as a bare YAML boolean or number.
//!
//! `handle: true`, `case_id: yes`, `template: true` or `id: 1` parse as a boolean or a
//! number, and graphrt rejects the document ("invalid type: boolean `true`, expected a
//! string"). The fix is always the same, so the app makes it instead of spending a repair
//! round on it (measured with gpt-4.1-mini, the model "fixed" `case_id: true` to the
//! reserved `false` and the build ran out of repairs).

use serde_json::Value as Json;

/// Node fields that hold text.
const TEXT_NODE_FIELDS: &[&str] = &["template", "answer"];
/// Lists of a node whose items have a text `id` (or `case_id`).
const ID_LISTS: &[(&str, &str)] = &[("classes", "id"), ("actions", "id"), ("cases", "case_id")];

/// `flow_yaml` with those fields turned into text, or `None` when none needed it (or the
/// document does not parse; graphrt reports that).
pub fn quote_text_fields(flow_yaml: &str) -> Option<String> {
    let mut document: Json = serde_saphyr::from_str(flow_yaml).ok()?;
    let mut changed = 0;
    if let Some(edges) = document.pointer_mut("/graph/edges").and_then(Json::as_array_mut) {
        for edge in edges {
            changed += quote_field(edge, "handle");
        }
    }
    if let Some(nodes) = document.pointer_mut("/graph/nodes").and_then(Json::as_array_mut) {
        for node in nodes {
            for field in TEXT_NODE_FIELDS {
                changed += quote_field(node, field);
            }
            for (list, id_field) in ID_LISTS {
                if let Some(items) = node.get_mut(*list).and_then(Json::as_array_mut) {
                    for item in items {
                        changed += quote_field(item, id_field);
                    }
                }
            }
        }
    }
    if changed == 0 {
        return None;
    }
    log::info!("the draft wrote {changed} text field(s) as a boolean or number: quoted them");
    serde_saphyr::to_string(&document).ok()
}

/// Turns `object[field]` into text when it is a boolean or number; 1 when it did.
fn quote_field(object: &mut Json, field: &str) -> usize {
    let Some(value) = object.get_mut(field) else { return 0 };
    let text = match value {
        Json::Bool(flag) => flag.to_string(),
        Json::Number(number) => number.to_string(),
        _ => return 0,
    };
    *value = Json::String(text);
    1
}

#[cfg(test)]
mod tests {
    use super::*;

    const DRAFT: &str = r#"
version: "1"
name: handoff
graph:
  nodes:
    - id: start
      type: start
      variables: [{ variable: message, type: paragraph, required: true }]
    - id: check
      type: if-else
      cases:
        - case_id: true
          logical_operator: and
          conditions: [{ variable_selector: [start, message], comparison_operator: contains, value: order }]
    - { id: mark_handoff, type: template-transform, template: true, variables: [] }
    - { id: reply, type: answer, answer: 42 }
    - id: end
      type: end
      outputs: [{ variable: handoff, value_selector: [mark_handoff, output] }]
  edges:
    - { source: start, target: check }
    - { source: check, target: mark_handoff, handle: true }
    - { source: check, target: reply, handle: "false" }
    - { source: mark_handoff, target: end }
    - { source: reply, target: end }
"#;

    #[test]
    fn quotes_booleans_and_numbers_where_graphrt_reads_text() {
        assert!(super::super::compile_flow(DRAFT).is_err());
        let quoted = quote_text_fields(DRAFT).expect("changed");
        super::super::compile_flow(&quoted).unwrap_or_else(|error| panic!("{error}\n{quoted}"));
        let document: Json = serde_saphyr::from_str(&quoted).unwrap();
        assert_eq!(document.pointer("/graph/nodes/2/template"), Some(&Json::String("true".into())));
        assert_eq!(document.pointer("/graph/nodes/3/answer"), Some(&Json::String("42".into())));
        assert_eq!(document.pointer("/graph/nodes/1/cases/0/case_id"), Some(&Json::String("true".into())));
        assert_eq!(document.pointer("/graph/edges/1/handle"), Some(&Json::String("true".into())));
    }

    #[test]
    fn leaves_a_document_alone_when_nothing_needs_quoting() {
        assert_eq!(quote_text_fields(include_str!("../../fixtures/flows/simple_answer.yaml")), None);
        assert_eq!(quote_text_fields("not: [valid"), None);
    }
}
