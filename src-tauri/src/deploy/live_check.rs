//! Checks against real programs, run by hand (`cargo test live_ -- --ignored --nocapture`):
//! the graphrt CLI and a running `graphrt serve` instead of the fakes of `tests.rs`. Nothing
//! here runs in CI. What each check needs is in its doc comment; the folder of
//! `GRAPHRT_LIVE_DIR` receives what the next step of a manual run uses.
//!
//! A full run, with `graphrt` built from a commit that has the chat page and the phone page:
//! 1. `live_export_for_own_server`: writes the agent file and the Docker instructions.
//! 2. Start `graphrt serve <dir>` with the variables of those instructions.
//! 3. `live_own_server_pairs_a_phone`: connects it, reads what is on, pairs, lists, shows the
//!    code again, removes the phone.
//! 4. `live_put_online_passes_the_choices`: deploys through the real CLI.

use std::path::PathBuf;
use std::sync::Arc;

use super::http::ReqwestDeployHttp;
use super::online::{ChatAudience, OnlineFeatures};
use super::phone::OnlineTarget;
use super::*;
use crate::storage::models::{AgentKind, NewAgent};

/// A chat agent: one model step that answers the person's message.
const CHAT_FLOW: &str = r#"
version: "1"
name: menu
graph:
  nodes:
    - id: start
      type: start
    - id: llm
      type: llm
      title: Answer
      model: { provider: openai, name: gpt-4o-mini }
      prompt_template:
        - { role: system, text: "You answer questions about a bakery's menu in one short sentence." }
        - { role: user, text: "{{#sys.query#}}" }
    - id: answer
      type: answer
      answer: "{{#llm.text#}}"
  edges:
    - { source: start, target: llm }
    - { source: llm, target: answer }
"#;

#[derive(Debug)]
struct NoEvents;

impl DeployEventSink for NoEvents {
    fn send(&self, _event: DeployEvent) {}
}

fn required(name: &str) -> String {
    std::env::var(name).unwrap_or_else(|_| panic!("set {name} for this check"))
}

fn live_dir() -> PathBuf {
    let dir = PathBuf::from(required("GRAPHRT_LIVE_DIR"));
    std::fs::create_dir_all(&dir).unwrap();
    dir
}

fn everything_on() -> OnlineFeatures {
    OnlineFeatures {
        chat: true,
        chat_audience: ChatAudience::Guests,
        embed_site: Some("https://www.example.com".into()),
        phone: true,
        notifications: true,
        notify_email: Some("owner@example.com".into()),
        answer_when_time_runs_out: true,
        whatsapp: false,
        teams: false,
    }
}

/// A service on an in-memory database and keychain, with the real HTTP client.
fn live_service(temp: &tempfile::TempDir) -> (DeployService, Arc<Database>, Arc<CredentialStore>, Agent) {
    let db = Arc::new(Database::open_in_memory().unwrap());
    let credentials = Arc::new(CredentialStore::in_memory());
    let agent = db
        .create_agent(NewAgent {
            name: "Menu questions chatbot".into(),
            kind: AgentKind::Chatbot,
            description: "Answers menu questions".into(),
            flow_yaml: CHAT_FLOW.into(),
        })
        .unwrap();
    let service = DeployService::new(DeployServiceConfig {
        app_data_dir: temp.path().to_path_buf(),
        db: db.clone(),
        credentials: credentials.clone(),
        downloader: None,
        http: Arc::new(ReqwestDeployHttp::new().unwrap()),
        events: Arc::new(NoEvents),
    });
    (service, db, credentials, agent)
}

/// Writes `<GRAPHRT_LIVE_DIR>/bundles/menu-questions-chatbot.grt` and `instructions.txt` (the
/// Docker command of "My own server" with everything turned on).
#[test]
#[ignore = "manual: writes the agent file and instructions for a real graphrt serve"]
fn live_export_for_own_server() {
    let temp = tempfile::tempdir().unwrap();
    let (service, _db, _credentials, agent) = live_service(&temp);
    let dir = live_dir();
    let bundles = dir.join("bundles");
    std::fs::create_dir_all(&bundles).unwrap();
    let stem = online::agent_file_stem(&agent.name);
    service.export_agent_file(&agent.id, &bundles.join(format!("{stem}.grt"))).unwrap();
    let instructions = service.own_server_instructions(&agent, &[], &everything_on()).unwrap();
    std::fs::write(dir.join("instructions.txt"), &instructions.command).unwrap();
    println!("{}", instructions.command);
    println!("chat page: {:?}\nphone page: {:?}", instructions.chat_address, instructions.phone_address);
}

/// Needs `GRAPHRT_LIVE_SERVER_URL` and `GRAPHRT_LIVE_SERVER_KEY` of a running `graphrt serve`
/// with the chat page and the phone page on. Writes the pairing link of a second phone to
/// `<GRAPHRT_LIVE_DIR>/pairing-link.txt` (a key of that test server only: delete it afterwards).
#[tokio::test]
#[ignore = "manual: needs a running graphrt serve"]
async fn live_own_server_pairs_a_phone() {
    let temp = tempfile::tempdir().unwrap();
    let (service, _db, credentials, _agent) = live_service(&temp);
    let url = required("GRAPHRT_LIVE_SERVER_URL");
    let server = service.connect_own_server("Test server", &url, &required("GRAPHRT_LIVE_SERVER_KEY")).await.unwrap();
    let target = OnlineTarget::Server { server_id: server.server.id.clone() };

    let live = service.live_features(&target).await.unwrap();
    println!("live: {live:?}");
    assert!(live.reachable);
    let chat = live.chat.expect("the chat page is on");
    assert_eq!(chat.audience, "guests");
    let phone = live.phone.expect("the phone page is on");
    assert!(phone.can_pair && phone.approvals && phone.notifications && phone.answers_when_time_runs_out);

    let first = service.pair_device(&target, "Check phone").await.unwrap();
    assert!(first.link.starts_with(&format!("{}/monitor/#pair=", url.trim_end_matches('/'))));
    let listed = service.list_devices(&target).await.unwrap();
    assert!(listed.iter().any(|device| device.id == first.device_id && device.can_show_code));
    assert_eq!(service.device_pairing(&target, &first.device_id).unwrap().link, first.link);
    let secret_name = format!("device:server:{}:{}", server.server.id, first.device_id);
    assert!(credentials.read_deploy_secret(&secret_name).unwrap().is_some());

    service.revoke_device(&target, &first.device_id).await.unwrap();
    let listed = service.list_devices(&target).await.unwrap();
    assert!(!listed.iter().any(|device| device.id == first.device_id), "the removed phone is gone on the server");
    assert!(credentials.read_deploy_secret(&secret_name).unwrap().is_none());

    // A second phone stays paired, for opening the phone page with its link in a browser.
    let second = service.pair_device(&target, "Browser at phone width").await.unwrap();
    std::fs::write(live_dir().join("pairing-link.txt"), &second.link).unwrap();
    println!("paired {} (link written to pairing-link.txt, not printed)", second.device_id);
    println!("chat link: {}\nwidget: {}", chat.link, chat.widget_snippet);
}

/// Needs `GRAPHRT_LIVE_CLI`: a `graphrt` executable (or a wrapper that points it at a test
/// Machines API), and `FLY_API_TOKEN` for it. Deploys with everything turned on, then again
/// with everything off.
#[cfg(unix)]
#[tokio::test]
#[ignore = "manual: needs the graphrt CLI and a Machines API to deploy to"]
async fn live_put_online_passes_the_choices() {
    let temp = tempfile::tempdir().unwrap();
    let (service, _db, credentials, agent) = live_service(&temp);
    let service = service.with_cli_executable(PathBuf::from(required("GRAPHRT_LIVE_CLI")));
    credentials.set_api_key(crate::credentials::ModelProvider::Openai, "sk-live-check-not-a-real-key").unwrap();
    let token = serde_json::json!({ "token": required("FLY_API_TOKEN") }).to_string();
    credentials.set_deploy_secret("account:fly", &token).unwrap();
    println!("the tools know the chat and phone pages: {}", service.cli_info().online_features);
    assert!(service.cli_info().online_features, "this graphrt is older than the chat page and the phone page");
    let report = CompatibilityReport { ready: true, items: Vec::new() };
    let options = |features: OnlineFeatures| DeployOptions {
        provider: DeployProvider::Fly,
        mode: DeployMode::ScaleToZero,
        area: ServerArea::Asia,
        image: None,
        features,
    };

    let on = service.deploy(&agent.id, options(everything_on()), &[], &report).await.unwrap();
    println!("online at {:?} as {:?}", on.view.deployment.url, on.view.deployment.deployed_version_label);
    assert!(on.api_key.is_some() && on.view.features.phone && on.view.features.chat);

    let off = service.deploy(&agent.id, options(OnlineFeatures::default()), &[], &report).await.unwrap();
    assert_eq!(off.view.features, OnlineFeatures::default());
    println!("updated to {:?} with everything off", off.view.deployment.deployed_version_label);
}
