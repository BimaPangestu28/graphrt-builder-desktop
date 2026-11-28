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
    /// Read only by the Unix-only fake-CLI tests.
    #[cfg(unix)]
    events: Arc<RecordedEvents>,
    agent: Agent,
    _temp: tempfile::TempDir,
}

/// Releases the agent's latest version: only a release goes online.
fn release_latest(db: &Database, agent_id: &str) {
    let version = db.get_agent(agent_id).unwrap().current_version;
    db.create_release(
        agent_id,
        crate::storage::quality::NewRelease {
            agent_version: version,
            notes: "Test release".into(),
            check_id: None,
            passed: None,
            total: None,
            required_percent: 80,
            override_reason: Some("tests of the deploy service".into()),
        },
    )
    .unwrap();
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
    release_latest(&db, &agent.id);
    let service = DeployService::new(DeployServiceConfig {
        app_data_dir: temp.path().to_path_buf(),
        db: db.clone(),
        credentials: credentials.clone(),
        downloader: None,
        http: http.clone(),
        events: events.clone(),
    });
    Harness {
        service,
        db,
        credentials,
        http,
        #[cfg(unix)]
        events,
        agent,
        _temp: temp,
    }
}

fn ready_report() -> CompatibilityReport {
    CompatibilityReport { ready: true, items: Vec::new() }
}

fn fly_options() -> DeployOptions {
    DeployOptions {
        provider: DeployProvider::Fly,
        mode: DeployMode::ScaleToZero,
        area: ServerArea::Asia,
        image: None,
        features: OnlineFeatures::default(),
        cloud_place: None,
        region: None,
    }
}

#[cfg(unix)]
fn fake_cli(folder: &std::path::Path, body: &str) -> PathBuf {
    let path = folder.join("fake-graphrt");
    crate::test_support::write_executable_script(&path, body);
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

    harness.service.disconnect_account(DeployProvider::Fly).await.unwrap();
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

#[test]
fn release_numbers_are_compared_as_numbers() {
    assert!(release_at_least("0.6.4", (0, 6, 4)));
    assert!(release_at_least("v0.10.0-rc.1", (0, 6, 4)));
    assert!(!release_at_least("0.6.3", (0, 6, 4)));
    assert!(!release_at_least("unreleased", (0, 6, 4)));
}

#[cfg(unix)]
fn google_place(project: &str) -> CloudPlace {
    CloudPlace { project: project.into(), region: "asia-southeast2".into() }
}

#[cfg(unix)]
fn google_options(place: Option<CloudPlace>) -> DeployOptions {
    DeployOptions { provider: DeployProvider::GoogleCloud, cloud_place: place, ..fly_options() }
}

/// A fake `graphrt` that knows Cloud Run, records its calls and fails with `billing_disabled`
/// while `{folder}/no-billing` exists.
#[cfg(unix)]
fn cloud_run_script(folder: &std::path::Path) -> String {
    format!(
        r#"echo "ARGS $*" >> "{record}"
echo "ENV TOKEN=$GOOGLE_OAUTH_ACCESS_TOKEN FLY=$FLY_API_TOKEN CREDS=$GOOGLE_APPLICATION_CREDENTIALS" >> "{record}"
case "$2" in
  --help) echo "  --project <PROJECT>  Direct, Cloud Run: Google Cloud project id [default: \$GOOGLE_CLOUD_PROJECT]" ;;
  pause) echo '{{"type":"result","action":"pause","app":"menu","url":"https://menu-abc-et.a.run.app","status":"paused","changed":true}}' ;;
  remove) echo '{{"type":"result","action":"remove","app":"menu","removed":true,"secrets_deleted":["menu-graphrt-api-key"],"bucket_deleted":true,"service_account_deleted":true}}' ;;
  list-versions) echo '{{"type":"result","action":"list-versions","app":"menu","url":"https://menu-abc-et.a.run.app","current_version":"v1","versions":[{{"label":"v1","deployed_at":"2026-11-28T10:00:00Z","current":true,"revision":"menu-00001-abc","mode":"scale-to-zero","workflow":"agent","state":"serving"}}],"project":"graphrt","region":"asia-southeast2"}}' ;;
  *)
    if [ -f "{no_billing}" ]; then
      echo '{{"type":"error","code":"billing_disabled","message":"could not create the bucket: project graphrt has no active billing account. Link one at https://console.cloud.google.com/billing/linkedaccount?project=graphrt, then deploy again"}}'
      exit 1
    fi
    echo '{{"type":"step","step":"preparing","status":"done","message":"Preparing"}}'
    echo '{{"type":"result","action":"deploy","url":"https://menu-abc-et.a.run.app","version":"v1","app":"menu","workflow":"agent","api_key":"grk_once","serve":{{}},"store":null,"project":"graphrt","region":"asia-southeast2","image":"ghcr.io/graphrt/graphrt:0.6.4"}}'
    ;;
esac"#,
        record = folder.join("calls.txt").display(),
        no_billing = folder.join("no-billing").display(),
    )
}

#[cfg(unix)]
#[tokio::test]
async fn puts_an_agent_on_cloud_run_with_the_signed_in_google_account() {
    let mut harness = harness(FLOW);
    let folder = tempfile::tempdir().unwrap();
    harness.service = harness.service.with_cli_executable(fake_cli(folder.path(), &cloud_run_script(folder.path())));
    harness.credentials.set_api_key(ModelProvider::Openai, "sk-openai-secret").unwrap();
    let agent_id = harness.agent.id.clone();

    let not_signed_in =
        harness.service.deploy(&agent_id, google_options(Some(google_place("graphrt"))), &[], &ready_report()).await;
    assert!(
        matches!(not_signed_in, Err(AppError::DeployFailed(ref problem)) if problem.fix == Some(google_cloud::DeployFix::SignInAgain))
    );
    harness.service.sign_in_google_for_test("ana@example.com", "ya29.test-token").await;
    let accounts = harness.service.list_accounts().unwrap();
    let google = accounts.iter().find(|account| account.provider == DeployProvider::GoogleCloud).unwrap();
    assert!(google.connected && google.can_deploy, "{google:?}");
    assert_eq!(google.summary.as_deref(), Some("Signed in as ana@example.com"));
    let no_place = harness.service.deploy(&agent_id, google_options(None), &[], &ready_report()).await.unwrap_err();
    assert!(no_place.to_string().contains("Pick a Google Cloud project"), "{no_place}");

    std::fs::write(folder.path().join("no-billing"), "").unwrap();
    let refused = harness
        .service
        .deploy(&agent_id, google_options(Some(google_place("graphrt"))), &[], &ready_report())
        .await
        .unwrap_err();
    assert_eq!(refused.code(), "deploy_failed");
    let details = refused.details().unwrap();
    assert_eq!(details["kind"], "billing_disabled");
    assert_eq!(details["fix"]["url"], "https://console.cloud.google.com/billing/linkedaccount?project=graphrt");
    assert!(refused.to_string().contains("no billing account"), "{refused}");
    std::fs::remove_file(folder.path().join("no-billing")).unwrap();

    let outcome = harness
        .service
        .deploy(&agent_id, google_options(Some(google_place("graphrt"))), &[], &ready_report())
        .await
        .unwrap();
    assert_eq!(outcome.api_key.as_deref(), Some("grk_once"));
    assert_eq!(outcome.view.deployment.url.as_deref(), Some("https://menu-abc-et.a.run.app"));
    assert_eq!(outcome.view.place, Some(google_place("graphrt")));
    assert_eq!(outcome.view.area, None, "Fly.io areas say nothing about Cloud Run");
    let calls = std::fs::read_to_string(folder.path().join("calls.txt")).unwrap();
    let deploy_line = calls.lines().rfind(|line| line.starts_with("ARGS deploy --target")).unwrap();
    assert!(deploy_line.contains("--target cloud-run --direct"), "{deploy_line}");
    assert!(deploy_line.contains("--project graphrt --region asia-southeast2"), "{deploy_line}");
    assert!(deploy_line.contains("--secret OPENAI_API_KEY"));
    assert!(calls.contains("ENV TOKEN=ya29.test-token FLY= CREDS="), "only the access token: {calls}");
    assert!(!calls.lines().filter(|line| line.starts_with("ARGS")).any(|line| line.contains("ya29")));

    let review = harness.service.review(&harness.agent, &[], DeployProvider::GoogleCloud).unwrap();
    assert_eq!(review.cloud_place, Some(google_place("graphrt")));
    let moved = harness
        .service
        .deploy(&agent_id, google_options(Some(google_place("other-project"))), &[], &ready_report())
        .await
        .unwrap_err();
    assert!(matches!(moved, AppError::Conflict(ref message) if message.contains("Take it offline first")), "{moved}");
    let to_fly = harness.service.deploy(&agent_id, fly_options(), &[], &ready_report()).await.unwrap_err();
    assert!(to_fly.to_string().contains("online with Google Cloud"), "{to_fly}");

    let paused = harness.service.manage(&agent_id, ManageAction::Pause).await.unwrap().unwrap();
    assert_eq!(paused.deployment.status, DeploymentStatus::Paused);
    let versions = harness.service.list_versions(&agent_id).await.unwrap();
    assert_eq!(versions.iter().map(|version| version.label.as_str()).collect::<Vec<_>>(), ["v1"]);
    let calls = std::fs::read_to_string(folder.path().join("calls.txt")).unwrap();
    let pause_line = calls.lines().find(|line| line.starts_with("ARGS deploy pause")).unwrap();
    assert!(pause_line.contains("--project graphrt --region asia-southeast2 --json"), "{pause_line}");

    assert_eq!(harness.service.manage(&agent_id, ManageAction::Remove).await.unwrap(), None);
    let project = harness.db.get_agent_setting(&agent_id, DEPLOY_PROJECT_KEY).unwrap();
    assert!(project.is_none_or(|value| value.is_null()), "the project is forgotten with the deployment");
}

/// A fake `graphrt` that knows Lambda (without a store), records its calls and refuses with
/// `permission_denied` while `{folder}/denied` exists.
#[cfg(unix)]
fn lambda_script(folder: &std::path::Path) -> String {
    format!(
        r#"echo "ARGS $*" >> "{record}"
echo "ENV ID=$AWS_ACCESS_KEY_ID SECRET=$AWS_SECRET_ACCESS_KEY TOKEN=$AWS_SESSION_TOKEN PROFILE=$AWS_PROFILE" >> "{record}"
case "$2" in
  --help) echo "  --profile <PROFILE>  Direct, Lambda: AWS profile of ~/.aws/credentials / ~/.aws/config --chat-access --monitor --push --expire-approvals --drop-store" ;;
  capabilities) exit 2 ;;
  pause) echo '{{"type":"result","action":"pause","app":"graphrt-menu","url":"https://abc.lambda-url.ap-southeast-3.on.aws/","status":"paused","changed":true,"region":"ap-southeast-3"}}' ;;
  remove) echo '{{"type":"result","action":"remove","app":"graphrt-menu","removed":true,"region":"ap-southeast-3"}}' ;;
  *)
    if [ -f "{denied}" ]; then
      echo '{{"type":"error","code":"permission_denied","message":"could not create the function: User: arn:aws:iam::1:user/x is not authorized to perform: lambda:CreateFunction on resource: graphrt-menu"}}'
      exit 1
    fi
    echo '{{"type":"result","action":"deploy","url":"https://abc.lambda-url.ap-southeast-3.on.aws/","version":"v1","app":"graphrt-menu","workflow":"agent","api_key":"grk_lambda","region":"ap-southeast-3"}}'
    ;;
esac"#,
        record = folder.join("calls.txt").display(),
        denied = folder.join("denied").display(),
    )
}

#[cfg(unix)]
#[tokio::test]
async fn puts_an_agent_on_aws_lambda_with_the_saved_access_key() {
    let mut harness = harness(FLOW);
    let folder = tempfile::tempdir().unwrap();
    harness.service = harness.service.with_cli_executable(fake_cli(folder.path(), &lambda_script(folder.path())));
    harness.credentials.set_api_key(ModelProvider::Openai, "sk-openai-secret").unwrap();
    let agent_id = harness.agent.id.clone();
    let aws_options = |region: Option<&str>, features: OnlineFeatures| DeployOptions {
        provider: DeployProvider::Aws,
        mode: DeployMode::AlwaysOn,
        region: region.map(str::to_owned),
        features,
        ..fly_options()
    };

    let review = harness.service.review(&harness.agent, &[], DeployProvider::Aws).unwrap();
    assert!(review.can_deploy && !review.store_features, "Lambda without a store: {review:?}");
    let not_connected = harness
        .service
        .deploy(&agent_id, aws_options(Some("ap-southeast-3"), OnlineFeatures::default()), &[], &ready_report())
        .await;
    assert!(
        matches!(not_connected, Err(AppError::DeployFailed(ref problem)) if problem.fix == Some(google_cloud::DeployFix::ConnectAgain { provider: DeployProvider::Aws })),
        "{not_connected:?}"
    );
    harness
        .credentials
        .set_deploy_secret(
            "account:aws",
            r#"{"accessKeyId":"AKIATESTTESTTEST1234","secretAccessKey":"test-secret-not-real","sessionToken":null}"#,
        )
        .unwrap();
    let no_region =
        harness.service.deploy(&agent_id, aws_options(None, OnlineFeatures::default()), &[], &ready_report()).await;
    assert!(no_region.unwrap_err().to_string().contains("Pick an AWS region"));
    let phone = OnlineFeatures { phone: true, ..OnlineFeatures::default() };
    let needs_store =
        harness.service.deploy(&agent_id, aws_options(Some("ap-southeast-3"), phone), &[], &ready_report()).await;
    assert!(needs_store.unwrap_err().to_string().contains("storage space"));

    std::fs::write(folder.path().join("denied"), "").unwrap();
    let denied = harness
        .service
        .deploy(&agent_id, aws_options(Some("ap-southeast-3"), OnlineFeatures::default()), &[], &ready_report())
        .await
        .unwrap_err();
    let details = denied.details().unwrap();
    assert_eq!((details["provider"].as_str(), details["kind"].as_str()), (Some("aws"), Some("permission_denied")));
    assert_eq!(details["role"], "lambda:CreateFunction");
    std::fs::remove_file(folder.path().join("denied")).unwrap();

    let chat = OnlineFeatures { chat: true, ..OnlineFeatures::default() };
    let outcome = harness
        .service
        .deploy(&agent_id, aws_options(Some("ap-southeast-3"), chat), &[], &ready_report())
        .await
        .unwrap();
    assert_eq!(outcome.view.deployment.url.as_deref(), Some("https://abc.lambda-url.ap-southeast-3.on.aws/"));
    assert_eq!(outcome.view.deployment.region.as_deref(), Some("ap-southeast-3"));
    assert_eq!(outcome.view.deployment.mode, DeployMode::ScaleToZero, "Lambda only scales to zero");
    let calls = std::fs::read_to_string(folder.path().join("calls.txt")).unwrap();
    let deploy_line = calls.lines().rfind(|line| line.starts_with("ARGS deploy --target")).unwrap();
    assert!(deploy_line.contains("--target lambda --direct"), "{deploy_line}");
    assert!(deploy_line.contains("--region ap-southeast-3 --mode scale-to-zero"), "{deploy_line}");
    assert!(deploy_line.contains("--chat") && !deploy_line.contains("--drop-store"), "{deploy_line}");
    assert!(!deploy_line.contains("--project"));
    assert!(calls.contains("ENV ID=AKIATESTTESTTEST1234 SECRET=test-secret-not-real TOKEN= PROFILE="), "{calls}");
    assert!(!calls.lines().filter(|line| line.starts_with("ARGS")).any(|line| line.contains("test-secret-not-real")));

    let moved = harness
        .service
        .deploy(&agent_id, aws_options(Some("us-east-1"), OnlineFeatures::default()), &[], &ready_report())
        .await
        .unwrap_err();
    assert!(moved.to_string().contains("Take it offline first"), "{moved}");
    assert_eq!(
        harness.service.review(&harness.agent, &[], DeployProvider::Aws).unwrap().region.as_deref(),
        Some("ap-southeast-3")
    );

    harness.service.manage(&agent_id, ManageAction::Pause).await.unwrap();
    let calls = std::fs::read_to_string(folder.path().join("calls.txt")).unwrap();
    let pause_line = calls.lines().find(|line| line.starts_with("ARGS deploy pause")).unwrap();
    assert!(
        pause_line.contains("--target lambda --direct") && pause_line.contains("--region ap-southeast-3 --json"),
        "{pause_line}"
    );
    assert_eq!(harness.service.manage(&agent_id, ManageAction::Remove).await.unwrap(), None);
}

#[tokio::test]
async fn deploying_needs_fly_the_tools_and_saved_keys() {
    let harness = harness(FLOW);
    let not_fly = DeployOptions { provider: DeployProvider::Azure, ..fly_options() };
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
  --help) ;;
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
    assert!(
        !harness.service.view(&harness.agent.id).unwrap().unwrap().has_changes,
        "an unreleased draft stays offline"
    );
    release_latest(&harness.db, &harness.agent.id);
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
    assert!(!rolled_back.has_changes, "going back online puts the release of v1 in use too");
    assert_eq!(harness.db.release_in_use(&harness.agent.id).unwrap().map(|release| release.number), Some(1));

    assert_eq!(harness.service.manage(&harness.agent.id, ManageAction::Remove).await.unwrap(), None);
    assert_eq!(harness.db.get_deployment(&harness.agent.id).unwrap(), None);
    assert_eq!(harness.credentials.read_deploy_secret(&format!("key:{}", harness.agent.id)).unwrap(), None);
}

/// A fake `graphrt` that deploys, lists v2 (current) and v1 (standby), and fails its roll back
/// while `{folder}/rollback-fails` exists, the way a Machine that never starts does.
#[cfg(unix)]
fn rollback_script(folder: &std::path::Path) -> String {
    format!(
        r#"case "$2" in
  --help) ;;
  rollback)
    if [ -f "{fails}" ]; then
      echo '{{"type":"error","code":"provider","message":"Machine 8edd412fd70918 did not start within 120 s"}}'
      exit 1
    fi
    echo '{{"type":"result","action":"rollback","app":"menu","url":"https://menu.fly.dev","version":"v1","workflow":"agent"}}' ;;
  list-versions) echo '{{"type":"result","action":"list-versions","app":"menu","url":"https://menu.fly.dev","current_version":"v2","versions":[{{"label":"v2","deployed_at":"2026-11-24T16:00:00.123Z","current":true,"role":"current","mode":"scale-to-zero","workflow":"agent","state":"started"}},{{"label":"v1","deployed_at":"2026-11-23T09:12:00.000Z","current":false,"role":"standby","mode":"scale-to-zero","workflow":"agent","state":"stopped"}}]}}' ;;
  *)
    version=$(echo "$*" | sed 's/.*--version \([^ ]*\).*/\1/')
    echo "{{\"type\":\"result\",\"action\":\"deploy\",\"url\":\"https://menu.fly.dev\",\"version\":\"$version\",\"app\":\"menu\",\"workflow\":\"agent\",\"api_key\":null}}"
    ;;
esac"#,
        fails = folder.join("rollback-fails").display()
    )
}

#[cfg(unix)]
#[tokio::test]
async fn going_back_to_a_release_changes_nothing_when_the_online_copy_cannot_switch() {
    let mut harness = harness(FLOW);
    let folder = tempfile::tempdir().unwrap();
    harness.service = harness.service.with_cli_executable(fake_cli(folder.path(), &rollback_script(folder.path())));
    harness.credentials.set_api_key(ModelProvider::Openai, "sk-openai-secret").unwrap();
    harness.credentials.set_deploy_secret("account:fly", r#"{"token":"fly-secret"}"#).unwrap();
    let agent_id = harness.agent.id.clone();
    harness.service.deploy(&agent_id, fly_options(), &[], &ready_report()).await.unwrap();
    harness.db.update_agent_flow(&agent_id, &FLOW.replace("hello", "hi there"), "Friendlier").unwrap();
    release_latest(&harness.db, &agent_id);
    harness.service.deploy(&agent_id, fly_options(), &[], &ready_report()).await.unwrap();
    let in_use = |db: &Database| db.release_in_use(&agent_id).unwrap().map(|release| release.number);
    assert_eq!(in_use(&harness.db), Some(2));

    std::fs::write(folder.path().join("rollback-fails"), "").unwrap();
    let error = harness.service.put_release_in_use(&agent_id, 1).await.unwrap_err();
    assert!(matches!(error, AppError::OnlineSwitchFailed { release_number: 1, in_use_number: Some(2) }), "{error:?}");
    assert_eq!(error.code(), "online_switch_failed");
    let message = error.to_string();
    assert!(message.contains("release 2 stays in use here and online"), "{message}");
    assert!(!message.contains("Machine"), "no provider jargon: {message}");
    assert_eq!(in_use(&harness.db), Some(2), "the release in use here stays the one online");
    let view = harness.service.view(&agent_id).unwrap().unwrap();
    assert_eq!(view.deployment.deployed_version_label.as_deref(), Some("v2"));

    std::fs::remove_file(folder.path().join("rollback-fails")).unwrap();
    let (release, online) = harness.service.put_release_in_use(&agent_id, 1).await.unwrap();
    assert_eq!(release.number, 1);
    assert_eq!(online, OnlineSwitch::Switched { label: "v1".into() });
    assert_eq!(in_use(&harness.db), Some(1));
    assert!(harness.service.put_release_in_use(&agent_id, 1).await.is_err(), "already in use");
}

#[tokio::test]
async fn going_back_to_a_release_of_an_agent_that_is_not_online_switches_here() {
    let harness = harness(FLOW);
    let agent_id = harness.agent.id.clone();
    harness.db.update_agent_flow(&agent_id, &FLOW.replace("hello", "hi there"), "Friendlier").unwrap();
    release_latest(&harness.db, &agent_id);
    let (release, online) = harness.service.put_release_in_use(&agent_id, 1).await.unwrap();
    assert_eq!((release.number, online), (1, OnlineSwitch::NotOnline));
    assert_eq!(harness.db.release_in_use(&agent_id).unwrap().map(|release| release.number), Some(1));
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
    release_latest(&harness.db, &harness.agent.id);

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

#[test]
fn only_the_release_in_use_is_exported() {
    let harness = harness(FLOW);
    let folder = tempfile::tempdir().unwrap();
    let draft = FLOW.replace("hello", "not released yet");
    harness.db.update_agent_flow(&harness.agent.id, &draft, "Draft").unwrap();
    let yaml_path = harness.service.export_agent_file(&harness.agent.id, &folder.path().join("menu.yaml")).unwrap();
    assert_eq!(std::fs::read_to_string(&yaml_path).unwrap(), FLOW, "the draft is not exported");

    let unreleased = harness
        .db
        .create_agent(NewAgent {
            name: "Never released".into(),
            kind: AgentKind::Chatbot,
            description: String::new(),
            flow_yaml: FLOW.into(),
        })
        .unwrap();
    let refused = harness.service.export_agent_file(&unreleased.id, &folder.path().join("other.yaml"));
    assert!(matches!(refused, Err(AppError::NeedsRelease)));
}

#[test]
fn a_released_chatbot_setup_goes_into_the_agent_file_and_going_back_takes_it_out() {
    let harness = harness(FLOW);
    let folder = tempfile::tempdir().unwrap();
    let agent_id = harness.agent.id.clone();
    let mut settings =
        crate::chatbot_setup::get_chatbot_setup(&harness.db, &agent_id, &|_| Default::default()).unwrap().settings;
    settings.persona.instructions = "Delivery is free within Bandung.".into();
    crate::chatbot_setup::save_chatbot_settings(&harness.db, &agent_id, settings, &|_| Default::default()).unwrap();
    let path = folder.path().join("menu.yaml");
    let exported = |harness: &Harness| {
        harness.service.export_agent_file(&agent_id, &path).unwrap();
        std::fs::read_to_string(&path).unwrap()
    };
    assert_eq!(exported(&harness), FLOW, "an unreleased setup stays out, like any draft");

    release_latest(&harness.db, &agent_id);
    let with_setup = exported(&harness);
    assert!(with_setup.contains("{{#env.chatbot_brief#}}"), "{with_setup}");
    assert!(with_setup.contains("Delivery is free within Bandung."), "{with_setup}");

    harness.db.switch_release(&agent_id, 1, SwitchReason::RolledBack).unwrap();
    assert_eq!(exported(&harness), FLOW, "release 1 had no setup");
}

// ---- the chat page, the phone page and paired phones ----

fn chat_and_phone() -> OnlineFeatures {
    OnlineFeatures {
        chat: true,
        chat_audience: online::ChatAudience::Guests,
        embed_site: Some("www.toko-kue.example/menu".into()),
        phone: true,
        notifications: true,
        notify_email: Some("ana@example.com".into()),
        answer_when_time_runs_out: true,
        whatsapp: false,
        teams: false,
    }
}

/// A fake `graphrt` whose `deploy --help` lists the chat and phone flags when `knows_features`,
/// and which records the arguments of every other call in `record`.
#[cfg(unix)]
fn feature_cli(folder: &std::path::Path, record: &std::path::Path, knows_features: bool) -> PathBuf {
    let help = if knows_features {
        "--chat --chat-access <WHO> --cors-origin <ORIGIN> --monitor --push <CONTACT> --expire-approvals --drop-store"
    } else {
        "--rotate-api-key --json"
    };
    let script = format!(
        r#"if [ "$1 $2" = "deploy --help" ]; then echo "{help}"; exit 0; fi
echo "ARGS $*" >> "{record}"
case "$2" in
  remove) echo '{{"type":"result","action":"remove","app":"menu","removed":true}}' ;;
  *) echo '{{"type":"result","action":"deploy","url":"https://menu.fly.dev","version":"v1","app":"menu","workflow":"agent","api_key":"grk_shown_once_0123456789"}}' ;;
esac"#,
        record = record.display()
    );
    fake_cli(folder, &script)
}

#[cfg(unix)]
fn ready_to_deploy(knows_features: bool) -> (Harness, tempfile::TempDir, PathBuf) {
    let mut harness = harness(FLOW);
    let folder = tempfile::tempdir().unwrap();
    let record = folder.path().join("calls.txt");
    harness.service = harness.service.with_cli_executable(feature_cli(folder.path(), &record, knows_features));
    harness.credentials.set_api_key(ModelProvider::Openai, "sk-openai-secret").unwrap();
    harness.credentials.set_deploy_secret("account:fly", r#"{"token":"fly-secret"}"#).unwrap();
    (harness, folder, record)
}

#[cfg(unix)]
#[tokio::test]
async fn tools_older_than_the_chat_and_phone_pages_refuse_them_in_plain_words_and_still_deploy_without() {
    let (harness, _folder, record) = ready_to_deploy(false);
    assert!(!harness.service.cli_info().online_features);

    let options = DeployOptions { features: chat_and_phone(), ..fly_options() };
    let refused = harness.service.deploy(&harness.agent.id, options, &[], &ready_report()).await.unwrap_err();

    assert_eq!(refused.code(), "invalid_input");
    assert!(refused.to_string().ends_with(ONLINE_FEATURES_NEED_NEWER_TOOLS), "{refused}");
    assert!(!record.exists(), "nothing was sent to the provider");
    assert!(harness.service.view(&harness.agent.id).unwrap().is_none());

    // Without them the deploy goes through, and no flag the old tools do not know is sent.
    harness.service.deploy(&harness.agent.id, fly_options(), &[], &ready_report()).await.unwrap();
    let calls = std::fs::read_to_string(&record).unwrap();
    assert!(!calls.contains("--drop-store") && !calls.contains("--chat"), "{calls}");
}

#[cfg(unix)]
#[tokio::test]
async fn the_chat_and_phone_choices_become_flags_are_remembered_and_survive_a_new_key() {
    let (harness, _folder, record) = ready_to_deploy(true);
    assert!(harness.service.cli_info().online_features);
    assert_eq!(
        harness.service.review(&harness.agent, &[], DeployProvider::Fly).unwrap().features,
        OnlineFeatures::default()
    );

    let options = DeployOptions { features: chat_and_phone(), ..fly_options() };
    let outcome = harness.service.deploy(&harness.agent.id, options, &[], &ready_report()).await.unwrap();

    let calls = std::fs::read_to_string(&record).unwrap();
    let deploy_line = calls.lines().next().unwrap();
    assert!(
        deploy_line.contains(
            "--chat --chat-access guests --cors-origin https://www.toko-kue.example --monitor \
             --push mailto:ana@example.com --expire-approvals --json"
        ),
        "{deploy_line}"
    );
    assert!(!deploy_line.contains("--drop-store"), "the storage with the paired phones is kept");
    let saved = outcome.view.features;
    assert!(saved.chat && saved.phone && saved.notifications && saved.answer_when_time_runs_out);
    assert_eq!(saved.embed_site.as_deref(), Some("https://www.toko-kue.example"), "saved as the site's origin");
    assert_eq!(harness.service.review(&harness.agent, &[], DeployProvider::Fly).unwrap().features, saved);

    // "Make a new key" is a deploy too: it must name what is on, or it would turn it off.
    harness.service.rotate_api_key(&harness.agent.id).await.unwrap();
    let calls = std::fs::read_to_string(&record).unwrap();
    let rotation = calls.lines().nth(1).unwrap();
    assert!(rotation.contains("--rotate-api-key") && rotation.contains("--monitor"), "{rotation}");
    assert!(rotation.contains("--chat --chat-access guests"), "{rotation}");

    // Turning everything off removes the storage volume, so its cost ends.
    let off = harness.service.deploy(&harness.agent.id, fly_options(), &[], &ready_report()).await.unwrap();
    assert_eq!(off.view.features, OnlineFeatures::default());
    let calls = std::fs::read_to_string(&record).unwrap();
    let last = calls.lines().last().unwrap();
    assert!(last.contains("--drop-store") && !last.contains("--monitor") && !last.contains("--chat"), "{last}");
}

#[cfg(unix)]
#[tokio::test]
async fn a_website_or_email_that_cannot_work_stops_the_deploy_before_anything_runs() {
    let (harness, _folder, record) = ready_to_deploy(true);
    let no_email = OnlineFeatures { notify_email: None, ..chat_and_phone() };
    let bad_site = OnlineFeatures { embed_site: Some("not a site".into()), ..chat_and_phone() };
    for features in [no_email, bad_site] {
        let options = DeployOptions { features, ..fly_options() };
        let refused = harness.service.deploy(&harness.agent.id, options, &[], &ready_report()).await.unwrap_err();
        assert_eq!(refused.code(), "invalid_input", "{refused}");
    }
    assert!(!record.exists());
}

const PAIRED: &str = r#"{"device":{"id":"dev-5c1f","name":"Ana's phone","scopes":["runs:read","approvals:resolve"],"created_ms":1795750000000},"token":"grd1.dev-5c1f.TOKENSECRET","pairing":{"v":1,"url":"https://menu.fly.dev","token":"grd1.dev-5c1f.TOKENSECRET"},"link":"https://menu.fly.dev/monitor/#pair=grd1.dev-5c1f.TOKENSECRET"}"#;

fn online_with_key(harness: &Harness) -> phone::OnlineTarget {
    harness.db.save_deployment(&online_record(&harness.agent.id)).unwrap();
    harness.credentials.set_deploy_secret(&format!("key:{}", harness.agent.id), "grk_access_key").unwrap();
    phone::OnlineTarget::Agent { agent_id: harness.agent.id.clone() }
}

#[tokio::test]
async fn what_is_on_is_asked_from_the_online_agent_itself() {
    let harness = harness(FLOW);
    let target = online_with_key(&harness);
    harness.http.answer(
        "https://menu.fly.dev/v1/chat/config",
        200,
        r#"{"title":"agent","workflows":[{"name":"agent","input":null}],"access":"guests","conversations":false}"#,
    );
    harness.http.answer(
        "https://menu.fly.dev/v1/monitor/config",
        404,
        r#"{"error":"this server has no monitoring page"}"#,
    );

    let live = harness.service.live_features(&target).await.unwrap();

    assert!(live.reachable);
    let chat = live.chat.unwrap();
    assert_eq!(chat.link, "https://menu.fly.dev/chat/agent");
    assert_eq!(
        chat.widget_snippet,
        r#"<script src="https://menu.fly.dev/chat/embed.js" data-workflow="agent" async></script>"#
    );
    assert!(live.phone.is_none(), "an agent without the phone page says so");
    let asked = harness.http.requests.lock().unwrap().clone();
    assert!(asked.iter().all(|(_, bearer)| bearer.is_none()), "both pages' settings are public: no key is sent");

    // An agent that does not answer is reported as such, not as "everything is off".
    let unreachable = super::tests::harness(FLOW);
    let target = online_with_key(&unreachable);
    let live = unreachable.service.live_features(&target).await.unwrap();
    assert!(!live.reachable && live.problem.is_some() && live.chat.is_none());
}

#[tokio::test]
async fn pairing_keeps_the_code_in_the_keychain_only_and_revoking_forgets_it() {
    let harness = harness(FLOW);
    let target = online_with_key(&harness);
    harness.http.answer("POST https://menu.fly.dev/v1/devices", 201, PAIRED);
    harness.http.answer("DELETE https://menu.fly.dev/v1/devices/dev-5c1f", 204, "");

    for bad_name in ["", "   ", "a\nb", &"x".repeat(101)] {
        assert_eq!(harness.service.pair_device(&target, bad_name).await.unwrap_err().code(), "invalid_input");
    }
    let pairing = harness.service.pair_device(&target, " Ana's phone ").await.unwrap();

    assert_eq!(pairing.link, "https://menu.fly.dev/monitor/#pair=grd1.dev-5c1f.TOKENSECRET");
    let (_, body) = harness.http.bodies.lock().unwrap()[0].clone();
    assert_eq!(body, serde_json::json!({ "name": "Ana's phone", "url": "https://menu.fly.dev" }));
    let sent = harness.http.requests.lock().unwrap().clone();
    assert_eq!(sent.last().unwrap().1.as_deref(), Some("grk_access_key"), "paired with the access key");
    assert!(sent.iter().all(|(url, _)| !url.contains("grk_access_key")), "the key is never in an address");
    let secret_name = format!("device:agent:{}:dev-5c1f", harness.agent.id);
    assert!(harness.credentials.read_deploy_secret(&secret_name).unwrap().unwrap().contains("TOKENSECRET"));
    {
        let settings = harness.db.lock().unwrap();
        let stored: Vec<String> = settings
            .prepare("SELECT value FROM settings")
            .unwrap()
            .query_map([], |row| row.get(0))
            .unwrap()
            .map(Result::unwrap)
            .collect();
        assert!(stored.iter().all(|value| !value.contains("TOKENSECRET") && !value.contains("grd1.")), "{stored:?}");
        assert!(stored.iter().any(|value| value.contains("dev-5c1f")), "only the phone's id is remembered");
    }

    // The code can be shown again, on request, for that phone only.
    assert_eq!(harness.service.device_pairing(&target, "dev-5c1f").unwrap().link, pairing.link);
    assert_eq!(harness.service.device_pairing(&target, "dev-other").unwrap_err().code(), "not_found");
    assert_eq!(harness.service.device_pairing(&target, "../key").unwrap_err().code(), "not_found");

    harness.http.answer(
        "https://menu.fly.dev/v1/devices",
        200,
        r#"{"devices":[{"id":"dev-5c1f","name":"Ana's phone","created_ms":1795750000000,"last_used_ms":1795750060000},{"id":"dev-9a9a","name":"Wall display","created_ms":1795740000000}]}"#,
    );
    let devices = harness.service.list_devices(&target).await.unwrap();
    assert_eq!(devices.iter().map(|device| device.name.as_str()).collect::<Vec<_>>(), ["Ana's phone", "Wall display"]);
    assert!(devices[0].can_show_code && !devices[1].can_show_code, "a phone paired elsewhere has no code here");

    harness.service.revoke_device(&target, "dev-5c1f").await.unwrap();
    assert!(harness.credentials.read_deploy_secret(&secret_name).unwrap().is_none());
    assert_eq!(harness.service.device_pairing(&target, "dev-5c1f").unwrap_err().code(), "not_found");
    assert_eq!(harness.service.revoke_device(&target, "../../v1/runs").await.unwrap_err().code(), "invalid_input");
}

#[tokio::test]
async fn a_refused_revoke_keeps_the_phone_and_codes_of_phones_removed_elsewhere_are_forgotten() {
    let harness = harness(FLOW);
    let target = online_with_key(&harness);
    harness.http.answer("POST https://menu.fly.dev/v1/devices", 201, PAIRED);
    harness.service.pair_device(&target, "Ana's phone").await.unwrap();
    let secret_name = format!("device:agent:{}:dev-5c1f", harness.agent.id);

    harness.http.answer("DELETE https://menu.fly.dev/v1/devices/dev-5c1f", 401, "");
    assert_eq!(harness.service.revoke_device(&target, "dev-5c1f").await.unwrap_err().code(), "credentials");
    assert!(harness.credentials.read_deploy_secret(&secret_name).unwrap().is_some(), "it is still paired");

    // The phone unpaired itself in the phone page: its code here is of no use.
    harness.http.answer("https://menu.fly.dev/v1/devices", 200, r#"{"devices":[]}"#);
    assert!(harness.service.list_devices(&target).await.unwrap().is_empty());
    assert!(harness.credentials.read_deploy_secret(&secret_name).unwrap().is_none());

    harness.http.answer("https://menu.fly.dev/v1/devices", 404, r#"{"error":"not found"}"#);
    let off = harness.service.list_devices(&target).await.unwrap_err();
    assert!(off.to_string().contains("Follow it from your phone"), "{off}");
}

#[tokio::test]
async fn a_connected_server_pairs_phones_with_its_own_key_and_forgets_them_when_removed() {
    let harness = harness(FLOW);
    harness.http.answer("https://agents.example.com/healthz", 200, "ok");
    harness.http.answer("https://agents.example.com/v1/runs?limit=1", 200, "[]");
    let server =
        harness.service.connect_own_server("Office server", "https://agents.example.com", "srv_key").await.unwrap();
    let target = phone::OnlineTarget::Server { server_id: server.server.id.clone() };
    harness.http.answer(
        "POST https://agents.example.com/v1/devices",
        201,
        &PAIRED.replace("menu.fly.dev", "agents.example.com"),
    );

    let pairing = harness.service.pair_device(&target, "Ana's phone").await.unwrap();

    assert!(pairing.link.starts_with("https://agents.example.com/monitor/#pair="));
    assert_eq!(harness.http.requests.lock().unwrap().last().unwrap().1.as_deref(), Some("srv_key"));
    let secret_name = format!("device:server:{}:dev-5c1f", server.server.id);
    assert!(harness.credentials.read_deploy_secret(&secret_name).unwrap().is_some());

    harness.service.remove_own_server(&server.server.id).unwrap();
    assert!(harness.credentials.read_deploy_secret(&secret_name).unwrap().is_none());
    assert_eq!(harness.service.pair_device(&target, "Ana's phone").await.unwrap_err().code(), "not_found");
}

#[test]
fn own_server_instructions_name_the_agents_keys_and_the_chosen_pages() {
    let harness = harness(FLOW);
    let instructions = harness.service.own_server_instructions(&harness.agent, &[], &chat_and_phone()).unwrap();
    // The agent file is saved as menu-questions-chatbot.grt, and graphrt serves it under that name.
    let name = "menu-questions-chatbot";
    assert!(instructions.command.contains("-e OPENAI_API_KEY=<your key>"), "{}", instructions.command);
    assert!(instructions.command.contains(&format!("-e GRAPHRT_CHAT={name}")));
    assert!(instructions.command.contains("-e GRAPHRT_MONITOR=1"));
    assert_eq!(instructions.chat_address.unwrap(), format!("https://<the address of this server>/chat/{name}"));
    let bad = OnlineFeatures { embed_site: Some("nope".into()), ..chat_and_phone() };
    assert_eq!(harness.service.own_server_instructions(&harness.agent, &[], &bad).unwrap_err().code(), "invalid_input");
}

/// A released task agent whose workflow names a knowledge base indexed from `file`
/// with passages of 60 tokens. Returns the agent and the knowledge base id.
async fn agent_with_knowledge(harness: &Harness, file: &Path) -> (Agent, String) {
    use crate::knowledge::models::{ChunkingSettings, SourceKind};
    let knowledge = Arc::new(crate::knowledge::KnowledgeService::new(
        harness.db.clone(),
        harness.credentials.clone(),
        harness._temp.path().join("knowledge"),
        Arc::new(crate::knowledge::events::DiscardKnowledgeEvents),
    ));
    let knowledge_base = knowledge.create_knowledge_base("Catering FAQ", "").unwrap();
    knowledge.add_source(&knowledge_base.id, SourceKind::File, &file.display().to_string()).unwrap();
    let chunking = ChunkingSettings { max_tokens: 60, overlap_tokens: 0, ..ChunkingSettings::default() };
    let settings = crate::knowledge::models::KnowledgeSettings { chunking, ..knowledge_base.settings.clone() };
    knowledge.update_settings(&knowledge_base.id, settings).await.unwrap();
    knowledge.sync_knowledge_base(&knowledge_base.id).await.unwrap();
    let flow = format!("{FLOW}\n# knowledge: {}\n", knowledge_base.id);
    let agent = harness
        .db
        .create_agent(NewAgent {
            name: "Uses FAQ".into(),
            kind: AgentKind::Task,
            description: String::new(),
            flow_yaml: flow,
        })
        .unwrap();
    release_latest(&harness.db, &agent.id);
    (harness.db.get_agent(&agent.id).unwrap(), knowledge_base.id)
}

fn faq_fixture() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("fixtures/knowledge/catering-faq.md")
}

/// The knowledge config inside a `.grt` bundle.
fn bundle_knowledge(bytes: &[u8]) -> (graphrt_bundle::Bundle, serde_json::Value) {
    let bundle = graphrt_bundle::Bundle::open(bytes, &graphrt_bundle::OpenOptions::default()).unwrap();
    let (_, config_text) = bundle.knowledge_config().expect("the bundle has a knowledge config");
    let config = serde_json::from_str(config_text).unwrap();
    (bundle, config)
}

#[tokio::test]
async fn bundles_carry_the_knowledge_the_agent_uses_with_its_chunking() {
    let harness = harness(FLOW);
    let (agent, knowledge_base_id) = agent_with_knowledge(&harness, &faq_fixture()).await;
    let knowledge_base = crate::knowledge::records::get_knowledge_base(&harness.db, &knowledge_base_id).unwrap();

    let folder = tempfile::tempdir().unwrap();
    let bytes =
        std::fs::read(harness.service.export_agent_file(&agent.id, &folder.path().join("faq.grt")).unwrap()).unwrap();
    let (bundle, config) = bundle_knowledge(&bytes);
    assert_eq!(config["datasets"][0]["id"], knowledge_base.id.as_str());
    assert_eq!(config["datasets"][0]["chunking"]["max_chars"], 240);
    let store_path = config["stores"][knowledge_base.id.as_str()]["path"].as_str().unwrap();
    assert!(bundle.file(store_path).is_some_and(|store| !store.is_empty()), "the passages ship with it");

    // The agent without knowledge gets no knowledge config.
    let plain = harness.service.export_agent_file(&harness.agent.id, &folder.path().join("menu.grt")).unwrap();
    let plain =
        graphrt_bundle::Bundle::open(&std::fs::read(plain).unwrap(), &graphrt_bundle::OpenOptions::default()).unwrap();
    assert!(plain.knowledge_config().is_none());
}

#[tokio::test]
async fn a_chatbot_whose_flow_has_no_retrieval_step_ships_its_attached_knowledge_and_looks_it_up() {
    let harness = harness(FLOW);
    let (_, knowledge_base_id) = agent_with_knowledge(&harness, &faq_fixture()).await;
    let chatbot_id = harness.agent.id.clone();
    crate::chatbot_setup::attach_knowledge_base(&harness.db, &chatbot_id, &knowledge_base_id, &|_| Default::default())
        .unwrap();
    release_latest(&harness.db, &chatbot_id);

    let folder = tempfile::tempdir().unwrap();
    let bytes = std::fs::read(harness.service.export_agent_file(&chatbot_id, &folder.path().join("menu.grt")).unwrap())
        .unwrap();
    let (bundle, config) = bundle_knowledge(&bytes);
    assert_eq!(config["datasets"][0]["id"], knowledge_base_id.as_str(), "the attached knowledge ships with it");
    let workflow = String::from_utf8(bundle.file("workflow.yaml").unwrap().to_vec()).unwrap();
    assert!(workflow.contains(crate::chatbot_setup::overlay::ONLINE_KNOWLEDGE_STEP), "{workflow}");
    assert!(workflow.contains("{{#context#}}"), "{workflow}");
}

#[cfg(unix)]
#[tokio::test]
async fn going_online_ships_the_knowledge_bundle_and_refuses_knowledge_too_large() {
    let mut harness = harness(FLOW);
    let (agent, knowledge_base_id) = agent_with_knowledge(&harness, &faq_fixture()).await;
    // Indexed (with local embeddings) before any key exists.
    let big = harness._temp.path().join("big.md");
    let mut seed = 7u64;
    let words: Vec<String> = (0..300_000)
        .map(|_| {
            seed = seed.wrapping_mul(6364136223846793005).wrapping_add(1442695040888963407);
            format!("w{:x}", seed >> 40)
        })
        .collect();
    std::fs::write(&big, words.join(" ")).unwrap();
    let (big_agent, big_id) = agent_with_knowledge(&harness, &big).await;
    let big_sources = crate::knowledge::records::list_sources(&harness.db, &big_id).unwrap();
    assert!(big_sources[0].passage_count > 1000, "{big_sources:?}");
    let folder = tempfile::tempdir().unwrap();
    let shipped = folder.path().join("shipped");
    let script = format!(
        r#"for last in "$@"; do :; done
case "$2" in
  --help) ;;
  *)
    cp "$last" "{shipped}"
    echo "$last" > "{shipped}.name"
    echo '{{"type":"result","action":"deploy","url":"https://faq.fly.dev","version":"v1","app":"faq","workflow":"agent","api_key":"grk_once"}}'
    ;;
esac"#,
        shipped = shipped.display()
    );
    harness.service = harness.service.with_cli_executable(fake_cli(folder.path(), &script));
    harness.credentials.set_api_key(ModelProvider::Openai, "sk").unwrap();
    harness.credentials.set_deploy_secret("account:fly", r#"{"token":"t"}"#).unwrap();

    harness.service.deploy(&agent.id, fly_options(), &[], &ready_report()).await.unwrap();
    let name = std::fs::read_to_string(folder.path().join("shipped.name")).unwrap();
    assert!(name.trim().ends_with("agent.grt"), "{name}");
    let (bundle, config) = bundle_knowledge(&std::fs::read(&shipped).unwrap());
    assert_eq!(config["datasets"][0]["id"], knowledge_base_id.as_str());
    assert_eq!(config["datasets"][0]["chunking"]["max_chars"], 240);
    let store = config["stores"][knowledge_base_id.as_str()]["path"].as_str().unwrap();
    assert!(bundle.file(store).is_some_and(|bytes| !bytes.is_empty()));

    // "Make a new key" redeploys the same package.
    std::fs::remove_file(&shipped).unwrap();
    harness.service.rotate_api_key(&agent.id).await.unwrap();
    bundle_knowledge(&std::fs::read(&shipped).unwrap());

    // An agent without knowledge still ships plain YAML.
    release_latest(&harness.db, &harness.agent.id);
    harness.service.deploy(&harness.agent.id, fly_options(), &[], &ready_report()).await.unwrap();
    let name = std::fs::read_to_string(folder.path().join("shipped.name")).unwrap();
    assert!(name.trim().ends_with("agent.yaml"), "{name}");

    // graphrt tools that predate large agents: knowledge above 1 MB is refused before anything is sent.
    std::fs::remove_file(folder.path().join("shipped.name")).unwrap();
    let error = harness.service.deploy(&big_agent.id, fly_options(), &[], &ready_report()).await.unwrap_err();
    assert!(
        matches!(&error, AppError::InvalidInput(message) if message.contains("at most 1 MB") && message.contains("Update the graphrt tools")),
        "{error}"
    );
    assert!(!folder.path().join("shipped.name").exists(), "nothing was sent");

    // Tools that upload large agents onto the store volume get the whole knowledge, whatever its size.
    let newer = tempfile::tempdir().unwrap();
    let newer_script = script.replacen(
        "  --help) ;;",
        "  --help) echo 'Workflow file; with --direct also a bundle (.grt) of any size: above 1 MiB it is uploaded onto the store volume.' ;;",
        1,
    );
    harness.service = harness.service.with_cli_executable(fake_cli(newer.path(), &newer_script));
    harness.service.deploy(&big_agent.id, fly_options(), &[], &ready_report()).await.unwrap();
    let shipped_big = std::fs::read(&shipped).unwrap();
    assert!(shipped_big.len() > MAX_DEPLOY_FILE_BYTES, "{} bytes", shipped_big.len());
    let (bundle, config) = bundle_knowledge(&shipped_big);
    let store = config["datasets"][0]["store"].as_str().unwrap();
    let path = config["stores"][store]["path"].as_str().unwrap();
    assert!(bundle.file(path).is_some_and(|bytes| bytes.len() > 1024 * 1024), "every passage goes along");
}
