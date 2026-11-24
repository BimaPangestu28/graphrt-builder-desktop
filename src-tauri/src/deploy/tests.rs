//! `DeployService` end to end with a fake `graphrt` binary (Unix shell script), the in-memory
//! keychain and a fake HTTP client.

use std::sync::{Arc, Mutex};

use super::http::tests::FakeHttp;
use super::*;
use crate::credentials::ModelProvider;
use crate::storage::models::{AgentKind, NewAgent};

#[derive(Debug, Default)]
struct RecordedEvents(Mutex<Vec<DeployEvent>>);

impl DeployEventSink for RecordedEvents {
    fn send(&self, event: DeployEvent) {
        self.0.lock().unwrap().push(event);
    }
}

const FLOW: &str = r#"
name: menu
graph:
  nodes:
    - id: start
      type: start
    - id: answer
      type: llm
      title: Answer
      model: { provider: openai, name: gpt-4o-mini }
      prompt_template:
        - { role: user, text: hello }
    - id: end
      type: end
  edges:
    - { source: start, target: answer }
    - { source: answer, target: end }
"#;

struct Harness {
    service: DeployService,
    db: Arc<Database>,
    credentials: Arc<CredentialStore>,
    http: Arc<FakeHttp>,
    events: Arc<RecordedEvents>,
    agent: Agent,
    _temp: tempfile::TempDir,
}

fn harness(flow_yaml: &str) -> Harness {
    let temp = tempfile::tempdir().unwrap();
    let db = Arc::new(Database::open_in_memory().unwrap());
    let credentials = Arc::new(CredentialStore::in_memory());
    let http = Arc::new(FakeHttp::default());
    let events = Arc::new(RecordedEvents::default());
    let agent = db
        .create_agent(NewAgent {
            name: "Menu questions chatbot".into(),
            kind: AgentKind::Chatbot,
            description: "Answers menu questions".into(),
            flow_yaml: flow_yaml.into(),
        })
        .unwrap();
    let service = DeployService::new(DeployServiceConfig {
        app_data_dir: temp.path().to_path_buf(),
        db: db.clone(),
        credentials: credentials.clone(),
        downloader: None,
        http: http.clone(),
        events: events.clone(),
    });
    Harness { service, db, credentials, http, events, agent, _temp: temp }
}

fn ready_report() -> CompatibilityReport {
    CompatibilityReport { ready: true, items: Vec::new() }
}

fn fly_options() -> DeployOptions {
    DeployOptions { provider: DeployProvider::Fly, mode: DeployMode::ScaleToZero, area: ServerArea::Asia, image: None }
}

#[cfg(unix)]
fn fake_cli(folder: &std::path::Path, body: &str) -> PathBuf {
    use std::os::unix::fs::PermissionsExt;
    let path = folder.join("fake-graphrt");
    std::fs::write(&path, format!("#!/bin/sh\n{body}\n")).unwrap();
    std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o755)).unwrap();
    path
}

#[test]
fn deployment_names_and_versions() {
    let harness = harness(FLOW);
    let name = deployment_name_for(&harness.agent);
    assert!(name.starts_with("menu-questions-chatbot-"), "{name}");
    assert!(name.bytes().all(|byte| byte.is_ascii_lowercase() || byte.is_ascii_digit() || byte == b'-'));
    assert_eq!(next_version_label(None), "v1");
    assert_eq!(next_version_label(Some("v9")), "v10");
    assert_eq!(ServerArea::from_fly_region(ServerArea::Europe.fly_region()), Some(ServerArea::Europe));
}

#[test]
fn image_references_are_checked() {
    assert_eq!(checked_image_reference(None).unwrap(), None);
    assert_eq!(checked_image_reference(Some("  ")).unwrap(), None, "empty means graphrt's own image");
    assert_eq!(
        checked_image_reference(Some(" ghcr.io/acme/graphrt:0.6.0 ")).unwrap().as_deref(),
        Some("ghcr.io/acme/graphrt:0.6.0")
    );
    assert!(checked_image_reference(Some("registry.fly.io/app@sha256:abc123")).is_ok());
    for refused in ["--rotate-api-key", "acme/graphrt latest", "img;rm -rf", &"a".repeat(300)] {
        assert!(checked_image_reference(Some(refused)).is_err(), "{refused}");
    }
}

#[test]
fn the_cli_is_not_available_without_a_pinned_release() {
    let harness = harness(FLOW);
    if cli_release::GRAPHRT_CLI_VERSION.is_none() {
        assert_eq!(harness.service.cli_info().status, CliStatus::NotAvailable);
        let runtime = tokio::runtime::Builder::new_current_thread().enable_all().build().unwrap();
        let error = runtime.block_on(harness.service.install_cli()).unwrap_err();
        assert!(error.to_string().contains("not available yet"), "{error}");
        assert!(error.to_string().contains("server image"), "says what is missing: {error}");
    }
}

#[tokio::test]
async fn accounts_are_checked_stored_in_the_keychain_and_forgotten() {
    let harness = harness(FLOW);
    harness.http.answer(http::FLY_TOKEN_CHECK_URL, 200, "[]");
    let account = harness
        .service
        .connect_account(&DeployAccountInput::Fly { access_token: "FlyV1 test_token_0123456789abcdefghij".into() })
        .await
        .unwrap();
    assert!(account.connected && account.can_deploy);
    let stored = harness.credentials.read_deploy_secret("account:fly").unwrap().unwrap();
    assert!(stored.contains("test_token_0123456789abcdefghij"));
    let listed = harness.service.list_accounts().unwrap();
    assert_eq!(listed.len(), 5);
    assert!(listed.iter().all(|account| account.summary.as_deref() != Some(stored.as_str())), "never the key itself");

    harness.http.answer(http::FLY_TOKEN_CHECK_URL, 401, "");
    let refused = harness
        .service
        .connect_account(&DeployAccountInput::Fly { access_token: "FlyV1 test_token_wrongwrongwrong".into() })
        .await;
    assert!(refused.unwrap_err().to_string().contains("didn't accept"));

    harness.service.disconnect_account(DeployProvider::Fly).unwrap();
    assert_eq!(harness.credentials.read_deploy_secret("account:fly").unwrap(), None);
    assert!(!harness.service.list_accounts().unwrap()[0].connected);
}

#[test]
fn compatibility_and_the_model_fix_make_a_new_version() {
    let flow = FLOW.replace("provider: openai, name: gpt-4o-mini", "provider: ollama, name: llama3");
    let harness = harness(&flow);
    harness.credentials.set_api_key(ModelProvider::Openai, "sk-test").unwrap();
    let report = harness.service.check_compatibility(&harness.agent, &[], false).unwrap();
    assert!(!report.ready);
    let fix = report.items[0].fix.clone().unwrap();
    let agent = harness.service.apply_model_fix(&harness.agent.id, &fix).unwrap();
    assert_eq!(agent.current_version, harness.agent.current_version + 1);
    assert!(agent.flow_yaml.contains("openai") && agent.flow_yaml.contains("gpt-4o-mini"));
    let after = harness.service.check_compatibility(&agent, &[], false).unwrap();
    assert!(after.ready, "{:?}", after.items);
    assert!(harness.service.apply_model_fix(&agent.id, &CompatibilityFix::SwitchWhatsAppToCloud).is_err());
}

#[tokio::test]
async fn deploying_needs_fly_the_tools_and_saved_keys() {
    let harness = harness(FLOW);
    let not_fly = DeployOptions { provider: DeployProvider::Aws, ..fly_options() };
    let error = harness.service.deploy(&harness.agent.id, not_fly, &[], &ready_report()).await.unwrap_err();
    assert!(error.to_string().contains("coming soon"), "{error}");
    let blocked = CompatibilityReport { ready: false, items: Vec::new() };
    assert!(harness.service.deploy(&harness.agent.id, fly_options(), &[], &blocked).await.is_err());
}

#[cfg(unix)]
#[tokio::test]
async fn deploys_with_secrets_in_the_environment_then_updates_and_takes_offline() {
    let mut harness = harness(FLOW);
    let folder = tempfile::tempdir().unwrap();
    let record = folder.path().join("calls.txt");
    let script = format!(
        r#"echo "ARGS $*" >> "{record}"
echo "ENV OPENAI=$OPENAI_API_KEY FLY=$FLY_API_TOKEN" >> "{record}"
case "$2" in
  pause) echo '{{"type":"result","action":"pause","app":"menu","url":"https://menu.fly.dev","status":"paused","changed":true}}' ;;
  resume) echo '{{"type":"result","action":"resume","app":"menu","url":"https://menu.fly.dev","status":"online","version":"v2","changed":true}}' ;;
  remove) echo '{{"type":"result","action":"remove","app":"menu","removed":true}}' ;;
  rollback) echo '{{"type":"result","action":"rollback","app":"menu","url":"https://menu.fly.dev","version":"v1","workflow":"agent"}}' ;;
  list-versions) echo '{{"type":"result","action":"list-versions","app":"menu","url":"https://menu.fly.dev","current_version":"v2","versions":[{{"label":"v2","deployed_at":"2026-11-24T16:00:00.123Z","current":true,"role":"current","mode":"scale-to-zero","workflow":"agent","state":"stopped"}},{{"label":"v1","deployed_at":"2026-11-23T09:12:00.000Z","current":false,"role":"standby","mode":"scale-to-zero","workflow":"agent","state":"stopped"}}]}}' ;;
  *)
    for step in preparing secrets starting checking; do
      echo "{{\"type\":\"step\",\"step\":\"$step\",\"status\":\"running\",\"message\":\"$step\"}}"
      echo "{{\"type\":\"step\",\"step\":\"$step\",\"status\":\"done\",\"message\":\"$step\"}}"
    done
    version=$(echo "$*" | sed 's/.*--version \([^ ]*\).*/\1/')
    # The key only on the first deploy, as graphrt does (null on later ones).
    if [ -f "{marker}" ]; then key=null; else key='"grk_shown_once"'; touch "{marker}"; fi
    echo "{{\"type\":\"result\",\"action\":\"deploy\",\"url\":\"https://menu.fly.dev\",\"version\":\"$version\",\"app\":\"menu\",\"workflow\":\"agent\",\"api_key\":$key}}"
    ;;
esac"#,
        marker = folder.path().join("key-made").display(),
        record = record.display()
    );
    harness.service = harness.service.with_cli_executable(fake_cli(folder.path(), &script));
    harness.credentials.set_api_key(ModelProvider::Openai, "sk-openai-secret").unwrap();
    harness.credentials.set_deploy_secret("account:fly", r#"{"token":"fly-secret"}"#).unwrap();

    let outcome = harness.service.deploy(&harness.agent.id, fly_options(), &[], &ready_report()).await.unwrap();
    assert_eq!(outcome.api_key.as_deref(), Some("grk_shown_once"));
    assert_eq!(outcome.workflow.as_deref(), Some("agent"));
    assert_eq!(outcome.view.deployment.status, DeploymentStatus::Working);
    assert_eq!(outcome.view.deployment.deployed_version_label.as_deref(), Some("v1"));
    assert_eq!(outcome.view.deployment.region.as_deref(), Some("sin"));
    assert!(!outcome.view.has_changes);
    assert!(outcome.view.has_api_key);
    assert_eq!(
        harness.credentials.read_deploy_secret(&format!("key:{}", harness.agent.id)).unwrap().as_deref(),
        Some("grk_shown_once")
    );
    let steps =
        harness.events.0.lock().unwrap().iter().filter(|event| matches!(event, DeployEvent::Step { .. })).count();
    assert_eq!(steps, 8);

    let calls = std::fs::read_to_string(&record).unwrap();
    let argument_line = calls.lines().find(|line| line.starts_with("ARGS deploy --target")).unwrap();
    assert!(argument_line.contains("--secret OPENAI_API_KEY") && argument_line.contains("--region sin"));
    assert!(!calls
        .lines()
        .filter(|line| line.starts_with("ARGS"))
        .any(|line| line.contains("sk-openai-secret") || line.contains("fly-secret")));
    assert!(calls.contains("ENV OPENAI=sk-openai-secret FLY=fly-secret"));

    // A change makes the online copy outdated; updating deploys v2 from the new version.
    harness.db.update_agent_flow(&harness.agent.id, &FLOW.replace("hello", "hi there"), "Friendlier").unwrap();
    assert!(harness.service.view(&harness.agent.id).unwrap().unwrap().has_changes);
    let updated = harness.service.deploy(&harness.agent.id, fly_options(), &[], &ready_report()).await.unwrap();
    assert_eq!(updated.view.deployment.deployed_version_label.as_deref(), Some("v2"));
    assert!(!updated.view.has_changes);
    assert_eq!(updated.api_key, None, "a redeploy reports no key");
    assert!(updated.view.has_api_key);
    assert_eq!(
        harness.credentials.read_deploy_secret(&format!("key:{}", harness.agent.id)).unwrap().as_deref(),
        Some("grk_shown_once"),
        "the saved key is kept when a redeploy reports none"
    );

    let history = harness.service.list_versions(&harness.agent.id).await.unwrap();
    assert_eq!(history.iter().map(|entry| entry.label.as_str()).collect::<Vec<_>>(), ["v2", "v1"]);
    assert!(history[0].is_current);
    assert_eq!(history[0].change_summary, "Friendlier");

    let paused = harness.service.manage(&harness.agent.id, ManageAction::Pause).await.unwrap().unwrap();
    assert_eq!(paused.deployment.status, DeploymentStatus::Paused);
    let rolled_back = harness
        .service
        .manage(&harness.agent.id, ManageAction::Rollback { version: "v1".into() })
        .await
        .unwrap()
        .unwrap();
    assert_eq!(rolled_back.deployment.deployed_version_label.as_deref(), Some("v1"));
    assert!(rolled_back.has_changes, "v1 was made from the older desktop version");

    assert_eq!(harness.service.manage(&harness.agent.id, ManageAction::Remove).await.unwrap(), None);
    assert_eq!(harness.db.get_deployment(&harness.agent.id).unwrap(), None);
    assert_eq!(harness.credentials.read_deploy_secret(&format!("key:{}", harness.agent.id)).unwrap(), None);
}

#[cfg(unix)]
#[tokio::test]
async fn a_deploy_that_failed_after_storing_its_key_keeps_the_key_and_says_it_exists() {
    let mut harness = harness(FLOW);
    let folder = tempfile::tempdir().unwrap();
    let script = r#"echo '{"type":"step","step":"secrets","status":"done","message":"set GRAPHRT_API_KEY"}'
echo '{"type":"step","step":"checking","status":"failed","message":"readyz critical"}'
echo '{"type":"api_key","api_key":"grk_live_after_failure"}'
echo '{"type":"error","code":"health_check_failed","message":"GET /readyz did not pass within 120 s"}'
exit 1"#;
    harness.service = harness.service.with_cli_executable(fake_cli(folder.path(), script));
    harness.credentials.set_api_key(ModelProvider::Openai, "sk").unwrap();
    harness.credentials.set_deploy_secret("account:fly", r#"{"token":"t"}"#).unwrap();

    let error = harness.service.deploy(&harness.agent.id, fly_options(), &[], &ready_report()).await.unwrap_err();
    let message = error.to_string();
    assert!(message.contains("was created on Fly.io") && message.contains("access key is saved"), "{message}");
    assert!(message.contains("GET /readyz did not pass"), "{message}");
    assert!(!message.contains("grk_live_after_failure"), "the key is never in a message");
    assert_eq!(
        harness.credentials.read_deploy_secret(&format!("key:{}", harness.agent.id)).unwrap().as_deref(),
        Some("grk_live_after_failure")
    );
    let record = harness.db.get_deployment(&harness.agent.id).unwrap().unwrap();
    assert_eq!(record.status, DeploymentStatus::Failed);
    assert_eq!(record.status_message.as_deref(), Some(message.as_str()));
    let logged = harness.events.0.lock().unwrap().clone();
    assert!(!format!("{logged:?}").contains("grk_live_after_failure"), "nor in the technical log");
}

#[cfg(unix)]
#[tokio::test]
async fn making_a_new_key_redeploys_the_online_version_with_rotation() {
    let mut harness = harness(FLOW);
    let folder = tempfile::tempdir().unwrap();
    let record_path = folder.path().join("calls.txt");
    let script = format!(
        r#"echo "ARGS $*" >> "{record}"
case "$*" in
  *--rotate-api-key*) echo '{{"type":"result","action":"deploy","url":"https://menu.fly.dev","version":"v1","app":"menu","workflow":"agent","api_key":"grk_rotated"}}' ;;
  *) echo '{{"type":"result","action":"deploy","url":"https://menu.fly.dev","version":"v1","app":"menu","workflow":"agent","api_key":"grk_first"}}' ;;
esac"#,
        record = record_path.display()
    );
    harness.service = harness.service.with_cli_executable(fake_cli(folder.path(), &script));
    harness.credentials.set_api_key(ModelProvider::Openai, "sk").unwrap();
    harness.credentials.set_deploy_secret("account:fly", r#"{"token":"t"}"#).unwrap();

    assert!(harness.service.rotate_api_key(&harness.agent.id).await.is_err(), "not online yet");
    let custom = DeployOptions { image: Some("ghcr.io/acme/graphrt:0.6.0".into()), ..fly_options() };
    harness.service.deploy(&harness.agent.id, custom, &[], &ready_report()).await.unwrap();
    // A later change is not shipped by a key rotation: it keeps the online version.
    harness.db.update_agent_flow(&harness.agent.id, &FLOW.replace("hello", "changed"), "Changed").unwrap();

    let rotated = harness.service.rotate_api_key(&harness.agent.id).await.unwrap();
    assert_eq!(rotated.api_key, "grk_rotated");
    assert_eq!(rotated.problem, None);
    assert!(rotated.view.has_changes, "the online copy still runs the older version");
    assert_eq!(
        harness.credentials.read_deploy_secret(&format!("key:{}", harness.agent.id)).unwrap().as_deref(),
        Some("grk_rotated")
    );
    let calls = std::fs::read_to_string(&record_path).unwrap();
    let rotation = calls.lines().find(|line| line.contains("--rotate-api-key")).unwrap();
    assert!(rotation.contains("--version v1") && rotation.contains("--mode scale-to-zero"), "{rotation}");
    assert!(rotation.contains("--image ghcr.io/acme/graphrt:0.6.0"), "the same image: {rotation}");
    assert!(!rotation.contains("--secret"), "the other secrets stay on Fly.io: {rotation}");
    assert_eq!(
        harness.service.review(&harness.agent, &[], DeployProvider::Fly).unwrap().image.as_deref(),
        Some("ghcr.io/acme/graphrt:0.6.0")
    );
}

#[cfg(unix)]
#[tokio::test]
async fn a_rotation_that_failed_after_storing_the_key_still_shows_it() {
    let mut harness = harness(FLOW);
    let folder = tempfile::tempdir().unwrap();
    let script = r#"case "$*" in
  *--rotate-api-key*)
    echo '{"type":"api_key","api_key":"grk_rotated_live"}'
    echo '{"type":"error","code":"start_timeout","message":"the Machine did not boot"}'
    exit 1 ;;
  *) echo '{"type":"result","action":"deploy","url":"https://menu.fly.dev","version":"v1","app":"menu","workflow":"agent","api_key":"grk_first"}' ;;
esac"#;
    harness.service = harness.service.with_cli_executable(fake_cli(folder.path(), script));
    harness.credentials.set_api_key(ModelProvider::Openai, "sk").unwrap();
    harness.credentials.set_deploy_secret("account:fly", r#"{"token":"t"}"#).unwrap();
    harness.service.deploy(&harness.agent.id, fly_options(), &[], &ready_report()).await.unwrap();

    let rotated = harness.service.rotate_api_key(&harness.agent.id).await.unwrap();
    assert_eq!(rotated.api_key, "grk_rotated_live");
    assert!(rotated.problem.as_deref().is_some_and(|problem| problem.contains("did not boot")));
    assert_eq!(
        harness.credentials.read_deploy_secret(&format!("key:{}", harness.agent.id)).unwrap().as_deref(),
        Some("grk_rotated_live")
    );
}

#[cfg(unix)]
#[tokio::test]
async fn status_from_the_cli_explains_what_is_wrong() {
    let mut harness = harness(FLOW);
    let folder = tempfile::tempdir().unwrap();
    let status = include_str!("contract/fixtures/status-offline.json").trim();
    let script = format!("echo '{status}'");
    harness.service = harness.service.with_cli_executable(fake_cli(folder.path(), &script));
    harness.credentials.set_deploy_secret("account:fly", r#"{"token":"t"}"#).unwrap();
    harness.db.save_deployment(&online_record(&harness.agent.id)).unwrap();
    let view = harness.service.refresh_status(&harness.agent.id).await.unwrap().unwrap();
    assert_eq!(view.deployment.status, DeploymentStatus::NeedsAttention);
    assert!(view.deployment.status_message.as_deref().is_some_and(|message| message.starts_with("Nothing is online")));
}

#[cfg(unix)]
#[tokio::test]
async fn removing_with_an_app_token_says_an_org_token_is_needed() {
    let mut harness = harness(FLOW);
    let folder = tempfile::tempdir().unwrap();
    let script = r#"echo '{"type":"error","code":"unauthorized","message":"Fly refused the token (403)"}'
exit 1"#;
    harness.service = harness.service.with_cli_executable(fake_cli(folder.path(), script));
    harness.credentials.set_deploy_secret("account:fly", r#"{"token":"t"}"#).unwrap();
    harness.db.save_deployment(&online_record(&harness.agent.id)).unwrap();
    let error = harness.service.manage(&harness.agent.id, ManageAction::Remove).await.unwrap_err();
    assert!(error.to_string().contains("fly tokens create org"), "{error}");
    assert!(harness.db.get_deployment(&harness.agent.id).unwrap().is_some(), "nothing is forgotten");
}

fn online_record(agent_id: &str) -> DeploymentRecord {
    DeploymentRecord {
        agent_id: agent_id.to_owned(),
        provider: DeployProvider::Fly,
        deployment_name: "menu".into(),
        app: Some("menu".into()),
        url: Some("https://menu.fly.dev".into()),
        region: Some("iad".into()),
        mode: DeployMode::AlwaysOn,
        deployed_version_label: Some("v1".into()),
        deployed_agent_version: Some(1),
        status: DeploymentStatus::Working,
        status_message: None,
        status_checked_at: None,
        created_at: String::new(),
        updated_at: String::new(),
    }
}

#[cfg(unix)]
#[tokio::test]
async fn a_failed_first_deploy_is_recorded_with_its_plain_message() {
    let mut harness = harness(FLOW);
    let folder = tempfile::tempdir().unwrap();
    let script = r#"echo '{"type":"step","step":"preparing","status":"failed"}'
echo '{"type":"error","code":"quota","message":"Fly.io needs a payment method on your account first"}'
exit 1"#;
    harness.service = harness.service.with_cli_executable(fake_cli(folder.path(), script));
    harness.credentials.set_api_key(ModelProvider::Openai, "sk").unwrap();
    harness.credentials.set_deploy_secret("account:fly", r#"{"token":"t"}"#).unwrap();
    let error = harness.service.deploy(&harness.agent.id, fly_options(), &[], &ready_report()).await.unwrap_err();
    assert_eq!(error.to_string(), "Fly.io needs a payment method on your account first");
    let record = harness.db.get_deployment(&harness.agent.id).unwrap().unwrap();
    assert_eq!(record.status, DeploymentStatus::Failed);
}

#[tokio::test]
async fn health_checks_update_the_status_and_online_runs_are_listed() {
    let harness = harness(FLOW);
    harness.db.save_deployment(&online_record(&harness.agent.id)).unwrap();
    let view = harness.service.refresh_status(&harness.agent.id).await.unwrap().unwrap();
    assert_eq!(view.deployment.status, DeploymentStatus::NeedsAttention);
    harness.http.answer("https://menu.fly.dev/healthz", 200, "ok");
    let view = harness.service.refresh_status(&harness.agent.id).await.unwrap().unwrap();
    assert_eq!(view.deployment.status, DeploymentStatus::Working);

    harness.credentials.set_deploy_secret(&format!("key:{}", harness.agent.id), "grt_key").unwrap();
    harness.http.answer(
        "https://menu.fly.dev/v1/runs?limit=10",
        200,
        r#"[{"id":"r1","status":"succeeded","started_at":"2026-11-24T10:00:00Z"}]"#,
    );
    let runs = harness.service.online_runs(10).await.unwrap();
    assert_eq!(runs.runs.len(), 1);
    assert_eq!(runs.runs[0].source_name, "Menu questions chatbot");
    assert_eq!(runs.runs[0].place, "Fly.io");
    assert!(runs.problems.is_empty());
}

#[tokio::test]
async fn own_servers_are_tested_before_they_are_saved() {
    let harness = harness(FLOW);
    let refused = harness.service.connect_own_server("home-nas", "http://192.168.1.20:8080", "k").await;
    assert!(refused.unwrap_err().to_string().contains("didn't answer"));
    harness.http.answer("http://192.168.1.20:8080/healthz", 200, "ok");
    harness.http.answer("http://192.168.1.20:8080/v1/runs?limit=1", 401, "");
    let wrong_key = harness.service.connect_own_server("home-nas", "http://192.168.1.20:8080", "k").await;
    assert!(wrong_key.unwrap_err().to_string().contains("access key"));
    harness.http.answer("http://192.168.1.20:8080/v1/runs?limit=1", 200, "[]");
    let view = harness.service.connect_own_server("home-nas", "http://192.168.1.20:8080/", "server-key").await.unwrap();
    assert_eq!(view.server.url, "http://192.168.1.20:8080");
    assert_eq!(
        harness.credentials.read_deploy_secret(&format!("server:{}", view.server.id)).unwrap().as_deref(),
        Some("server-key")
    );
    harness.service.remove_own_server(&view.server.id).unwrap();
    assert!(harness.db.list_own_servers().unwrap().is_empty());
    assert_eq!(harness.credentials.read_deploy_secret(&format!("server:{}", view.server.id)).unwrap(), None);
}

#[test]
fn exports_a_bundle_or_yaml_without_keys() {
    let harness = harness(FLOW);
    harness.credentials.set_api_key(ModelProvider::Openai, "sk-never-exported").unwrap();
    let folder = tempfile::tempdir().unwrap();
    let bundle_path = harness.service.export_agent_file(&harness.agent.id, &folder.path().join("menu.grt")).unwrap();
    let bytes = std::fs::read(&bundle_path).unwrap();
    let bundle = graphrt_bundle::Bundle::open(&bytes, &graphrt_bundle::OpenOptions::default()).unwrap();
    assert!(bundle.workflow(None).is_ok());
    assert!(!String::from_utf8_lossy(&bytes).contains("sk-never-exported"));
    let yaml_path = harness.service.export_agent_file(&harness.agent.id, &folder.path().join("menu.yaml")).unwrap();
    assert_eq!(std::fs::read_to_string(yaml_path).unwrap(), FLOW);
}
