//! Phone access end to end on a loopback port: pairing, what a device token may read and
//! answer, the Host and Origin checks, and the rate limits.

use std::net::SocketAddr;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Arc;
use std::time::Duration;

use graphrt_llm::mock::MockModel;
use graphrt_llm::{ChatModel, ModelRegistry};
use serde_json::{json, Value as Json};
use tokio::io::{AsyncReadExt, AsyncWriteExt};

use super::*;
use crate::credentials::{CredentialStore, ModelProvider};
use crate::engine::{ModelRegistrySource, RunEventPayload, RunEventSink};
use crate::storage::models::{AgentKind, NewAgent, RunStatus, RunTrigger};

/// llm + human-input, as in the engine tests.
const DRAFT_AND_APPROVE: &str = r#"
version: "1"
name: draft-and-approve
graph:
  nodes:
    - id: start
      type: start
      variables:
        - { variable: topic, type: text-input, required: true }
    - id: draft_message
      type: llm
      model: { provider: openai, name: gpt-4o-mini }
      prompt_template:
        - { role: user, text: "Write about {{#start.topic#}}" }
    - id: approve_message
      type: human-input
      prompt: "Send this?\n\n{{#draft_message.text#}}"
      actions:
        - { id: approve, title: Approve }
        - { id: reject, title: Reject }
    - id: end
      type: end
      outputs:
        - { variable: message, value_selector: [draft_message, text] }
        - { variable: decision, value_selector: [approve_message, action] }
  edges:
    - { source: start, target: draft_message }
    - { source: draft_message, target: approve_message }
    - { source: approve_message, target: end, handle: approve }
"#;

#[derive(Debug, Default)]
struct CountingEvents(AtomicUsize);

impl PhoneAccessEvents for CountingEvents {
    fn changed(&self) {
        self.0.fetch_add(1, Ordering::SeqCst);
    }
}

#[derive(Debug, Default)]
struct NoSink;

impl RunEventSink for NoSink {
    fn send(&self, _payload: RunEventPayload) {}
}

#[derive(Debug)]
struct FixedModel(Arc<dyn ChatModel>);

impl ModelRegistrySource for FixedModel {
    fn build_registry(&self, _credentials: &CredentialStore, _db: &Database) -> AppResult<ModelRegistry> {
        Ok(ModelRegistry::new().with("openai", self.0.clone()))
    }
}

struct Rig {
    _dir: tempfile::TempDir,
    db: Arc<Database>,
    runs: Arc<RunManager>,
    access: Arc<PhoneAccess>,
    events: Arc<CountingEvents>,
    address: SocketAddr,
    agent_id: String,
}

async fn rig(answers: &[&str]) -> Rig {
    let dir = tempfile::tempdir().unwrap();
    let db = Arc::new(Database::open_in_memory().unwrap());
    let credentials = Arc::new(CredentialStore::in_memory());
    credentials.set_api_key(ModelProvider::Openai, "sk-test").unwrap();
    let model = Arc::new(MockModel::new(answers.iter().map(|answer| MockModel::text(answer)).collect()));
    let runs = Arc::new(
        RunManager::new(db.clone(), credentials, Arc::new(NoSink))
            .with_model_registry_source(Arc::new(FixedModel(model))),
    );
    let events = Arc::new(CountingEvents::default());
    let access = Arc::new(PhoneAccess::new(db.clone(), dir.path(), events.clone()));
    access.attach(runs.clone());
    let address = access.serve_on_loopback().await;
    let agent = db
        .create_agent(NewAgent {
            name: "Offers".into(),
            kind: AgentKind::Task,
            description: "test".into(),
            flow_yaml: DRAFT_AND_APPROVE.into(),
        })
        .unwrap();
    Rig { _dir: dir, db, runs, access, events, address, agent_id: agent.id }
}

/// One HTTP/1.1 request; the answer's status and body (de-chunked).
async fn request(
    address: SocketAddr,
    method: &str,
    path: &str,
    headers: &[(&str, &str)],
    body: Option<&str>,
) -> (u16, String) {
    let mut stream = tokio::net::TcpStream::connect(address).await.unwrap();
    let mut text = format!("{method} {path} HTTP/1.1\r\nConnection: close\r\n");
    if !headers.iter().any(|(name, _)| name.eq_ignore_ascii_case("host")) {
        text.push_str(&format!("Host: {address}\r\n"));
    }
    for (name, value) in headers {
        text.push_str(&format!("{name}: {value}\r\n"));
    }
    if let Some(body) = body {
        text.push_str(&format!("Content-Type: application/json\r\nContent-Length: {}\r\n", body.len()));
    }
    text.push_str("\r\n");
    text.push_str(body.unwrap_or_default());
    stream.write_all(text.as_bytes()).await.unwrap();
    let mut answer = Vec::new();
    tokio::time::timeout(Duration::from_secs(10), stream.read_to_end(&mut answer)).await.unwrap().unwrap();
    let answer = String::from_utf8_lossy(&answer).into_owned();
    let (head, body) = answer.split_once("\r\n\r\n").unwrap_or((&answer, ""));
    let status = head.split(' ').nth(1).and_then(|code| code.parse().ok()).unwrap_or(0);
    let body =
        if head.to_ascii_lowercase().contains("transfer-encoding: chunked") { dechunk(body) } else { body.to_owned() };
    (status, body)
}

fn dechunk(mut body: &str) -> String {
    let mut out = String::new();
    while let Some((size, rest)) = body.split_once("\r\n") {
        let Ok(size) = usize::from_str_radix(size.trim(), 16) else { break };
        if size == 0 || rest.len() < size {
            break;
        }
        out.push_str(&rest[..size]);
        body = rest[size..].trim_start_matches("\r\n");
    }
    out
}

async fn get(rig: &Rig, path: &str, token: &str) -> (u16, Json) {
    let bearer = format!("Bearer {token}");
    let (status, body) = request(rig.address, "GET", path, &[("Authorization", &bearer)], None).await;
    (status, serde_json::from_str(&body).unwrap_or(Json::Null))
}

async fn post(rig: &Rig, path: &str, token: &str, body: &Json) -> (u16, Json) {
    let bearer = format!("Bearer {token}");
    let (status, answer) =
        request(rig.address, "POST", path, &[("Authorization", &bearer)], Some(&body.to_string())).await;
    (status, serde_json::from_str(&answer).unwrap_or(Json::Null))
}

/// Pairs a phone the way its pairing page does; returns the device token.
async fn pair_phone(rig: &Rig, name: &str) -> String {
    let pairing = rig.access.pair(name).await.unwrap();
    let code = pairing.link.split_once("/pair#").unwrap().1.to_owned();
    assert!(pairing.link.starts_with(&format!("http://{}", rig.address)));
    let (status, body) =
        request(rig.address, "POST", "/v1/pair", &[], Some(&json!({ "code": code }).to_string())).await;
    assert_eq!(status, 201, "{body}");
    let body: Json = serde_json::from_str(&body).unwrap();
    body["token"].as_str().unwrap().to_owned()
}

async fn wait_for(db: &Database, run_id: &str, status: RunStatus) {
    for _ in 0..200 {
        if db.get_run(run_id).unwrap().status == status {
            return;
        }
        tokio::time::sleep(Duration::from_millis(25)).await;
    }
    panic!("run {run_id} never reached {status:?}");
}

#[tokio::test]
async fn a_phone_pairs_once_with_a_code_and_is_removed_for_good() {
    let rig = rig(&[]).await;
    let pairing = rig.access.pair("Ana's phone").await.unwrap();
    let code = pairing.link.split_once("/pair#").unwrap().1.to_owned();
    let body = json!({ "code": code }).to_string();
    let (status, answer) = request(rig.address, "POST", "/v1/pair", &[], Some(&body)).await;
    assert_eq!(status, 201, "{answer}");
    let token = serde_json::from_str::<Json>(&answer).unwrap()["token"].as_str().unwrap().to_owned();
    assert!(token.starts_with("grd1."));
    // The same code again pairs nothing.
    assert_eq!(request(rig.address, "POST", "/v1/pair", &[], Some(&body)).await.0, 410);

    let (status, me) = get(&rig, "/v1/devices/me", &token).await;
    assert_eq!(status, 200);
    assert_eq!(me["name"], "Ana's phone");
    assert_eq!(me["scopes"], json!(["runs:read", "approvals:resolve"]));
    let devices = rig.access.list_devices().unwrap();
    assert_eq!(devices.len(), 1);
    assert!(!devices[0].can_show_code);
    assert!(rig.events.0.load(Ordering::SeqCst) >= 1);

    rig.access.revoke(&devices[0].id).unwrap();
    assert_eq!(get(&rig, "/v1/devices/me", &token).await.0, 401);
    assert_eq!(get(&rig, "/v1/runs", &token).await.0, 401);
    assert!(rig.access.list_devices().unwrap().is_empty());
    let kinds: Vec<ActivityKind> = rig.access.activity(10).unwrap().into_iter().map(|entry| entry.kind).collect();
    assert_eq!(kinds, [ActivityKind::Removed, ActivityKind::PairingRefused, ActivityKind::Paired]);
}

#[tokio::test]
async fn a_phone_unpairs_itself() {
    let rig = rig(&[]).await;
    let token = pair_phone(&rig, "Phone").await;
    let bearer = format!("Bearer {token}");
    assert_eq!(request(rig.address, "DELETE", "/v1/devices/me", &[("Authorization", &bearer)], None).await.0, 204);
    assert_eq!(get(&rig, "/v1/devices/me", &token).await.0, 401);
}

#[tokio::test]
async fn requests_for_other_names_or_from_other_sites_are_refused() {
    let rig = rig(&[]).await;
    let token = pair_phone(&rig, "Phone").await;
    let bearer = format!("Bearer {token}");
    let (status, _) =
        request(rig.address, "GET", "/v1/runs", &[("Host", "evil.example:47613"), ("Authorization", &bearer)], None)
            .await;
    assert_eq!(status, 421);
    let (status, _) = request(
        rig.address,
        "GET",
        "/v1/runs",
        &[("Origin", "https://evil.example"), ("Authorization", &bearer)],
        None,
    )
    .await;
    assert_eq!(status, 403);
    let origin = format!("http://{}", rig.address);
    let (status, _) =
        request(rig.address, "GET", "/v1/runs", &[("Origin", &origin), ("Authorization", &bearer)], None).await;
    assert_eq!(status, 200);
    // The page itself is public, with its policy.
    let (status, page) = request(rig.address, "GET", "/monitor/", &[], None).await;
    assert_eq!(status, 200);
    assert!(page.contains("monitor.js"));
    assert_eq!(request(rig.address, "GET", "/monitor/monitor.js", &[], None).await.0, 200);
    assert_eq!(request(rig.address, "GET", "/pair", &[], None).await.0, 200);
    let (status, config) = request(rig.address, "GET", "/v1/monitor/config", &[], None).await;
    assert_eq!(status, 200);
    assert_eq!(serde_json::from_str::<Json>(&config).unwrap()["access"], "key");
}

#[tokio::test]
async fn guessing_tokens_or_codes_is_slowed_down() {
    let rig = rig(&[]).await;
    let mut statuses = Vec::new();
    for _ in 0..25 {
        statuses.push(get(&rig, "/v1/runs", "grd1.dev-0000.not-a-secret").await.0);
    }
    assert_eq!(statuses[0], 401);
    assert_eq!(statuses.last(), Some(&429));
    let mut codes = Vec::new();
    for _ in 0..7 {
        let body = json!({ "code": "grp1.made-up-code-that-is-long-enough" }).to_string();
        codes.push(request(rig.address, "POST", "/v1/pair", &[], Some(&body)).await.0);
    }
    assert_eq!(codes[0], 410);
    assert_eq!(codes.last(), Some(&429));
    // An API key or anything else that is not a device token never gets in.
    assert_eq!(get(&rig, "/v1/approvals", "sk-the-owners-model-key").await.0, 429);
}

#[tokio::test]
async fn a_phone_follows_a_paused_run_and_approves_it() {
    let rig = rig(&["Hello cafe!"]).await;
    let token = pair_phone(&rig, "Phone").await;
    let run = rig.runs.start_run(&rig.agent_id, RunTrigger::Manual, json!({"topic": "coffee"})).await.unwrap();
    wait_for(&rig.db, &run.id, RunStatus::Paused).await;
    // A test run of the builder is not for phones.
    let test_run = rig.db.insert_run(&rig.agent_id, 1, RunTrigger::Test).unwrap();

    let (status, page) = get(&rig, "/v1/runs?limit=10", &token).await;
    assert_eq!(status, 200);
    let runs = page["runs"].as_array().unwrap();
    assert_eq!(runs.len(), 1);
    assert_eq!(runs[0]["workflow"], "Offers");
    assert_eq!(runs[0]["status"], "paused");
    assert_eq!(runs[0]["resume_inputs"][0]["key"], "approve_message");
    assert_eq!(get(&rig, &format!("/v1/runs/{}", test_run.id), &token).await.0, 404);
    assert_eq!(get(&rig, "/v1/runs?status=sleeping", &token).await.0, 400);

    let (status, inbox) = get(&rig, "/v1/approvals", &token).await;
    assert_eq!(status, 200);
    assert_eq!(inbox["expiry_enforced"], true);
    assert_eq!(inbox["approvals"][0]["run_id"], run.id.as_str());
    assert_eq!(inbox["approvals"][0]["requests"][0]["kind"], "human_input");

    // A phone cannot stop runs, and answers only what is asked.
    assert_eq!(post(&rig, &format!("/v1/runs/{}/abort", run.id), &token, &json!({})).await.0, 403);
    let wrong = json!({"inputs": {"other_node": {"action": "approve"}}});
    assert_eq!(post(&rig, &format!("/v1/approvals/{}", run.id), &token, &wrong).await.0, 400);

    let answer = json!({"inputs": {"approve_message": {"action": "approve", "values": {}}}});
    let (status, accepted) = post(&rig, &format!("/v1/approvals/{}", run.id), &token, &answer).await;
    assert_eq!(status, 202, "{accepted}");
    assert_eq!(accepted["status"], "running");
    assert!(accepted["first_event"].as_u64().unwrap() > 0);
    wait_for(&rig.db, &run.id, RunStatus::Succeeded).await;
    // One answer wins.
    assert_eq!(post(&rig, &format!("/v1/approvals/{}", run.id), &token, &answer).await.0, 409);

    let (status, record) = get(&rig, &format!("/v1/runs/{}", run.id), &token).await;
    assert_eq!(status, 200);
    assert_eq!(record["status"], "succeeded");
    assert_eq!(record["answer"], "Hello cafe!");
    let (status, events) = get(&rig, &format!("/v1/runs/{}/events?stream=false", run.id), &token).await;
    assert_eq!(status, 200);
    let types: Vec<&str> = events.as_array().unwrap().iter().filter_map(|event| event["type"].as_str()).collect();
    assert_eq!(types.first(), Some(&"run_started"));
    assert_eq!(types.last(), Some(&"run_succeeded"));
    let (status, later) = get(&rig, &format!("/v1/runs/{}/events?stream=false&from=2", run.id), &token).await;
    assert_eq!(status, 200);
    assert_eq!(later.as_array().unwrap().len() + 2, types.len());

    // Following the finished run streams its events and ends with the terminal one.
    let bearer = format!("Bearer {token}");
    let (status, stream) =
        request(rig.address, "GET", &format!("/v1/runs/{}/events", run.id), &[("Authorization", &bearer)], None).await;
    assert_eq!(status, 200);
    assert!(stream.contains("event: run_started"));
    assert!(stream.contains("event: run_paused"));
    assert!(!stream.contains("event: run_succeeded"), "the stream ends at the first pause: {stream}");
    let (_, resumed) = request(
        rig.address,
        "GET",
        &format!("/v1/runs/{}/events", run.id),
        &[("Authorization", &bearer), ("Last-Event-ID", &(accepted["first_event"].as_u64().unwrap() - 1).to_string())],
        None,
    )
    .await;
    assert!(resumed.contains("event: run_succeeded"));
    assert!(!resumed.contains("event: run_paused"));

    let activity = rig.access.activity(1).unwrap();
    assert_eq!(activity[0].kind, ActivityKind::Answered);
    assert_eq!(activity[0].agent_name.as_deref(), Some("Offers"));
}

#[tokio::test]
async fn push_subscriptions_belong_to_their_phone() {
    let rig = rig(&[]).await;
    let token = pair_phone(&rig, "Phone").await;
    let (status, info) = get(&rig, "/v1/push", &token).await;
    assert_eq!(status, 200);
    assert!(info["public_key"].as_str().unwrap().len() > 80);
    let bad = json!({"endpoint": "http://127.0.0.1/push", "keys": {"p256dh": "x", "auth": "y"}});
    assert_eq!(post(&rig, "/v1/push/subscriptions", &token, &bad).await.0, 400);
    assert_eq!(post(&rig, "/v1/push/test", &token, &json!({"endpoint": "https://push.example/none"})).await.0, 404);
}

#[tokio::test]
async fn pairing_needs_a_running_server_and_a_name() {
    let dir = tempfile::tempdir().unwrap();
    let db = Arc::new(Database::open_in_memory().unwrap());
    let access = PhoneAccess::new(db, dir.path(), Arc::new(CountingEvents::default()));
    assert!(matches!(access.pair("Phone").await, Err(AppError::InvalidInput(_))));
    assert!(matches!(access.pair("  ").await, Err(AppError::InvalidInput(_))));
    // Nothing is created before the person turns it on.
    assert!(!dir.path().join(DIR_NAME).exists());
}

#[tokio::test]
async fn settings_are_saved_and_checked() {
    let dir = tempfile::tempdir().unwrap();
    let db = Arc::new(Database::open_in_memory().unwrap());
    let access = PhoneAccess::new(db, dir.path(), Arc::new(CountingEvents::default()));
    assert_eq!(access.settings(), PhoneAccessSettings::default());
    assert!(!access.settings().enabled);
    let tunnel = PhoneAccessSettings {
        enabled: false,
        reach: Reach::Tunnel { public_url: " https://Agents.Example.com/ ".into() },
        port: DEFAULT_PORT,
    };
    let status = access.save(tunnel).await.unwrap();
    assert_eq!(status.settings.reach, Reach::Tunnel { public_url: "https://agents.example.com".into() });
    assert!(!status.serving);
    let plain = PhoneAccessSettings {
        reach: Reach::Tunnel { public_url: "http://agents.example.com".into() },
        ..PhoneAccessSettings::default()
    };
    assert!(matches!(access.save(plain).await, Err(AppError::InvalidInput(_))));
    let low_port = PhoneAccessSettings { port: 80, ..PhoneAccessSettings::default() };
    assert!(matches!(access.save(low_port).await, Err(AppError::InvalidInput(_))));
}

#[test]
fn tailscale_serves_https_only_with_certificates() {
    let mut info = TailscaleInfo {
        installed: true,
        running: true,
        dns_name: Some("laptop.tail0f0add.ts.net".into()),
        address: Some(Ipv4Addr::new(100, 79, 4, 107)),
        magic_dns: true,
        https_certificates: true,
    };
    let plan = tailscale_plan(&info, 47613).unwrap();
    assert_eq!(plan.address, "https://laptop.tail0f0add.ts.net:47613");
    assert_eq!(plan.bind, SocketAddr::from(([127, 0, 0, 1], 47613)));
    assert!(plan.secure && plan.tailscale_serve);

    info.https_certificates = false;
    let plan = tailscale_plan(&info, 47613).unwrap();
    assert_eq!(plan.address, "http://laptop.tail0f0add.ts.net:47613");
    assert_eq!(plan.bind, SocketAddr::from(([100, 79, 4, 107], 47613)));
    assert!(!plan.secure && !plan.tailscale_serve);
    assert!(plan.notice.unwrap().contains("HTTPS Certificates"));
    assert_eq!(plan.base_urls, ["http://100.79.4.107:47613", "http://laptop.tail0f0add.ts.net:47613"]);

    info.address = None;
    assert!(tailscale_plan(&info, 47613).is_err());
}

#[test]
fn a_tunnel_address_is_an_https_origin() {
    assert_eq!(tunnel_origin("https://agents.example.com").unwrap(), "https://agents.example.com");
    assert_eq!(tunnel_origin("https://agents.example.com:8443/").unwrap(), "https://agents.example.com:8443");
    for invalid in [
        "http://agents.example.com",
        "https://agents.example.com/monitor",
        "agents.example.com",
        "https://user@agents.example.com",
    ] {
        assert!(tunnel_origin(invalid).is_err(), "{invalid}");
    }
}
