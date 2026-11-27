//! Running `graphrt deploy` and reading its JSON Lines output.
//!
//! Contract: graphrt `docs/deploy-direct.md` and `docs/schemas/deploy-direct.schema.json` (a copy
//! is in `contract/`, checked by [`super::contract`]'s tests).
//! `graphrt deploy --target fly --direct --deployment <name> --version <label> [--region <code>]
//! [--mode always-on|scale-to-zero] [--secret NAME ...] [--org <slug>] [--image <ref>]
//! [--rotate-api-key] --json <agent.yaml>` prints one JSON object per line:
//! `{"type":"step","step":"preparing|secrets|starting|checking","status":"running|done|failed","message"}`,
//! then `{"type":"result","action":"deploy","url","version","app","workflow","api_key"}` or
//! `{"type":"error","code","message"}`. A deploy that stored a new API key and then failed prints
//! `{"type":"api_key","api_key"}` right before its `error` line: that key is live on Fly.io.
//! `api_key` in the result is `null` on every deploy but the first and `--rotate-api-key`.
//! `graphrt deploy status|list-versions|rollback <v>|pause|resume|remove --target fly --direct
//! --deployment <name> --json` manage it.
//!
//! Google Cloud Run (graphrt `docs/deploy-cloud-run.md`) takes the same flags and prints the
//! same lines, with `--target cloud-run --project <id> --region <region>` (the management
//! commands too: a deployment lives in one project and region) and its credential in
//! `GOOGLE_OAUTH_ACCESS_TOKEN`.
//!
//! **Secrets never go on the command line.** The provider credential is `FLY_API_TOKEN` and each
//! `--secret NAME` value is the environment variable `NAME`. The process starts with an empty
//! environment plus [`PASSTHROUGH_ENV`], so nothing else of the app's environment leaks in.

use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::Arc;
use std::time::Duration;

use serde::{Deserialize, Serialize};
use tokio::io::{AsyncBufReadExt, AsyncReadExt, BufReader};

use super::providers::DeployProvider;
use crate::error::{AppError, AppResult};
use crate::storage::deployments::DeployMode;

/// Longest a deploy may take before it is stopped.
pub const DEPLOY_TIMEOUT: Duration = Duration::from_secs(30 * 60);
/// Longest a status / pause / resume / remove / rollback call may take.
pub const MANAGE_TIMEOUT: Duration = Duration::from_secs(5 * 60);
/// Longest stdout line read (a JSON event); longer lines are cut.
const MAX_LINE_BYTES: usize = 64 * 1024;
/// stderr kept for the technical log.
const MAX_STDERR_BYTES: usize = 32 * 1024;

/// Variables copied from the app's environment so the CLI can find TLS roots, temp and home.
pub const PASSTHROUGH_ENV: &[&str] =
    &["PATH", "HOME", "USERPROFILE", "SYSTEMROOT", "TMPDIR", "TEMP", "TMP", "LANG", "SSL_CERT_FILE", "SSL_CERT_DIR"];

/// The variable the Fly.io access key goes in.
pub const FLY_TOKEN_ENV: &str = "FLY_API_TOKEN";

/// One `graphrt deploy` request.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DeployRequest {
    pub target: DeployProvider,
    pub deployment: String,
    pub version_label: String,
    pub region: Option<String>,
    /// `--project` (Google Cloud).
    pub project: Option<String>,
    pub mode: DeployMode,
    pub org: Option<String>,
    /// `--secret NAME` (names only; values are environment variables).
    pub secret_names: Vec<String>,
    /// `--image <ref>`: another image running `graphrt serve` (Advanced). `None`: the CLI's
    /// default, `ghcr.io/graphrt/graphrt:<CLI version>`.
    pub image: Option<String>,
    /// `--rotate-api-key`: replace the deployment's API key (the new one is in the result).
    pub rotate_api_key: bool,
    /// The chat page, the phone page and what goes with them, as flags
    /// ([`super::online::OnlineFeatures::deploy_arguments`]). Empty for graphrt tools that do
    /// not know them ([`knows_online_features`]): an unknown flag would stop the deploy.
    pub feature_arguments: Vec<String>,
    pub agent_file: PathBuf,
}

/// The `graphrt deploy` sub-commands that manage an existing deployment.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize)]
#[serde(tag = "action", rename_all = "snake_case")]
pub enum ManageAction {
    Status,
    ListVersions,
    Rollback { version: String },
    Pause,
    Resume,
    Remove,
}

/// The `--target` value.
pub fn target_name(provider: DeployProvider) -> &'static str {
    match provider {
        DeployProvider::Fly => "fly",
        DeployProvider::GoogleCloud => "cloud-run",
        DeployProvider::Aws => "ecs",
        DeployProvider::Azure => "aca",
        DeployProvider::Kubernetes => "k8s",
    }
}

/// `deploy --target … --json <file>`: everything but secret values.
pub fn deploy_arguments(request: &DeployRequest) -> Vec<String> {
    let mut arguments: Vec<String> = vec![
        "deploy".into(),
        "--target".into(),
        target_name(request.target).into(),
        "--direct".into(),
        "--deployment".into(),
        request.deployment.clone(),
        "--version".into(),
        request.version_label.clone(),
    ];
    if let Some(project) = &request.project {
        arguments.extend(["--project".into(), project.clone()]);
    }
    if let Some(region) = &request.region {
        arguments.extend(["--region".into(), region.clone()]);
    }
    arguments.extend(["--mode".into(), request.mode.cli_value().into()]);
    for name in &request.secret_names {
        arguments.extend(["--secret".into(), name.clone()]);
    }
    if let Some(org) = &request.org {
        arguments.extend(["--org".into(), org.clone()]);
    }
    if let Some(image) = &request.image {
        arguments.extend(["--image".into(), image.clone()]);
    }
    if request.rotate_api_key {
        arguments.push("--rotate-api-key".into());
    }
    arguments.extend(request.feature_arguments.iter().cloned());
    arguments.push("--json".into());
    arguments.push(request.agent_file.to_string_lossy().into_owned());
    arguments
}

/// Where a deployment lives, for the management commands: Google Cloud needs its project and
/// region; Fly.io refuses both (the app name is enough).
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct ManagePlace {
    pub project: Option<String>,
    pub region: Option<String>,
}

/// `deploy <action> [version] --target … --direct --deployment <name> [--project --region] --json`.
pub fn manage_arguments(
    action: &ManageAction,
    provider: DeployProvider,
    deployment: &str,
    place: &ManagePlace,
) -> Vec<String> {
    let mut arguments: Vec<String> = vec!["deploy".into()];
    match action {
        ManageAction::Status => arguments.push("status".into()),
        ManageAction::ListVersions => arguments.push("list-versions".into()),
        ManageAction::Rollback { version } => arguments.extend(["rollback".into(), version.clone()]),
        ManageAction::Pause => arguments.push("pause".into()),
        ManageAction::Resume => arguments.push("resume".into()),
        ManageAction::Remove => arguments.push("remove".into()),
    }
    arguments.extend([
        "--target".into(),
        target_name(provider).into(),
        "--direct".into(),
        "--deployment".into(),
        deployment.to_owned(),
    ]);
    if provider != DeployProvider::Fly {
        if let Some(project) = &place.project {
            arguments.extend(["--project".into(), project.clone()]);
        }
        if let Some(region) = &place.region {
            arguments.extend(["--region".into(), region.clone()]);
        }
    }
    arguments.push("--json".into());
    arguments
}

/// Whether the `deploy --help` text of a graphrt CLI lists the flags for the chat page and the
/// phone page. Asking the tools themselves keeps the app right whatever number the graphrt
/// release that brings them gets.
pub fn help_lists_online_features(deploy_help: &str) -> bool {
    ["--chat-access", "--monitor", "--push", "--expire-approvals", "--drop-store"]
        .iter()
        .all(|flag| deploy_help.contains(flag))
}

/// Whether `graphrt deploy --help` lists `--channel` (Graphrt/graphrt#145): the online copy
/// can answer customers on WhatsApp Business.
pub fn help_lists_channels(deploy_help: &str) -> bool {
    deploy_help.contains("--channel")
}

/// Whether `graphrt deploy --help` says agents of any size go online (Graphrt/graphrt: an
/// agent above 1 MiB is uploaded onto the store volume), so knowledge of any size goes with it.
pub fn help_lists_large_agents(deploy_help: &str) -> bool {
    deploy_help.contains("uploaded onto the store volume")
}

/// Whether `graphrt deploy --help` lists the Google Cloud project of a direct deploy
/// (Graphrt/graphrt#174): the tools can put agents on Cloud Run directly.
pub fn help_lists_cloud_run(deploy_help: &str) -> bool {
    deploy_help.contains("Google Cloud project id")
}

/// What the installed graphrt tools can put online, from one `graphrt deploy --help`.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct CliAbilities {
    /// The chat page, the phone page and the rest of [`help_lists_online_features`].
    pub online_features: bool,
    /// Messaging channels ([`help_lists_channels`]).
    pub channels: bool,
    /// Agents (with their knowledge) larger than 1 MiB ([`help_lists_large_agents`]).
    pub large_agents: bool,
    /// Google Cloud Run, directly ([`help_lists_cloud_run`]).
    pub cloud_run: bool,
}

/// Runs `graphrt deploy --help` and reads what the tools can do. Nothing when the tools do
/// not start.
pub fn abilities(executable: &Path) -> CliAbilities {
    match deploy_help(executable) {
        Some(help) => CliAbilities {
            online_features: help_lists_online_features(&help),
            channels: help_lists_channels(&help),
            large_agents: help_lists_large_agents(&help),
            cloud_run: help_lists_cloud_run(&help),
        },
        None => CliAbilities::default(),
    }
}

/// Runs `graphrt deploy --help` and checks it with [`help_lists_online_features`]. `false`
/// when the tools do not start.
pub fn knows_online_features(executable: &Path) -> bool {
    abilities(executable).online_features
}

fn deploy_help(executable: &Path) -> Option<String> {
    let mut command = std::process::Command::new(executable);
    command.args(["deploy", "--help"]).env_clear().stdin(Stdio::null()).stderr(Stdio::null());
    for name in PASSTHROUGH_ENV {
        if let Ok(value) = std::env::var(name) {
            command.env(name, value);
        }
    }
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt as _;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        command.creation_flags(CREATE_NO_WINDOW);
    }
    match command.output() {
        Ok(output) if output.status.success() => Some(String::from_utf8_lossy(&output.stdout).into_owned()),
        Ok(_) | Err(_) => None,
    }
}

/// The four human steps.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum DeployStep {
    Preparing,
    Secrets,
    Starting,
    Checking,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum StepStatus {
    Running,
    Done,
    Failed,
}

/// One stdout line of `graphrt deploy --json`.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum CliEvent {
    Step {
        step: DeployStep,
        status: StepStatus,
        #[serde(default)]
        message: Option<String>,
    },
    /// The final line of `deploy` (and `rollback`, which has the same fields but no key).
    Result {
        url: String,
        version: String,
        #[serde(default)]
        app: Option<String>,
        /// The name to call: `POST {url}/v1/workflows/{workflow}/runs`.
        #[serde(default)]
        workflow: Option<String>,
        /// Only on the deploy that created the key or with `--rotate-api-key`; `null` otherwise.
        #[serde(default)]
        api_key: Option<String>,
    },
    /// A deploy stored a new API key, then failed: printed once, right before the `error` line.
    ApiKey { api_key: String },
    Error {
        #[serde(default)]
        code: Option<String>,
        message: String,
    },
}

/// A parsed line: a known event, another JSON object (manage commands), or plain text.
#[derive(Debug, Clone, PartialEq)]
pub enum CliLine {
    Event(CliEvent),
    Json(serde_json::Value),
    Text(String),
}

pub fn parse_line(line: &str) -> CliLine {
    let trimmed = line.trim();
    if !trimmed.starts_with('{') {
        return CliLine::Text(trimmed.to_owned());
    }
    if let Ok(event) = serde_json::from_str::<CliEvent>(trimmed) {
        return CliLine::Event(event);
    }
    match serde_json::from_str::<serde_json::Value>(trimmed) {
        Ok(value) => CliLine::Json(value),
        Err(_) => CliLine::Text(trimmed.to_owned()),
    }
}

/// The process environment: [`PASSTHROUGH_ENV`] from `inherited`, then `extra` (credentials, secrets).
pub fn compose_environment(
    inherited: impl Fn(&str) -> Option<String>,
    extra: &[(String, String)],
) -> Vec<(String, String)> {
    let mut environment: Vec<(String, String)> =
        PASSTHROUGH_ENV.iter().filter_map(|name| inherited(name).map(|value| ((*name).to_owned(), value))).collect();
    for (name, value) in extra {
        environment.retain(|(known, _)| known != name);
        environment.push((name.clone(), value.clone()));
    }
    environment
}

/// What a finished CLI call printed.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct CliOutput {
    pub events: Vec<CliEvent>,
    /// Other JSON objects (status, versions).
    pub json: Vec<serde_json::Value>,
    /// Plain stdout lines and stderr, for the technical log.
    pub log: Vec<String>,
    pub exit_success: bool,
}

impl CliOutput {
    pub fn result(&self) -> Option<&CliEvent> {
        self.events.iter().rev().find(|event| matches!(event, CliEvent::Result { .. }))
    }

    pub fn error(&self) -> Option<(&Option<String>, &String)> {
        self.events.iter().rev().find_map(|event| match event {
            CliEvent::Error { code, message } => Some((code, message)),
            _ => None,
        })
    }

    /// The key of an `api_key` line: a failed deploy already made it live on Fly.io.
    pub fn api_key_of_failure(&self) -> Option<&str> {
        self.events.iter().rev().find_map(|event| match event {
            CliEvent::ApiKey { api_key } => Some(api_key.as_str()),
            _ => None,
        })
    }

    /// The error line as one plain sentence ([`plain_error_message`]).
    pub fn plain_error(&self) -> Option<String> {
        self.error().map(|(code, message)| plain_error_message(code.as_deref(), message))
    }

    /// `Ok` when the call exited cleanly without an error event; otherwise its plain message.
    pub fn ensure_success(&self, what: &str) -> AppResult<()> {
        if let Some(message) = self.plain_error() {
            return Err(AppError::Internal(message));
        }
        if !self.exit_success {
            let detail = self.log.last().cloned().unwrap_or_else(|| "no details".into());
            return Err(AppError::Internal(format!("{what} did not finish: {detail}")));
        }
        Ok(())
    }
}

/// The CLI's message, with what to do for refusals people can fix themselves (schema `error.code`).
pub fn plain_error_message(code: Option<&str>, message: &str) -> String {
    match code {
        Some("unauthorized") => format!(
            "Fly.io didn't accept the access key for this. Putting an agent online the first time and taking it offline \
             need an organization token (fly tokens create org <your-org> --expiry 720h): connect Fly.io again with one. \
             ({message})"
        ),
        Some("missing_token") => "Connect your Fly.io account first (Online accounts)".to_owned(),
        Some("app_name_taken") => {
            format!("Another Fly.io account already uses this agent's web address. Rename the agent and try again. ({message})")
        }
        _ => message.to_owned(),
    }
}

/// Called for each line as it arrives (progress to the UI).
pub type LineCallback = Arc<dyn Fn(&CliLine) + Send + Sync>;

/// Starts `executable` with `arguments` and exactly `environment`, reads stdout line by line
/// (each passed to `on_line`) until it exits, `timeout` passes or `cancel` fires (the process
/// is killed then).
///
/// # Errors
/// `Internal` when it cannot start, times out or is cancelled.
pub async fn run_cli(
    executable: &Path,
    arguments: &[String],
    environment: &[(String, String)],
    timeout: Duration,
    cancel: Arc<tokio::sync::Notify>,
    on_line: LineCallback,
) -> AppResult<CliOutput> {
    let mut command = tokio::process::Command::new(executable);
    command
        .args(arguments)
        .env_clear()
        .envs(environment.iter().map(|(name, value)| (name.as_str(), value.as_str())))
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);
    #[cfg(windows)]
    {
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        command.creation_flags(CREATE_NO_WINDOW);
    }
    let mut child =
        command.spawn().map_err(|error| AppError::Internal(format!("could not start the graphrt tools: {error}")))?;
    let stdout = child.stdout.take().ok_or_else(|| AppError::Internal("no output from the graphrt tools".into()))?;
    let mut stderr =
        child.stderr.take().ok_or_else(|| AppError::Internal("no output from the graphrt tools".into()))?;
    let stderr_task = tokio::spawn(async move {
        let mut buffer = Vec::new();
        let _ = (&mut stderr).take(MAX_STDERR_BYTES as u64).read_to_end(&mut buffer).await;
        String::from_utf8_lossy(&buffer).into_owned()
    });

    let mut output = CliOutput::default();
    let reading = async {
        let mut lines = BufReader::new(stdout).lines();
        while let Some(line) = lines.next_line().await.map_err(|error| AppError::Internal(error.to_string()))? {
            let line: String = line.chars().take(MAX_LINE_BYTES).collect();
            let parsed = parse_line(&line);
            on_line(&parsed);
            match parsed {
                CliLine::Event(event) => output.events.push(event),
                CliLine::Json(value) => output.json.push(value),
                CliLine::Text(text) if !text.is_empty() => output.log.push(text),
                CliLine::Text(_) => {}
            }
        }
        child.wait().await.map_err(|error| AppError::Internal(error.to_string()))
    };
    let status = tokio::select! {
        status = reading => status?,
        () = tokio::time::sleep(timeout) => {
            return Err(AppError::Internal("the graphrt tools took too long and were stopped".into()));
        }
        () = cancel.notified() => {
            return Err(AppError::Conflict("stopped".into()));
        }
    };
    let stderr_text = stderr_task.await.unwrap_or_default();
    output.log.extend(stderr_text.lines().filter(|line| !line.trim().is_empty()).map(str::to_owned));
    output.exit_success = status.success();
    Ok(output)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample_request() -> DeployRequest {
        DeployRequest {
            target: DeployProvider::Fly,
            deployment: "menu-chatbot-1a2b".into(),
            version_label: "v2".into(),
            region: Some("sin".into()),
            project: None,
            mode: DeployMode::ScaleToZero,
            org: None,
            secret_names: vec!["OPENAI_API_KEY".into(), "WHATSAPP_CLOUD_ACCESS_TOKEN".into()],
            image: None,
            rotate_api_key: false,
            feature_arguments: Vec::new(),
            agent_file: PathBuf::from("/tmp/agent.yaml"),
        }
    }

    #[test]
    fn feature_flags_go_before_the_agent_file_and_only_when_given() {
        let request = DeployRequest {
            feature_arguments: vec!["--chat".into(), "--chat-access".into(), "guests".into(), "--monitor".into()],
            ..sample_request()
        };
        let arguments = deploy_arguments(&request);
        let chat_at = arguments.iter().position(|argument| argument == "--chat").unwrap();
        assert_eq!(arguments[chat_at..chat_at + 4], ["--chat", "--chat-access", "guests", "--monitor"]);
        assert_eq!(arguments[arguments.len() - 2..], ["--json", "/tmp/agent.yaml"]);
        assert!(!deploy_arguments(&sample_request()).iter().any(|argument| argument == "--chat"));
    }

    #[test]
    fn the_help_text_says_whether_the_tools_know_the_chat_and_phone_flags() {
        let old = "Usage: graphrt deploy [OPTIONS]\n  --rotate-api-key\n  --json\n";
        assert!(!help_lists_online_features(old));
        let new = "  --chat\n  --chat-access <WHO>\n  --cors-origin <ORIGIN>\n  --monitor\n  --push <CONTACT>\n  \
                   --expire-approvals\n  --drop-store\n";
        assert!(help_lists_online_features(new));
        assert!(!help_lists_online_features("--chat-access --monitor"), "every flag the app sends must be there");
    }

    #[cfg(unix)]
    #[test]
    fn asks_the_tools_themselves_and_takes_a_failure_as_no() {
        let temp = tempfile::tempdir().unwrap();
        let knows = temp.path().join("new");
        crate::test_support::write_executable_script(
            &knows,
            r#"[ "$1 $2" = "deploy --help" ] && echo "--chat-access --monitor --push --expire-approvals --drop-store""#,
        );
        assert!(knows_online_features(&knows));
        let old = temp.path().join("old");
        crate::test_support::write_executable_script(&old, "echo '--rotate-api-key --json'");
        assert!(!knows_online_features(&old));
        let broken = temp.path().join("broken");
        crate::test_support::write_executable_script(&broken, "exit 3");
        assert!(!knows_online_features(&broken));
        assert!(!knows_online_features(&temp.path().join("missing")));
    }

    #[test]
    fn large_agents_are_known_from_the_deploy_help() {
        assert!(help_lists_large_agents(
            "a bundle (`.grt`) of any size: above 1 MiB it is uploaded onto the store volume"
        ));
        assert!(!help_lists_large_agents("Workflow file the agents serve; with `--direct` also a bundle (`.grt`)."));
    }

    #[test]
    fn deploy_arguments_follow_the_contract_and_hold_no_values() {
        assert_eq!(
            deploy_arguments(&sample_request()),
            [
                "deploy",
                "--target",
                "fly",
                "--direct",
                "--deployment",
                "menu-chatbot-1a2b",
                "--version",
                "v2",
                "--region",
                "sin",
                "--mode",
                "scale-to-zero",
                "--secret",
                "OPENAI_API_KEY",
                "--secret",
                "WHATSAPP_CLOUD_ACCESS_TOKEN",
                "--json",
                "/tmp/agent.yaml"
            ]
        );
    }

    #[test]
    fn image_and_key_rotation_are_passed_only_when_asked_for() {
        let request = DeployRequest {
            image: Some("ghcr.io/acme/graphrt:0.6.0-custom".into()),
            rotate_api_key: true,
            ..sample_request()
        };
        let arguments = deploy_arguments(&request);
        let image_at = arguments.iter().position(|argument| argument == "--image").unwrap();
        assert_eq!(arguments[image_at + 1], "ghcr.io/acme/graphrt:0.6.0-custom");
        assert!(arguments.contains(&"--rotate-api-key".to_owned()));
        assert_eq!(arguments.last().unwrap(), "/tmp/agent.yaml", "the agent file stays last");
        let plain = deploy_arguments(&sample_request());
        assert!(!plain
            .iter()
            .any(|argument| argument == "--image" || argument == "--rotate-api-key" || argument == "--app"));
    }

    #[test]
    fn refusals_people_can_fix_get_plain_guidance() {
        let unauthorized = plain_error_message(Some("unauthorized"), "Fly refused the token (403)");
        assert!(unauthorized.contains("fly tokens create org"), "{unauthorized}");
        assert!(unauthorized.contains("403"));
        assert!(plain_error_message(Some("app_name_taken"), "taken").contains("Rename the agent"));
        assert_eq!(plain_error_message(Some("capacity"), "No room in sin"), "No room in sin");
        assert_eq!(plain_error_message(None, "boom"), "boom");
    }

    #[test]
    fn manage_arguments_follow_the_contract() {
        let fly = ManagePlace { project: None, region: Some("sin".into()) };
        assert_eq!(
            manage_arguments(&ManageAction::Rollback { version: "v1".into() }, DeployProvider::Fly, "d", &fly),
            ["deploy", "rollback", "v1", "--target", "fly", "--direct", "--deployment", "d", "--json"],
            "Fly.io refuses --region on management commands"
        );
        assert_eq!(manage_arguments(&ManageAction::Pause, DeployProvider::Fly, "d", &fly)[1], "pause");
        assert_eq!(manage_arguments(&ManageAction::ListVersions, DeployProvider::Fly, "d", &fly)[1], "list-versions");
        let cloud_run = ManagePlace { project: Some("graphrt".into()), region: Some("asia-southeast2".into()) };
        assert_eq!(
            manage_arguments(&ManageAction::Status, DeployProvider::GoogleCloud, "d", &cloud_run),
            [
                "deploy",
                "status",
                "--target",
                "cloud-run",
                "--direct",
                "--deployment",
                "d",
                "--project",
                "graphrt",
                "--region",
                "asia-southeast2",
                "--json"
            ]
        );
    }

    #[test]
    fn cloud_run_deploys_name_the_project_and_region() {
        let request = DeployRequest {
            target: DeployProvider::GoogleCloud,
            region: Some("asia-southeast2".into()),
            project: Some("graphrt".into()),
            ..sample_request()
        };
        let arguments = deploy_arguments(&request);
        assert_eq!(arguments[..4], ["deploy", "--target", "cloud-run", "--direct"]);
        let project_at = arguments.iter().position(|argument| argument == "--project").unwrap();
        assert_eq!(arguments[project_at..project_at + 4], ["--project", "graphrt", "--region", "asia-southeast2"]);
        assert!(!deploy_arguments(&sample_request()).iter().any(|argument| argument == "--project"));
    }

    #[test]
    fn cloud_run_is_known_from_the_deploy_help() {
        assert!(help_lists_cloud_run(
            "  --project <PROJECT>  Direct, Cloud Run: Google Cloud project id [default: $GOOGLE_CLOUD_PROJECT]"
        ));
        assert!(!help_lists_cloud_run("  --target <TARGET>  [possible values: local, k8s, cloud-run, fly]"));
    }

    #[test]
    fn parses_json_lines_events_and_falls_back_to_text() {
        assert_eq!(
            parse_line(r#"{"type":"step","step":"secrets","status":"running","message":"Copying"}"#),
            CliLine::Event(CliEvent::Step {
                step: DeployStep::Secrets,
                status: StepStatus::Running,
                message: Some("Copying".into())
            })
        );
        assert!(matches!(
            parse_line(r#"{"type":"result","url":"https://a.fly.dev","version":"v1","app":"a","api_key":"grt_x"}"#),
            CliLine::Event(CliEvent::Result { .. })
        ));
        assert_eq!(
            parse_line(r#"{"type":"api_key","api_key":"grk_live"}"#),
            CliLine::Event(CliEvent::ApiKey { api_key: "grk_live".into() })
        );
        assert!(matches!(parse_line(r#"{"state":"running"}"#), CliLine::Json(_)));
        assert_eq!(parse_line("building image"), CliLine::Text("building image".into()));
        assert_eq!(parse_line("{broken"), CliLine::Text("{broken".into()));
    }

    #[test]
    fn the_environment_keeps_only_passthrough_and_extra_values() {
        let inherited = |name: &str| match name {
            "PATH" => Some("/usr/bin".to_owned()),
            "AWS_SECRET_ACCESS_KEY" => Some("leak".to_owned()),
            _ => None,
        };
        let environment = compose_environment(inherited, &[(FLY_TOKEN_ENV.into(), "fly-token".into())]);
        assert_eq!(
            environment,
            [("PATH".to_owned(), "/usr/bin".to_owned()), ("FLY_API_TOKEN".into(), "fly-token".into())]
        );
    }

    /// A fake `graphrt` that records its arguments and environment and prints the contract's events.
    #[cfg(unix)]
    fn fake_cli(folder: &Path, script_body: &str) -> PathBuf {
        let path = folder.join("graphrt");
        crate::test_support::write_executable_script(&path, script_body);
        path
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn runs_the_cli_passing_secrets_only_through_the_environment() {
        let temp = tempfile::tempdir().unwrap();
        let record = temp.path().join("record.txt");
        let script = format!(
            r#"echo "ARGS: $*" > "{record}"
echo "OPENAI: $OPENAI_API_KEY" >> "{record}"
echo "FLY: $FLY_API_TOKEN" >> "{record}"
echo "HOME_SECRET: $UNRELATED_SECRET" >> "{record}"
echo '{{"type":"step","step":"preparing","status":"running","message":"Preparing"}}'
echo 'plain progress'
echo '{{"type":"step","step":"preparing","status":"done"}}'
echo '{{"type":"result","url":"https://menu.fly.dev","version":"v2","app":"menu","api_key":"grt_once"}}'
echo 'warning on stderr' 1>&2"#,
            record = record.display()
        );
        let executable = fake_cli(temp.path(), &script);
        let environment = compose_environment(
            |name| std::env::var(name).ok(),
            &[(FLY_TOKEN_ENV.into(), "fly-secret-token".into()), ("OPENAI_API_KEY".into(), "sk-secret-value".into())],
        );
        let seen = Arc::new(std::sync::Mutex::new(Vec::new()));
        let seen_by_callback = seen.clone();
        let output = run_cli(
            &executable,
            &deploy_arguments(&sample_request()),
            &environment,
            Duration::from_secs(20),
            Arc::new(tokio::sync::Notify::new()),
            Arc::new(move |line| seen_by_callback.lock().unwrap().push(line.clone())),
        )
        .await
        .unwrap();

        assert!(output.exit_success);
        assert_eq!(output.events.len(), 3);
        assert!(matches!(output.result(), Some(CliEvent::Result { api_key: Some(key), .. }) if key == "grt_once"));
        assert_eq!(output.log, ["plain progress", "warning on stderr"]);
        assert_eq!(seen.lock().unwrap().len(), 4, "every stdout line reaches the callback");

        let recorded = std::fs::read_to_string(&record).unwrap();
        let argument_line = recorded.lines().next().unwrap();
        assert!(!argument_line.contains("sk-secret-value") && !argument_line.contains("fly-secret-token"));
        assert!(argument_line.contains("--secret OPENAI_API_KEY"));
        assert!(recorded.contains("OPENAI: sk-secret-value"));
        assert!(recorded.contains("FLY: fly-secret-token"));
        assert!(recorded.contains("HOME_SECRET: \n") || recorded.ends_with("HOME_SECRET: \n"));
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn reports_error_events_and_failed_exits() {
        let temp = tempfile::tempdir().unwrap();
        let executable = fake_cli(
            temp.path(),
            r#"echo '{"type":"error","code":"auth","message":"Fly.io did not accept the access key"}'
exit 3"#,
        );
        let output = run_cli(
            &executable,
            &["deploy".into()],
            &[],
            Duration::from_secs(20),
            Arc::new(tokio::sync::Notify::new()),
            Arc::new(|_| {}),
        )
        .await
        .unwrap();
        assert!(!output.exit_success);
        assert_eq!(output.ensure_success("deploy").unwrap_err().to_string(), "Fly.io did not accept the access key");
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn cancelling_stops_the_process() {
        let temp = tempfile::tempdir().unwrap();
        let executable = fake_cli(temp.path(), "sleep 30");
        let cancel = Arc::new(tokio::sync::Notify::new());
        let cancel_soon = cancel.clone();
        tokio::spawn(async move {
            tokio::time::sleep(Duration::from_millis(200)).await;
            cancel_soon.notify_one();
        });
        let started = std::time::Instant::now();
        let error =
            run_cli(&executable, &[], &[], Duration::from_secs(20), cancel, Arc::new(|_| {})).await.unwrap_err();
        assert_eq!(error.code(), "conflict");
        assert!(started.elapsed() < Duration::from_secs(10));
    }
}
