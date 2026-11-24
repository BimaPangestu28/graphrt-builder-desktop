//! One-click fixes of the compatibility checklist that change the workflow document.

use serde_json::Value as Json;

use crate::error::{AppError, AppResult};

/// Rewrites every `model: { provider: <from>, name: … }` in the document to `to_provider` with
/// `to_model`. Returns the new document and how many model settings changed. Comments inside
/// the document are not kept (like a Nodes edit).
///
/// # Errors
/// `Workflow` when the document cannot be read or written, or nothing uses `from_provider`.
pub fn switch_model_provider(
    flow_yaml: &str,
    from_provider: &str,
    to_provider: &str,
    to_model: &str,
) -> AppResult<(String, usize)> {
    let mut document: Json = serde_saphyr::from_str(flow_yaml)
        .map_err(|error| AppError::Workflow(format!("could not read the agent: {error}")))?;
    let changed = replace_models(&mut document, from_provider, to_provider, to_model);
    if changed == 0 {
        return Err(AppError::Workflow(format!("no step of this agent uses {from_provider}")));
    }
    let written = serde_saphyr::to_string(&document)
        .map_err(|error| AppError::Workflow(format!("could not write the agent: {error}")))?;
    Ok((written, changed))
}

fn replace_models(value: &mut Json, from_provider: &str, to_provider: &str, to_model: &str) -> usize {
    match value {
        Json::Object(object) => {
            let mut changed = 0;
            if let Some(Json::Object(model)) = object.get_mut("model") {
                if model.get("provider").and_then(Json::as_str) == Some(from_provider) {
                    model.insert("provider".into(), Json::String(to_provider.to_owned()));
                    model.insert("name".into(), Json::String(to_model.to_owned()));
                    changed += 1;
                }
            }
            for (key, child) in object.iter_mut() {
                if key != "model" {
                    changed += replace_models(child, from_provider, to_provider, to_model);
                }
            }
            changed
        }
        Json::Array(items) => {
            items.iter_mut().map(|item| replace_models(item, from_provider, to_provider, to_model)).sum()
        }
        _ => 0,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const FLOW: &str = r#"
name: menu
graph:
  nodes:
    - id: answer
      type: llm
      model: { provider: claude-code-cli, name: default }
      prompt: hi
    - id: loop
      type: iteration
    - id: inner
      type: llm
      parent: loop
      model: { provider: claude-code-cli, name: default }
    - id: other
      type: llm
      model: { provider: openai, name: gpt-4o }
"#;

    #[test]
    fn switches_every_model_of_the_provider_and_nothing_else() {
        let (written, changed) = switch_model_provider(FLOW, "claude-code-cli", "openai", "gpt-4o-mini").unwrap();
        assert_eq!(changed, 2);
        let document: Json = serde_saphyr::from_str(&written).unwrap();
        let nodes = document["graph"]["nodes"].as_array().unwrap();
        assert_eq!(nodes[0]["model"]["provider"], "openai");
        assert_eq!(nodes[0]["model"]["name"], "gpt-4o-mini");
        assert_eq!(nodes[3]["model"]["name"], "gpt-4o", "other providers keep their model");
        assert_eq!(nodes[0]["prompt"], "hi");
    }

    #[test]
    fn refuses_when_nothing_uses_the_provider() {
        assert!(switch_model_provider(FLOW, "ollama", "openai", "gpt-4o-mini").is_err());
        assert!(switch_model_provider("{ broken", "ollama", "openai", "x").is_err());
    }
}
