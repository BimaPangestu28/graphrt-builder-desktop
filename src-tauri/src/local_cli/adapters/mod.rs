//! One [`CliAdapter`] per supported CLI, each documenting its exact command line and the
//! official docs it follows. Fixtures under `fixtures/` are recorded samples for Claude
//! Code and Codex; the others' are hand-written from their documented output formats
//! (marked "doc-derived" at the top of each file), since those CLIs could not be run here.

mod claude_code;
mod codex;
mod copilot;
mod cursor;
mod gemini;
mod opencode;
mod qwen;

use super::adapter::CliAdapter;
use super::LocalCli;

#[cfg(test)]
pub use claude_code::{claude_model_aliases, claude_models, parse_claude_auth_status};
#[cfg(test)]
pub use codex::{parse_codex_catalog, parse_codex_login_status};
#[cfg(test)]
pub use cursor::{parse_cursor_status, FIXED_REQUEST as CURSOR_FIXED_REQUEST};
#[cfg(test)]
pub use gemini::POLICY_FILE_NAME as GEMINI_POLICY_FILE_NAME;
#[cfg(test)]
pub use opencode::{agent_config as opencode_agent_config, parse_opencode_auth_list, parse_opencode_models};
#[cfg(test)]
pub use qwen::EXCLUDED_TOOLS as QWEN_EXCLUDED_TOOLS;

/// The adapter of `cli`.
pub fn adapter_for(cli: LocalCli) -> &'static dyn CliAdapter {
    match cli {
        LocalCli::ClaudeCode => &claude_code::ClaudeCodeAdapter,
        LocalCli::Codex => &codex::CodexAdapter,
        LocalCli::GeminiCli => &gemini::GeminiCliAdapter,
        LocalCli::CursorCli => &cursor::CursorAdapter,
        LocalCli::CopilotCli => &copilot::CopilotAdapter,
        LocalCli::OpenCode => &opencode::OpenCodeAdapter,
        LocalCli::QwenCode => &qwen::QwenCodeAdapter,
    }
}
