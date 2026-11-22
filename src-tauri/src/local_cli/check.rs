//! "Check connection": one tiny prompt through the CLI, only when the user asks
//! (it spends a little of their plan). Detection alone never sends a prompt.

use std::sync::Arc;
use std::time::{Duration, Instant};

use graphrt_llm::{ChatModel, ChatRequest, LlmError, Message};
use serde::{Deserialize, Serialize};

use super::detect::Detection;
use super::{LocalCli, LocalCliModel, CLI_DEFAULT_MODEL};

/// The check waits at most this long (a cold CLI start can take a few seconds).
const CHECK_TIMEOUT: Duration = Duration::from_secs(90);

/// Outcome of a connection check, in plain words.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalCliCheck {
    pub ok: bool,
    pub message: String,
}

/// Sends "Reply with the word OK." through `cli` and reports how it went.
pub async fn check_connection(cli: LocalCli, detection: Arc<Detection>) -> LocalCliCheck {
    let name = cli.display_name();
    if detection.binary.is_none() {
        return LocalCliCheck { ok: false, message: format!("{name} is not installed on this computer") };
    }
    let model = LocalCliModel::new(cli, detection).with_timeout(CHECK_TIMEOUT);
    let request = ChatRequest::new(
        CLI_DEFAULT_MODEL,
        vec![
            Message::system("You are a connection check. Reply with the single word OK."),
            Message::user("Reply with the word OK."),
        ],
    );
    let started = Instant::now();
    match ask(&model, request).await {
        Ok(reply) if !reply.trim().is_empty() => {
            LocalCliCheck { ok: true, message: format!("{name} answered in {:.1} s", started.elapsed().as_secs_f64()) }
        }
        Ok(_) => LocalCliCheck { ok: false, message: format!("{name} answered with nothing") },
        Err(error) => LocalCliCheck { ok: false, message: describe_check_error(&error) },
    }
}

async fn ask(model: &LocalCliModel, request: ChatRequest) -> Result<String, LlmError> {
    let stream = model.chat(request).await?;
    Ok(graphrt_llm::collect(stream, |_| {}).await?.text)
}

/// The error message without graphrt-llm's "authentication failed: " style prefix.
fn describe_check_error(error: &LlmError) -> String {
    match error {
        LlmError::Auth(message)
        | LlmError::BadRequest(message)
        | LlmError::Config(message)
        | LlmError::Network(message)
        | LlmError::Decode(message)
        | LlmError::ContextLength(message)
        | LlmError::RateLimit { message, .. }
        | LlmError::Server { message, .. } => message.clone(),
        other => other.to_string(),
    }
}
