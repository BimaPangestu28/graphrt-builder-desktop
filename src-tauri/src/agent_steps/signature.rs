//! What an agent needs and gives back when another agent calls it: its start
//! inputs (with JSON types for the tool schema) and its output keys.

use graphrt_core::Graph;
use serde::{Deserialize, Serialize};
use serde_json::{json, Map, Value as Json};

use crate::error::AppResult;
use crate::flow;

/// JSON type of a start input, derived from the `start` variable `type`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum InputValueType {
    String,
    Number,
    Boolean,
    /// `json` inputs: any JSON value.
    Any,
}

/// One start input of an agent.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentInput {
    pub name: String,
    pub label: String,
    pub required: bool,
    pub value_type: InputValueType,
    /// Allowed values of a `select` input (empty otherwise).
    pub options: Vec<String>,
}

/// Inputs, outputs and shape of an agent's current flow.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentSignature {
    pub inputs: Vec<AgentInput>,
    /// Keys of the run outputs (`end` outputs, plus `answer` when the flow replies).
    pub outputs: Vec<String>,
    pub step_count: usize,
    /// Some step stops to ask the user; such an agent cannot run as a step yet.
    pub asks_for_approval: bool,
}

/// Reads the signature of a workflow document.
///
/// # Errors
/// Same as [`flow::compile_flow`].
pub fn read_signature(flow_yaml: &str) -> AppResult<AgentSignature> {
    let summary = flow::summarize_flow(flow_yaml)?;
    let graph = flow::compile_flow(flow_yaml)?;
    let typed_inputs = collect_typed_inputs(&graph);
    let inputs = summary
        .inputs
        .into_iter()
        .map(|input| {
            let (value_type, options) = typed_inputs
                .iter()
                .find(|(name, _, _)| *name == input.name)
                .map(|(_, value_type, options)| (*value_type, options.clone()))
                .unwrap_or((InputValueType::String, Vec::new()));
            AgentInput { name: input.name, label: input.label, required: input.required, value_type, options }
        })
        .collect();
    Ok(AgentSignature {
        inputs,
        outputs: collect_outputs(&graph),
        step_count: summary.steps.len(),
        asks_for_approval: summary.steps.iter().any(|step| step.needs_approval),
    })
}

/// JSON Schema of the tool arguments: one property per start input.
pub fn tool_parameters_schema(signature: &AgentSignature) -> Json {
    let mut properties = Map::new();
    for input in &signature.inputs {
        let mut property = Map::new();
        match input.value_type {
            InputValueType::String => {
                property.insert("type".into(), json!("string"));
            }
            InputValueType::Number => {
                property.insert("type".into(), json!("number"));
            }
            InputValueType::Boolean => {
                property.insert("type".into(), json!("boolean"));
            }
            InputValueType::Any => {}
        }
        if !input.options.is_empty() {
            property.insert("enum".into(), json!(input.options));
        }
        property.insert("description".into(), json!(input.label));
        properties.insert(input.name.clone(), Json::Object(property));
    }
    let required: Vec<&str> =
        signature.inputs.iter().filter(|input| input.required).map(|input| input.name.as_str()).collect();
    json!({"type": "object", "properties": properties, "required": required})
}

/// `(name, type, select options)` of every `start` variable.
fn collect_typed_inputs(graph: &Graph) -> Vec<(String, InputValueType, Vec<String>)> {
    graph
        .nodes()
        .iter()
        .filter(|node| &*node.kind == "start")
        .filter_map(|node| node.doc.config.get("variables").and_then(Json::as_array))
        .flatten()
        .filter_map(|variable| {
            let name = variable.get("variable").and_then(Json::as_str)?.to_owned();
            let declared_type = variable.get("type").and_then(Json::as_str).unwrap_or("text-input");
            let value_type = match declared_type {
                "number" => InputValueType::Number,
                "checkbox" | "boolean" => InputValueType::Boolean,
                "json" | "object" | "array" => InputValueType::Any,
                _ => InputValueType::String,
            };
            let options = variable
                .get("options")
                .and_then(Json::as_array)
                .map(|options| options.iter().filter_map(Json::as_str).map(str::to_owned).collect())
                .unwrap_or_default();
            Some((name, value_type, options))
        })
        .collect()
}

fn collect_outputs(graph: &Graph) -> Vec<String> {
    let mut outputs: Vec<String> = graph
        .nodes()
        .iter()
        .filter(|node| &*node.kind == "end")
        .filter_map(|node| node.doc.config.get("outputs").and_then(Json::as_array))
        .flatten()
        .filter_map(|output| output.get("variable").and_then(Json::as_str))
        .map(str::to_owned)
        .collect();
    if graph.nodes().iter().any(|node| &*node.kind == "answer") && !outputs.iter().any(|output| output == "answer") {
        outputs.push("answer".into());
    }
    outputs.dedup();
    outputs
}

#[cfg(test)]
mod tests {
    use super::*;

    const TYPED_FLOW: &str = r#"
version: "1"
name: typed
graph:
  nodes:
    - id: start
      type: start
      variables:
        - { variable: place, type: paragraph, required: true, label: The place to score }
        - { variable: limit, type: number }
        - { variable: tone, type: select, options: [friendly, formal] }
    - id: score
      type: llm
      model: { provider: openai, name: gpt-4o-mini }
      prompt_template:
        - { role: user, text: "Score {{#start.place#}}" }
    - id: end
      type: end
      outputs:
        - { variable: score, value_selector: [score, text] }
        - { variable: reason, value_selector: [score, text] }
  edges:
    - { source: start, target: score }
    - { source: score, target: end }
"#;

    #[test]
    fn reads_inputs_with_types_and_outputs() {
        let signature = read_signature(TYPED_FLOW).unwrap();
        assert_eq!(signature.outputs, ["score", "reason"]);
        assert_eq!(signature.step_count, 1);
        assert!(!signature.asks_for_approval);
        let types: Vec<InputValueType> = signature.inputs.iter().map(|input| input.value_type).collect();
        assert_eq!(types, [InputValueType::String, InputValueType::Number, InputValueType::String]);
        assert_eq!(signature.inputs[2].options, ["friendly", "formal"]);
    }

    #[test]
    fn schema_lists_inputs_and_required_ones() {
        let schema = tool_parameters_schema(&read_signature(TYPED_FLOW).unwrap());
        assert_eq!(schema["required"], json!(["place"]));
        assert_eq!(schema["properties"]["limit"]["type"], "number");
        assert_eq!(schema["properties"]["place"]["description"], "The place to score");
        assert_eq!(schema["properties"]["tone"]["enum"], json!(["friendly", "formal"]));
    }
}
