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
//! Argument names get the same care, because llama3.2 asked `image/resize` for `width` where
//! the tool calls it `max_width`: a name the tool does not know is trimmed, and when exactly
//! one of the tool's own names ends in `_<name>` (and was not given) the value goes there.
//!
//! Nothing else changes: a value that does not fit is passed on as it was and the tool
//! refuses it with its own message. Paths and other text are never touched.
//!
//! A tool given a path that does not exist answers with the files that do, so the model can
//! ask again instead of giving up.
//!
//! The same wrapper adds one sentence to the result of a tool that made a file
//! ([`SHOWN_BY_THE_APP`]). Measured with gpt-4o-mini: without it, five answers out of five
//! ended in a link such as `[Download](sandbox:/reports/summary.pdf)`, which leads nowhere,
//! although the file was already shown as a card under the answer.

use std::sync::{Arc, OnceLock};

use futures::future::BoxFuture;
use graphrt_core::tool::{ToolCallContext, ToolError, ToolOutput, ToolRuntime, ToolSpec};
use graphrt_files::Workspace;
use serde_json::{Map, Value as Json};

/// Added to the result of a tool call that made a file, so the model does not invent a link to it.
pub(super) const SHOWN_BY_THE_APP: &str = "The app shows this file to the person as a download next to your answer. \
    Do not write a link or a path to it; just say what you made.";

/// How graphrt's workspace says a path names no file (`StoreError::NotFound`).
const NO_SUCH_FILE: &str = "does not exist";
/// Most files named after "the file does not exist".
const MAX_FILES_NAMED: usize = 20;

/// A tool provider whose arguments are put into the types its schema asks for.
#[derive(Debug)]
pub(super) struct LenientArguments {
    tools: Arc<dyn ToolRuntime>,
    /// The files the tools work on, to say which exist when a tool is given a path that does not.
    view: Workspace,
    /// The provider's tools, read once (the built-in providers never change theirs).
    specs: OnceLock<Vec<ToolSpec>>,
}

impl LenientArguments {
    pub(super) fn around(tools: Arc<dyn ToolRuntime>, view: Workspace) -> Arc<dyn ToolRuntime> {
        Arc::new(Self { tools, view, specs: OnceLock::new() })
    }

    /// "The files that exist are: ..." for a tool that was given a path that does not exist.
    /// llama3.2 asked for `photos/cat.jpg`, got "does not exist" and gave up, with the
    /// attached picture one line away; told which files exist, a model can ask again.
    async fn existing_files_hint(&self) -> Option<String> {
        let listing = self.view.list(None, MAX_FILES_NAMED).await.ok()?;
        if listing.entries.is_empty() {
            return Some("There are no files yet.".to_owned());
        }
        let paths: Vec<String> = listing.entries.iter().map(|entry| entry.path.to_string()).collect();
        Some(format!(
            "The files that exist are: {}. Call the tool again with one of these exact paths.",
            paths.join(", ")
        ))
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
            let mut output = self.tools.call(name, arguments, context).await?;
            if !output.is_error && !graphrt_core::tool::collect_files(&output.data).is_empty() {
                output.text = format!("{}\n{SHOWN_BY_THE_APP}", output.text.trim_end());
            }
            if output.is_error && output.text.contains(NO_SUCH_FILE) {
                if let Some(hint) = self.existing_files_hint().await {
                    output.text = format!("{}\n{hint}", output.text.trim_end());
                }
            }
            Ok(output)
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
    let given: Vec<String> = fields.keys().map(|name| name.trim().to_owned()).collect();
    fields
        .into_iter()
        .map(|(name, value)| {
            let name = known_name(&name, properties, &given);
            match properties.get(&name) {
                Some(schema) => (name, fit_to_schema(value, schema)),
                None => (name, value),
            }
        })
        .collect()
}

/// The tool's own name for an argument a model called `name`: `name` itself when the tool
/// knows it (also after trimming spaces), or the one name of the tool that ends in `_<name>`
/// and was not given as well (`width` for `max_width`). Anything else stays as it was written.
fn known_name(name: &str, properties: &Map<String, Json>, given: &[String]) -> String {
    let trimmed = name.trim();
    if properties.contains_key(trimmed) {
        return trimmed.to_owned();
    }
    let suffix = format!("_{trimmed}");
    let mut longer = properties.keys().filter(|known| known.ends_with(&suffix) && !given.contains(known));
    match (longer.next(), longer.next()) {
        (Some(only), None) if !trimmed.is_empty() => only.clone(),
        _ => name.to_owned(),
    }
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

    #[test]
    fn an_argument_name_the_tool_calls_differently_finds_its_place() {
        let resize = json!({
            "type": "object",
            "properties": {
                "path": { "type": "string" },
                "max_width": { "type": "integer" },
                "max_height": { "type": "integer" },
                "overwrite": { "type": "boolean" }
            }
        });
        // What llama3.2 sent to `image/resize`.
        let sent = json!({ "path": "uploads/poster.png", "width": "400", " overwrite": "false" });
        assert_eq!(
            fit_to_schema(sent, &resize),
            json!({ "path": "uploads/poster.png", "max_width": 400, "overwrite": false })
        );
        // The tool's own name wins when both are given, and a name that fits two is left alone.
        let both = json!({ "width": 300, "max_width": 400 });
        assert_eq!(fit_to_schema(both.clone(), &resize), both);
        let two_fit = json!({ "type": "object", "properties": { "min_size": { "type": "integer" }, "max_size": { "type": "integer" } } });
        assert_eq!(fit_to_schema(json!({ "size": "4" }), &two_fit), json!({ "size": "4" }));
        assert_eq!(fit_to_schema(json!({ "colour": "red" }), &resize), json!({ "colour": "red" }));
    }
}
