//! The final lines of `graphrt deploy status` and `graphrt deploy list-versions` (`--direct --json`).
//!
//! The source of truth is graphrt's `docs/schemas/deploy-direct.schema.json`; the copy in
//! `contract/deploy-direct.schema.json` (graphrt `bf67b88`) is what the tests below check the
//! fixtures (`contract/fixtures`, from the examples in graphrt `docs/deploy-direct.md`) and these
//! types against. When graphrt changes the contract, copy the new schema over and run the tests.
//!
//! Every field the schema requires is required here too (a line without one is not used), and
//! unknown fields are ignored so a newer CLI that adds fields keeps working.

use serde::de::DeserializeOwned;
use serde::{Deserialize, Serialize};

use crate::storage::deployments::DeploymentStatus;

/// `status` of `graphrt deploy status`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum RemoteStatus {
    /// Serving (with scale-to-zero also while stopped: it starts on the next request).
    Online,
    Paused,
    /// A version is being started; the current one keeps serving.
    Deploying,
    /// The current Machine crashed, its check is critical, or an always-on Machine is not running.
    Failed,
    /// The app exists but nothing is current, e.g. after a failed first deploy.
    Offline,
}

impl RemoteStatus {
    /// The state the desktop shows for it.
    pub fn deployment_status(self) -> DeploymentStatus {
        match self {
            Self::Online | Self::Deploying => DeploymentStatus::Working,
            Self::Paused => DeploymentStatus::Paused,
            Self::Failed | Self::Offline => DeploymentStatus::NeedsAttention,
        }
    }

    /// One plain sentence for "needs attention"; `None` when nothing is wrong.
    pub fn problem(self) -> Option<&'static str> {
        match self {
            Self::Online | Self::Deploying | Self::Paused => None,
            Self::Failed => Some("The online copy stopped working. Update it or go back to an earlier version"),
            Self::Offline => Some("Nothing is online: the last try didn't finish. Update it to try again"),
        }
    }
}

/// `mode` of the current version.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum RemoteMode {
    AlwaysOn,
    ScaleToZero,
}

/// `machines[].role`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum MachineRole {
    Current,
    Candidate,
    Standby,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct MachineCheck {
    pub name: String,
    /// Fly's check status: `passing`, `warning`, `critical`.
    pub status: String,
}

/// One Fly Machine of the deployment (one per version).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct RemoteMachine {
    pub id: String,
    pub name: String,
    /// Fly's state: `started`, `stopped`, `suspended`, `starting`, `failed`...
    pub state: String,
    pub region: String,
    pub version: Option<String>,
    pub role: Option<MachineRole>,
    pub checks: Vec<MachineCheck>,
}

/// The final line of `graphrt deploy status --json`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct StatusResult {
    pub app: String,
    pub url: String,
    pub status: RemoteStatus,
    /// Label of the version serving; `None` when offline.
    pub current_version: Option<String>,
    pub workflow: Option<String>,
    pub mode: Option<RemoteMode>,
    /// RFC 3339 UTC; a rollback keeps that version's original time.
    pub last_deployed_at: Option<String>,
    /// Fly.io only (Cloud Run reports `traffic` instead, which the app does not read).
    #[serde(default)]
    pub machines: Vec<RemoteMachine>,
}

/// One entry of `versions` (newest deploy first). Only these can be passed to `rollback`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct RemoteVersion {
    pub label: String,
    pub deployed_at: Option<String>,
    pub current: bool,
    /// Fly.io: `current`, `candidate`, `standby`; Cloud Run has none (its `state` says it).
    #[serde(default)]
    pub role: String,
    pub mode: Option<String>,
    pub workflow: Option<String>,
    /// Fly.io: the state of the version's Machine; Cloud Run: `serving` or `standby`.
    pub state: String,
}

/// The final line of `graphrt deploy list-versions --json`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ListVersionsResult {
    pub app: String,
    pub url: String,
    pub current_version: Option<String>,
    pub versions: Vec<RemoteVersion>,
}

/// The last `{"type":"result","action":<action>}` object, when it has every required field.
fn final_result<T: DeserializeOwned>(json: &[serde_json::Value], action: &str) -> Option<T> {
    let line = json.iter().rev().find(|value| {
        value.get("type").and_then(serde_json::Value::as_str) == Some("result")
            && value.get("action").and_then(serde_json::Value::as_str) == Some(action)
    })?;
    match serde_json::from_value(line.clone()) {
        Ok(parsed) => Some(parsed),
        Err(error) => {
            log::warn!("graphrt deploy {action} printed a result this app cannot read: {error}");
            None
        }
    }
}

/// The `status` result among the JSON lines of `graphrt deploy status --json`.
pub fn status_result(json: &[serde_json::Value]) -> Option<StatusResult> {
    final_result(json, "status")
}

/// The `list-versions` result among the JSON lines of `graphrt deploy list-versions --json`
/// (Fly.io and Cloud Run, graphrt `docs/schemas/deploy-direct-cloud-run.schema.json`).
pub fn list_versions_result(json: &[serde_json::Value]) -> Option<ListVersionsResult> {
    final_result(json, "list-versions")
}

#[cfg(test)]
mod tests {
    use std::collections::BTreeSet;

    use serde_json::Value;

    use super::*;
    use crate::deploy::cli::{parse_line, CliEvent, CliLine, DeployStep, StepStatus};

    const SCHEMA: &str = include_str!("contract/deploy-direct.schema.json");
    const DEPLOY_FIRST: &str = include_str!("contract/fixtures/deploy-first.jsonl");
    const DEPLOY_REDEPLOY: &str = include_str!("contract/fixtures/deploy-redeploy.jsonl");
    const DEPLOY_FAILED_AFTER_KEY: &str = include_str!("contract/fixtures/deploy-failed-after-key.jsonl");
    const STATUS: &str = include_str!("contract/fixtures/status.json");
    const STATUS_OFFLINE: &str = include_str!("contract/fixtures/status-offline.json");
    const LIST_VERSIONS: &str = include_str!("contract/fixtures/list-versions.json");
    const MANAGE_RESULTS: &str = include_str!("contract/fixtures/manage-results.jsonl");
    /// graphrt `docs/schemas/deploy-direct-cloud-run.schema.json` at `90e0109` (Graphrt/graphrt#174).
    const CLOUD_RUN_SCHEMA: &str = include_str!("contract/deploy-direct-cloud-run.schema.json");
    const CLOUD_RUN: &str = include_str!("contract/fixtures/cloud-run.jsonl");

    fn schema() -> Value {
        serde_json::from_str(SCHEMA).unwrap()
    }

    fn definition<'a>(schema: &'a Value, name: &str) -> &'a Value {
        &schema["$defs"][name]
    }

    fn resolve<'a>(schema: &'a Value, node: &'a Value) -> &'a Value {
        match node.get("$ref").and_then(Value::as_str) {
            Some(reference) => definition(schema, reference.trim_start_matches("#/$defs/")),
            None => node,
        }
    }

    fn type_matches(expected: &str, value: &Value) -> bool {
        match expected {
            "object" => value.is_object(),
            "array" => value.is_array(),
            "string" => value.is_string(),
            "boolean" => value.is_boolean(),
            "null" => value.is_null(),
            "integer" => value.is_i64() || value.is_u64(),
            "number" => value.is_number(),
            _ => false,
        }
    }

    /// The JSON Schema keywords the contract uses: `$ref`, `oneOf`, `type`, `const`, `enum`,
    /// `required`, `properties`, `additionalProperties: false`, `items` and `pattern`.
    fn violations(schema: &Value, node: &Value, value: &Value, path: &str) -> Vec<String> {
        let node = resolve(schema, node);
        if let Some(options) = node.get("oneOf").and_then(Value::as_array) {
            let matching = options.iter().filter(|option| violations(schema, option, value, path).is_empty()).count();
            return if matching == 1 { Vec::new() } else { vec![format!("{path}: matches {matching} of oneOf")] };
        }
        let mut found = Vec::new();
        if let Some(expected) = node.get("type") {
            let allowed: Vec<&str> = match expected {
                Value::String(single) => vec![single.as_str()],
                Value::Array(many) => many.iter().filter_map(Value::as_str).collect(),
                _ => Vec::new(),
            };
            if !allowed.iter().any(|kind| type_matches(kind, value)) {
                found.push(format!("{path}: {value} is not {allowed:?}"));
            }
        }
        if let Some(constant) = node.get("const") {
            if constant != value {
                found.push(format!("{path}: {value} is not {constant}"));
            }
        }
        if let Some(choices) = node.get("enum").and_then(Value::as_array) {
            if !choices.contains(value) {
                found.push(format!("{path}: {value} is not one of {choices:?}"));
            }
        }
        if let (Some(pattern), Some(text)) = (node.get("pattern").and_then(Value::as_str), value.as_str()) {
            if !regex::Regex::new(pattern).unwrap().is_match(text) {
                found.push(format!("{path}: {text} does not match {pattern}"));
            }
        }
        if let Some(object) = value.as_object() {
            for required in node.get("required").and_then(Value::as_array).into_iter().flatten() {
                let name = required.as_str().unwrap();
                if !object.contains_key(name) {
                    found.push(format!("{path}: `{name}` is missing"));
                }
            }
            let properties = node.get("properties").and_then(Value::as_object);
            for (name, field) in object {
                match properties.and_then(|known| known.get(name)) {
                    Some(field_schema) => {
                        found.extend(violations(schema, field_schema, field, &format!("{path}.{name}")))
                    }
                    None if node.get("additionalProperties") == Some(&Value::Bool(false)) => {
                        found.push(format!("{path}: unknown field `{name}`"));
                    }
                    None => {}
                }
            }
        }
        if let (Some(items), Some(array)) = (node.get("items"), value.as_array()) {
            for (index, item) in array.iter().enumerate() {
                found.extend(violations(schema, items, item, &format!("{path}[{index}]")));
            }
        }
        found
    }

    fn assert_valid_line(line: &Value) {
        let schema = schema();
        let problems = violations(&schema, &schema, line, "line");
        assert!(problems.is_empty(), "{line} breaks the schema: {problems:?}");
    }

    fn lines(fixture: &str) -> Vec<Value> {
        fixture.lines().filter(|line| !line.trim().is_empty()).map(|line| serde_json::from_str(line).unwrap()).collect()
    }

    /// The field names of a definition, in the schema and as this app writes the type back.
    fn assert_same_fields(definition_name: &str, ours: &Value) {
        let schema = schema();
        let node = definition(&schema, definition_name);
        let theirs: BTreeSet<&str> = node["properties"].as_object().unwrap().keys().map(String::as_str).collect();
        let ours: BTreeSet<&str> = ours
            .as_object()
            .unwrap()
            .keys()
            .map(String::as_str)
            .filter(|key| *key != "type" && *key != "action")
            .collect();
        let theirs: BTreeSet<&str> = theirs.into_iter().filter(|key| *key != "type" && *key != "action").collect();
        assert_eq!(ours, theirs, "the fields of `{definition_name}`");
        let required: BTreeSet<&str> = node["required"].as_array().unwrap().iter().filter_map(Value::as_str).collect();
        assert!(
            theirs.iter().all(|field| required.contains(field)),
            "every `{definition_name}` field is always present"
        );
    }

    #[test]
    fn the_validator_refuses_lines_the_schema_refuses() {
        let schema = schema();
        for broken in [
            serde_json::json!({ "type": "error", "code": "nope", "message": "x" }),
            serde_json::json!({ "type": "error", "code": "internal", "message": "x", "api_key": "grk_leak" }),
            serde_json::json!({ "type": "result", "action": "status", "status": "online" }),
            serde_json::json!({ "type": "result", "action": "deploy", "url": "http://x.fly.dev", "version": "v1", "app": "x", "workflow": "w", "api_key": null }),
        ] {
            assert!(!violations(&schema, &schema, &broken, "line").is_empty(), "{broken}");
        }
    }

    #[test]
    fn every_fixture_line_follows_the_schema() {
        for fixture in [DEPLOY_FIRST, DEPLOY_REDEPLOY, DEPLOY_FAILED_AFTER_KEY, MANAGE_RESULTS, STATUS_OFFLINE] {
            for line in lines(fixture) {
                assert_valid_line(&line);
            }
        }
        for fixture in [STATUS, LIST_VERSIONS] {
            assert_valid_line(&serde_json::from_str(fixture).unwrap());
        }
    }

    #[test]
    fn reads_a_first_deploy_with_its_key_and_workflow() {
        let parsed: Vec<CliLine> = DEPLOY_FIRST.lines().map(parse_line).collect();
        assert_eq!(parsed.iter().filter(|line| matches!(line, CliLine::Event(CliEvent::Step { .. }))).count(), 8);
        assert_eq!(
            parsed[2],
            CliLine::Event(CliEvent::Step {
                step: DeployStep::Secrets,
                status: StepStatus::Running,
                message: Some("Writing Fly secrets".into())
            })
        );
        let CliLine::Event(CliEvent::Result { url, version, app, workflow, api_key }) = parsed.last().unwrap() else {
            panic!("the last line is the result: {parsed:?}");
        };
        assert_eq!(
            (url.as_str(), version.as_str(), app.as_deref(), workflow.as_deref()),
            ("https://support-bot.fly.dev", "v1", Some("support-bot"), Some("support"))
        );
        assert!(api_key.as_deref().is_some_and(|key| key.starts_with("grk_") && key.len() == 52));
    }

    #[test]
    fn a_redeploy_has_no_key() {
        let last = DEPLOY_REDEPLOY.lines().last().map(parse_line).unwrap();
        assert!(matches!(last, CliLine::Event(CliEvent::Result { api_key: None, ref version, .. }) if version == "v2"));
    }

    #[test]
    fn a_failure_after_the_key_was_stored_hands_it_over_before_the_error() {
        let parsed: Vec<CliLine> = DEPLOY_FAILED_AFTER_KEY.lines().map(parse_line).collect();
        let count = parsed.len();
        assert!(
            matches!(&parsed[count - 2], CliLine::Event(CliEvent::ApiKey { api_key }) if api_key.starts_with("grk_"))
        );
        assert!(
            matches!(&parsed[count - 1], CliLine::Event(CliEvent::Error { code: Some(code), .. }) if code == "health_check_failed")
        );
    }

    #[test]
    fn reads_status_with_its_machines() {
        let value: Value = serde_json::from_str(STATUS).unwrap();
        let status = status_result(std::slice::from_ref(&value)).unwrap();
        assert_eq!(status.status, RemoteStatus::Online);
        assert_eq!(status.current_version.as_deref(), Some("v2"));
        assert_eq!(status.mode, Some(RemoteMode::ScaleToZero));
        assert_eq!(status.last_deployed_at.as_deref(), Some("2026-11-24T16:00:00.123Z"));
        assert_eq!(status.machines.len(), 2);
        assert_eq!(status.machines[0].role, Some(MachineRole::Current));
        assert_eq!(status.machines[0].checks, [MachineCheck { name: "readyz".into(), status: "passing".into() }]);
        assert_eq!(status.machines[1].role, Some(MachineRole::Standby));
        assert_eq!(status.status.deployment_status(), DeploymentStatus::Working);

        let offline: Value = serde_json::from_str(STATUS_OFFLINE).unwrap();
        let offline = status_result(&[offline]).unwrap();
        assert_eq!(offline.status, RemoteStatus::Offline);
        assert_eq!((offline.current_version, offline.mode, offline.machines[0].role), (None, None, None));
        assert_eq!(offline.status.deployment_status(), DeploymentStatus::NeedsAttention);
        assert!(offline.status.problem().is_some());
    }

    #[test]
    fn every_remote_status_maps_to_a_desktop_state() {
        assert_eq!(RemoteStatus::Paused.deployment_status(), DeploymentStatus::Paused);
        assert_eq!(RemoteStatus::Deploying.deployment_status(), DeploymentStatus::Working);
        assert_eq!(RemoteStatus::Failed.deployment_status(), DeploymentStatus::NeedsAttention);
        let schema = schema();
        let statuses = definition(&schema, "status_result")["properties"]["status"]["enum"].as_array().unwrap().clone();
        for status in statuses {
            let parsed: RemoteStatus = serde_json::from_value(status.clone()).unwrap();
            assert_eq!(serde_json::to_value(parsed).unwrap(), status);
        }
    }

    #[test]
    fn reads_list_versions_newest_first() {
        let value: Value = serde_json::from_str(LIST_VERSIONS).unwrap();
        let listed = list_versions_result(&[value]).unwrap();
        assert_eq!(listed.current_version.as_deref(), Some("v2"));
        assert_eq!(listed.versions.iter().map(|version| version.label.as_str()).collect::<Vec<_>>(), ["v2", "v1"]);
        assert!(listed.versions[0].current && !listed.versions[1].current);
        assert_eq!(listed.versions[1].deployed_at.as_deref(), Some("2026-11-23T09:12:00.000Z"));
    }

    #[test]
    fn a_result_of_another_action_or_missing_fields_is_not_used() {
        let pause = lines(MANAGE_RESULTS).into_iter().find(|line| line["action"] == "pause").unwrap();
        assert_eq!(status_result(&[pause]), None);
        let partial = serde_json::json!({ "type": "result", "action": "status", "status": "online" });
        assert_eq!(status_result(&[partial]), None);
        let newer = serde_json::json!({
            "type": "result", "action": "list-versions", "app": "a", "url": "https://a.fly.dev",
            "current_version": null, "versions": [], "added_later": 1
        });
        assert!(list_versions_result(&[newer]).is_some(), "unknown fields are ignored");
    }

    #[test]
    fn cloud_run_results_and_refusals_follow_its_schema_and_are_read() {
        let schema: Value = serde_json::from_str(CLOUD_RUN_SCHEMA).unwrap();
        let fixture = lines(CLOUD_RUN);
        for line in &fixture {
            let problems = violations(&schema, &schema, line, "line");
            assert!(problems.is_empty(), "{line} breaks the Cloud Run schema: {problems:?}");
        }
        let status = status_result(&fixture).unwrap();
        assert_eq!(status.status, RemoteStatus::Online);
        assert_eq!(status.current_version.as_deref(), Some("v2"));
        assert!(status.machines.is_empty());
        let listed = list_versions_result(&fixture).unwrap();
        assert_eq!(listed.versions.iter().map(|version| version.label.as_str()).collect::<Vec<_>>(), ["v2", "v1"]);
        assert_eq!(listed.versions[1].state, "standby");
        // Every code the app words itself is one the tools can print.
        let codes = definition(&schema, "error")["properties"]["code"]["enum"].as_array().unwrap().clone();
        for code in [
            "api_disabled",
            "billing_disabled",
            "permission_denied",
            "org_policy",
            "unauthorized",
            "missing_credentials",
            "name_taken",
            "rate_limited",
            "gcp_unavailable",
            "health_check_failed",
            "start_timeout",
        ] {
            assert!(codes.iter().any(|known| known == code), "{code} is not a Cloud Run error code");
        }
        for line in fixture.iter().filter(|line| line["type"] == "error") {
            let event = match parse_line(&line.to_string()) {
                CliLine::Event(CliEvent::Error { code, message }) => (code, message),
                other => panic!("not an error event: {other:?}"),
            };
            let place =
                crate::deploy::google_cloud::CloudPlace { project: "graphrt".into(), region: "asia-southeast2".into() };
            let problem = crate::deploy::google_cloud::problem_for(event.0.as_deref(), &event.1, Some(&place));
            assert!(problem.fix.is_some(), "{} has a fix", problem.kind);
        }
    }

    #[test]
    fn the_types_have_exactly_the_fields_of_the_schema() {
        let status = status_result(&[serde_json::from_str(STATUS).unwrap()]).unwrap();
        assert_same_fields("status_result", &serde_json::to_value(&status).unwrap());
        assert_same_fields("machine", &serde_json::to_value(&status.machines[0]).unwrap());
        let listed = list_versions_result(&[serde_json::from_str(LIST_VERSIONS).unwrap()]).unwrap();
        assert_same_fields("list_versions_result", &serde_json::to_value(&listed).unwrap());
        let schema = schema();
        let version_schema = &definition(&schema, "list_versions_result")["properties"]["versions"]["items"];
        let theirs: BTreeSet<&str> =
            version_schema["properties"].as_object().unwrap().keys().map(String::as_str).collect();
        let version_value = serde_json::to_value(&listed.versions[0]).unwrap();
        let ours: BTreeSet<&str> = version_value.as_object().unwrap().keys().map(String::as_str).collect();
        assert_eq!(ours, theirs, "the fields of `versions[]`");
    }
}
