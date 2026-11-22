//! The graphrt `ChatModel` that answers through a local CLI.
//!
//! Every call starts the CLI in a fresh temporary working directory (removed when the
//! call ends), writes the prompt to its stdin and turns its JSON output into deltas as
//! lines arrive, so the answer streams. Dropping the stream (Stop run, Stop the builder)
//! kills the process; so does the timeout.

use std::collections::VecDeque;
use std::path::PathBuf;
use std::process::Stdio;
use std::sync::Arc;
use std::time::Duration;

use futures::future::BoxFuture;
use graphrt_llm::{ChatDelta, ChatModel, ChatRequest, ChatStream, FinishReason, LlmError};
use tokio::io::{AsyncBufReadExt, AsyncReadExt, AsyncWriteExt, BufReader, Lines};
use tokio::process::{Child, ChildStdout, Command};
use tokio::task::JoinHandle;
use tokio::time::Instant;

use super::adapter::{CallPlan, InstructionsDelivery, PromptDelivery};
use super::command::{is_valid_model_name, plan_call, INSTRUCTIONS_FILE_NAME};
use super::detect::Detection;
use super::parse::{parser_for, CliOutputParser};
use super::prompt::{first_json_object, prepare_prompt, CliPrompt};
use super::{LocalCli, CALL_TIMEOUT};

/// Most of stderr kept for error messages (the end is what matters).
const STDERR_TAIL_BYTES: usize = 8 * 1024;

/// A model provider backed by a local CLI.
#[derive(Debug, Clone)]
pub struct LocalCliModel {
    cli: LocalCli,
    detection: Arc<Detection>,
    timeout: Duration,
}

impl LocalCliModel {
    /// A model for `cli` as detected, with the default [`CALL_TIMEOUT`].
    pub fn new(cli: LocalCli, detection: Arc<Detection>) -> Self {
        Self { cli, detection, timeout: CALL_TIMEOUT }
    }

    /// The same model with another per-call timeout.
    pub fn with_timeout(mut self, timeout: Duration) -> Self {
        self.timeout = timeout;
        self
    }

    async fn start(self, request: ChatRequest) -> Result<ChatStream, LlmError> {
        let name = self.cli.display_name();
        if !is_valid_model_name(&request.model) {
            return Err(LlmError::Config(format!("`{}` is not a {name} model name", request.model.trim())));
        }
        let binary = self.detection.binary.clone().ok_or_else(|| {
            LlmError::Config(format!("{name} is not installed on this computer (see {})", self.cli.install_url()))
        })?;
        let prompt = prepare_prompt(self.cli, &request)?;
        let workdir = tempfile::Builder::new()
            .prefix("graphrt-cli-")
            .tempdir()
            .map_err(|error| LlmError::Config(format!("could not make a working folder for {name}: {error}")))?;
        let instructions_path = self.write_instructions(&prompt, workdir.path())?;
        let plan = plan_call(self.cli, &self.detection, &request.model, workdir.path(), instructions_path.as_deref());
        let stdin_text = self.deliver_prompt(&prompt, workdir.path())?;
        write_workdir_files(&plan, workdir.path())?;
        let mut child = self.spawn(&binary, &plan, workdir.path())?;
        write_prompt(&mut child, stdin_text);
        let stderr_tail = collect_stderr_tail(&mut child);
        let stdout = child.stdout.take().ok_or_else(|| LlmError::Config(format!("{name} has no output")))?;
        let state = CallState {
            cli: self.cli,
            child,
            lines: BufReader::new(stdout).lines(),
            parser: parser_for(self.cli),
            pending: VecDeque::new(),
            deadline: Instant::now() + self.timeout,
            timeout: self.timeout,
            stderr_tail: Some(stderr_tail),
            forced_tool: prompt.forced_tool,
            forced_tool_text: String::new(),
            is_done: false,
            _workdir: workdir,
        };
        Ok(Box::pin(futures::stream::unfold(state, next_delta)))
    }

    /// The instructions file for CLIs reading their system prompt from one (Claude Code's
    /// flag, Gemini CLI's environment variable); the others get it in the prompt.
    fn write_instructions(&self, prompt: &CliPrompt, workdir: &std::path::Path) -> Result<Option<PathBuf>, LlmError> {
        let uses_file = !matches!(self.cli.adapter().instructions_delivery(), InstructionsDelivery::InPrompt);
        if !uses_file || prompt.instructions.trim().is_empty() {
            return Ok(None);
        }
        let path = workdir.join(INSTRUCTIONS_FILE_NAME);
        std::fs::write(&path, &prompt.instructions)
            .map_err(|error| LlmError::Config(format!("could not write the instructions file: {error}")))?;
        Ok(Some(path))
    }

    /// What goes to stdin: the prompt, or nothing when the adapter takes it as a rules
    /// file in the working directory (then written there).
    fn deliver_prompt(&self, prompt: &CliPrompt, workdir: &std::path::Path) -> Result<String, LlmError> {
        match self.cli.adapter().prompt_delivery() {
            PromptDelivery::Stdin => Ok(prompt.prompt.clone()),
            PromptDelivery::WorkdirRulesFile(file_name) => {
                std::fs::write(workdir.join(file_name), &prompt.prompt)
                    .map_err(|error| LlmError::Config(format!("could not write the prompt file: {error}")))?;
                Ok(String::new())
            }
        }
    }

    fn spawn(&self, binary: &std::path::Path, plan: &CallPlan, workdir: &std::path::Path) -> Result<Child, LlmError> {
        let mut command = Command::new(binary);
        command
            .args(&plan.args)
            .envs(plan.env.iter().map(|(name, value)| (name.as_str(), value.as_str())))
            .current_dir(workdir)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .kill_on_drop(true);
        if let Some(child_path) = &self.detection.child_path {
            command.env("PATH", child_path);
        }
        #[cfg(windows)]
        command.creation_flags(0x0800_0000);
        log::info!("asking {} (local CLI)", self.cli.display_name());
        command
            .spawn()
            .map_err(|error| LlmError::Config(format!("could not start {}: {error}", self.cli.display_name())))
    }
}

impl ChatModel for LocalCliModel {
    fn chat(&self, request: ChatRequest) -> BoxFuture<'_, Result<ChatStream, LlmError>> {
        Box::pin(self.clone().start(request))
    }
}

/// The adapter's working-folder files (e.g. a project config denying every tool).
fn write_workdir_files(plan: &CallPlan, workdir: &std::path::Path) -> Result<(), LlmError> {
    for (relative_path, content) in &plan.files {
        let path = workdir.join(relative_path);
        let written =
            path.parent().map_or(Ok(()), std::fs::create_dir_all).and_then(|()| std::fs::write(&path, content));
        written.map_err(|error| LlmError::Config(format!("could not prepare the working folder: {error}")))?;
    }
    Ok(())
}

/// Writes the prompt and closes stdin so the CLI starts answering.
fn write_prompt(child: &mut Child, prompt: String) {
    let Some(mut stdin) = child.stdin.take() else { return };
    tokio::spawn(async move {
        if let Err(error) = stdin.write_all(prompt.as_bytes()).await {
            log::warn!("could not hand the prompt to the local CLI: {error}");
        }
        drop(stdin);
    });
}

/// Reads stderr to its end, keeping the last [`STDERR_TAIL_BYTES`].
fn collect_stderr_tail(child: &mut Child) -> JoinHandle<String> {
    let stderr = child.stderr.take();
    tokio::spawn(async move {
        let Some(mut stderr) = stderr else { return String::new() };
        let mut tail: Vec<u8> = Vec::new();
        let mut buffer = [0_u8; 4096];
        while let Ok(read) = stderr.read(&mut buffer).await {
            if read == 0 {
                break;
            }
            tail.extend_from_slice(&buffer[..read]);
            if tail.len() > STDERR_TAIL_BYTES {
                tail.drain(..tail.len() - STDERR_TAIL_BYTES);
            }
        }
        String::from_utf8_lossy(&tail).into_owned()
    })
}

/// One running call. Dropping it kills the process and removes the working folder.
struct CallState {
    cli: LocalCli,
    child: Child,
    lines: Lines<BufReader<ChildStdout>>,
    parser: Box<dyn CliOutputParser>,
    pending: VecDeque<Result<ChatDelta, LlmError>>,
    deadline: Instant,
    timeout: Duration,
    stderr_tail: Option<JoinHandle<String>>,
    forced_tool: Option<String>,
    /// Answer text of a forced-tool request, turned into the tool call at the end.
    forced_tool_text: String,
    is_done: bool,
    _workdir: tempfile::TempDir,
}

async fn next_delta(mut state: CallState) -> Option<(Result<ChatDelta, LlmError>, CallState)> {
    loop {
        if let Some(item) = state.pending.pop_front() {
            return Some((item, state));
        }
        if state.is_done {
            return None;
        }
        state.read_next().await;
    }
}

impl CallState {
    async fn read_next(&mut self) {
        match tokio::time::timeout_at(self.deadline, self.lines.next_line()).await {
            Err(_elapsed) => self.fail(timeout_error(self.cli, self.timeout)).await,
            Ok(Ok(Some(line))) => match self.parser.parse_line(&line) {
                Ok(deltas) => {
                    self.accept(deltas);
                    if self.parser.is_complete() {
                        self.complete_early().await;
                    }
                }
                Err(error) => self.fail(error).await,
            },
            Ok(Ok(None)) => self.finish().await,
            Ok(Err(error)) => {
                let message = format!("could not read {}'s answer: {error}", self.cli.display_name());
                self.fail(LlmError::BadRequest(message)).await;
            }
        }
    }

    /// Ends the call with `error`, killing the process if it still runs.
    async fn fail(&mut self, error: LlmError) {
        let _kill_result = self.child.kill().await;
        self.pending.push_back(Err(error));
        self.is_done = true;
    }

    /// The parser has the whole answer: stop the process instead of waiting for it.
    async fn complete_early(&mut self) {
        let _kill_result = self.child.kill().await;
        self.flush_forced_tool(None);
        self.is_done = true;
    }

    /// Stdout closed: wait for the exit and let the parser report what is missing.
    async fn finish(&mut self) {
        let exited_successfully = match tokio::time::timeout_at(self.deadline, self.child.wait()).await {
            Ok(Ok(status)) => status.success(),
            _ => {
                let _kill_result = self.child.kill().await;
                false
            }
        };
        let stderr = match self.stderr_tail.take() {
            Some(task) => task.await.unwrap_or_default(),
            None => String::new(),
        };
        match self.parser.finish(exited_successfully, &stderr) {
            Ok(deltas) => self.accept(deltas),
            Err(error) => self.pending.push_back(Err(error)),
        }
        self.flush_forced_tool(None);
        self.is_done = true;
    }

    fn accept(&mut self, deltas: Vec<ChatDelta>) {
        for delta in deltas {
            match delta {
                ChatDelta::Text(text) if self.forced_tool.is_some() => self.forced_tool_text.push_str(&text),
                ChatDelta::Finish(reason) if self.forced_tool.is_some() => self.flush_forced_tool(Some(reason)),
                other => self.pending.push_back(Ok(other)),
            }
        }
    }

    /// A forced-tool answer becomes that tool's call when it holds a JSON object,
    /// otherwise it stays text (graphrt then reports the reply did not fit).
    fn flush_forced_tool(&mut self, finish: Option<FinishReason>) {
        let Some(tool_name) = self.forced_tool.take() else { return };
        let text = std::mem::take(&mut self.forced_tool_text);
        let finish = match first_json_object(&text) {
            Some(arguments) => {
                self.pending.push_back(Ok(ChatDelta::ToolCall {
                    index: 0,
                    id: Some("local_cli_call_1".to_owned()),
                    name: Some(tool_name),
                    arguments: serde_json::Value::Object(arguments).to_string(),
                }));
                finish.map(|_| FinishReason::ToolCalls)
            }
            None => {
                if !text.is_empty() {
                    self.pending.push_back(Ok(ChatDelta::Text(text)));
                }
                finish
            }
        };
        if let Some(finish) = finish {
            self.pending.push_back(Ok(ChatDelta::Finish(finish)));
        }
    }
}

fn timeout_error(cli: LocalCli, timeout: Duration) -> LlmError {
    let seconds = timeout.as_secs();
    let limit = if seconds >= 120 { format!("{} minutes", seconds / 60) } else { format!("{seconds} seconds") };
    LlmError::BadRequest(format!("{} did not finish within {limit}, so graphrt stopped it", cli.display_name()))
}
