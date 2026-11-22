use std::collections::BTreeSet;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::{Duration, Instant};

use graphrt_core::tool::ToolSpec;
use graphrt_llm::{ChatDelta, ChatModel, ChatRequest, FinishReason, LlmError, Message, ResponseFormat, ToolChoice};

use super::adapters::{self, claude_models, parse_codex_catalog};
use super::capability::capability_gap;
use super::command::{build_args, is_valid_model_name};
use super::detect::{self, Detection, Locator};
use super::parse::{classify_failure, failure_text, parser_for};
use super::prompt::{first_json_object, prepare_prompt};
use super::*;

const CLAUDE_STREAM_SUCCESS: &str = include_str!("fixtures/claude_stream_success.jsonl");
const CLAUDE_STREAM_NO_PARTIAL: &str = include_str!("fixtures/claude_stream_no_partial.jsonl");
const CLAUDE_STREAM_NOT_SIGNED_IN: &str = include_str!("fixtures/claude_stream_not_signed_in.jsonl");
const CODEX_EXEC_SUCCESS: &str = include_str!("fixtures/codex_exec_success.jsonl");
const CODEX_EXEC_LEGACY: &str = include_str!("fixtures/codex_exec_legacy.jsonl");
const CODEX_EXEC_TOKEN_REVOKED: &str = include_str!("fixtures/codex_exec_token_revoked.jsonl");
const CODEX_MODELS_CATALOG: &str = include_str!("fixtures/codex_models_catalog.json");

/// Every delta a parser produces for `output`, plus how it finished.
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

fn usage_of(deltas: &[ChatDelta]) -> Option<graphrt_core::event::Usage> {
    deltas.iter().rev().find_map(|delta| if let ChatDelta::Usage(usage) = delta { Some(*usage) } else { None })
}

// ---- Output parsing (recorded samples) ----

#[test]
fn claude_stream_json_streams_text_and_reads_usage() {
    let deltas = parse_all(LocalCli::ClaudeCode, CLAUDE_STREAM_SUCCESS).unwrap();
    assert_eq!(text_of(&deltas), "Halo!", "text deltas only, not repeated from the assistant message or result");
    let usage = usage_of(&deltas).unwrap();
    assert_eq!(usage.prompt_tokens, 2 + 5804);
    assert_eq!(usage.completion_tokens, 147);
    assert_eq!(deltas.last(), Some(&ChatDelta::Finish(FinishReason::Stop)));
}

#[test]
fn claude_without_partial_messages_uses_the_assistant_message_once() {
    let deltas = parse_all(LocalCli::ClaudeCode, CLAUDE_STREAM_NO_PARTIAL).unwrap();
    assert_eq!(text_of(&deltas), r#"{"city": "Bandung", "count": 3}"#);
    assert_eq!(usage_of(&deltas).unwrap().prompt_tokens, 150);
}

#[test]
fn claude_not_signed_in_is_an_auth_error_with_the_way_out() {
    let error = parse_all(LocalCli::ClaudeCode, CLAUDE_STREAM_NOT_SIGNED_IN).unwrap_err();
    let LlmError::Auth(message) = error else { panic!("expected an auth error, got {error:?}") };
    assert!(message.contains("run `claude` and sign in"), "{message}");
}

#[test]
fn claude_output_without_a_result_reports_stderr() {
    let mut parser = parser_for(LocalCli::ClaudeCode);
    assert!(parser.parse_line("not json at all").unwrap().is_empty());
    let error = parser.finish(false, "error: unknown option '--safe-mode'\n").unwrap_err();
    assert!(matches!(error, LlmError::Config(ref message) if message.contains("too old")), "{error:?}");
}

#[test]
fn codex_exec_json_reads_the_agent_message_and_usage() {
    let deltas = parse_all(LocalCli::Codex, CODEX_EXEC_SUCCESS).unwrap();
    assert_eq!(text_of(&deltas), "Hello from Codex.");
    assert!(deltas.contains(&ChatDelta::Reasoning("**Answering briefly**".into())));
    let usage = usage_of(&deltas).unwrap();
    assert_eq!((usage.prompt_tokens, usage.completion_tokens), (2915, 9));
}

#[test]
fn codex_legacy_events_stream_deltas_without_repeating_the_message() {
    let deltas = parse_all(LocalCli::Codex, CODEX_EXEC_LEGACY).unwrap();
    assert_eq!(text_of(&deltas), "Hello there.");
    assert_eq!(usage_of(&deltas).unwrap().prompt_tokens, 50);
}

#[test]
fn codex_revoked_sign_in_is_an_auth_error() {
    let error = parse_all(LocalCli::Codex, CODEX_EXEC_TOKEN_REVOKED).unwrap_err();
    let LlmError::Auth(message) = error else { panic!("expected an auth error, got {error:?}") };
    assert!(message.contains("codex login"), "{message}");
}

#[test]
fn codex_that_never_completes_reports_its_last_error() {
    let mut parser = parser_for(LocalCli::Codex);
    parser.parse_line(r#"{"type":"error","message":"Reconnecting... 1/5"}"#).unwrap();
    let error = parser.finish(false, "").unwrap_err();
    assert!(error.to_string().contains("Reconnecting"), "{error}");
}

#[test]
fn failures_are_classified_and_scrubbed() {
    let limit = classify_failure(LocalCli::ClaudeCode, "Claude AI usage limit reached|1795356000");
    assert!(matches!(limit, LlmError::RateLimit { ref message, .. } if message.contains("Claude plan")), "{limit:?}");
    let model = classify_failure(LocalCli::Codex, "The model `gpt-9` does not exist or you do not have access");
    assert!(matches!(model, LlmError::BadRequest(ref message) if message.contains("does not offer")), "{model:?}");
    let scrubbed = classify_failure(LocalCli::Codex, "failed for someone@example.com with sk-abcdefghijklmnop1234");
    let text = scrubbed.to_string();
    assert!(!text.contains("someone@example.com") && !text.contains("sk-abcdefghijklmnop1234"), "{text}");
    let stderr = "2026-11-22T00:00:50.066285Z ERROR codex_login::auth::manager: Failed to refresh token: boom\n";
    assert_eq!(failure_text(stderr, "fallback"), "Failed to refresh token: boom");
}

// ---- Prompts and capabilities ----

#[test]
fn a_single_user_message_is_sent_as_is_with_the_system_prompt_apart() {
    let request = ChatRequest::new("default", vec![Message::system("Be brief."), Message::user("Hi there")]);
    let prompt = prepare_prompt(LocalCli::ClaudeCode, &request).unwrap();
    assert_eq!(prompt.instructions, "Be brief.");
    assert_eq!(prompt.prompt, "Hi there");
    let codex = prepare_prompt(LocalCli::Codex, &request).unwrap();
    assert!(
        codex.prompt.contains("# Instructions\nBe brief.") && codex.prompt.contains("# Task\nHi there"),
        "{}",
        codex.prompt
    );
    assert!(codex.prompt.contains("Do not run commands"));
}

#[test]
fn a_conversation_becomes_a_transcript() {
    let messages = vec![Message::user("Draft it"), Message::assistant("Here it is"), Message::user("Shorter")];
    let prompt = prepare_prompt(LocalCli::ClaudeCode, &ChatRequest::new("sonnet", messages)).unwrap();
    assert!(
        prompt.prompt.contains("[User]\nDraft it\n\n[Assistant]\nHere it is\n\n[User]\nShorter"),
        "{}",
        prompt.prompt
    );
}

#[test]
fn structured_output_becomes_a_json_instruction() {
    let schema = serde_json::json!({"type": "object", "properties": {"n": {"type": "integer"}}});
    let request = ChatRequest::new("default", vec![Message::user("Count")])
        .with_response_format(ResponseFormat::JsonSchema { name: "out".into(), schema, strict: false });
    let prompt = prepare_prompt(LocalCli::ClaudeCode, &request).unwrap();
    assert!(prompt.instructions.contains("JSON Schema") && prompt.instructions.contains("\"integer\""));
}

fn search_tool() -> ToolSpec {
    ToolSpec { name: "search".into(), description: "Search".into(), parameters: serde_json::json!({"type": "object"}) }
}

#[test]
fn tool_calling_is_a_clear_capability_error() {
    let request = ChatRequest::new("default", vec![Message::user("Find it")])
        .with_tools(vec![search_tool()])
        .with_tool_choice(ToolChoice::Auto);
    let error = prepare_prompt(LocalCli::ClaudeCode, &request).unwrap_err();
    assert_eq!(
        error,
        LlmError::Config(
            "Claude Code (local CLI) can't do tool calls in a Run an agent step — pick an API model for this step"
                .into()
        )
    );
    let mut image_message = Message::user("What is this?");
    image_message
        .content
        .push(graphrt_llm::ContentPart::Image { url: "data:image/png;base64,AA".into(), detail: None });
    let error = prepare_prompt(LocalCli::Codex, &ChatRequest::new("default", vec![image_message])).unwrap_err();
    assert!(error.to_string().contains("can't read images"));
}

#[test]
fn a_forced_tool_is_answered_as_json_arguments() {
    let request = ChatRequest::new("default", vec![Message::user("Bandung, 3 people")])
        .with_tools(vec![search_tool()])
        .with_tool_choice(ToolChoice::Tool("search".into()));
    let prompt = prepare_prompt(LocalCli::ClaudeCode, &request).unwrap();
    assert_eq!(prompt.forced_tool.as_deref(), Some("search"));
    assert!(prompt.instructions.contains("arguments for `search`"));
    let object = first_json_object("Sure:\n```json\n{\"city\": \"Bandung\"}\n```").unwrap();
    assert_eq!(object.get("city").and_then(serde_json::Value::as_str), Some("Bandung"));
}

#[test]
fn capability_gaps_name_agent_steps_with_tools_and_images() {
    let config = |value: serde_json::Value| value.as_object().unwrap().clone();
    let agent_with_tools =
        config(serde_json::json!({"model": {"provider": "claude-code-cli", "name": "default"}, "tools": ["web/*"]}));
    let gap = capability_gap("agent", &agent_with_tools).unwrap();
    assert_eq!(
        gap.message("Research"),
        "Research uses Claude Code (on this computer), which can't call tools: pick an API model for this step"
    );
    let agent_without_tools = config(serde_json::json!({"model": {"provider": "codex-cli", "name": "default"}}));
    assert_eq!(capability_gap("agent", &agent_without_tools), None);
    let vision =
        config(serde_json::json!({"model": {"provider": "codex-cli", "name": "x"}, "vision": {"enabled": true}}));
    assert_eq!(capability_gap("llm", &vision).map(|gap| gap.reason), Some("can't read images"));
    let api_model =
        config(serde_json::json!({"model": {"provider": "openai", "name": "gpt-4o-mini"}, "tools": ["web/*"]}));
    assert_eq!(capability_gap("agent", &api_model), None);
}

#[test]
fn flows_report_capability_gaps_by_step_title() {
    let flow_yaml = include_str!("../../fixtures/flows/simple_answer.yaml").replace(
        "      type: llm\n      title: Answer the question\n      model:\n        provider: openai\n        name: gpt-4o-mini\n",
        "      type: llm\n      title: Answer the question\n      vision: { enabled: true }\n      model:\n        provider: claude-code-cli\n        name: default\n",
    );
    let gaps = crate::flow::find_local_cli_capability_gaps(&flow_yaml).unwrap();
    assert_eq!(gaps, ["Answer the question uses Claude Code (on this computer), which can't read images: pick an API model for this step"]);
}

// ---- Command lines ----

fn detection_with_flags(binary: Option<PathBuf>, flags: &[&str]) -> Detection {
    Detection {
        binary,
        flags: flags.iter().map(|flag| (*flag).to_owned()).collect::<BTreeSet<_>>(),
        ..Detection::default()
    }
}

#[test]
fn claude_command_line_has_no_tools_and_only_supported_flags() {
    let detection = detection_with_flags(None, &["--safe-mode", "--include-partial-messages"]);
    let args = build_args(
        LocalCli::ClaudeCode,
        &detection,
        "sonnet",
        Path::new("/tmp/w"),
        Some(Path::new("/tmp/w/instructions.txt")),
    );
    assert_eq!(
        args,
        [
            "-p",
            "--output-format",
            "stream-json",
            "--verbose",
            "--tools",
            "",
            "--include-partial-messages",
            "--safe-mode",
            "--model",
            "sonnet",
            "--system-prompt-file",
            "/tmp/w/instructions.txt"
        ]
    );
    let default_model_args = build_args(LocalCli::ClaudeCode, &detection, "default", Path::new("/tmp/w"), None);
    assert!(!default_model_args.contains(&"--model".to_owned()));
}

#[test]
fn codex_command_line_is_read_only_and_reads_stdin() {
    let detection = detection_with_flags(None, &["--ephemeral"]);
    let args = build_args(LocalCli::Codex, &detection, "gpt-5.4", Path::new("/tmp/w"), None);
    assert_eq!(
        args,
        [
            "exec",
            "--json",
            "--skip-git-repo-check",
            "--sandbox",
            "read-only",
            "--color",
            "never",
            "--ephemeral",
            "-C",
            "/tmp/w",
            "-m",
            "gpt-5.4",
            "-"
        ]
    );
}

#[test]
fn model_names_that_look_like_flags_are_refused() {
    assert!(is_valid_model_name("claude-sonnet-5-5"));
    assert!(is_valid_model_name("gpt-5.4-mini"));
    assert!(is_valid_model_name("sonnet[1m]"));
    assert!(!is_valid_model_name("--dangerously-skip-permissions"));
    assert!(!is_valid_model_name("sonnet; rm -rf ~"));
    assert!(!is_valid_model_name(""));
}

// ---- Model lists ----

#[test]
fn claude_models_are_the_help_aliases_plus_the_base_ones() {
    let help = "  --model <model>   Model for the current session. Use an alias for the latest model (e.g. 'fable',\n                    'opus', or 'sonnet') or a model's full name.\n  -n, --name <name>  Set a name 'ignored'";
    let aliases = adapters::claude_model_aliases(help);
    assert_eq!(aliases, ["fable", "opus", "sonnet"]);
    let ids: Vec<String> = claude_models(&aliases).into_iter().map(|model| model.id).collect();
    assert_eq!(ids, ["sonnet", "opus", "haiku", "fable"]);
}

#[test]
fn codex_catalog_lists_visible_models_by_priority() {
    let ids: Vec<String> = parse_codex_catalog(CODEX_MODELS_CATALOG).into_iter().map(|model| model.id).collect();
    assert_eq!(ids, ["gpt-5.5", "gpt-5.4"]);
    assert!(parse_codex_catalog("not json").is_empty());
}

#[test]
fn sign_in_statuses_are_read_without_the_account_details() {
    let claude = r#"{"loggedIn": true, "authMethod": "claude.ai", "email": "someone@example.com"}"#;
    assert_eq!(adapters::parse_claude_auth_status(claude), SignInState::SignedIn);
    assert_eq!(adapters::parse_claude_auth_status(r#"{"loggedIn": false}"#), SignInState::SignedOut);
    assert_eq!(adapters::parse_claude_auth_status("error: unknown command 'auth'"), SignInState::Unknown);
    assert_eq!(adapters::parse_codex_login_status(true, "Logged in using ChatGPT"), SignInState::SignedIn);
    assert_eq!(adapters::parse_codex_login_status(false, "Not logged in"), SignInState::SignedOut);
    assert_eq!(detect::parse_login_shell_path("Welcome!\n__GRAPHRT_PATH__/a:/b"), Some("/a:/b".into()));
}

/// Looks for the real CLIs of this computer (version, help, sign-in status; no prompt is sent).
/// Run by hand: `cargo test real_cli_detection -- --ignored --nocapture`.
#[test]
#[ignore = "inspects the CLIs installed on this computer"]
fn real_cli_detection() {
    for cli in LocalCli::ALL {
        let detection = detect::detect(cli, &Locator::from_environment());
        println!(
            "{}: binary={:?} version={:?} sign_in={:?} aliases={:?} safe_mode={} partial={} models={:?}",
            cli.display_name(),
            detection.binary,
            detection.version,
            detection.sign_in,
            detection.model_aliases,
            detection.supports("--safe-mode"),
            detection.supports("--include-partial-messages"),
            list_models(cli, &detection).into_iter().map(|model| model.id).collect::<Vec<_>>()
        );
    }
}

// ---- Fake binaries (detection, streaming, timeout, kill) ----

#[cfg(unix)]
mod fake_binaries {
    use super::*;

    fn write_script(dir: &Path, name: &str, body: &str) -> PathBuf {
        use std::os::unix::fs::PermissionsExt;
        let path = dir.join(name);
        std::fs::write(&path, format!("#!/bin/sh\n{body}\n")).unwrap();
        std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o755)).unwrap();
        path
    }

    const FAKE_CLAUDE_DETECTION: &str = r#"case "$1" in
  --version) echo "2.1.330 (Claude Code)" ;;
  --help) echo "  --model <model>  Use an alias (e.g. 'fable', 'opus', or 'sonnet')"; echo "  --safe-mode  Safe"; echo "  --tools <tools...>" ;;
  auth) echo '{"loggedIn": true, "email": "someone@example.com"}' ;;
esac"#;

    #[test]
    fn detection_finds_fake_binaries_in_a_temporary_path() {
        let bin_dir = tempfile::tempdir().unwrap();
        write_script(bin_dir.path(), "claude", FAKE_CLAUDE_DETECTION);
        write_script(
            bin_dir.path(),
            "codex",
            r#"case "$1" in --version) echo "codex-cli 0.142.2" ;; login) echo "Not logged in" >&2; exit 1 ;; esac"#,
        );
        let locator = Locator { path_var: Some(bin_dir.path().as_os_str().to_owned()), ..Locator::default() };

        let claude = detect::detect(LocalCli::ClaudeCode, &locator);
        assert_eq!(claude.binary.as_deref(), Some(bin_dir.path().join("claude").as_path()));
        assert_eq!(claude.version.as_deref(), Some("2.1.330 (Claude Code)"));
        assert_eq!(claude.sign_in, SignInState::SignedIn);
        assert!(claude.supports("--safe-mode") && !claude.supports("--include-partial-messages"));
        assert_eq!(claude.model_aliases, ["fable", "opus", "sonnet"]);
        let child_path = claude.child_path.clone().unwrap();
        assert_eq!(std::env::split_paths(&child_path).next().as_deref(), Some(bin_dir.path()));

        let codex = detect::detect(LocalCli::Codex, &locator);
        assert_eq!(codex.version.as_deref(), Some("codex-cli 0.142.2"));
        assert_eq!(codex.sign_in, SignInState::SignedOut);
    }

    #[test]
    fn detection_skips_missing_and_non_executable_files() {
        let bin_dir = tempfile::tempdir().unwrap();
        std::fs::write(bin_dir.path().join("claude"), "not executable").unwrap();
        let extra_dir = tempfile::tempdir().unwrap();
        let locator = Locator {
            path_var: Some(bin_dir.path().as_os_str().to_owned()),
            extra_dirs: vec![extra_dir.path().to_path_buf()],
            ..Locator::default()
        };
        assert_eq!(detect::detect(LocalCli::ClaudeCode, &locator), Detection::default());
        write_script(extra_dir.path(), "claude", FAKE_CLAUDE_DETECTION);
        let found = detect::find_binary(LocalCli::ClaudeCode, &locator);
        assert_eq!(found.as_deref(), Some(extra_dir.path().join("claude").as_path()), "common folders come after PATH");
    }

    /// A fake CLI that records its arguments, stdin and working folder, then prints `output`.
    fn recording_cli(dir: &Path, name: &str, output_fixture: &str) -> PathBuf {
        let fixture = dir.join("output.jsonl");
        std::fs::write(&fixture, output_fixture).unwrap();
        let record = dir.display();
        let body = format!(
            "for argument in \"$@\"; do printf '[%s]\\n' \"$argument\"; done > '{record}/args.txt'\n\
             cat > '{record}/stdin.txt'\npwd > '{record}/cwd.txt'\n\
             if [ -f instructions.txt ]; then cp instructions.txt '{record}/instructions.txt'; fi\n\
             cat '{}'",
            fixture.display()
        );
        write_script(dir, name, &body)
    }

    async fn collect_reply(model: &LocalCliModel, request: ChatRequest) -> Result<graphrt_llm::ChatResponse, LlmError> {
        let stream = model.chat(request).await?;
        graphrt_llm::collect(stream, |_| {}).await
    }

    #[tokio::test]
    async fn claude_calls_stream_through_a_fake_binary_without_secrets_on_the_command_line() {
        let dir = tempfile::tempdir().unwrap();
        let binary = recording_cli(dir.path(), "claude", CLAUDE_STREAM_SUCCESS);
        let detection = Arc::new(detection_with_flags(Some(binary), &["--include-partial-messages"]));
        let model = LocalCliModel::new(LocalCli::ClaudeCode, detection);
        let request = ChatRequest::new(
            "haiku",
            vec![Message::system("Answer in one word."), Message::user("Say hello, my key is sk-secret-123")],
        );

        let response = collect_reply(&model, request).await.unwrap();
        assert_eq!(response.text, "Halo!");
        assert_eq!(response.usage.completion_tokens, 147);

        let args = std::fs::read_to_string(dir.path().join("args.txt")).unwrap();
        assert!(args.contains("[--tools]\n[]\n"), "no tools: {args}");
        assert!(args.contains("[--model]\n[haiku]"), "{args}");
        assert!(!args.contains("sk-secret") && !args.contains("Say hello"), "the prompt goes through stdin: {args}");
        assert_eq!(
            std::fs::read_to_string(dir.path().join("stdin.txt")).unwrap(),
            "Say hello, my key is sk-secret-123"
        );
        assert_eq!(std::fs::read_to_string(dir.path().join("instructions.txt")).unwrap(), "Answer in one word.");
        let workdir = PathBuf::from(std::fs::read_to_string(dir.path().join("cwd.txt")).unwrap().trim());
        assert!(workdir.file_name().unwrap().to_string_lossy().starts_with("graphrt-cli-"), "{workdir:?}");
        assert!(!workdir.exists(), "the throwaway working folder is removed after the call");
    }

    #[tokio::test]
    async fn codex_forced_tool_answers_become_a_tool_call() {
        let dir = tempfile::tempdir().unwrap();
        let output = CODEX_EXEC_SUCCESS.replace("Hello from Codex.", r#"{\"city\": \"Bandung\"}"#);
        let binary = recording_cli(dir.path(), "codex", &output);
        let model = LocalCliModel::new(LocalCli::Codex, Arc::new(detection_with_flags(Some(binary), &[])));
        let request = ChatRequest::new("default", vec![Message::user("I live in Bandung")])
            .with_tools(vec![search_tool()])
            .with_tool_choice(ToolChoice::Tool("search".into()));

        let response = collect_reply(&model, request).await.unwrap();
        assert_eq!(response.text, "");
        assert_eq!(response.tool_calls.len(), 1);
        assert_eq!(response.tool_calls[0].name, "search");
        assert_eq!(response.tool_calls[0].arguments, r#"{"city":"Bandung"}"#);
        assert_eq!(response.finish_reason, Some(FinishReason::ToolCalls));
        let args = std::fs::read_to_string(dir.path().join("args.txt")).unwrap();
        assert!(args.contains("[--sandbox]\n[read-only]") && args.ends_with("[-]\n"), "{args}");
        assert!(!args.contains("[-m]"), "the CLI default sends no model flag: {args}");
    }

    #[tokio::test]
    async fn a_cli_that_takes_too_long_is_stopped() {
        let dir = tempfile::tempdir().unwrap();
        let binary = write_script(dir.path(), "claude", "exec sleep 30");
        let model = LocalCliModel::new(LocalCli::ClaudeCode, Arc::new(detection_with_flags(Some(binary), &[])))
            .with_timeout(Duration::from_millis(400));
        let started = Instant::now();
        let error = collect_reply(&model, ChatRequest::new("default", vec![Message::user("hi")])).await.unwrap_err();
        assert!(error.to_string().contains("did not finish within"), "{error}");
        assert!(started.elapsed() < Duration::from_secs(10));
    }

    #[tokio::test]
    async fn dropping_the_stream_kills_the_process() {
        let dir = tempfile::tempdir().unwrap();
        let pid_file = dir.path().join("pid.txt");
        let binary = write_script(dir.path(), "claude", &format!("echo $$ > '{}'\nexec sleep 30", pid_file.display()));
        let model = LocalCliModel::new(LocalCli::ClaudeCode, Arc::new(detection_with_flags(Some(binary), &[])));
        let stream = model.chat(ChatRequest::new("default", vec![Message::user("hi")])).await.unwrap();
        let pid = wait_for_pid(&pid_file).await;
        drop(stream);
        let deadline = Instant::now() + Duration::from_secs(5);
        while is_running(pid) {
            assert!(Instant::now() < deadline, "process {pid} still runs after the call was dropped");
            tokio::time::sleep(Duration::from_millis(50)).await;
        }
    }

    /// Waits up to 15 s: macOS checks every new script before its first run, which can
    /// take a while when many tests start fake CLIs at once.
    async fn wait_for_pid(pid_file: &Path) -> u32 {
        for _ in 0..500 {
            if let Some(pid) = std::fs::read_to_string(pid_file).ok().and_then(|text| text.trim().parse().ok()) {
                return pid;
            }
            tokio::time::sleep(Duration::from_millis(30)).await;
        }
        panic!("the fake CLI never started");
    }

    /// Alive and not a zombie waiting to be reaped.
    fn is_running(pid: u32) -> bool {
        let output = std::process::Command::new("ps").args(["-o", "stat=", "-p", &pid.to_string()]).output().unwrap();
        let state = String::from_utf8_lossy(&output.stdout);
        let state = state.trim();
        !state.is_empty() && !state.starts_with('Z')
    }

    #[tokio::test]
    async fn the_connection_check_reports_success_and_missing_installs() {
        let dir = tempfile::tempdir().unwrap();
        let binary = recording_cli(dir.path(), "claude", CLAUDE_STREAM_SUCCESS);
        let check = check_connection(LocalCli::ClaudeCode, Arc::new(detection_with_flags(Some(binary), &[]))).await;
        assert!(check.ok, "{check:?}");
        assert!(check.message.starts_with("Claude Code answered in"), "{}", check.message);
        let missing = check_connection(LocalCli::Codex, Arc::new(Detection::default())).await;
        assert_eq!(missing, LocalCliCheck { ok: false, message: "Codex is not installed on this computer".into() });
    }

    #[test]
    fn enabled_and_installed_clis_join_the_model_registry() {
        let db = crate::storage::Database::open_in_memory().unwrap();
        let dir = tempfile::tempdir().unwrap();
        let binary = write_script(dir.path(), "claude", "exit 0");
        let detect = |cli: LocalCli| {
            Arc::new(if cli == LocalCli::ClaudeCode {
                detection_with_flags(Some(binary.clone()), &[])
            } else {
                Detection::default()
            })
        };
        let mut registry = graphrt_llm::ModelRegistry::new();
        crate::credentials::add_local_cli_models(&mut registry, &db, detect);
        assert!(registry.is_empty(), "nothing until the user turns a CLI on");

        db.set_setting(LocalCli::ClaudeCode.enabled_setting_key(), "true").unwrap();
        db.set_setting(LocalCli::Codex.enabled_setting_key(), "true").unwrap();
        crate::credentials::add_local_cli_models(&mut registry, &db, detect);
        assert_eq!(registry.names().collect::<Vec<_>>(), ["claude-code-cli"], "Codex is on but not installed");
    }
}
