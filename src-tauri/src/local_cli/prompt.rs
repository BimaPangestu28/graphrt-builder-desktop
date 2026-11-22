//! A graphrt `ChatRequest` as what a CLI takes: instructions plus one prompt text.
//!
//! The CLIs answer one prompt at a time, so a multi-turn conversation is written out
//! as a transcript. Tool calling is not available through them; a request that
//! forces one tool (graphrt's "Extract parameters" step) is answered as JSON for that
//! tool instead, and structured output becomes an instruction to reply with JSON
//! (graphrt validates the reply against the schema either way).

use graphrt_llm::{ChatRequest, ContentPart, LlmError, Message, ResponseFormat, Role, ToolChoice};

use super::LocalCli;

/// What one CLI call sends.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CliPrompt {
    /// System instructions (Claude Code: `--system-prompt-file`; Codex: top of the prompt).
    pub instructions: String,
    /// The prompt text written to the CLI's stdin.
    pub prompt: String,
    /// The tool a request forced, answered as a JSON object of its arguments.
    pub forced_tool: Option<String>,
}

/// The capability error for a request with tools (e.g. a "Run an agent" step with tools).
pub fn tool_calls_unsupported(cli: LocalCli) -> LlmError {
    LlmError::Config(format!(
        "{} (local CLI) can't do tool calls in a Run an agent step — pick an API model for this step",
        cli.display_name()
    ))
}

/// Builds the CLI prompt for `request`.
///
/// # Errors
/// `Config` for tools the model would have to call itself, tool results in the
/// history, or images (none of which the CLIs take as plain text).
pub fn prepare_prompt(cli: LocalCli, request: &ChatRequest) -> Result<CliPrompt, LlmError> {
    let forced_tool = forced_tool(cli, request)?;
    let mut instructions: Vec<String> = Vec::new();
    let mut conversation: Vec<&Message> = Vec::new();
    for message in &request.messages {
        check_message(cli, message)?;
        if message.role == Role::System {
            instructions.push(message.text());
        } else {
            conversation.push(message);
        }
    }
    if let Some(tool_name) = &forced_tool {
        instructions.push(forced_tool_instruction(request, tool_name));
    } else if let Some(format_instruction) = response_format_instruction(request.response_format.as_ref()) {
        instructions.push(format_instruction);
    }
    let instructions = instructions.into_iter().filter(|text| !text.trim().is_empty()).collect::<Vec<_>>().join("\n\n");
    let prompt = conversation_text(&conversation);
    let prompt = match cli {
        LocalCli::ClaudeCode => prompt,
        LocalCli::Codex => codex_prompt(&instructions, &prompt),
    };
    Ok(CliPrompt { instructions, prompt, forced_tool })
}

/// The one tool a request forces, if any; any other use of tools is a capability error.
fn forced_tool(cli: LocalCli, request: &ChatRequest) -> Result<Option<String>, LlmError> {
    if request.tools.is_empty() {
        return Ok(None);
    }
    match &request.tool_choice {
        Some(ToolChoice::Tool(name)) if request.tools.iter().any(|tool| &tool.name == name) => Ok(Some(name.clone())),
        Some(ToolChoice::None) => Ok(None),
        _ => Err(tool_calls_unsupported(cli)),
    }
}

fn check_message(cli: LocalCli, message: &Message) -> Result<(), LlmError> {
    if message.role == Role::Tool || !message.tool_calls.is_empty() {
        return Err(tool_calls_unsupported(cli));
    }
    if message.content.iter().any(|part| !matches!(part, ContentPart::Text { .. })) {
        return Err(LlmError::Config(format!(
            "{} (local CLI) can't read images — pick an API model for this step",
            cli.display_name()
        )));
    }
    Ok(())
}

fn forced_tool_instruction(request: &ChatRequest, tool_name: &str) -> String {
    let schema = request
        .tools
        .iter()
        .find(|tool| tool.name == tool_name)
        .map(|tool| tool.parameters.to_string())
        .unwrap_or_else(|| "{}".to_owned());
    format!(
        "Reply with only one JSON object (no prose, no code fence) holding the arguments for `{tool_name}`, \
         matching this JSON Schema:\n{schema}"
    )
}

fn response_format_instruction(format: Option<&ResponseFormat>) -> Option<String> {
    match format? {
        ResponseFormat::JsonSchema { schema, .. } => Some(format!(
            "Reply with only one JSON value (no prose, no code fence) matching this JSON Schema:\n{schema}"
        )),
        ResponseFormat::JsonObject => Some("Reply with only one JSON object (no prose, no code fence).".to_owned()),
        _ => None,
    }
}

/// One user message as is; anything longer as a transcript ending on the last message.
fn conversation_text(conversation: &[&Message]) -> String {
    if let [only] = conversation {
        if only.role == Role::User {
            return only.text();
        }
    }
    let mut transcript = String::from("Conversation so far:\n");
    for message in conversation {
        let speaker = if message.role == Role::Assistant { "Assistant" } else { "User" };
        transcript.push_str(&format!("\n[{speaker}]\n{}\n", message.text().trim_end()));
    }
    transcript.push_str("\nWrite the assistant's next reply to the last [User] message. Reply with that text only.");
    transcript
}

/// Codex takes no system prompt flag: the instructions go on top, with a reminder that
/// this is a plain text task (its sandbox is read-only anyway).
fn codex_prompt(instructions: &str, prompt: &str) -> String {
    let mut text = String::from(
        "You are used as a plain text model. Do not run commands, read or change files, or browse: \
         answer only from the text below.\n",
    );
    if !instructions.trim().is_empty() {
        text.push_str(&format!("\n# Instructions\n{instructions}\n"));
    }
    text.push_str(&format!("\n# Task\n{prompt}\n"));
    text
}

/// The first JSON object in `text` (a reply may wrap it in a code fence or a sentence).
pub fn first_json_object(text: &str) -> Option<serde_json::Map<String, serde_json::Value>> {
    text.char_indices().filter(|(_, character)| *character == '{').find_map(|(start, _)| {
        let mut values = serde_json::Deserializer::from_str(&text[start..]).into_iter::<serde_json::Value>();
        match values.next()? {
            Ok(serde_json::Value::Object(object)) => Some(object),
            _ => None,
        }
    })
}
