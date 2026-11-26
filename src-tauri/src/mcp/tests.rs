use std::path::Path;
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
        auth: None,
    }
}

fn http_input(name: &str, url: &str, bearer_token_secret: Option<&str>) -> McpServerInput {
    McpServerInput {
        name: name.into(),
        transport: McpServerTransport::Http { url: url.into() },
        secret_env: Vec::new(),
        bearer_token_secret: bearer_token_secret.map(str::to_owned),
        auth: None,
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
    let credentials = Arc::new(CredentialStore::in_memory());
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
            // Windows resolves a bare name to its full path (`...\\npx.cmd`); elsewhere it stays `npx`.
            assert_eq!(Path::new(&stdio_config.command).file_stem().and_then(|stem| stem.to_str()), Some("npx"));
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
    let credentials = Arc::new(CredentialStore::in_memory());
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
    let credentials = Arc::new(CredentialStore::in_memory());
    add_definition(&db, stdio_input("ghost", "graphrt-no-such-mcp-server-binary", &[])).unwrap();
    let checked = check_connection(&db, &credentials, "ghost").await.unwrap();
    let check = checked.last_check.unwrap();
    assert!(!check.connected);
    assert!(check.error.unwrap().contains("ghost"));
    assert!(matches!(check_connection(&db, &credentials, "missing").await, Err(AppError::NotFound(_))));
}

#[test]
fn auth_kind_is_checked_against_the_transport_and_the_secret() {
    let bearer = validate_input(http_input("remote", "https://mcp.example.com/mcp", Some("TOKEN"))).unwrap();
    assert_eq!(bearer.auth, McpAuthKind::Bearer, "a named secret without `auth` means bearer");
    let open = validate_input(http_input("open", "https://mcp.example.com/mcp", None)).unwrap();
    assert_eq!(open.auth, McpAuthKind::None);
    let oauth = validate_input(McpServerInput {
        auth: Some(McpAuthKind::Oauth),
        ..http_input("upwork", "https://mcp.upwork.com/mcp", None)
    })
    .unwrap();
    assert_eq!(oauth.auth, McpAuthKind::Oauth);

    let refused = [
        McpServerInput { auth: Some(McpAuthKind::Oauth), ..stdio_input("fs", "srv", &[]) },
        McpServerInput { auth: Some(McpAuthKind::Oauth), ..http_input("x", "http://mcp.remote.test/mcp", None) },
        McpServerInput { auth: Some(McpAuthKind::Oauth), ..http_input("x", "https://x/mcp", Some("TOKEN")) },
        McpServerInput { auth: Some(McpAuthKind::Bearer), ..http_input("x", "https://x/mcp", None) },
        McpServerInput { auth: Some(McpAuthKind::None), ..http_input("x", "https://x/mcp", Some("TOKEN")) },
    ];
    for input in refused {
        assert!(matches!(validate_input(input.clone()), Err(AppError::InvalidInput(_))), "{input:?}");
    }
}

#[test]
fn definitions_stored_before_auth_existed_keep_their_bearer_token() {
    let db = Database::open_in_memory().unwrap();
    let legacy = r#"[{"name":"remote","transport":{"kind":"http","url":"https://x/mcp"},"secretEnv":[],
        "bearerTokenSecret":"TOKEN","knownTools":[],"lastCheck":null},
        {"name":"fs","transport":{"kind":"stdio","command":"srv","args":[]}}]"#;
    db.set_setting(definitions::SETTING_MCP_SERVERS, legacy).unwrap();
    let loaded = load_definitions(&db).unwrap();
    assert_eq!(loaded[0].auth, McpAuthKind::Bearer);
    assert_eq!(loaded[1].auth, McpAuthKind::None);
    assert_eq!(loaded[1].approval, McpApprovalPolicy::default());
}

#[test]
fn an_oauth_server_needs_a_sign_in_before_a_run_connects() {
    let credentials = Arc::new(CredentialStore::in_memory());
    let definition = upwork_from_plugin();
    match runtime_config(&definition, &credentials) {
        Err(AppError::MissingCredentials(message)) => assert!(message.contains("Sign in"), "{message}"),
        other => panic!("expected a missing sign-in, got {other:?}"),
    }
    credentials.set_mcp_oauth("upwork", crate::credentials::McpOAuthPart::RefreshToken, "refresh").unwrap();
    let session = oauth::store::OAuthSession {
        server_url: "https://mcp.upwork.com/mcp".into(),
        resource: "https://mcp.upwork.com/mcp".into(),
        issuer: "https://mcp.upwork.com".into(),
        authorization_endpoint: "https://www.upwork.com/authorize".into(),
        token_endpoint: "https://www.upwork.com/token".into(),
        revocation_endpoint: None,
        client_id: "client".into(),
        client_kind: oauth::store::ClientKind::Dynamic,
        redirect_uri: "http://127.0.0.1:1/callback".into(),
        scope: None,
        signed_in_at: None,
        needs_sign_in: None,
    };
    oauth::store::save_session(&credentials, "upwork", &session).unwrap();
    match runtime_config(&definition, &credentials).unwrap().transport {
        McpTransport::Http(http) => {
            assert!(http.token_source.is_some() && http.bearer_token.is_none(), "{http:?}");
        }
        other => panic!("unexpected {other:?}"),
    }
}

#[test]
fn a_tool_can_be_relaxed_and_made_to_ask_again() {
    let db = Database::open_in_memory().unwrap();
    let preset = upwork_from_plugin();
    definitions::store_new_definition(&db, preset).unwrap();
    assert!(load_definitions(&db).unwrap()[0].approval.tool_sends("send_message"));

    let (relaxed, _) = definitions::set_tool_approval(&db, "upwork", " send_message ", false).unwrap();
    assert_eq!(relaxed.approval.without_approval, ["send_message"]);
    assert!(!load_definitions(&db).unwrap()[0].approval.tool_sends("send_message"));
    let (again, _) = definitions::set_tool_approval(&db, "upwork", "send_message", true).unwrap();
    assert!(again.approval.without_approval.is_empty());

    assert!(definitions::set_tool_approval(&db, "upwork", "*", false).is_err(), "never all tools at once");
    assert!(matches!(definitions::set_tool_approval(&db, "missing", "x", false), Err(AppError::NotFound(_))));
}

#[test]
fn servers_without_a_policy_keep_the_name_rule() {
    let policy = McpApprovalPolicy::default();
    assert!(!policy.tool_sends("list_issues"));
    assert!(policy.tool_sends("create_issue"));
    assert!(policy.tool_sends("*"));
    let relaxed = McpApprovalPolicy { without_approval: vec!["create_issue".into()], ..McpApprovalPolicy::default() };
    assert!(!relaxed.tool_sends("create_issue"));
}

#[test]
fn a_view_shows_the_sign_in_only_for_oauth_servers() {
    let credentials = CredentialStore::in_memory();
    let preset = upwork_from_plugin();
    assert_eq!(view(preset, &credentials).sign_in, Some(oauth::McpSignInStatus::SignedOut));
    let plain = validate_input(http_input("open", "https://x/mcp", None)).unwrap();
    let shown = serde_json::to_value(view(plain, &credentials)).unwrap();
    assert_eq!(shown["signIn"], serde_json::Value::Null);
    assert_eq!(shown["auth"], "none");
}

#[test]
fn approval_checks_use_the_server_policy_by_provider_name() {
    let upwork = upwork_from_plugin();
    let definitions = [upwork];
    assert_eq!(tool_sends_in(&definitions, "upwork", "find_jobs"), Some(false));
    assert_eq!(tool_sends_in(&definitions, "mcp:upwork", "confirm_preview"), Some(true));
    // Upwork's strict rule: only find/get/list/search read.
    assert_eq!(tool_sends_in(&definitions, "upwork", "respond_to_offer"), Some(true));
    assert_eq!(tool_sends_in(&definitions, "github", "create_issue"), None, "not an MCP server: the caller decides");
}

/// The server the Upwork MCP preset plugin declares (graphrt-plugins `upwork/`).
fn upwork_server() -> crate::plugins::host::PluginMcpServer {
    crate::plugins::host::PluginMcpServer {
        spec: serde_json::from_value(serde_json::json!({
            "url": "https://mcp.upwork.com/mcp",
            "auth": "oauth",
            "approval": {"default": "ask", "read_only": ["find_*", "get_*", "list_*", "search_*"]},
            "guide": "guide.md"
        }))
        .unwrap(),
        guide: Some("- Use `{server}/list_accounts` first.".into()),
    }
}

fn upwork_from_plugin() -> McpServerDefinition {
    plugin_servers::definition_for("upwork", &upwork_server()).unwrap()
}

#[test]
fn a_plugin_server_asks_before_every_tool_that_does_not_read() {
    let upwork = upwork_from_plugin();
    assert_eq!(upwork.auth, McpAuthKind::Oauth);
    assert_eq!(upwork.plugin.as_deref(), Some("upwork"));
    for reading in ["find_jobs", "get_job_posting", "list_accounts", "search_tools", "get_preview"] {
        assert!(!upwork.approval.tool_sends(reading), "{reading} reads");
    }
    for sending in
        ["confirm_preview", "post_job", "send_message", "manage_proposals", "respond_to_offer", "execute_tool", "*"]
    {
        assert!(upwork.approval.tool_sends(sending), "{sending} asks first");
    }
    // A reading prefix never loosens the name rule (review #4).
    for disguised in ["get_and_send_report", "find_and_invite_freelancer", "list_then_submit", "get_upload_status"] {
        assert!(upwork.approval.tool_sends(disguised), "{disguised} says it sends");
    }
    let mut relaxed = upwork.clone();
    relaxed.approval.ask_first = vec!["find_secret*".into()];
    assert!(relaxed.approval.tool_sends("find_secrets"), "ask_first wins over read_only");
}

#[test]
fn installing_updating_and_removing_a_preset_plugin_syncs_its_server() {
    let mut stored = vec![validate_input(http_input("github", "https://mcp.github.test/mcp", None)).unwrap()];
    let presets = vec![("upwork".to_owned(), upwork_server())];
    let added = plugin_servers::apply(&mut stored, &presets);
    assert_eq!(added.added, ["upwork"]);
    assert_eq!(stored.len(), 2);

    // The user relaxed a tool and tested the server; an update keeps both.
    stored[1].approval.without_approval = vec!["send_message".into()];
    stored[1].known_tools =
        vec![McpToolInfo { name: "find_jobs".into(), description: String::new(), input_schema: None }];
    let mut updated_server = upwork_server();
    updated_server.guide = Some("new guide".into());
    let outcome = plugin_servers::apply(&mut stored, &[("upwork".to_owned(), updated_server)]);
    assert!(outcome.added.is_empty() && outcome.removed.is_empty());
    assert_eq!(stored[1].approval.without_approval, ["send_message"]);
    assert_eq!(stored[1].known_tools.len(), 1);
    assert_eq!(stored[1].guide.as_deref(), Some("new guide"));

    let removed = plugin_servers::apply(&mut stored, &[]);
    assert_eq!(removed.removed, ["upwork"]);
    assert_eq!(stored.len(), 1, "a server added by hand stays");
}

#[test]
fn a_preset_never_replaces_a_server_added_by_hand() {
    let mut stored = vec![validate_input(http_input("upwork", "https://my.proxy.test/mcp", None)).unwrap()];
    let outcome = plugin_servers::apply(&mut stored, &[("upwork".to_owned(), upwork_server())]);
    assert_eq!(outcome.skipped.len(), 1);
    assert!(outcome.skipped[0].1.contains("added by hand"), "{:?}", outcome.skipped);
    assert_eq!(stored[0].transport, McpServerTransport::Http { url: "https://my.proxy.test/mcp".into() });
    let too_long = "a".repeat(41);
    let outcome = plugin_servers::apply(&mut stored, &[(too_long, upwork_server())]);
    assert_eq!(outcome.skipped.len(), 1, "names the app cannot use are reported");
}

#[test]
fn removing_a_preset_plugin_forgets_the_local_sign_in() {
    let db = Database::open_in_memory().unwrap();
    let credentials = CredentialStore::in_memory();
    plugin_servers::sync(&db, &credentials, &[("upwork".to_owned(), upwork_server())]).unwrap();
    credentials.set_mcp_oauth("upwork", crate::credentials::McpOAuthPart::RefreshToken, "refresh").unwrap();
    let (outcome, all) = plugin_servers::sync(&db, &credentials, &[]).unwrap();
    assert_eq!(outcome.removed, ["upwork"]);
    assert!(all.is_empty());
    assert_eq!(credentials.read_mcp_oauth("upwork", crate::credentials::McpOAuthPart::RefreshToken).unwrap(), None);
}

#[test]
fn the_builder_gets_the_plugin_rules_and_guide() {
    let mut upwork = upwork_from_plugin();
    upwork.name = "work".into();
    upwork.approval.without_approval = vec!["send_message".into()];
    let guide = prompt_guide::plugin_guide(&upwork);
    assert!(guide.contains("comes from the upwork plugin"), "{guide}");
    assert!(guide.contains("`find_*`") && guide.contains("plus `send_message`"), "{guide}");
    assert!(guide.contains("`require_approval`") && guide.contains("`work/find_jobs`"), "{guide}");
    assert!(guide.contains("Use `work/list_accounts` first."), "{{server}} is replaced: {guide}");
    let by_hand = validate_input(http_input("open", "https://x/mcp", None)).unwrap();
    assert!(prompt_guide::plugin_guide(&by_hand).is_empty());
}
