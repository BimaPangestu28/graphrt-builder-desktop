//! Qwen Code (`qwen`, npm `@qwen-code/qwen-code`, a Gemini CLI fork).
//!
//! Docs and source (verified against `main`, 0.28, 2026-11):
//! - install: <https://github.com/QwenLM/qwen-code> (README "Installation")
//! - headless mode: <https://github.com/QwenLM/qwen-code/blob/main/docs/users/features/headless.md>
//!   (piped stdin is the prompt; `--output-format stream-json` prints Claude-Code-style
//!   `system` / `assistant` / `stream_event` / `result` messages; headless runs exclude
//!   shell, edit and write tools by default)
//! - approval modes: <https://github.com/QwenLM/qwen-code/blob/main/docs/users/features/approval-mode.md>
//!   (`plan|default|auto-edit|auto|yolo`; `default` asks, and nothing can answer in headless)
//! - settings and flags: <https://github.com/QwenLM/qwen-code/blob/main/docs/users/configuration/settings.md>
//!   (`--exclude-tools` deny rules remove the tools, with the `Bash` / `Read` / `Edit`
//!   aliases; `-e none` disables every extension; `--chat-recording false`;
//!   `--max-tool-calls`)
//! - system prompt: `QWEN_SYSTEM_MD=<path>` replaces the base prompt
//!   (`packages/core/src/core/prompts.ts`); `--system-prompt` would put the text on the
//!   command line, so it is not used.
//!
//! Command line (prompt on stdin, tools excluded, nothing recorded):
//! `qwen --output-format stream-json --approval-mode default --exclude-tools <list>
//! [--include-partial-messages] [--extensions none] [--max-tool-calls 0]
//! [--chat-recording false] [-m <model>]`, with `QWEN_SYSTEM_MD=<workdir>/instructions.txt`
//! and `QWEN_TELEMETRY_ENABLED=false`. `--bare` is never passed (it lifts the headless
//! tool restrictions), nor `--yolo` / `auto`.
//!
//! Output is read with the Claude Code parser, refusing `tool_use` blocks and ending the
//! call at the `result` (Qwen may keep finishing background memory tasks afterwards).
//! Sign-in: `qwen auth` was removed (it checks inside the app with `/doctor`), so it
//! stays "not confirmed" until a run or "Check connection".

use std::path::Path;

use super::super::adapter::{named_models, CallPlan, CliAdapter, CliInfo, InstructionsDelivery};
use super::super::command::explicit_model;
use super::super::detect::Detection;
use super::super::parse::CliOutputParser;
use super::super::LocalCli;
use super::claude_code::ClaudeStreamParser;
use crate::model_catalog::AvailableModel;

pub struct QwenCodeAdapter;

const INFO: CliInfo = CliInfo {
    display_name: "Qwen Code",
    binary_names: &["qwen"],
    install_url: "https://github.com/QwenLM/qwen-code",
    provider_name: "qwen-code-cli",
    enabled_setting_key: "local_cli_enabled.qwen-code-cli",
    sign_in_hint: "open Terminal, run `qwen` and sign in",
    plan_name: "Qwen",
};

/// Every built-in tool, by the documented deny-rule aliases and tool names.
pub const EXCLUDED_TOOLS: &str = "Bash,Shell,Read,Edit,run_shell_command,read_file,read_many_files,write_file,edit,\
notebook_edit,grep_search,glob,list_directory,web_fetch,web_search,save_memory,todo_write,agent,skill,monitor";

/// Flags with a value, passed only when the installed version's help lists them.
const OPTIONAL_FLAGS: &[(&str, Option<&str>)] = &[
    ("--include-partial-messages", None),
    ("--extensions", Some("none")),
    ("--max-tool-calls", Some("0")),
    ("--chat-recording", Some("false")),
];

/// Models the docs name for `--model` (which ones work depends on the sign-in).
const DOCUMENTED_MODELS: &[(&str, &str)] =
    &[("qwen3-coder-plus", "Qwen3 Coder Plus"), ("qwen3.8-max", "Qwen3.8 Max"), ("qwen3.7-plus", "Qwen3.7 Plus")];

impl CliAdapter for QwenCodeAdapter {
    fn info(&self) -> &'static CliInfo {
        &INFO
    }

    fn instructions_delivery(&self) -> InstructionsDelivery {
        InstructionsDelivery::FileEnv("QWEN_SYSTEM_MD")
    }

    fn plan_call(
        &self,
        detection: &Detection,
        model: &str,
        _workdir: &Path,
        instructions_path: Option<&Path>,
    ) -> CallPlan {
        let mut args: Vec<String> =
            ["--output-format", "stream-json", "--approval-mode", "default", "--exclude-tools", EXCLUDED_TOOLS]
                .map(str::to_owned)
                .to_vec();
        for (flag, value) in OPTIONAL_FLAGS.iter().filter(|(flag, _)| detection.supports(flag)) {
            args.push((*flag).to_owned());
            args.extend(value.map(str::to_owned));
        }
        if let Some(model) = explicit_model(model) {
            args.extend(["-m".to_owned(), model.to_owned()]);
        }
        let mut env = vec![("QWEN_TELEMETRY_ENABLED".to_owned(), "false".to_owned())];
        if let Some(instructions_path) = instructions_path {
            env.push(("QWEN_SYSTEM_MD".to_owned(), instructions_path.display().to_string()));
        }
        CallPlan { args, env, files: Vec::new() }
    }

    fn parser(&self) -> Box<dyn CliOutputParser> {
        Box::new(ClaudeStreamParser::new(LocalCli::QwenCode, true))
    }

    fn list_models(&self, _detection: &Detection) -> Vec<AvailableModel> {
        named_models(DOCUMENTED_MODELS)
    }
}
