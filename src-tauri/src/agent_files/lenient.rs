//! Forgiving the way small models write tool arguments.
//!
//! Measured with local models (`conversations/real_model_tests.rs`): a model that picks the
//! right file tool often writes a number or a yes/no as text, `{"size": "400", "overwrite":
//! "false"}`. The tools read their arguments strictly, answer "invalid arguments", and the
//! model gives up. The meaning was never in doubt, so [`LenientArguments`] puts each
//! argument into the type the tool's own schema asks for before the tool sees it:
//! - text that is a number, for an `integer` or `number`;
//! - `"true"` / `"false"`, for a `boolean`;
//! - text that is JSON, for an `array` or `object`;
//! - a whole number written as `400.0`, for an `integer`.
//!
//! Nothing else changes: a value that does not fit is passed on as it was and the tool
//! refuses it with its own message. Paths and other text are never touched.

use std::sync::{Arc, OnceLock};

use futures::future::BoxFuture;
use graphrt_core::tool::{ToolCallContext, ToolError, ToolOutput, ToolRuntime, ToolSpec};
use serde_json::{Map, Value as Json};

/// A tool provider whose arguments are put into the types its schema asks for.
#[derive(Debug)]
pub(super) struct LenientArguments {
    tools: Arc<dyn ToolRuntime>,
    /// The provider's tools, read once (the built-in providers never change theirs).
    specs: OnceLock<Vec<ToolSpec>>,
}

impl LenientArguments {
    pub(super) fn around(tools: Arc<dyn ToolRuntime>) -> Arc<dyn ToolRuntime> {
        Arc::new(Self { tools, specs: OnceLock::new() })
    }

    async fn parameters_of(&self, name: &str) -> Option<Json> {
        if self.specs.get().is_none() {
            let listed = self.tools.list().await.ok()?;
            // Another call may have filled it meanwhile; either list is the same.
            let _ = self.specs.set(listed);
        }
        self.specs.get()?.iter().find(|spec| spec.name == name).map(|spec| spec.parameters.clone())
    }
}

impl ToolRuntime for LenientArguments {
    fn list(&self) -> BoxFuture<'_, Result<Vec<ToolSpec>, ToolError>> {
        self.tools.list()
    }

    fn call<'a>(
        &'a self,
        name: &'a str,
        arguments: Json,
        context: &'a ToolCallContext,
    ) -> BoxFuture<'a, Result<ToolOutput, ToolError>> {
        Box::pin(async move {
            let arguments = match self.parameters_of(name).await {
                Some(parameters) => fit_to_schema(arguments, &parameters),
                None => arguments,
            };
            self.tools.call(name, arguments, context).await
        })
    }

    fn accepts_secrets(&self) -> bool {
        self.tools.accepts_secrets()
    }
}

/// `value` with every part put into the type `schema` asks for, where the meaning is clear.
pub(super) fn fit_to_schema(value: Json, schema: &Json) -> Json {
    let wanted = schema.get("type").and_then(Json::as_str).unwrap_or_default();
    let value = match (wanted, value) {
        ("integer", Json::String(text)) => match text.trim().parse::<i64>() {
            Ok(number) => Json::from(number),
            Err(_) => whole_number(text.trim().parse::<f64>().ok()).unwrap_or(Json::String(text)),
        },
        ("integer", Json::Number(number)) if !number.is_i64() && !number.is_u64() => {
            whole_number(number.as_f64()).unwrap_or(Json::Number(number))
        }
        ("number", Json::String(text)) => {
            match text.trim().parse::<f64>().ok().and_then(serde_json::Number::from_f64) {
                Some(number) => Json::Number(number),
                None => Json::String(text),
            }
        }
        ("boolean", Json::String(text)) => match text.trim().to_ascii_lowercase().as_str() {
            "true" => Json::Bool(true),
            "false" => Json::Bool(false),
            _ => Json::String(text),
        },
        ("array" | "object", Json::String(text)) => match serde_json::from_str::<Json>(&text) {
            Ok(parsed) if (wanted == "array" && parsed.is_array()) || (wanted == "object" && parsed.is_object()) => {
                parsed
            }
            _ => Json::String(text),
        },
        (_, value) => value,
    };
    match value {
        Json::Object(fields) => {
            let properties = schema.get("properties").and_then(Json::as_object);
            Json::Object(fit_fields(fields, properties))
        }
        Json::Array(items) => match schema.get("items") {
            Some(item_schema) => Json::Array(items.into_iter().map(|item| fit_to_schema(item, item_schema)).collect()),
            None => Json::Array(items),
        },
        other => other,
    }
}

fn fit_fields(fields: Map<String, Json>, properties: Option<&Map<String, Json>>) -> Map<String, Json> {
    let Some(properties) = properties else { return fields };
    fields
        .into_iter()
        .map(|(name, value)| match properties.get(&name) {
            Some(schema) => (name, fit_to_schema(value, schema)),
            None => (name, value),
        })
        .collect()
}

/// `number` as a JSON integer when it has no fraction and fits one.
fn whole_number(number: Option<f64>) -> Option<Json> {
    let number = number.filter(|number| number.is_finite() && number.fract() == 0.0)?;
    // Parsed back from its own text: exact for every whole number an `i64` holds.
    format!("{number:.0}").parse::<i64>().ok().map(Json::from)
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;

    fn schema() -> Json {
        json!({
            "type": "object",
            "properties": {
                "path": { "type": "string" },
                "size": { "type": "integer" },
                "quality": { "type": "number" },
                "overwrite": { "type": "boolean" },
                "sheets": { "type": "array", "items": { "type": "object", "properties": { "header": { "type": "boolean" } } } }
            }
        })
    }

    #[test]
    fn numbers_and_yes_no_written_as_text_become_what_the_tool_asks_for() {
        // What llama3.2 sent to `image/thumbnail`.
        let sent = json!({ "path": "uploads/poster.png", "overwrite": "false", "size": "400" });
        assert_eq!(
            fit_to_schema(sent, &schema()),
            json!({ "path": "uploads/poster.png", "overwrite": false, "size": 400 })
        );
        let sent = json!({ "size": " 400.0 ", "quality": "0.8", "overwrite": "TRUE" });
        assert_eq!(fit_to_schema(sent, &schema()), json!({ "size": 400, "quality": 0.8, "overwrite": true }));
        assert_eq!(fit_to_schema(json!({ "size": 400.0 }), &schema()), json!({ "size": 400 }));
    }

    #[test]
    fn lists_written_as_text_are_read_and_their_parts_fitted() {
        let sent = json!({ "sheets": "[{\"header\": \"true\", \"rows\": [[\"a\", 1]]}]" });
        assert_eq!(fit_to_schema(sent, &schema()), json!({ "sheets": [{ "header": true, "rows": [["a", 1]] }] }));
    }

    #[test]
    fn text_stays_text_and_what_does_not_fit_is_left_for_the_tool_to_refuse() {
        // A path that looks like a number or a yes/no is still a path.
        let sent = json!({ "path": "2026", "size": "big", "overwrite": "maybe", "quality": "", "sheets": "not json", "other": "400" });
        assert_eq!(fit_to_schema(sent.clone(), &schema()), sent);
        assert_eq!(fit_to_schema(json!({ "size": 400.5 }), &schema()), json!({ "size": 400.5 }));
        assert_eq!(fit_to_schema(json!("400"), &json!({})), json!("400"));
        assert_eq!(fit_to_schema(json!({ "size": "400" }), &json!({ "type": "object" })), json!({ "size": "400" }));
    }
}
