//! Model steps read a looked-up response whole.
//!
//! A drafting model does not know the shape of an API's or a plugin's response. It writes a
//! path it finds plausible, such as `{{#fetch.json.query.pages.0.extract#}}` or
//! `{{#wiki.extract#}}`; when the path does not exist the reference is empty, the run still
//! succeeds, and the next step "summarizes" nothing. A model step does not need the path:
//! given the whole response it finds the part itself. So in the prompts of model steps:
//!
//! - a reference into an `http-request` step's `body` (raw markup), or two or more names
//!   below its `json` (`json.query.pages`), becomes its `text` (the response as readable
//!   text). One name below `json` (`json.results`) is left alone: a top-level field is what
//!   API examples show and drafts get right.
//! - a reference to a plugin step's output that the plugin does not have, or below its
//!   `data`, becomes its `data`.
//! - a reference to a `tool` step's output other than `text` / `json`, or two or more names
//!   below `json`, becomes its `text`.
//!
//! Steps that are not model steps keep their paths: a loop over `json.results` needs the list.

use std::collections::HashMap;

use serde_json::Value as Json;

/// Node types whose prompt text a model reads.
const MODEL_STEP_TYPES: &[&str] = &["llm", "agent", "question-classifier", "parameter-extractor"];

/// What a step that fetches something gives a model step to read.
#[derive(Debug, Clone, PartialEq)]
enum Fetched {
    /// An `http-request`: `body`, `json`, `text`, `status_code`, `headers`.
    Lookup,
    /// A `tool` step: `text` and `json`.
    Tool,
    /// A plugin step, with the outputs its kind declares (empty when unknown).
    Plugin { outputs: Vec<String> },
}

impl Fetched {
    /// The output to read instead of `path`, or `None` when `path` stays.
    fn whole_output(&self, path: &str) -> Option<String> {
        let mut names = path.split(['.', '[']).filter(|name| !name.is_empty());
        let first = names.next()?;
        let below = names.count();
        match self {
            Fetched::Lookup => match first {
                "body" => Some("text".to_owned()),
                "json" if below >= 2 => Some("text".to_owned()),
                _ => None,
            },
            Fetched::Tool => match first {
                "text" if below == 0 => None,
                "json" if below < 2 => None,
                _ => Some("text".to_owned()),
            },
            Fetched::Plugin { outputs } => {
                let data = if outputs.is_empty() || outputs.iter().any(|output| output == "data") {
                    "data".to_owned()
                } else {
                    outputs[0].clone()
                };
                let known = outputs.iter().any(|output| output == first) || (outputs.is_empty() && first == "data");
                if !known || (first == data && below > 0) {
                    Some(data)
                } else {
                    None
                }
            }
        }
    }
}

/// `flow_yaml` with the model steps' references into a response replaced by the whole
/// response. The document is returned as it is when nothing needs replacing or it cannot
/// be read (compiling reports that).
pub(super) fn read_whole_responses(flow_yaml: String) -> String {
    let registry = crate::flow::draft_node_registry();
    read_whole_responses_with(flow_yaml, |kind| {
        registry
            .descriptor_ref(kind)
            .map(|descriptor| descriptor.outputs.iter().map(|output| output.name.clone()).collect())
    })
}

/// [`read_whole_responses`] with the outputs of plugin kinds from `plugin_outputs`.
fn read_whole_responses_with(flow_yaml: String, plugin_outputs: impl Fn(&str) -> Option<Vec<String>>) -> String {
    let Ok(Json::Object(mut document)) = serde_saphyr::from_str::<Json>(&flow_yaml) else { return flow_yaml };
    let Some(nodes) = document.get_mut("graph").and_then(|graph| graph.get_mut("nodes")).and_then(Json::as_array_mut)
    else {
        return flow_yaml;
    };
    let fetching: HashMap<String, Fetched> = nodes
        .iter()
        .filter_map(|node| {
            let id = node.get("id").and_then(Json::as_str)?;
            let fetched = match node.get("type").and_then(Json::as_str)? {
                "http-request" => Fetched::Lookup,
                "tool" => Fetched::Tool,
                kind if kind.contains('.') => Fetched::Plugin { outputs: plugin_outputs(kind).unwrap_or_default() },
                _ => return None,
            };
            Some((id.to_owned(), fetched))
        })
        .collect();
    if fetching.is_empty() {
        return flow_yaml;
    }
    let mut replaced = 0;
    for node in nodes.iter_mut() {
        let is_model_step =
            node.get("type").and_then(Json::as_str).is_some_and(|node_type| MODEL_STEP_TYPES.contains(&node_type));
        if is_model_step {
            replaced += replace_in(node, &fetching);
        }
    }
    if replaced == 0 {
        return flow_yaml;
    }
    match serde_saphyr::to_string(&Json::Object(document)) {
        Ok(yaml) => {
            log::info!("{replaced} reference(s) into a fetched response now read the whole response");
            format!("{}{yaml}", leading_comments(&flow_yaml))
        }
        Err(error) => {
            log::warn!("could not write the document back after replacing response paths: {error}");
            flow_yaml
        }
    }
}

/// Replaces the references in every string under `value`; returns how many were replaced.
fn replace_in(value: &mut Json, fetching: &HashMap<String, Fetched>) -> usize {
    match value {
        Json::String(text) => {
            let (rewritten, count) = whole_response_references(text, fetching);
            if count > 0 {
                *text = rewritten;
            }
            count
        }
        Json::Array(items) => items.iter_mut().map(|item| replace_in(item, fetching)).sum(),
        Json::Object(fields) => fields.values_mut().map(|field| replace_in(field, fetching)).sum(),
        _ => 0,
    }
}

/// `text` with every reference into a fetched response that [`Fetched::whole_output`]
/// replaces read whole, and how many references that changed.
///
/// @example `"{{#fetch.json.items.0.name#}}"` → `"{{#fetch.text#}}"` when `fetch` is a lookup
fn whole_response_references(text: &str, fetching: &HashMap<String, Fetched>) -> (String, usize) {
    let mut rewritten = String::with_capacity(text.len());
    let mut replaced = 0;
    let mut rest = text;
    while let Some(open) = rest.find("{{#") {
        let after_open = &rest[open + 3..];
        let Some(close) = after_open.find("#}}") else { break };
        let reference = &after_open[..close];
        rewritten.push_str(&rest[..open]);
        let whole = reference.split_once('.').and_then(|(node_id, path)| {
            let fetched = fetching.get(node_id)?;
            fetched.whole_output(path).map(|output| (node_id, output))
        });
        match whole {
            Some((node_id, output)) => {
                rewritten.push_str(&format!("{{{{#{node_id}.{output}#}}}}"));
                replaced += 1;
            }
            None => rewritten.push_str(&rest[open..open + 3 + close + 3]),
        }
        rest = &after_open[close + 3..];
    }
    rewritten.push_str(rest);
    (rewritten, replaced)
}

/// The comment lines the document starts with (writing it back as YAML drops them).
fn leading_comments(flow_yaml: &str) -> String {
    flow_yaml.lines().take_while(|line| line.starts_with('#')).map(|line| format!("{line}\n")).collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::flow;

    /// A draft as gpt-4o-mini writes it for "summarize a Wikipedia page": a guessed path.
    const GUESSED_PATH: &str = r##"# Looks up a page.
version: "1"
name: wikipedia-summary
graph:
  nodes:
    - id: start
      type: start
      variables:
        - { variable: topic, type: text-input, required: true, label: Topic }
    - id: fetch_summary
      type: http-request
      method: get
      url: "https://en.wikipedia.org/w/api.php"
      params:
        - { key: titles, value: "{{#start.topic#}}" }
    - id: note
      type: template-transform
      template: "{{ title }}"
      variables: [{ variable: title, value_selector: [fetch_summary, json, title] }]
    - id: summarize
      type: llm
      model: { provider: openai, name: gpt-4o-mini }
      prompt_template:
        - { role: system, text: "Summarize the text in two sentences." }
        - { role: user, text: "About {{#start.topic#}}:\n{{#fetch_summary.json.query.pages.0.extract#}}\n{{#fetch_summary.body.extract#}} {{#fetch_summary.json#}} {{#fetch_summary.status_code#}}" }
    - id: end
      type: end
      outputs:
        - { variable: summary, value_selector: [summarize, text] }
  edges:
    - { source: start, target: fetch_summary }
    - { source: fetch_summary, target: note }
    - { source: note, target: summarize }
    - { source: summarize, target: end }
"##;

    #[test]
    fn a_model_step_reads_the_whole_response_instead_of_a_guessed_path() {
        let rewritten = read_whole_responses(GUESSED_PATH.to_owned());

        assert!(rewritten.starts_with("# Looks up a page.\n"), "{rewritten}");
        let document: Json = serde_saphyr::from_str(&rewritten).unwrap();
        let nodes = document.pointer("/graph/nodes").and_then(Json::as_array).unwrap();
        let prompt = nodes[3].pointer("/prompt_template/1/text").and_then(Json::as_str).unwrap();
        assert_eq!(
            prompt,
            "About {{#start.topic#}}:\n{{#fetch_summary.text#}}\n{{#fetch_summary.text#}} {{#fetch_summary.json#}} {{#fetch_summary.status_code#}}"
        );
        // A step that is not a model step keeps its path.
        assert_eq!(
            nodes[2].pointer("/variables/0/value_selector"),
            Some(&serde_json::json!(["fetch_summary", "json", "title"]))
        );
        flow::summarize_flow(&rewritten).unwrap_or_else(|error| panic!("{error}\n{rewritten}"));
    }

    #[test]
    fn documents_without_such_references_are_returned_untouched() {
        let simple = include_str!("../../fixtures/flows/simple_answer.yaml");
        assert_eq!(read_whole_responses(simple.to_owned()), simple);
        let exact = GUESSED_PATH.replace(
            "{{#fetch_summary.json.query.pages.0.extract#}}\\n{{#fetch_summary.body.extract#}}",
            "{{#fetch_summary.text#}}",
        );
        assert_eq!(read_whole_responses(exact.clone()), exact);
        assert_eq!(read_whole_responses("not: [yaml".to_owned()), "not: [yaml");
    }

    #[test]
    fn only_references_into_a_lookup_are_replaced() {
        let lookups = HashMap::from([("fetch".to_owned(), Fetched::Lookup)]);
        let written = "{{#fetch.json.a.b#}} {{#other.json.a.b#}} {{#fetch.json[0].a#}} {{#fetch.jsonish.a.b#}} {{#fetch.json.results#}} {{#fetch.body#}} {{#fetch";
        let (text, count) = whole_response_references(written, &lookups);
        assert_eq!(
            text,
            "{{#fetch.text#}} {{#other.json.a.b#}} {{#fetch.text#}} {{#fetch.jsonish.a.b#}} {{#fetch.json.results#}} {{#fetch.text#}} {{#fetch"
        );
        assert_eq!(count, 3);
        // A real draft's reference to a top-level list stays what it is.
        let approval_loop = include_str!("../../fixtures/flows/approval_loop.yaml");
        assert_eq!(read_whole_responses(approval_loop.to_owned()), approval_loop);
    }

    /// gpt-4o-mini's draft for "summarize a Wikipedia page" with the Wikipedia plugin: an
    /// output the plugin does not have.
    const PLUGIN_GUESS: &str = r##"version: "1"
name: wiki
graph:
  nodes:
    - { id: start, type: start, variables: [{ variable: city, type: text-input, required: true, label: City }] }
    - { id: wiki, type: wikipedia.get_page_summary, title: Look it up, page_title: "{{#start.city#}}" }
    - { id: rates, type: tool, provider_id: currency-rates, tool_name: get_latest_rates, timeout_ms: 60000 }
    - id: write
      type: llm
      model: { provider: openai, name: gpt-4o-mini }
      prompt_template:
        - { role: user, text: "{{#wiki.extract#}} {{#wiki.data.extract#}} {{#wiki.data#}} {{#wiki.next_cursor#}} {{#rates.data.0.rate#}} {{#rates.json.rates.IDR#}} {{#rates.json.base#}} {{#rates.text#}}" }
    - { id: end, type: end, outputs: [{ variable: result, value_selector: [write, text] }] }
  edges:
    - { source: start, target: wiki }
    - { source: wiki, target: rates }
    - { source: rates, target: write }
    - { source: write, target: end }
"##;

    #[test]
    fn a_model_step_reads_a_plugin_steps_data_and_a_tools_text_whole() {
        let outputs = |kind: &str| {
            (kind == "wikipedia.get_page_summary").then(|| vec!["data".to_owned(), "next_cursor".to_owned()])
        };

        let rewritten = read_whole_responses_with(PLUGIN_GUESS.to_owned(), outputs);

        let document: Json = serde_saphyr::from_str(&rewritten).unwrap();
        let prompt = document.pointer("/graph/nodes/3/prompt_template/0/text").and_then(Json::as_str).unwrap();
        assert_eq!(
            prompt,
            "{{#wiki.data#}} {{#wiki.data#}} {{#wiki.data#}} {{#wiki.next_cursor#}} {{#rates.text#}} {{#rates.text#}} {{#rates.json.base#}} {{#rates.text#}}"
        );
    }

    #[test]
    fn a_plugin_whose_outputs_are_unknown_is_read_through_data() {
        let plugin = Fetched::Plugin { outputs: Vec::new() };
        assert_eq!(plugin.whole_output("extract"), Some("data".to_owned()));
        assert_eq!(plugin.whole_output("data"), None);
        let text_plugin = Fetched::Plugin { outputs: vec!["text".to_owned()] };
        assert_eq!(text_plugin.whole_output("text"), None);
        assert_eq!(text_plugin.whole_output("summary"), Some("text".to_owned()));
    }
}
