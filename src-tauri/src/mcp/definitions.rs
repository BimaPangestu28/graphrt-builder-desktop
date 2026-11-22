//! MCP server definitions as the user adds them in Connections > Advanced, and
//! their translation into graphrt-mcp configs.
//!
//! Definitions are stored as one JSON array in the `settings` table
//! ([`SETTING_MCP_SERVERS`]). They never hold secret values: a server names
//! the workflow secrets it needs (OS credential store, see [`CredentialStore`]) and the
//! values are read only when a run actually connects to the server.

use std::ffi::OsStr;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use graphrt_mcp::config::DEFAULT_TIMEOUT_MS;
use graphrt_mcp::{HttpConfig, McpServerConfig, McpTransport, StdioConfig};
use indexmap::IndexMap;
use serde::{Deserialize, Serialize};

use crate::agent_steps::AGENT_TOOL_PROVIDER;
use crate::credentials::CredentialStore;
use crate::error::{AppError, AppResult};
use crate::storage::{now_rfc3339, Database};

/// Settings key holding every definition as a JSON array.
pub const SETTING_MCP_SERVERS: &str = "mcp.servers";

/// Longest server name (it becomes a tool provider id in workflow documents).
const MAX_NAME_LENGTH: usize = 40;

/// Directories GUI apps usually miss on `PATH` (macOS starts them with
/// `/usr/bin:/bin:/usr/sbin:/sbin`), so `npx` / `uvx` from Homebrew are found.
const EXTRA_PATH_DIRECTORIES: [&str; 2] = ["/opt/homebrew/bin", "/usr/local/bin"];

/// Serializes read-modify-write of the stored list (add / remove / check).
static DEFINITIONS_WRITE_LOCK: Mutex<()> = Mutex::new(());

/// How the app reaches a server.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum McpServerTransport {
    /// A local program speaking MCP over stdin / stdout, e.g. `npx -y @modelcontextprotocol/server-filesystem ~/Documents`.
    Stdio {
        command: String,
        #[serde(default)]
        args: Vec<String>,
    },
    /// A remote server over Streamable HTTP.
    Http { url: String },
}

/// One tool a server reported during its last connection check.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct McpToolInfo {
    pub name: String,
    pub description: String,
    /// JSON Schema of the tool's arguments (`inputSchema` of `tools/list`), kept so the
    /// Nodes view shows the tool's inputs as a form. Absent for checks made before it was kept.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub input_schema: Option<serde_json::Value>,
}

/// Result of the latest "Test connection".
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct McpConnectionCheck {
    pub connected: bool,
    /// Why the connection failed (never contains secret values).
    pub error: Option<String>,
    /// RFC 3339 time of the check.
    pub checked_at: String,
}

/// What the user enters to add a server.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct McpServerInput {
    /// Provider id in workflows: `provider_id: <name>` or `tools: [<name>/*]`.
    pub name: String,
    pub transport: McpServerTransport,
    /// Workflow secrets passed to a stdio server as environment variables of the same name.
    #[serde(default)]
    pub secret_env: Vec<String>,
    /// Workflow secret sent as the bearer token to an HTTP server.
    #[serde(default)]
    pub bearer_token_secret: Option<String>,
}

/// A stored server: the user's input plus what the last check found.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct McpServerDefinition {
    pub name: String,
    pub transport: McpServerTransport,
    #[serde(default)]
    pub secret_env: Vec<String>,
    #[serde(default)]
    pub bearer_token_secret: Option<String>,
    /// Tools found by the last successful check (listed in the builder prompt).
    #[serde(default)]
    pub known_tools: Vec<McpToolInfo>,
    #[serde(default)]
    pub last_check: Option<McpConnectionCheck>,
}

impl McpServerDefinition {
    /// Every workflow secret this server needs.
    pub fn secret_names(&self) -> Vec<&str> {
        self.secret_env.iter().map(String::as_str).chain(self.bearer_token_secret.as_deref()).collect()
    }
}

/// Checks and normalizes the input (trimmed text, no empty arguments).
///
/// # Errors
/// `InvalidInput` naming the first problem.
pub fn validate_input(input: McpServerInput) -> AppResult<McpServerDefinition> {
    let name = input.name.trim().to_owned();
    validate_name(&name)?;
    let transport = normalize_transport(input.transport)?;
    let secret_env: Vec<String> = input.secret_env.iter().map(|secret| secret.trim().to_owned()).collect();
    let bearer_token_secret =
        input.bearer_token_secret.map(|secret| secret.trim().to_owned()).filter(|s| !s.is_empty());
    match &transport {
        McpServerTransport::Stdio { .. } if bearer_token_secret.is_some() => {
            return Err(invalid("a bearer token only applies to servers reached by URL"));
        }
        McpServerTransport::Http { .. } if !secret_env.is_empty() => {
            return Err(invalid("environment secrets only apply to servers started by a command"));
        }
        McpServerTransport::Http { url } if bearer_token_secret.is_some() && !may_carry_a_token(url) => {
            return Err(invalid(BEARER_OVER_HTTP_MESSAGE));
        }
        _ => {}
    }
    for secret_name in secret_env.iter().chain(bearer_token_secret.iter()) {
        validate_secret_name(secret_name)?;
    }
    Ok(McpServerDefinition {
        name,
        transport,
        secret_env,
        bearer_token_secret,
        known_tools: Vec::new(),
        last_check: None,
    })
}

const BEARER_OVER_HTTP_MESSAGE: &str = "a bearer token is only sent over https:// (or http:// to this computer: \
     localhost, 127.0.0.1 or ::1); change the address to https://";

/// Whether a bearer token may go to `url`: `https://`, or `http://` to a loopback host.
fn may_carry_a_token(url: &str) -> bool {
    let Ok(parsed) = reqwest::Url::parse(url) else { return false };
    match parsed.scheme() {
        "https" => true,
        "http" => parsed.host_str().is_some_and(|host| {
            let host = host.trim_start_matches('[').trim_end_matches(']');
            host.eq_ignore_ascii_case("localhost")
                || host.parse::<std::net::IpAddr>().is_ok_and(|address| address.is_loopback())
        }),
        _ => false,
    }
}

fn invalid(message: &str) -> AppError {
    AppError::InvalidInput(message.to_owned())
}

/// Lowercase letters, digits, `-` and `_`; it cannot shadow the `agents` provider.
fn validate_name(name: &str) -> AppResult<()> {
    let is_valid_character = |character: char| {
        character.is_ascii_lowercase() || character.is_ascii_digit() || character == '-' || character == '_'
    };
    let starts_well = name.chars().next().is_some_and(|first| first.is_ascii_lowercase() || first.is_ascii_digit());
    if !starts_well || name.len() > MAX_NAME_LENGTH || !name.chars().all(is_valid_character) {
        return Err(AppError::InvalidInput(format!(
            "MCP server names use lowercase letters, digits, - and _, start with a letter or digit and are at most \
             {MAX_NAME_LENGTH} characters"
        )));
    }
    if name == AGENT_TOOL_PROVIDER || name == "builtin" {
        return Err(AppError::InvalidInput(format!("`{name}` is reserved; pick another name")));
    }
    Ok(())
}

fn normalize_transport(transport: McpServerTransport) -> AppResult<McpServerTransport> {
    match transport {
        McpServerTransport::Stdio { command, args } => {
            let command = command.trim().to_owned();
            if command.is_empty() || command.contains('\n') {
                return Err(invalid("enter the command that starts the server"));
            }
            let args = args.into_iter().map(|arg| arg.trim().to_owned()).filter(|arg| !arg.is_empty()).collect();
            Ok(McpServerTransport::Stdio { command, args })
        }
        McpServerTransport::Http { url } => {
            let url = url.trim().to_owned();
            if !(url.starts_with("https://") || url.starts_with("http://")) || url.contains(char::is_whitespace) {
                return Err(invalid("the server address must start with https:// or http://"));
            }
            Ok(McpServerTransport::Http { url })
        }
    }
}

/// Same rule as workflow secrets (`GOOGLE_PLACES_KEY`), checked early for a clear message.
fn validate_secret_name(name: &str) -> AppResult<()> {
    let starts_well = name.chars().next().is_some_and(|first| first.is_ascii_alphabetic() || first == '_');
    let is_valid =
        name.len() <= 64 && name.chars().all(|character| character.is_ascii_alphanumeric() || character == '_');
    if starts_well && is_valid {
        Ok(())
    } else {
        Err(AppError::InvalidInput(format!("`{name}` is not a valid secret name (letters, digits and underscores)")))
    }
}

/// Every stored definition, in the order they were added. An unreadable value
/// is logged and treated as empty so runs never fail because of it.
///
/// # Errors
/// `Database` when the settings table cannot be read.
pub fn load_definitions(db: &Database) -> AppResult<Vec<McpServerDefinition>> {
    let Some(stored_json) = db.get_setting(SETTING_MCP_SERVERS)? else {
        return Ok(Vec::new());
    };
    Ok(serde_json::from_str(&stored_json).unwrap_or_else(|error| {
        log::warn!("ignoring unreadable MCP server list: {error}");
        Vec::new()
    }))
}

fn save_definitions(db: &Database, definitions: &[McpServerDefinition]) -> AppResult<()> {
    db.set_setting(SETTING_MCP_SERVERS, &serde_json::to_string(definitions)?)
}

/// Runs `change` on the stored list and saves the result, one writer at a time.
fn modify_definitions<Output>(
    db: &Database,
    change: impl FnOnce(&mut Vec<McpServerDefinition>) -> AppResult<Output>,
) -> AppResult<(Output, Vec<McpServerDefinition>)> {
    let _guard =
        DEFINITIONS_WRITE_LOCK.lock().map_err(|_| AppError::Internal("MCP server list lock poisoned".into()))?;
    let mut definitions = load_definitions(db)?;
    let output = change(&mut definitions)?;
    save_definitions(db, &definitions)?;
    Ok((output, definitions))
}

/// Validates and stores a new server; returns it and the whole updated list.
///
/// # Errors
/// `InvalidInput` for a bad input or a name already in use.
pub fn add_definition(
    db: &Database,
    input: McpServerInput,
) -> AppResult<(McpServerDefinition, Vec<McpServerDefinition>)> {
    let definition = validate_input(input)?;
    modify_definitions(db, |definitions| {
        if definitions.iter().any(|existing| existing.name == definition.name) {
            return Err(AppError::InvalidInput(format!("an MCP server named `{}` is already added", definition.name)));
        }
        definitions.push(definition.clone());
        Ok(definition)
    })
}

/// Removes a server; returns the updated list.
///
/// # Errors
/// `NotFound` when no server has that name.
pub fn remove_definition(db: &Database, name: &str) -> AppResult<Vec<McpServerDefinition>> {
    let (_, definitions) = modify_definitions(db, |definitions| {
        let count_before = definitions.len();
        definitions.retain(|definition| definition.name != name);
        if definitions.len() == count_before {
            return Err(AppError::NotFound(format!("MCP server {name}")));
        }
        Ok(())
    })?;
    Ok(definitions)
}

/// Stores the outcome of a connection check (and the tools on success).
///
/// # Errors
/// `NotFound` when the server was removed meanwhile.
pub fn record_check(
    db: &Database,
    name: &str,
    tools: Option<Vec<McpToolInfo>>,
    error: Option<String>,
) -> AppResult<(McpServerDefinition, Vec<McpServerDefinition>)> {
    modify_definitions(db, |definitions| {
        let definition = definitions
            .iter_mut()
            .find(|definition| definition.name == name)
            .ok_or_else(|| AppError::NotFound(format!("MCP server {name}")))?;
        let connected = tools.is_some();
        if let Some(tools) = tools {
            definition.known_tools = tools;
        }
        definition.last_check = Some(McpConnectionCheck { connected, error, checked_at: now_rfc3339() });
        Ok(definition.clone())
    })
}

/// The graphrt-mcp config for `definition`, with its secrets read from the credential store.
///
/// Stdio servers get an empty environment except graphrt-mcp's launcher
/// essentials, a `PATH` that also covers Homebrew, and the named secrets.
///
/// # Errors
/// `MissingCredentials` listing every secret that is not set.
pub fn runtime_config(definition: &McpServerDefinition, credentials: &CredentialStore) -> AppResult<McpServerConfig> {
    let mut missing_names = Vec::new();
    let mut read_secret = |secret_name: &str| -> AppResult<Option<String>> {
        let value = credentials.read_workflow_secret(secret_name)?;
        if value.is_none() {
            missing_names.push(secret_name.to_owned());
        }
        Ok(value)
    };
    let transport = match &definition.transport {
        McpServerTransport::Stdio { command, args } => {
            let mut env = IndexMap::new();
            env.insert("PATH".to_owned(), extended_path(std::env::var("PATH").ok()));
            for secret_name in &definition.secret_env {
                if let Some(value) = read_secret(secret_name)? {
                    env.insert(secret_name.clone(), value);
                }
            }
            McpTransport::Stdio(StdioConfig {
                command: launch_command(command),
                args: args.clone(),
                env,
                pass_env: Vec::new(),
                inherit_env: false,
                cwd: None,
                show_stderr: false,
            })
        }
        McpServerTransport::Http { url } => {
            let bearer_token = match &definition.bearer_token_secret {
                // A definition saved before this rule: never send the token in clear text.
                Some(_) if !may_carry_a_token(url) => return Err(invalid(BEARER_OVER_HTTP_MESSAGE)),
                Some(secret_name) => read_secret(secret_name)?,
                None => None,
            };
            McpTransport::Http(HttpConfig { url: url.clone(), headers: IndexMap::new(), bearer_token })
        }
    };
    if !missing_names.is_empty() {
        return Err(AppError::MissingCredentials(missing_names.join(", ")));
    }
    Ok(McpServerConfig {
        name: definition.name.clone(),
        transport,
        timeout_ms: DEFAULT_TIMEOUT_MS,
        allowed_tools: None,
    })
}

/// The program to start for a stdio server's `command`.
///
/// On Windows, starting `npx` only looks for `npx.exe`, while Node ships
/// `npx.cmd` (likewise `uvx.cmd`, `pnpm.cmd`, ...). So a bare name is resolved
/// through `PATH` and `PATHEXT` to its full path, which std can start (it runs
/// `.cmd` / `.bat` through `cmd.exe` with safe quoting). Elsewhere, and when
/// nothing matches, the command is used as written.
fn launch_command(command: &str) -> String {
    if !cfg!(windows) {
        return command.to_owned();
    }
    let search_path = std::env::var_os("PATH").unwrap_or_default();
    let path_extensions = std::env::var("PATHEXT").unwrap_or_else(|_| DEFAULT_WINDOWS_PATH_EXTENSIONS.to_owned());
    find_command_with_extensions(command, &search_path, &path_extensions)
        .map(|resolved| resolved.display().to_string())
        .unwrap_or_else(|| command.to_owned())
}

/// `PATHEXT` when the variable is missing.
const DEFAULT_WINDOWS_PATH_EXTENSIONS: &str = ".COM;.EXE;.BAT;.CMD";

/// The first `<directory>/<command><extension>` that is a file, trying each
/// `PATH` directory (in `search_path`, split the platform's way) with each
/// `PATHEXT` extension. `None` for names with a directory part or one of those
/// extensions already, which need no lookup.
///
/// @example
/// // PATH=C:\Program Files\nodejs, PATHEXT=.EXE;.CMD → C:\Program Files\nodejs\npx.cmd
/// find_command_with_extensions("npx", &search_path, ".EXE;.CMD");
pub(crate) fn find_command_with_extensions(
    command: &str,
    search_path: &OsStr,
    path_extensions: &str,
) -> Option<PathBuf> {
    let extensions: Vec<String> = path_extensions
        .split(';')
        .map(str::trim)
        .filter(|extension| !extension.is_empty())
        .map(str::to_ascii_lowercase)
        .collect();
    let already_has_extension = Path::new(command).extension().is_some_and(|extension| {
        extensions.contains(&format!(".{}", extension.to_string_lossy().to_ascii_lowercase()))
    });
    if command.is_empty() || command.contains(['/', '\\']) || already_has_extension {
        return None;
    }
    std::env::split_paths(search_path).filter(|directory| !directory.as_os_str().is_empty()).find_map(|directory| {
        extensions
            .iter()
            .map(|extension| directory.join(format!("{command}{extension}")))
            .find(|candidate| candidate.is_file())
    })
}

/// `current` plus [`EXTRA_PATH_DIRECTORIES`] that are not on it yet.
pub(crate) fn extended_path(current: Option<String>) -> String {
    if cfg!(windows) {
        return current.unwrap_or_default();
    }
    let mut directories: Vec<String> =
        current.unwrap_or_default().split(':').filter(|directory| !directory.is_empty()).map(str::to_owned).collect();
    for extra in EXTRA_PATH_DIRECTORIES {
        if !directories.iter().any(|directory| directory == extra) {
            directories.push(extra.to_owned());
        }
    }
    directories.join(":")
}
