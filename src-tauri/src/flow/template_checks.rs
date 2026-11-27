//! Template mistakes graphrt accepts when it compiles a draft, but that break the run.
//!
//! - A `{{#…#}}` that is not a value path (`{{#reply.text == "x" ? a : b#}}`): graphrt
//!   only reads `{{#step.output#}}` paths and leaves anything else as text, so the
//!   customer gets the raw template.
//! - A `template-transform` whose Jinja template uses a name its `variables` do not
//!   declare (`{{ classify.class_id }}`): graphrt renders it as empty text, and reading a
//!   field of it fails the run ("undefined value").

use graphrt_core::Graph;
use serde_json::{Map, Value as Json};

const TEMPLATE_TRANSFORM_KIND: &str = "template-transform";
const REFERENCE_OPENING: &str = "{{#";
const REFERENCE_CLOSING: &str = "#}}";
/// Names Jinja provides itself (functions and loop helpers), never declared by a step.
const JINJA_BUILTIN_NAMES: &[&str] = &[
    "range",
    "dict",
    "namespace",
    "lipsum",
    "cycler",
    "joiner",
    "debug",
    "loop",
    "self",
    "super",
    "caller",
    "varargs",
    "kwargs",
    "true",
    "false",
    "none",
    "True",
    "False",
    "None",
];

/// One problem with a step's templates, as a sentence for the model.
pub(super) fn template_problems(graph: &Graph) -> Vec<String> {
    let mut problems = Vec::new();
    for node in graph.nodes() {
        let mut bad_references = Vec::new();
        collect_bad_references(&node.doc.config, &mut bad_references);
        for reference in bad_references {
            problems.push(format!(
                "step `{id}` writes `{reference}`, which is not a value: `{{{{#…#}}}}` holds only a step id and \
                 output such as `{{{{#write_answer.text#}}}}`, never a condition or expression. Branch with a \
                 `question-classifier` or `if-else` and give each branch its own step",
                id = node.id
            ));
        }
        if &*node.kind == TEMPLATE_TRANSFORM_KIND {
            if let Some(undeclared) = undeclared_jinja_names(&node.doc.config) {
                problems.extend(undeclared.into_iter().map(|name| {
                    format!(
                        "step `{id}` (template-transform) uses `{name}` in its template, but its `variables` do \
                         not declare it: add `{{ variable: {name}, value_selector: [<step id>, <output>] }}` to \
                         `variables`, or write the text without it",
                        id = node.id
                    )
                }));
            }
        }
    }
    problems
}

fn collect_bad_references(config: &Map<String, Json>, found: &mut Vec<String>) {
    for value in config.values() {
        collect_from_value(value, found);
    }
}

fn collect_from_value(value: &Json, found: &mut Vec<String>) {
    match value {
        Json::String(text) => {
            for inner in text.split(REFERENCE_OPENING).skip(1).filter_map(|rest| rest.split(REFERENCE_CLOSING).next()) {
                if !is_value_path(inner) {
                    let reference = format!("{REFERENCE_OPENING}{inner}{REFERENCE_CLOSING}");
                    if !found.contains(&reference) {
                        found.push(reference);
                    }
                }
            }
        }
        Json::Array(items) => items.iter().for_each(|item| collect_from_value(item, found)),
        Json::Object(fields) => fields.values().for_each(|field| collect_from_value(field, found)),
        _ => {}
    }
}

/// `step.output.key`, `context` or `sys.query`: dot-separated names of letters, digits, `_` and `-`.
fn is_value_path(inner: &str) -> bool {
    let inner = inner.trim();
    !inner.is_empty()
        && inner
            .split('.')
            .all(|part| !part.is_empty() && part.chars().all(|c| c.is_alphanumeric() || c == '_' || c == '-'))
}

/// Names the template reads that are neither declared in `variables` nor Jinja's own;
/// `None` when the template does not parse (graphrt reports that itself).
fn undeclared_jinja_names(config: &Map<String, Json>) -> Option<Vec<String>> {
    let template = config.get("template")?.as_str()?;
    let declared: Vec<&str> = config
        .get("variables")
        .and_then(Json::as_array)
        .map(|variables| variables.iter().filter_map(|variable| variable.get("variable")?.as_str()).collect())
        .unwrap_or_default();
    let mut environment = minijinja::Environment::new();
    environment.add_template("template", template).ok()?;
    let mut undeclared: Vec<String> = environment
        .get_template("template")
        .ok()?
        .undeclared_variables(false)
        .into_iter()
        .filter(|name| !declared.contains(&name.as_str()) && !JINJA_BUILTIN_NAMES.contains(&name.as_str()))
        .collect();
    undeclared.sort();
    Some(undeclared)
}
