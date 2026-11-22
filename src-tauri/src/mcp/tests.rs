use std::sync::Arc;

use graphrt_core::tool::ToolRegistry;
use graphrt_mcp::McpTransport;

use super::definitions::{
    add_definition, extended_path, find_command_with_extensions, load_definitions, record_check, remove_definition,
    runtime_config, validate_input,
};
use super::prompt_guide::servers_guide;
use super::*;
use crate::error::AppError;

fn stdio_input(name: &str, command: &str, args: &[&str]) -> McpServerInput {
    McpServerInput {
        name: name.into(),
        transport: McpServerTransport::Stdio {
            command: command.into(),
            args: args.iter().map(|arg| (*arg).into()).collect(),
        },
        secret_env: Vec::new(),
        bearer_token_secret: None,
    }
}

fn http_input(name: &str, url: &str, bearer_token_secret: Option<&str>) -> McpServerInput {
    McpServerInput {
        name: name.into(),
        transport: McpServerTransport::Http { url: url.into() },
        secret_env: Vec::new(),
        bearer_token_secret: bearer_token_secret.map(str::to_owned),
    }
}

#[test]
fn input_is_trimmed_and_checked() {
    let definition = validate_input(McpServerInput {
        secret_env: vec![" GITHUB_TOKEN ".into()],
        ..stdio_input(" github ", " npx ", &["-y", " ", "@modelcontextprotocol/server-github"])
    })
    .unwrap();
    assert_eq!(definition.name, "github");
    assert_eq!(
        definition.transport,
        McpServerTransport::Stdio {
            command: "npx".into(),
            args: vec!["-y".into(), "@modelcontextprotocol/server-github".into()]
        }
    );
    assert_eq!(definition.secret_env, ["GITHUB_TOKEN"]);

    for bad_name in ["", "GitHub", "has space", "a/b", "mcp:x", "-dash", "agents", "builtin"] {
        assert!(
            matches!(validate_input(stdio_input(bad_name, "srv", &[])), Err(AppError::InvalidInput(_))),
            "{bad_name}"
        );
    }
    assert!(validate_input(stdio_input("fs", "  ", &[])).is_err());
    assert!(validate_input(http_input("remote", "ftp://example.com", None)).is_err());
    assert!(validate_input(http_input("remote", "https://mcp.example.com/mcp", Some("bad name"))).is_err());
    let token_on_stdio = McpServerInput { bearer_token_secret: Some("TOKEN".into()), ..stdio_input("fs", "srv", &[]) };
    assert!(validate_input(token_on_stdio).is_err());
    let env_on_http =
        McpServerInput { secret_env: vec!["TOKEN".into()], ..http_input("remote", "https://x/mcp", None) };
    assert!(validate_input(env_on_http).is_err());
}

#[test]
fn definitions_round_trip_through_settings() {
    let db = Database::open_in_memory().unwrap();
    assert!(load_definitions(&db).unwrap().is_empty());
    add_definition(&db, stdio_input("fs", "npx", &["-y", "server-filesystem", "/tmp"])).unwrap();
    let (_, all) =
        add_definition(&db, http_input("remote", "https://mcp.example.com/mcp", Some("REMOTE_TOKEN"))).unwrap();
    assert_eq!(all.len(), 2);
    assert_eq!(load_definitions(&db).unwrap(), all);
    assert!(matches!(add_definition(&db, stdio_input("fs", "other", &[])), Err(AppError::InvalidInput(_))));

    let tools = vec![McpToolInfo { name: "read_file".into(), description: "Read a file".into(), input_schema: None }];
    let (checked, _) = record_check(&db, "fs", Some(tools.clone()), None).unwrap();
    assert_eq!(checked.known_tools, tools);
    assert!(checked.last_check.as_ref().unwrap().connected);
    let (failed, _) = record_check(&db, "fs", None, Some("spawn failed".into())).unwrap();
    assert_eq!(failed.known_tools, tools, "a failed check keeps the tools found earlier");
    assert_eq!(failed.last_check.unwrap().error.as_deref(), Some("spawn failed"));

    let remaining = remove_definition(&db, "fs").unwrap();
    assert_eq!(remaining.len(), 1);
    assert_eq!(load_definitions(&db).unwrap()[0].name, "remote");
    assert!(matches!(remove_definition(&db, "fs"), Err(AppError::NotFound(_))));
}

#[test]
fn unreadable_stored_list_is_treated_as_empty() {
    let db = Database::open_in_memory().unwrap();
    db.set_setting(definitions::SETTING_MCP_SERVERS, "{not json").unwrap();
    assert!(load_definitions(&db).unwrap().is_empty());
}

#[test]
fn runtime_config_reads_the_named_secrets() {
    let credentials = CredentialStore::in_memory();
    let stdio = validate_input(McpServerInput {
        secret_env: vec!["GITHUB_TOKEN".into()],
        ..stdio_input("github", "npx", &["srv"])
    })
    .unwrap();
    match runtime_config(&stdio, &credentials) {
        Err(AppError::MissingCredentials(names)) => assert_eq!(names, "GITHUB_TOKEN"),
        other => panic!("expected missing credentials, got {other:?}"),
    }
    credentials.set_workflow_secret("GITHUB_TOKEN", "ghp-secret").unwrap();
    let config = runtime_config(&stdio, &credentials).unwrap();
    match &config.transport {
        McpTransport::Stdio(stdio_config) => {
            assert_eq!(stdio_config.command, "npx");
            assert_eq!(stdio_config.env.get("GITHUB_TOKEN").map(String::as_str), Some("ghp-secret"));
            assert!(stdio_config.env.contains_key("PATH"));
            assert!(!stdio_config.inherit_env, "host secrets are not leaked to the server");
        }
        other => panic!("unexpected {other:?}"),
    }

    let http = validate_input(http_input("remote", "https://mcp.example.com/mcp", Some("REMOTE_TOKEN"))).unwrap();
    assert!(matches!(runtime_config(&http, &credentials), Err(AppError::MissingCredentials(_))));
    credentials.set_workflow_secret("REMOTE_TOKEN", "bearer-value").unwrap();
    match runtime_config(&http, &credentials).unwrap().transport {
        McpTransport::Http(http_config) => assert_eq!(http_config.bearer_token.as_deref(), Some("bearer-value")),
        other => panic!("unexpected {other:?}"),
    }
}

#[test]
fn a_bearer_token_needs_https_unless_the_server_is_on_this_computer() {
    for url in ["http://mcp.remote.test/mcp", "http://192.168.1.20:8080/mcp", "http://localhost.evil.test/mcp"] {
        let error = validate_input(http_input("remote", url, Some("REMOTE_TOKEN"))).unwrap_err();
        assert!(error.to_string().contains("only sent over https://"), "{url}: {error}");
    }
    for url in [
        "https://mcp.remote.test/mcp",
        "http://localhost:3000/mcp",
        "http://LOCALHOST/mcp",
        "http://127.0.0.1:8080/mcp",
        "http://[::1]:8080/mcp",
    ] {
        assert!(validate_input(http_input("remote", url, Some("REMOTE_TOKEN"))).is_ok(), "{url}");
    }
    assert!(validate_input(http_input("open", "http://mcp.remote.test/mcp", None)).is_ok(), "no token, no rule");
}

#[test]
fn a_stored_definition_never_sends_its_token_over_plain_http() {
    let credentials = CredentialStore::in_memory();
    credentials.set_workflow_secret("REMOTE_TOKEN", "bearer-value").unwrap();
    let mut definition =
        validate_input(http_input("remote", "https://mcp.remote.test/mcp", Some("REMOTE_TOKEN"))).unwrap();
    definition.transport = McpServerTransport::Http { url: "http://mcp.remote.test/mcp".into() };
    assert!(matches!(runtime_config(&definition, &credentials), Err(AppError::InvalidInput(_))));
}

#[test]
fn bare_commands_resolve_through_path_and_pathext() {
    let first_dir = tempfile::tempdir().unwrap();
    let node_dir = tempfile::tempdir().unwrap();
    std::fs::write(node_dir.path().join("npx.cmd"), "@echo off\n").unwrap();
    std::fs::write(node_dir.path().join("node.exe"), "").unwrap();
    let search_path = std::env::join_paths([first_dir.path(), node_dir.path()]).unwrap();

    let npx = find_command_with_extensions("npx", &search_path, ".COM;.EXE;.BAT;.CMD");
    assert_eq!(npx, Some(node_dir.path().join("npx.cmd")));
    assert_eq!(find_command_with_extensions("node", &search_path, ".EXE;.CMD"), Some(node_dir.path().join("node.exe")));
    assert_eq!(find_command_with_extensions("uvx", &search_path, ".EXE;.CMD"), None, "not installed");
    assert_eq!(find_command_with_extensions("npx.cmd", &search_path, ".EXE;.CMD"), None, "already has an extension");
    assert_eq!(find_command_with_extensions("C:\\tools\\npx", &search_path, ".CMD"), None, "already a path");
}

#[test]
fn extended_path_adds_homebrew_once() {
    if cfg!(windows) {
        return;
    }
    assert_eq!(extended_path(Some("/usr/bin:/bin".into())), "/usr/bin:/bin:/opt/homebrew/bin:/usr/local/bin");
    assert_eq!(extended_path(Some("/usr/local/bin:/usr/bin".into())), "/usr/local/bin:/usr/bin:/opt/homebrew/bin");
    assert_eq!(extended_path(None), "/opt/homebrew/bin:/usr/local/bin");
}

#[test]
fn servers_join_the_registry_without_shadowing_other_providers() {
    let credentials = Arc::new(CredentialStore::in_memory());
    let mut registry = ToolRegistry::new();
    let taken = validate_input(stdio_input("taken", "srv", &[])).unwrap();
    register_servers(&mut registry, std::slice::from_ref(&taken), &credentials);
    let existing = registry.get("taken").cloned().unwrap();

    let definitions = vec![
        validate_input(stdio_input("fs", "srv", &[])).unwrap(),
        validate_input(stdio_input("taken", "other", &[])).unwrap(),
    ];
    register_servers(&mut registry, &definitions, &credentials);

    let providers: Vec<&str> = registry.providers().map(|(name, _)| name).collect();
    assert_eq!(providers, ["mcp:taken", "taken", "mcp:fs", "fs"]);
    assert!(Arc::ptr_eq(registry.get("taken").unwrap(), &existing), "the first provider keeps the name");
    assert!(Arc::ptr_eq(registry.get("fs").unwrap(), registry.get("mcp:fs").unwrap()));
}

#[tokio::test]
async fn a_server_that_cannot_start_fails_only_when_used() {
    let credentials = Arc::new(CredentialStore::in_memory());
    let mut registry = ToolRegistry::new();
    let missing = validate_input(stdio_input("ghost", "graphrt-no-such-mcp-server-binary", &[])).unwrap();
    register_servers(&mut registry, &[missing], &credentials);
    let runtime = registry.get("ghost").unwrap();

    let error = runtime.list().await.unwrap_err();
    assert_eq!(error.tool, "ghost/*");
    assert!(error.message.contains("ghost"), "{}", error.message);
    let call_error = runtime.call("anything", serde_json::json!({})).await.unwrap_err();
    assert_eq!(call_error.message, error.message, "the failed connection is not retried within a run");
}

#[tokio::test]
async fn a_missing_secret_is_reported_with_where_to_set_it() {
    let credentials = Arc::new(CredentialStore::in_memory());
    let mut registry = ToolRegistry::new();
    let needs_secret =
        validate_input(McpServerInput { secret_env: vec!["GITHUB_TOKEN".into()], ..stdio_input("github", "srv", &[]) })
            .unwrap();
    register_servers(&mut registry, &[needs_secret], &credentials);
    let error = registry.get("mcp:github").unwrap().list().await.unwrap_err();
    assert!(
        error.message.contains("GITHUB_TOKEN") && error.message.contains("Connections > Advanced"),
        "{}",
        error.message
    );
}

#[test]
fn builder_guide_lists_known_tools() {
    assert_eq!(servers_guide(&[]), "");
    let mut checked = validate_input(stdio_input("fs", "srv", &[])).unwrap();
    checked.known_tools = vec![
        McpToolInfo { name: "read_file".into(), description: "Read  a\nfile".into(), input_schema: None },
        McpToolInfo { name: "list_dir".into(), description: String::new(), input_schema: None },
    ];
    let unchecked = validate_input(http_input("remote", "https://x/mcp", None)).unwrap();
    let guide = servers_guide(&[checked, unchecked]);
    assert!(guide.contains("provider_id: <server>"));
    assert!(guide.contains("Server `fs`:\n  - `read_file`: Read a file\n  - `list_dir`"), "{guide}");
    assert!(guide.contains("Server `remote`: tools not checked yet; use `remote/*`"), "{guide}");
}

/// A minimal MCP server over stdio (newline-delimited JSON-RPC), run with python3.
const FAKE_SERVER_SCRIPT: &str = r#"
import json, os, sys
for line in sys.stdin:
    message = json.loads(line)
    method = message.get("method")
    if "id" not in message:
        continue
    if method == "initialize":
        result = {"protocolVersion": message["params"]["protocolVersion"], "capabilities": {"tools": {}},
                  "serverInfo": {"name": "fake", "version": "1.0.0"}}
    elif method == "tools/list":
        result = {"tools": [{"name": "echo", "description": "Echo text", "inputSchema": {"type": "object"}},
                            {"name": "token", "description": "Shows the token", "inputSchema": {"type": "object"}}]}
    elif method == "tools/call":
        name = message["params"]["name"]
        arguments = message["params"].get("arguments") or {}
        text = arguments.get("text", "") if name == "echo" else os.environ.get("FAKE_TOKEN", "unset")
        result = {"content": [{"type": "text", "text": text}], "isError": False}
    else:
        result = {}
    sys.stdout.write(json.dumps({"jsonrpc": "2.0", "id": message["id"], "result": result}) + "\n")
    sys.stdout.flush()
"#;

fn python_available() -> bool {
    std::process::Command::new("python3").arg("--version").output().is_ok_and(|output| output.status.success())
}

#[tokio::test]
async fn checks_a_real_stdio_server_and_calls_its_tools_in_a_run_registry() {
    if !python_available() {
        eprintln!("skipping: python3 is not installed");
        return;
    }
    let script_dir = tempfile::tempdir().unwrap();
    let script_path = script_dir.path().join("fake_mcp_server.py");
    std::fs::write(&script_path, FAKE_SERVER_SCRIPT).unwrap();
    let db = Database::open_in_memory().unwrap();
    let credentials = Arc::new(CredentialStore::in_memory());
    credentials.set_workflow_secret("FAKE_TOKEN", "token-from-keychain").unwrap();
    let input = McpServerInput {
        secret_env: vec!["FAKE_TOKEN".into()],
        ..stdio_input("fake", "python3", &[script_path.to_str().unwrap()])
    };
    add_definition(&db, input).unwrap();

    let checked = check_connection(&db, &credentials, "fake").await.unwrap();
    let check = checked.last_check.clone().unwrap();
    assert!(check.connected, "{:?}", check.error);
    let tool_names: Vec<&str> = checked.known_tools.iter().map(|tool| tool.name.as_str()).collect();
    assert_eq!(tool_names, ["echo", "token"]);
    assert_eq!(load_definitions(&db).unwrap()[0], checked, "the check is stored");

    let mut registry = ToolRegistry::new();
    register_servers(&mut registry, &[checked], &credentials);
    let runtime = registry.get("mcp:fake").unwrap();
    let echoed = runtime.call("echo", serde_json::json!({"text": "hello"})).await.unwrap();
    assert_eq!(echoed.text, "hello");
    let token = runtime.call("token", serde_json::json!({})).await.unwrap();
    assert_eq!(token.text, "token-from-keychain", "the named secret reaches the server as an env variable");
}

#[tokio::test]
async fn a_failed_check_is_recorded_not_returned_as_an_error() {
    let db = Database::open_in_memory().unwrap();
    let credentials = CredentialStore::in_memory();
    add_definition(&db, stdio_input("ghost", "graphrt-no-such-mcp-server-binary", &[])).unwrap();
    let checked = check_connection(&db, &credentials, "ghost").await.unwrap();
    let check = checked.last_check.unwrap();
    assert!(!check.connected);
    assert!(check.error.unwrap().contains("ghost"));
    assert!(matches!(check_connection(&db, &credentials, "missing").await, Err(AppError::NotFound(_))));
}
