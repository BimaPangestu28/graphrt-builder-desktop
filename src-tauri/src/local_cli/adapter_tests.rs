//! Tests of the adapters added after Claude Code and Codex (Gemini CLI, Cursor CLI,
//! GitHub Copilot CLI, OpenCode, Qwen Code) and of the shared adapter registry.
//!
//! None of these CLIs could be run while writing them, so every output fixture under
//! `fixtures/doc_derived/` is hand-written from the CLI's documented output format (each
//! file says so and names its source on its first line).

use std::collections::BTreeSet;
use std::path::Path;

use graphrt_llm::{ChatDelta, ChatRequest, FinishReason, LlmError, Message, ToolChoice};

use super::adapters::{self, CURSOR_FIXED_REQUEST, GEMINI_POLICY_FILE_NAME, QWEN_EXCLUDED_TOOLS};
use super::capability::capability_gap;
use super::command::{self, build_args};
use super::detect::Detection;
use super::parse::parser_for;
use super::prompt::prepare_prompt;
use super::*;

const GEMINI_SUCCESS: &str = include_str!("fixtures/doc_derived/gemini_stream_success.jsonl");
const GEMINI_AUTH_ERROR: &str = include_str!("fixtures/doc_derived/gemini_stream_auth_error.jsonl");
const GEMINI_TOOL_USE: &str = include_str!("fixtures/doc_derived/gemini_stream_tool_use.jsonl");
const CURSOR_PARTIAL: &str = include_str!("fixtures/doc_derived/cursor_stream_partial.jsonl");
const CURSOR_NO_PARTIAL: &str = include_str!("fixtures/doc_derived/cursor_stream_no_partial.jsonl");
const CURSOR_TOOL_CALL: &str = include_str!("fixtures/doc_derived/cursor_stream_tool_call.jsonl");
const COPILOT_SUCCESS: &str = include_str!("fixtures/doc_derived/copilot_jsonl_success.jsonl");
const COPILOT_AUTH_FAILURE: &str = include_str!("fixtures/doc_derived/copilot_jsonl_auth_failure.jsonl");
const OPENCODE_SUCCESS: &str = include_str!("fixtures/doc_derived/opencode_json_success.jsonl");
const OPENCODE_AUTH_ERROR: &str = include_str!("fixtures/doc_derived/opencode_json_auth_error.jsonl");
const QWEN_SUCCESS: &str = include_str!("fixtures/doc_derived/qwen_stream_success.jsonl");
const QWEN_TOOL_USE: &str = include_str!("fixtures/doc_derived/qwen_stream_tool_use.jsonl");
const QWEN_ERROR: &str = include_str!("fixtures/doc_derived/qwen_stream_error.jsonl");

/// The CLIs this file covers.
const NEW_CLIS: [LocalCli; 5] =
    [LocalCli::GeminiCli, LocalCli::CursorCli, LocalCli::CopilotCli, LocalCli::OpenCode, LocalCli::QwenCode];

fn parse_all(cli: LocalCli, output: &str) -> Result<Vec<ChatDelta>, LlmError> {
    let mut parser = parser_for(cli);
    let mut deltas = Vec::new();
    for line in output.lines() {
        deltas.extend(parser.parse_line(line)?);
    }
    deltas.extend(parser.finish(true, "")?);
    Ok(deltas)
}

fn text_of(deltas: &[ChatDelta]) -> String {
    deltas
        .iter()
        .filter_map(|delta| if let ChatDelta::Text(text) = delta { Some(text.as_str()) } else { None })
        .collect()
}

fn usage_of(deltas: &[ChatDelta]) -> Option<(u64, u64)> {
    deltas.iter().rev().find_map(|delta| match delta {
        ChatDelta::Usage(usage) => Some((usage.prompt_tokens, usage.completion_tokens)),
        _ => None,
    })
}

fn detection_with_flags(flags: &[&str]) -> Detection {
    Detection { flags: flags.iter().map(|flag| (*flag).to_owned()).collect::<BTreeSet<_>>(), ..Detection::default() }
}

fn strings(values: &[&str]) -> Vec<String> {
    values.iter().map(|value| (*value).to_owned()).collect()
}

// ---- Registry ----

#[test]
fn every_cli_has_its_own_provider_setting_and_official_install_page() {
    let mut provider_names = BTreeSet::new();
    for cli in LocalCli::ALL {
        assert!(provider_names.insert(cli.provider_name()), "{} is listed twice", cli.provider_name());
        assert_eq!(LocalCli::from_provider_name(cli.provider_name()), Some(cli));
        assert_eq!(cli.enabled_setting_key(), format!("local_cli_enabled.{}", cli.provider_name()));
        assert!(cli.install_url().starts_with("https://"), "{}", cli.install_url());
        let provider = crate::credentials::ModelProvider::for_local_cli(cli);
        assert_eq!(provider.local_cli(), Some(cli));
        assert_eq!(serde_json::to_value(provider).unwrap(), cli.provider_name());
    }
    assert_eq!(LocalCli::ALL[..2], [LocalCli::ClaudeCode, LocalCli::Codex], "Claude Code and Codex stay first");
    let install_pages: Vec<&str> = NEW_CLIS.iter().map(|cli| cli.install_url()).collect();
    assert_eq!(
        install_pages,
        [
            "https://github.com/google-gemini/gemini-cli",
            "https://cursor.com/docs/cli/installation",
            "https://docs.github.com/en/copilot/how-tos/set-up/install-copilot-cli",
            "https://opencode.ai/docs/",
            "https://github.com/QwenLM/qwen-code",
        ]
    );
}

#[test]
fn every_cli_lists_cli_default_first() {
    for cli in LocalCli::ALL {
        let models = list_models(cli, &Detection::default());
        assert_eq!(models[0].id, CLI_DEFAULT_MODEL, "{}", cli.display_name());
        let ids: BTreeSet<&str> = models.iter().map(|model| model.id.as_str()).collect();
        assert_eq!(ids.len(), models.len(), "no duplicates for {}", cli.display_name());
        assert!(models.iter().all(|model| command::is_valid_model_name(&model.id)), "{}", cli.display_name());
    }
    let gemini: Vec<String> =
        list_models(LocalCli::GeminiCli, &Detection::default()).into_iter().map(|m| m.id).collect();
    assert_eq!(gemini, ["default", "auto", "pro", "flash", "flash-lite", "gemini-2.5-pro", "gemini-2.5-flash"]);
}

// ---- Exact command lines ----

#[test]
fn gemini_command_line_denies_every_tool_and_reads_stdin() {
    let workdir = Path::new("/tmp/w");
    let plan = command::plan_call(
        LocalCli::GeminiCli,
        &detection_with_flags(&["--skip-trust"]),
        "flash",
        workdir,
        Some(Path::new("/tmp/w/instructions.txt")),
    );
    assert_eq!(
        plan.args,
        strings(&[
            "--output-format",
            "stream-json",
            "--approval-mode",
            "default",
            "--policy",
            "/tmp/w/graphrt-deny-all.toml",
            "--skip-trust",
            "-m",
            "flash",
        ])
    );
    assert!(!plan.args.iter().any(|arg| arg == "-p" || arg == "--yolo" || arg == "plan"), "{:?}", plan.args);
    assert!(plan.env.contains(&("GEMINI_SYSTEM_MD".into(), "/tmp/w/instructions.txt".into())));
    assert!(plan.env.contains(&("GEMINI_CLI_TRUST_WORKSPACE".into(), "true".into())));
    let (policy_name, policy) = &plan.files[0];
    assert_eq!(policy_name, GEMINI_POLICY_FILE_NAME);
    assert!(policy.contains("toolName = \"*\"") && policy.contains("decision = \"deny\""), "{policy}");
    let without_trust_flag = build_args(LocalCli::GeminiCli, &Detection::default(), "default", workdir, None);
    assert!(!without_trust_flag.contains(&"--skip-trust".to_owned()) && !without_trust_flag.contains(&"-m".to_owned()));
}

#[test]
fn cursor_command_line_is_ask_mode_with_a_fixed_request() {
    let detection = detection_with_flags(&["--stream-partial-output", "--mode", "--trust", "--workspace"]);
    let plan = command::plan_call(LocalCli::CursorCli, &detection, "gpt-5", Path::new("/tmp/w"), None);
    assert_eq!(
        plan.args,
        strings(&[
            "-p",
            "--output-format",
            "stream-json",
            "--stream-partial-output",
            "--mode",
            "ask",
            "--trust",
            "--workspace",
            "/tmp/w",
            "--model",
            "gpt-5",
            CURSOR_FIXED_REQUEST,
        ])
    );
    assert!(!plan.args.iter().any(|arg| ["--force", "--yolo", "--approve-mcps"].contains(&arg.as_str())));
    let (config_path, config) = &plan.files[0];
    assert_eq!(config_path, ".cursor/cli.json");
    let config: serde_json::Value = serde_json::from_str(config).unwrap();
    let denied: Vec<&str> =
        config["permissions"]["deny"].as_array().unwrap().iter().filter_map(serde_json::Value::as_str).collect();
    for rule in ["Shell(*)", "Write(**)", "Read(**)", "WebFetch(*)", "Mcp(*:*)"] {
        assert!(denied.contains(&rule), "{rule} missing from {denied:?}");
    }
    let old_version = build_args(LocalCli::CursorCli, &Detection::default(), "default", Path::new("/tmp/w"), None);
    assert_eq!(old_version, strings(&["-p", "--output-format", "stream-json", CURSOR_FIXED_REQUEST]));
}

#[test]
fn copilot_command_line_denies_and_removes_every_tool() {
    let detection = detection_with_flags(&[
        "--excluded-tools",
        "--disable-builtin-mcps",
        "--no-ask-user",
        "--no-custom-instructions",
        "--no-auto-update",
    ]);
    let args = build_args(LocalCli::CopilotCli, &detection, "claude-sonnet-5.5", Path::new("/tmp/w"), None);
    assert_eq!(
        args[..8],
        strings(&[
            "--output-format",
            "json",
            "--no-color",
            "--deny-tool=shell",
            "--deny-tool=write",
            "--deny-tool=read",
            "--deny-tool=url",
            "--deny-tool=memory",
        ])
    );
    for tool in ["bash", "powershell", "create", "edit", "apply_patch", "view", "web_fetch", "task"] {
        assert!(args.contains(&format!("--excluded-tools={tool}")), "{tool} not excluded: {args:?}");
    }
    assert!(args.ends_with(&strings(&[
        "--disable-builtin-mcps",
        "--no-ask-user",
        "--no-custom-instructions",
        "--no-auto-update",
        "--model",
        "claude-sonnet-5.5",
    ])));
    assert!(!args.iter().any(|arg| arg.starts_with("--allow") || arg == "-p" || arg == "--yolo"), "{args:?}");
    let old_version = build_args(LocalCli::CopilotCli, &Detection::default(), "default", Path::new("/tmp/w"), None);
    assert_eq!(old_version.len(), 8, "the deny rules are always passed: {old_version:?}");
}

#[test]
fn opencode_command_line_runs_a_text_only_agent() {
    let plan = command::plan_call(
        LocalCli::OpenCode,
        &detection_with_flags(&["--pure"]),
        "anthropic/claude-sonnet-5-5",
        Path::new("/tmp/w"),
        None,
    );
    assert_eq!(
        plan.args,
        strings(&[
            "run",
            "--format",
            "json",
            "--agent",
            "graphrt-text-only",
            "--pure",
            "-m",
            "anthropic/claude-sonnet-5-5"
        ])
    );
    assert!(!plan
        .args
        .iter()
        .any(|arg| ["--auto", "--yolo", "--dangerously-skip-permissions"].contains(&arg.as_str())));
    let env: std::collections::HashMap<&str, &str> =
        plan.env.iter().map(|(name, value)| (name.as_str(), value.as_str())).collect();
    let config: serde_json::Value = serde_json::from_str(env["OPENCODE_CONFIG_CONTENT"]).unwrap();
    assert_eq!(config["agent"]["graphrt-text-only"]["permission"], serde_json::json!({"*": "deny"}));
    assert_eq!(config["agent"]["graphrt-text-only"]["mode"], "primary");
    assert_eq!(env["OPENCODE_PERMISSION"], r#"{"*":"deny"}"#);
    assert_eq!(env["OPENCODE_DISABLE_CLAUDE_CODE_PROMPT"], "1");
    assert_eq!(adapters::opencode_agent_config(), env["OPENCODE_CONFIG_CONTENT"]);
}

#[test]
fn qwen_command_line_excludes_tools_and_records_nothing() {
    let detection =
        detection_with_flags(&["--include-partial-messages", "--extensions", "--max-tool-calls", "--chat-recording"]);
    let plan = command::plan_call(
        LocalCli::QwenCode,
        &detection,
        "qwen3-coder-plus",
        Path::new("/tmp/w"),
        Some(Path::new("/tmp/w/instructions.txt")),
    );
    assert_eq!(
        plan.args,
        strings(&[
            "--output-format",
            "stream-json",
            "--approval-mode",
            "default",
            "--exclude-tools",
            QWEN_EXCLUDED_TOOLS,
            "--include-partial-messages",
            "--extensions",
            "none",
            "--max-tool-calls",
            "0",
            "--chat-recording",
            "false",
            "-m",
            "qwen3-coder-plus",
        ])
    );
    for tool in ["Bash", "Read", "Edit", "run_shell_command", "write_file", "web_fetch"] {
        assert!(QWEN_EXCLUDED_TOOLS.split(',').any(|excluded| excluded == tool), "{tool}");
    }
    assert!(!plan.args.iter().any(|arg| ["--bare", "--yolo", "auto", "--system-prompt"].contains(&arg.as_str())));
    assert!(plan.env.contains(&("QWEN_SYSTEM_MD".into(), "/tmp/w/instructions.txt".into())));
}

// ---- Prompts and capabilities ----

#[test]
fn system_prompt_replacements_say_text_only_and_others_get_it_in_the_prompt() {
    let request = ChatRequest::new("default", vec![Message::system("Be brief."), Message::user("Hi")]);
    for cli in [LocalCli::GeminiCli, LocalCli::QwenCode] {
        let prompt = prepare_prompt(cli, &request).unwrap();
        assert!(prompt.instructions.starts_with("You are used as a plain text model"), "{}", prompt.instructions);
        assert!(prompt.instructions.ends_with("Be brief."), "{}", prompt.instructions);
        assert_eq!(prompt.prompt, "Hi");
    }
    for cli in [LocalCli::CursorCli, LocalCli::CopilotCli, LocalCli::OpenCode] {
        let prompt = prepare_prompt(cli, &request).unwrap();
        assert!(prompt.prompt.contains("# Instructions\nBe brief.") && prompt.prompt.contains("# Task\nHi"));
    }
    let bare = prepare_prompt(LocalCli::GeminiCli, &ChatRequest::new("default", vec![Message::user("Hi")])).unwrap();
    assert!(bare.instructions.starts_with("You are used as a plain text model"), "never the built-in coding prompt");
}

#[test]
fn tools_and_images_are_capability_errors_for_every_new_cli() {
    let search = graphrt_core::tool::ToolSpec {
        name: "search".into(),
        description: "Search".into(),
        parameters: serde_json::json!({"type": "object"}),
    };
    for cli in NEW_CLIS {
        let request = ChatRequest::new("default", vec![Message::user("Find it")])
            .with_tools(vec![search.clone()])
            .with_tool_choice(ToolChoice::Auto);
        let error = prepare_prompt(cli, &request).unwrap_err();
        assert_eq!(
            error,
            LlmError::Config(format!(
                "{} (local CLI) can't do tool calls in a Run an agent step — pick an API model for this step",
                cli.display_name()
            ))
        );
        let config =
            serde_json::json!({"model": {"provider": cli.provider_name(), "name": "default"}, "tools": ["web/*"]});
        let gap = capability_gap("agent", config.as_object().unwrap()).unwrap();
        assert_eq!(
            gap.message("Research"),
            format!(
                "Research uses {} (on this computer), which can't call tools: pick an API model for this step",
                cli.display_name()
            )
        );
        let vision = serde_json::json!({"model": {"provider": cli.provider_name(), "name": "x"}, "vision": true});
        assert_eq!(capability_gap("llm", vision.as_object().unwrap()).map(|gap| gap.reason), Some("can't read images"));
    }
}

// ---- Output parsing (doc-derived fixtures) ----

#[test]
fn gemini_stream_json_streams_assistant_deltas_and_reads_stats() {
    let deltas = parse_all(LocalCli::GeminiCli, GEMINI_SUCCESS).unwrap();
    assert_eq!(text_of(&deltas), "Hello from Gemini.", "the user echo is not part of the answer");
    assert_eq!(usage_of(&deltas), Some((120, 10)));
    assert_eq!(deltas.last(), Some(&ChatDelta::Finish(FinishReason::Stop)));
}

#[test]
fn gemini_errors_name_the_sign_in_and_refuse_tools() {
    let error = parse_all(LocalCli::GeminiCli, GEMINI_AUTH_ERROR).unwrap_err();
    let LlmError::Auth(message) = error else { panic!("expected an auth error, got {error:?}") };
    assert!(message.contains("Gemini CLI is not signed in") && message.contains("run `gemini`"), "{message}");
    let error = parse_all(LocalCli::GeminiCli, GEMINI_TOOL_USE).unwrap_err();
    assert!(error.to_string().contains("tried to use the `run_shell_command` tool"), "{error}");
    let mut parser = parser_for(LocalCli::GeminiCli);
    let stderr = "Error: something\n{\"session_id\":\"s\",\"error\":{\"type\":\"FatalTurnLimitedError\",\"message\":\"Maximum session turns exceeded\"}}";
    assert!(parser.finish(false, stderr).unwrap_err().to_string().contains("Maximum session turns exceeded"));
}

#[test]
fn cursor_stream_json_uses_deltas_and_skips_the_final_flush() {
    let deltas = parse_all(LocalCli::CursorCli, CURSOR_PARTIAL).unwrap();
    assert_eq!(text_of(&deltas), "Halo dari Cursor.");
    let deltas = parse_all(LocalCli::CursorCli, CURSOR_NO_PARTIAL).unwrap();
    assert_eq!(text_of(&deltas), r#"{"city": "Bandung"}"#, "the complete message once, not repeated from the result");
    let error = parse_all(LocalCli::CursorCli, CURSOR_TOOL_CALL).unwrap_err();
    assert!(error.to_string().contains("Cursor CLI tried to use the `writeToolCall` tool"), "{error}");
    let mut parser = parser_for(LocalCli::CursorCli);
    let error = parser.finish(false, "Error: Not authenticated. Run cursor-agent login\n").unwrap_err();
    assert!(matches!(error, LlmError::Auth(ref message) if message.contains("cursor-agent login")), "{error:?}");
}

#[test]
fn copilot_jsonl_streams_deltas_and_reads_the_result_record() {
    let deltas = parse_all(LocalCli::CopilotCli, COPILOT_SUCCESS).unwrap();
    assert_eq!(text_of(&deltas), "Hello from Copilot.", "deltas only, not repeated from the complete message");
    assert_eq!(usage_of(&deltas), Some((210, 12)));
    let error = parse_all(LocalCli::CopilotCli, COPILOT_AUTH_FAILURE).unwrap_err();
    assert!(matches!(error, LlmError::Auth(ref message) if message.contains("/login")), "{error:?}");
    let mut parser = parser_for(LocalCli::CopilotCli);
    parser.parse_line(r#"{"type":"assistant.message","data":{"content":"Only text"}}"#).unwrap();
    assert_eq!(parser.finish(true, "").unwrap(), [ChatDelta::Finish(FinishReason::Stop)], "no result record is fine");
    let error = parser_for(LocalCli::CopilotCli)
        .parse_line(r#"{"type":"tool.execution_start","data":{"toolName":"bash"}}"#)
        .unwrap_err();
    assert!(error.to_string().contains("`bash`"), "{error}");
}

#[test]
fn opencode_json_reads_text_parts_and_step_tokens() {
    let deltas = parse_all(LocalCli::OpenCode, OPENCODE_SUCCESS).unwrap();
    assert_eq!(text_of(&deltas), "Hello from OpenCode.");
    assert_eq!(usage_of(&deltas), Some((1200 + 100, 10)));
    let error = parse_all(LocalCli::OpenCode, OPENCODE_AUTH_ERROR).unwrap_err();
    assert!(matches!(error, LlmError::Auth(ref message) if message.contains("opencode auth login")), "{error:?}");
    let error = parser_for(LocalCli::OpenCode)
        .parse_line(r#"{"type":"tool_use","part":{"type":"tool","tool":"bash","state":{"status":"completed"}}}"#)
        .unwrap_err();
    assert!(error.to_string().contains("`bash`"), "{error}");
    let mut parser = parser_for(LocalCli::OpenCode);
    let error = parser.finish(false, "Error: You must provide a message or a command\n").unwrap_err();
    assert!(error.to_string().contains("You must provide a message"), "{error}");
}

#[test]
fn qwen_stream_json_reads_like_claude_code_and_refuses_tools() {
    let deltas = parse_all(LocalCli::QwenCode, QWEN_SUCCESS).unwrap();
    assert_eq!(text_of(&deltas), "Ibu kota Prancis adalah Paris.");
    assert_eq!(usage_of(&deltas), Some((320, 8)));
    let error = parse_all(LocalCli::QwenCode, QWEN_TOOL_USE).unwrap_err();
    assert!(error.to_string().contains("Qwen Code tried to use the `run_shell_command` tool"), "{error}");
    let error = parse_all(LocalCli::QwenCode, QWEN_ERROR).unwrap_err();
    assert!(matches!(error, LlmError::RateLimit { ref message, .. } if message.contains("Qwen plan")), "{error:?}");
}

// ---- Sign-in status and model lists (no usage spent) ----

#[test]
fn sign_in_statuses_are_read_from_the_clis_own_commands() {
    assert_eq!(adapters::parse_cursor_status("Not authenticated"), SignInState::SignedOut);
    assert_eq!(adapters::parse_cursor_status("✓ Logged in as someone@example.com"), SignInState::SignedIn);
    assert_eq!(adapters::parse_cursor_status("Endpoint: api2.cursor.sh"), SignInState::Unknown);
    let opencode_signed_in =
        "┌  Credentials ~/.local/share/opencode/auth.json\n│\n●  Anthropic oauth\n│\n└  1 credentials\n";
    assert_eq!(adapters::parse_opencode_auth_list(opencode_signed_in), SignInState::SignedIn);
    let opencode_env_only = "└  0 credentials\n┌  Environment\n●  OpenAI OPENAI_API_KEY\n└  1 environment variable\n";
    assert_eq!(adapters::parse_opencode_auth_list(opencode_env_only), SignInState::SignedIn);
    assert_eq!(adapters::parse_opencode_auth_list("└  0 credentials\n"), SignInState::Unknown);
    for cli in [LocalCli::GeminiCli, LocalCli::CopilotCli, LocalCli::QwenCode] {
        assert_eq!(cli.adapter().sign_in_args(), None, "{} has no status command", cli.display_name());
    }
}

#[test]
fn opencode_models_are_its_provider_model_lines() {
    let stdout = "opencode/grok-code\nanthropic/claude-sonnet-5-5\nopenrouter/qwen/qwen3-coder\n\nnot a model line\n";
    let ids: Vec<String> = adapters::parse_opencode_models(stdout).into_iter().map(|model| model.id).collect();
    assert_eq!(ids, ["opencode/grok-code", "anthropic/claude-sonnet-5-5", "openrouter/qwen/qwen3-coder"]);
}

// ---- Fake binaries (detection, end-to-end calls) ----

#[cfg(unix)]
mod fake_binaries {
    use std::path::PathBuf;
    use std::sync::Arc;
    use std::time::{Duration, Instant};

    use graphrt_llm::ChatModel;

    use super::*;
    use crate::local_cli::detect::{self, Locator};

    fn write_script(dir: &Path, name: &str, body: &str) -> PathBuf {
        use std::os::unix::fs::PermissionsExt;
        let path = dir.join(name);
        std::fs::write(&path, format!("#!/bin/sh\n{body}\n")).unwrap();
        std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o755)).unwrap();
        path
    }

    fn locator_for(dir: &Path) -> Locator {
        Locator { path_var: Some(dir.as_os_str().to_owned()), ..Locator::default() }
    }

    #[test]
    fn detection_finds_each_new_cli_in_a_temporary_path() {
        let bin_dir = tempfile::tempdir().unwrap();
        write_script(
            bin_dir.path(),
            "gemini",
            r#"case "$1" in --version) echo "0.71.0" ;; --help) echo "  --policy  --skip-trust  --approval-mode" ;; *) exit 1 ;; esac"#,
        );
        write_script(
            bin_dir.path(),
            "cursor-agent",
            r#"case "$1" in --version) echo "2026.11.20-abc" ;; --help) echo "Cursor Agent  --mode  --trust" ;; status) echo "Not authenticated" ;; esac"#,
        );
        write_script(
            bin_dir.path(),
            "copilot",
            r#"case "$1" in --version) echo "1.0.114" ;; --help) echo "  --excluded-tools  --no-ask-user" ;; esac"#,
        );
        write_script(
            bin_dir.path(),
            "opencode",
            r#"case "$1" in --version) echo "1.19.6" ;; run) echo "  --format  --pure" ;; auth) echo "└  2 credentials" >&2 ;; esac"#,
        );
        write_script(
            bin_dir.path(),
            "qwen",
            r#"case "$1" in --version) echo "0.28.3" ;; --help) echo "  --chat-recording" ;; esac"#,
        );
        let locator = locator_for(bin_dir.path());

        let gemini = detect::detect(LocalCli::GeminiCli, &locator);
        assert_eq!(gemini.version.as_deref(), Some("0.71.0"));
        assert_eq!(gemini.sign_in, SignInState::Unknown, "Gemini CLI has no status command");
        assert!(gemini.supports("--skip-trust"));
        let cursor = detect::detect(LocalCli::CursorCli, &locator);
        assert_eq!(cursor.binary.as_deref(), Some(bin_dir.path().join("cursor-agent").as_path()));
        assert_eq!(cursor.sign_in, SignInState::SignedOut);
        assert!(cursor.supports("--mode") && cursor.supports("--trust"));
        let copilot = detect::detect(LocalCli::CopilotCli, &locator);
        assert_eq!(copilot.version.as_deref(), Some("1.0.114"));
        assert!(copilot.supports("--excluded-tools"));
        let opencode = detect::detect(LocalCli::OpenCode, &locator);
        assert_eq!(opencode.sign_in, SignInState::SignedIn, "auth list counts, read from stderr too");
        assert!(opencode.supports("--pure"), "flags come from `opencode run --help`");
        let qwen = detect::detect(LocalCli::QwenCode, &locator);
        assert_eq!(qwen.version.as_deref(), Some("0.28.3"));
    }

    #[test]
    fn missing_clis_are_not_installed_with_their_install_page() {
        let empty_dir = tempfile::tempdir().unwrap();
        for cli in NEW_CLIS {
            let detection = detect::detect(cli, &locator_for(empty_dir.path()));
            assert_eq!(detection, Detection::default(), "{}", cli.display_name());
            let status = status_from(cli, false, &detection);
            assert!(!status.installed && !status.enabled);
            assert_eq!(status.install_url, cli.install_url());
        }
    }

    #[test]
    fn a_generic_agent_binary_counts_as_cursor_only_when_its_help_says_so() {
        let bin_dir = tempfile::tempdir().unwrap();
        write_script(
            bin_dir.path(),
            "agent",
            r#"case "$1" in --help) echo "Usage: agent [build-tool]" ;; --version) echo "9" ;; esac"#,
        );
        assert_eq!(detect::detect(LocalCli::CursorCli, &locator_for(bin_dir.path())), Detection::default());
        write_script(
            bin_dir.path(),
            "agent",
            r#"case "$1" in --help) echo "Cursor Agent CLI" ;; --version) echo "2026.11.20" ;; esac"#,
        );
        let cursor = detect::detect(LocalCli::CursorCli, &locator_for(bin_dir.path()));
        assert_eq!(cursor.binary.as_deref(), Some(bin_dir.path().join("agent").as_path()));
    }

    /// A fake CLI recording its arguments, stdin, environment and working folder files,
    /// then printing `output`.
    fn recording_cli(dir: &Path, name: &str, output: &str) -> PathBuf {
        let fixture = dir.join("output.jsonl");
        std::fs::write(&fixture, output).unwrap();
        let record = dir.display();
        let body = format!(
            "for argument in \"$@\"; do printf '[%s]\\n' \"$argument\"; done > '{record}/args.txt'\n\
             cat > '{record}/stdin.txt'\n\
             env > '{record}/env.txt'\n\
             mkdir -p '{record}/workdir' && cp -R . '{record}/workdir/'\n\
             if [ -n \"$GEMINI_SYSTEM_MD\" ]; then cp \"$GEMINI_SYSTEM_MD\" '{record}/system.md'; fi\n\
             cat '{}'",
            fixture.display()
        );
        write_script(dir, name, &body)
    }

    async fn collect_reply(model: &LocalCliModel, request: ChatRequest) -> Result<graphrt_llm::ChatResponse, LlmError> {
        let stream = model.chat(request).await?;
        graphrt_llm::collect(stream, |_| {}).await
    }

    fn read(dir: &Path, name: &str) -> String {
        std::fs::read_to_string(dir.join(name)).unwrap_or_default()
    }

    fn detection_of(binary: PathBuf, flags: &[&str]) -> Arc<Detection> {
        Arc::new(Detection { binary: Some(binary), ..detection_with_flags(flags) })
    }

    fn secret_request() -> ChatRequest {
        ChatRequest::new(
            "default",
            vec![Message::system("Answer in one word."), Message::user("Say hello, my key is sk-secret-123")],
        )
    }

    #[tokio::test]
    async fn gemini_runs_with_its_policy_and_system_prompt_file_and_the_prompt_on_stdin() {
        let dir = tempfile::tempdir().unwrap();
        let binary = recording_cli(dir.path(), "gemini", GEMINI_SUCCESS);
        let model = LocalCliModel::new(LocalCli::GeminiCli, detection_of(binary, &[]));
        let response = collect_reply(&model, secret_request()).await.unwrap();
        assert_eq!(response.text, "Hello from Gemini.");
        let args = read(dir.path(), "args.txt");
        assert!(!args.contains("sk-secret") && !args.contains("Say hello"), "{args}");
        assert_eq!(read(dir.path(), "stdin.txt"), "Say hello, my key is sk-secret-123");
        assert!(read(dir.path(), "system.md").ends_with("Answer in one word."));
        assert!(read(dir.path(), "workdir/graphrt-deny-all.toml").contains("decision = \"deny\""));
        assert!(read(dir.path(), "env.txt").contains("GEMINI_CLI_TRUST_WORKSPACE=true"));
    }

    #[tokio::test]
    async fn cursor_gets_the_prompt_as_workspace_rules_never_on_the_command_line() {
        let dir = tempfile::tempdir().unwrap();
        let binary = recording_cli(dir.path(), "cursor-agent", CURSOR_PARTIAL);
        let model = LocalCliModel::new(LocalCli::CursorCli, detection_of(binary, &["--mode"]));
        let response = collect_reply(&model, secret_request()).await.unwrap();
        assert_eq!(response.text, "Halo dari Cursor.");
        let args = read(dir.path(), "args.txt");
        assert!(
            !args.contains("sk-secret") && args.contains(CURSOR_FIXED_REQUEST) && args.contains("[--mode]\n[ask]"),
            "{args}"
        );
        assert_eq!(read(dir.path(), "stdin.txt"), "", "stdin is closed empty");
        let rules = read(dir.path(), "workdir/AGENTS.md");
        assert!(rules.contains("# Instructions\nAnswer in one word.") && rules.contains("sk-secret-123"), "{rules}");
        assert!(read(dir.path(), "workdir/.cursor/cli.json").contains("Shell(*)"));
    }

    #[tokio::test]
    async fn copilot_and_opencode_read_the_prompt_from_stdin() {
        for (cli, name, output, answer) in [
            (LocalCli::CopilotCli, "copilot", COPILOT_SUCCESS, "Hello from Copilot."),
            (LocalCli::OpenCode, "opencode", OPENCODE_SUCCESS, "Hello from OpenCode."),
        ] {
            let dir = tempfile::tempdir().unwrap();
            let binary = recording_cli(dir.path(), name, output);
            let model = LocalCliModel::new(cli, detection_of(binary, &[]));
            let response = collect_reply(&model, secret_request()).await.unwrap();
            assert_eq!(response.text, answer);
            assert!(!read(dir.path(), "args.txt").contains("sk-secret"));
            let stdin = read(dir.path(), "stdin.txt");
            assert!(
                stdin.starts_with("You are used as a plain text model") && stdin.contains("sk-secret-123"),
                "{stdin}"
            );
        }
        let dir = tempfile::tempdir().unwrap();
        let binary = recording_cli(dir.path(), "opencode", OPENCODE_SUCCESS);
        let model = LocalCliModel::new(LocalCli::OpenCode, detection_of(binary, &[]));
        collect_reply(&model, secret_request()).await.unwrap();
        assert!(read(dir.path(), "env.txt").contains(r#"OPENCODE_PERMISSION={"*":"deny"}"#));
    }

    #[tokio::test]
    async fn qwen_calls_end_at_the_result_even_if_the_process_lingers() {
        let dir = tempfile::tempdir().unwrap();
        let fixture = dir.path().join("output.jsonl");
        std::fs::write(&fixture, QWEN_SUCCESS).unwrap();
        let binary =
            write_script(dir.path(), "qwen", &format!("cat > /dev/null\ncat '{}'\nexec sleep 30", fixture.display()));
        let model = LocalCliModel::new(LocalCli::QwenCode, detection_of(binary, &[]));
        let started = Instant::now();
        let response = collect_reply(&model, ChatRequest::new("default", vec![Message::user("hi")])).await.unwrap();
        assert_eq!(response.text, "Ibu kota Prancis adalah Paris.");
        assert!(started.elapsed() < Duration::from_secs(10), "did not wait for the lingering process");
    }

    #[tokio::test]
    async fn a_tool_use_stops_the_call_with_a_clear_message() {
        let dir = tempfile::tempdir().unwrap();
        let binary = recording_cli(dir.path(), "gemini", GEMINI_TOOL_USE);
        let model = LocalCliModel::new(LocalCli::GeminiCli, detection_of(binary, &[]));
        let error = collect_reply(&model, ChatRequest::new("default", vec![Message::user("hi")])).await.unwrap_err();
        assert!(error.to_string().contains("graphrt does not allow"), "{error}");
    }
}
