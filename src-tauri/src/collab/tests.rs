//! Several Graphrt Desktops (each its own database and keychain) against a real team
//! server in the test process: share, join, edit at the same time, offline edits, the
//! viewer, an outsider.

use std::sync::{Arc, Mutex};
use std::time::Duration;

use graphrt_collab::server::{CollabConfig, Options, Server};
use serde_json::{json, Value};

use super::session::local_project;
use super::*;
use crate::credentials::CredentialStore;
use crate::storage::models::{AgentKind, NewAgent};
use crate::storage::Database;

const FLOW: &str = r#"version: "1"
graph:
  nodes:
    - { id: start, type: start }
    - { id: llm, type: llm, prompt: "You answer support questions." }
    - { id: end, type: end }
  edges:
    - { source: start, target: llm }
    - { source: llm, target: end }
"#;

#[derive(Debug, Default)]
struct Recorder {
    changed: Mutex<Vec<String>>,
}

impl CollabEvents for Recorder {
    fn changed(&self, agent_id: &str) {
        self.changed.lock().unwrap().push(agent_id.to_owned());
    }

    fn agent(&self, _agent_id: &str) {}
}

struct Desktop {
    collab: Arc<Collab>,
    db: Arc<Database>,
}

fn desktop() -> Desktop {
    let db = Arc::new(Database::open_in_memory().unwrap());
    let collab =
        Arc::new(Collab::new(db.clone(), Arc::new(CredentialStore::in_memory()), Arc::new(Recorder::default())));
    Desktop { collab, db }
}

async fn start_server(name: &str) -> (String, Arc<Server>) {
    let dir = std::env::temp_dir().join(format!("graphrt-desktop-collab-{name}-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    let tcp = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let port = tcp.local_addr().unwrap().port();
    let yaml = format!("public_url: http://127.0.0.1:{port}\ndata_dir: {}\n", dir.display());
    let config: CollabConfig = graphrt_core::yaml::from_str(&yaml, true).unwrap();
    let server = Server::open(Options {
        config,
        signing_key: None,
        secrets_key: None,
        client_ids: Default::default(),
        client_secrets: Default::default(),
        verifiers: None,
    })
    .unwrap();
    let running = Arc::clone(&server);
    tokio::spawn(async move { graphrt_collab::server::http::serve_on(running, tcp, std::future::pending()).await });
    (format!("http://127.0.0.1:{port}"), server)
}

fn flow_of(db: &Database, agent_id: &str) -> Value {
    local_project(db, agent_id).unwrap()["flow"].clone()
}

async fn wait_until(what: &str, check: impl Fn() -> bool) {
    let deadline = tokio::time::Instant::now() + Duration::from_secs(15);
    while !check() {
        assert!(tokio::time::Instant::now() < deadline, "timed out waiting for {what}");
        tokio::time::sleep(Duration::from_millis(50)).await;
    }
}

async fn wait_connected(desktop: &Desktop, agent_id: &str) {
    wait_until("connected", || desktop.collab.agent_state(agent_id).unwrap().connection == "connected").await;
    // One poll after the first state arrived.
    tokio::time::sleep(super::session::POLL * 2).await;
}

/// Edit the local agent's workflow the way any screen of the app does: a new version.
fn edit_flow(db: &Database, agent_id: &str, change: impl FnOnce(&mut Value)) {
    let mut flow = flow_of(db, agent_id);
    change(&mut flow);
    db.update_agent_flow(agent_id, &serde_saphyr::to_string(&flow).unwrap(), "Edited here").unwrap();
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn two_desktops_build_one_agent_together() {
    let (url, server) = start_server("two").await;
    let (_, owner_code) = server.bootstrap_invite("Acme team", graphrt_console::Role::Owner, None, 24).unwrap();
    let link = format!("{url}/join#{owner_code}");

    // Desktop A: points at the team server, checks it, joins as the owner.
    let a = desktop();
    let check = a.collab.check(&url).await;
    assert!(check.ok, "{check:?}");
    assert!(check.sign_in_with_invite);
    assert!(check.sign_in_providers.is_empty(), "an invite only server has no provider buttons");
    let preview = a.collab.preview_invite(&link).await.unwrap();
    assert_eq!(preview["workspace"]["name"], "Acme team");
    let joined = a.collab.join(&link, Some("Ana")).await.unwrap();
    assert_eq!(a.collab.server(), url, "the invite link set the server");
    let ws = joined["workspace"]["id"].as_str().unwrap().to_owned();
    let status = a.collab.status().await.unwrap();
    assert!(status.signed_in);
    assert_eq!(status.account.unwrap()["name"], "Ana");

    // A shares a local agent.
    let agent_a =
        a.db.create_agent(NewAgent {
            name: "Support bot".into(),
            kind: AgentKind::Task,
            description: "Answers".into(),
            flow_yaml: FLOW.into(),
        })
        .unwrap()
        .id;
    let shared = a.collab.share(&agent_a, &ws).await.unwrap();
    assert!(shared.shared);
    let project = shared.link.unwrap().project_id;
    wait_connected(&a, &agent_a).await;

    // Desktop B joins with an edit invite and opens the shared agent.
    let invite = a.collab.invite(&ws, "operator").await.unwrap();
    let b = desktop();
    b.collab.join(invite["link"].as_str().unwrap(), Some("Budi")).await.unwrap();
    let agent_b = b.collab.open_project(&ws, &project).await.unwrap();
    assert_eq!(b.db.get_agent(&agent_b).unwrap().name, "Support bot");
    assert_eq!(flow_of(&b.db, &agent_b), flow_of(&a.db, &agent_a));
    wait_connected(&b, &agent_b).await;

    // Both see each other.
    wait_until("A sees Budi", || a.collab.agent_state(&agent_a).unwrap().people.iter().any(|p| p["name"] == "Budi"))
        .await;
    wait_until("B sees Ana", || b.collab.agent_state(&agent_b).unwrap().people.iter().any(|p| p["name"] == "Ana"))
        .await;

    // At the same time: A rewrites the prompt, B adds a step and renames the agent.
    edit_flow(&a.db, &agent_a, |flow| flow["graph"]["nodes"][1]["prompt"] = json!("You answer billing questions."));
    edit_flow(&b.db, &agent_b, |flow| {
        flow["graph"]["nodes"].as_array_mut().unwrap().insert(2, json!({ "id": "notify", "type": "http" }));
    });
    b.db.rename_agent(&agent_b, "Support and billing bot").unwrap();
    let converged = |db: &Database, agent: &str| {
        let project = local_project(db, agent).unwrap();
        project["name"] == "Support and billing bot"
            && project["flow"]["graph"]["nodes"][1]["prompt"] == "You answer billing questions."
            && project["flow"]["graph"]["nodes"][2]["id"] == "notify"
    };
    wait_until("A has both edits", || converged(&a.db, &agent_a)).await;
    wait_until("B has both edits", || converged(&b.db, &agent_b)).await;
    assert_eq!(local_project(&a.db, &agent_a).unwrap(), local_project(&b.db, &agent_b).unwrap());
    let versions = a.db.list_agent_versions(&agent_a).unwrap();
    assert!(versions.iter().any(|v| v.change_summary.starts_with("Edited by")), "{versions:?}");

    // Offline: B's session stops, B edits, A edits, B comes back: both edits stay.
    b.collab.stop(&agent_b);
    edit_flow(&b.db, &agent_b, |flow| flow["graph"]["nodes"][2]["url"] = json!("https://hooks.example.com/x"));
    edit_flow(&a.db, &agent_a, |flow| flow["graph"]["nodes"][0]["title"] = json!("When a ticket comes in"));
    b.collab.start_shared();
    let both = |db: &Database, agent: &str| {
        let flow = flow_of(db, agent);
        flow["graph"]["nodes"][2]["url"] == "https://hooks.example.com/x"
            && flow["graph"]["nodes"][0]["title"] == "When a ticket comes in"
    };
    wait_until("A has B's offline edit", || both(&a.db, &agent_a)).await;
    wait_until("B has A's edit", || both(&b.db, &agent_b)).await;

    // A viewer sees the agent and cannot change it: a local change is put back.
    let view = a.collab.invite(&ws, "viewer").await.unwrap();
    let c = desktop();
    c.collab.join(view["link"].as_str().unwrap(), Some("Citra")).await.unwrap();
    let agent_c = c.collab.open_project(&ws, &project).await.unwrap();
    wait_connected(&c, &agent_c).await;
    assert!(c.collab.agent_state(&agent_c).unwrap().read_only);
    edit_flow(&c.db, &agent_c, |flow| flow["graph"]["nodes"][1]["prompt"] = json!("Viewer was here"));
    wait_until("the viewer's edit is put back", || {
        flow_of(&c.db, &agent_c)["graph"]["nodes"][1]["prompt"] == "You answer billing questions."
    })
    .await;
    tokio::time::sleep(Duration::from_millis(500)).await;
    assert_eq!(flow_of(&a.db, &agent_a)["graph"]["nodes"][1]["prompt"], "You answer billing questions.");

    // An outsider (another team on the same server) cannot open it.
    let (_, other_code) = server.bootstrap_invite("Other team", graphrt_console::Role::Owner, None, 24).unwrap();
    let d = desktop();
    d.collab.join(&format!("{url}/join#{other_code}"), Some("Eve")).await.unwrap();
    assert!(matches!(d.collab.open_project(&ws, &project).await, Err(AppError::NotFound(_))));

    // Signing out stops syncing and keeps the local agent.
    b.collab.sign_out().await.unwrap();
    assert_eq!(b.collab.agent_state(&agent_b).unwrap().connection, "signed_out");
    assert!(b.db.get_agent(&agent_b).is_ok());
}

#[tokio::test]
async fn check_explains_what_is_wrong() {
    let collab = desktop().collab;
    let plain = collab.check("http://collab.example.com").await;
    assert_eq!(plain.problem, Some(ServerProblem::PlainHttp));
    let nothing = collab.check("http://127.0.0.1:9").await;
    assert_eq!(nothing.problem, Some(ServerProblem::Unreachable));
    let garbage = collab.check("ftp://x").await;
    assert_eq!(garbage.problem, Some(ServerProblem::Address));
    assert_eq!(
        server_of_link("https://collab.example.com/join#gci1.ws_x.y").as_deref(),
        Some("https://collab.example.com")
    );
    assert_eq!(server_of_link("gci1.ws_x.y"), None);
    assert_eq!(collab.server(), DEFAULT_SERVER);
}
