//! The live session of one shared agent.
//!
//! The agent stays an ordinary local agent (SQLite: name, flow YAML, versions, node
//! layout), so every screen keeps working. The session maps it to the shared project
//! (sections `name`, `kind`, `description`, `flow`, `layout`) both ways:
//!
//! - **Local edits**: the agent is read again every [`POLL`] and, when it differs from
//!   what both sides last agreed on, the new JSON is sent as an edit (the CRDT turns it
//!   into the smallest change, so two people editing different steps, or typing in the
//!   same prompt, merge).
//! - **Edits of others**: written to the agent as a new version ("Edited by <names>"),
//!   the layout with it, then the UI is told to reload.
//! - **Offline**: the shared document is stored with the agent ([`super::AGENT_STATE`]),
//!   so what changed while offline merges on the next connection.
//! - **View only**: local changes are put back, with a message.

use std::sync::{Arc, Mutex, Weak};
use std::time::Duration;

use base64::engine::general_purpose::STANDARD;
use base64::Engine as _;
use graphrt_collab::client::{ClientError, LiveEvent, LiveOptions, LiveProject, TokenSource};
use graphrt_collab::ProjectDoc;
use serde_json::{json, Map, Value};
use tokio::sync::{mpsc, oneshot};

use super::{Collab, Link, AGENT_STATE, AGENT_SYNCED};
use crate::error::{AppError, AppResult};
use crate::storage::models::{AgentKind, NewAgent};
use crate::storage::node_layouts::NodeLayout;
use crate::storage::Database;

/// How often the local agent is compared with the shared one.
pub(crate) const POLL: Duration = Duration::from_millis(600);
/// How often the shared document is saved with the agent while it changes.
const SAVE_STATE_EVERY: Duration = Duration::from_secs(5);

/// What the agent's header shows.
#[derive(Debug, Clone, Default)]
pub struct Snapshot {
    pub connection: String,
    pub role: Option<String>,
    pub read_only: bool,
    pub people: Vec<Value>,
    pub message: Option<String>,
}

/// A running session.
#[derive(Debug)]
pub struct SessionHandle {
    stop: Mutex<Option<oneshot::Sender<()>>>,
    focus: mpsc::UnboundedSender<Option<String>>,
    snapshot: Arc<Mutex<Snapshot>>,
}

impl SessionHandle {
    pub fn snapshot(&self) -> Snapshot {
        self.snapshot.lock().map(|s| s.clone()).unwrap_or_default()
    }

    pub fn stop(&self) {
        if let Some(stop) = self.stop.lock().ok().and_then(|mut stop| stop.take()) {
            let _gone = stop.send(());
        }
    }

    pub fn focus(&self, node: Option<&str>) {
        let _gone = self.focus.send(node.map(str::to_owned));
    }
}

/// Start the session of `agent_id`.
pub(crate) fn spawn(collab: Weak<Collab>, agent_id: String, link: Link) -> SessionHandle {
    let (stop, stopped) = oneshot::channel();
    let (focus, focus_rx) = mpsc::unbounded_channel();
    let snapshot = Arc::new(Mutex::new(Snapshot { connection: "connecting".into(), ..Snapshot::default() }));
    let shared = Arc::clone(&snapshot);
    tauri::async_runtime::spawn(async move {
        if let Err(error) = run(collab, &agent_id, link, stopped, focus_rx, &shared).await {
            eprintln!("warning: collab: the session of {agent_id} ended: {error}");
            if let Ok(mut snapshot) = shared.lock() {
                snapshot.connection = "offline".into();
                snapshot.message = Some(error.to_string());
            }
        }
    });
    SessionHandle { stop: Mutex::new(Some(stop)), focus, snapshot }
}

fn update(snapshot: &Mutex<Snapshot>, change: impl FnOnce(&mut Snapshot)) {
    if let Ok(mut snapshot) = snapshot.lock() {
        change(&mut snapshot);
    }
}

async fn run(
    collab: Weak<Collab>,
    agent_id: &str,
    link: Link,
    mut stopped: oneshot::Receiver<()>,
    mut focus: mpsc::UnboundedReceiver<Option<String>>,
    snapshot: &Mutex<Snapshot>,
) -> AppResult<()> {
    let (db, events) = {
        let collab = collab.upgrade().ok_or_else(|| AppError::Internal("the app is closing".into()))?;
        (Arc::clone(&collab.db), Arc::clone(&collab.events))
    };
    let doc = match db.get_agent_setting(agent_id, AGENT_STATE)? {
        Some(Value::String(state)) => {
            STANDARD.decode(state).ok().and_then(|bytes| ProjectDoc::from_state(&bytes).ok()).unwrap_or_default()
        }
        _ => ProjectDoc::new(),
    };
    let workspace = link.workspace_id.clone();
    let source = Weak::clone(&collab);
    let token: TokenSource = Arc::new(move || {
        let collab = source.upgrade();
        let workspace = workspace.clone();
        Box::pin(async move {
            let collab = collab.ok_or(ClientError::Closed)?;
            collab.scoped(&workspace).await.map_err(|error| match error {
                AppError::Credentials(message) => ClientError::Http { status: 401, message },
                other => ClientError::Internal(other.to_string()),
            })
        })
    });
    let api_url = {
        let collab = collab.upgrade().ok_or_else(|| AppError::Internal("the app is closing".into()))?;
        collab.api()?.sync_url(&link.workspace_id, &link.project_id)
    };
    let (live, mut live_events) = LiveProject::start(
        doc,
        LiveOptions {
            url: api_url,
            token,
            renew_every: Duration::from_secs(240),
            max_backoff: Duration::from_secs(30),
        },
    );
    live.set_presence(json!({ "app": "desktop", "focus": Value::Null }));
    let mut synced = false;
    let mut read_only = false;
    let mut agreed: Value = db.get_agent_setting(agent_id, AGENT_SYNCED)?.unwrap_or(Value::Null);
    let mut poll = tokio::time::interval(POLL);
    let mut last_state_save = tokio::time::Instant::now();
    let mut state_dirty = false;
    let mut editors: Vec<String> = Vec::new();
    loop {
        tokio::select! {
            _ = &mut stopped => {
                live.close();
                save_state(&db, agent_id, &live)?;
                return Ok(());
            }
            node = focus.recv() => {
                let Some(node) = node else { continue };
                live.set_presence(json!({ "app": "desktop", "focus": node }));
            }
            event = live_events.recv() => {
                let Some(event) = event else { return Ok(()) };
                match event {
                    LiveEvent::Connected { you, read_only: viewer } => {
                        read_only = viewer;
                        update(snapshot, |s| {
                            s.connection = "connected".into();
                            s.role = Some(you.role.clone());
                            s.read_only = viewer;
                            s.message = None;
                        });
                        events.agent(agent_id);
                    }
                    LiveEvent::Synced(remote) => {
                        synced = true;
                        let local = local_project(&db, agent_id)?;
                        let edited_offline = agreed != Value::Null && local != agreed;
                        if edited_offline && !read_only {
                            // Edits made here while offline: they merge with what others did meanwhile.
                            send_local(&live, &agreed, &local).await?;
                            agreed = live.json();
                            apply_remote(&db, agent_id, &agreed, "the team")?;
                            agreed = local_project(&db, agent_id)?;
                        } else if remote != local {
                            apply_remote(&db, agent_id, &remote, "the team")?;
                            agreed = local_project(&db, agent_id)?;
                            events.changed(agent_id);
                        } else {
                            agreed = local;
                        }
                        db.set_agent_setting(agent_id, AGENT_SYNCED, &agreed)?;
                        state_dirty = true;
                    }
                    LiveEvent::Changed(_) => {
                        state_dirty = true;
                        if !synced {
                            continue;
                        }
                        // Local edits not sent yet go into the shared document first (only what
                        // changed here), so the write below does not replace them.
                        let local = local_project(&db, agent_id)?;
                        if local != agreed && !read_only {
                            send_local(&live, &agreed, &local).await?;
                        }
                        let merged = live.json();
                        let by = if editors.is_empty() { "the team".to_owned() } else { editors.join(", ") };
                        if apply_remote(&db, agent_id, &merged, &by)? {
                            events.changed(agent_id);
                        }
                        agreed = local_project(&db, agent_id)?;
                        db.set_agent_setting(agent_id, AGENT_SYNCED, &agreed)?;
                    }
                    LiveEvent::Presence(peers) => {
                        let people: Vec<Value> = dedupe_people(&peers);
                        editors = people.iter().filter_map(|p| p.get("name").and_then(Value::as_str).map(str::to_owned)).collect();
                        update(snapshot, |s| s.people = people);
                        events.agent(agent_id);
                    }
                    LiveEvent::Refused(reason) => {
                        update(snapshot, |s| s.message = Some(reason));
                        events.agent(agent_id);
                    }
                    LiveEvent::Role { role, read_only: viewer } => {
                        read_only = viewer;
                        update(snapshot, |s| {
                            s.role = Some(role);
                            s.read_only = viewer;
                        });
                        events.agent(agent_id);
                    }
                    LiveEvent::VersionSaved { .. } => {}
                    LiveEvent::Disconnected { reason, final_ } => {
                        synced = false;
                        update(snapshot, |s| {
                            s.connection = if final_ { "removed".into() } else { "offline".into() };
                            s.people.clear();
                            s.message = Some(reason);
                        });
                        events.agent(agent_id);
                        if final_ {
                            save_state(&db, agent_id, &live)?;
                            return Ok(());
                        }
                    }
                }
            }
            _ = poll.tick() => {
                if !synced {
                    continue;
                }
                let local = match local_project(&db, agent_id) {
                    Ok(local) => local,
                    // The agent was deleted here: stop.
                    Err(AppError::NotFound(_)) => {
                        live.close();
                        return Ok(());
                    }
                    Err(error) => return Err(error),
                };
                if local == agreed {
                    if state_dirty && last_state_save.elapsed() >= SAVE_STATE_EVERY {
                        save_state(&db, agent_id, &live)?;
                        state_dirty = false;
                        last_state_save = tokio::time::Instant::now();
                    }
                    continue;
                }
                if read_only {
                    apply_remote(&db, agent_id, &agreed, "the team")?;
                    update(snapshot, |s| s.message = Some("you can view this agent, not change it".into()));
                    events.changed(agent_id);
                    events.agent(agent_id);
                    continue;
                }
                send_local(&live, &agreed, &local).await?;
                let merged = live.json();
                if merged != local {
                    // Others changed something meanwhile: the local agent gets it too.
                    if apply_remote(&db, agent_id, &merged, "the team")? {
                        events.changed(agent_id);
                    }
                }
                agreed = local_project(&db, agent_id)?;
                db.set_agent_setting(agent_id, AGENT_SYNCED, &agreed)?;
                state_dirty = true;
            }
        }
    }
}

/// Send what changed here since `agreed` (only that), merged onto the shared document.
async fn send_local(live: &LiveProject, agreed: &Value, local: &Value) -> AppResult<()> {
    let merged = super::merge::merge3(agreed, local, &live.json());
    if let Value::Object(merged) = merged {
        live.edit(merged).await.map_err(|e| AppError::Internal(e.to_string()))?;
    }
    Ok(())
}

fn save_state(db: &Database, agent_id: &str, live: &LiveProject) -> AppResult<()> {
    match db.get_agent(agent_id) {
        Ok(_) => db.set_agent_setting(agent_id, AGENT_STATE, &Value::String(STANDARD.encode(live.state()))),
        Err(AppError::NotFound(_)) => Ok(()),
        Err(error) => Err(error),
    }
}

/// Everyone in the project once each: `{id, name, color, role, focus}`.
fn dedupe_people(peers: &[graphrt_collab::client::Peer]) -> Vec<Value> {
    let mut people: Vec<Value> = Vec::new();
    for peer in peers {
        let Some(person) = &peer.person else { continue };
        if people.iter().any(|p| p.get("id").and_then(Value::as_str) == Some(person.id.as_str())) {
            continue;
        }
        people.push(json!({
            "id": person.id,
            "name": person.name,
            "color": person.color,
            "role": person.role,
            "focus": peer.state.get("focus").cloned().unwrap_or(Value::Null),
        }));
    }
    people.sort_by(|a, b| a.get("name").and_then(Value::as_str).cmp(&b.get("name").and_then(Value::as_str)));
    people
}

/// A local agent as a shared project.
///
/// # Errors
/// `NotFound` when the agent was deleted, storage errors.
pub fn local_project(db: &Database, agent_id: &str) -> AppResult<Value> {
    let agent = db.get_agent(agent_id)?;
    let flow: Value = serde_saphyr::from_str(&agent.flow_yaml).unwrap_or(Value::Null);
    let layout = db.get_node_layout(agent_id, agent.current_version)?;
    let mut nodes = Map::new();
    for node in layout.nodes {
        let mut entry = Map::new();
        entry.insert("x".into(), json!(node.x));
        entry.insert("y".into(), json!(node.y));
        if let Some(width) = node.width {
            entry.insert("width".into(), json!(width));
        }
        if let Some(height) = node.height {
            entry.insert("height".into(), json!(height));
        }
        if node.collapsed {
            entry.insert("collapsed".into(), Value::Bool(true));
        }
        nodes.insert(node.node_id, Value::Object(entry));
    }
    // Numbers through JSON: 200.0 and 200 are the same position.
    Ok(normalize(json!({
        "name": agent.name,
        "kind": agent.kind,
        "description": agent.description,
        "flow": flow,
        "layout": nodes,
    })))
}

/// Whole floats as integers, as the shared document gives them back.
fn normalize(value: Value) -> Value {
    match value {
        Value::Number(number) => match number.as_f64() {
            Some(float) if number.is_f64() && float.fract() == 0.0 && float.abs() < 9e15 => json!(float as i64),
            _ => Value::Number(number),
        },
        Value::Array(items) => Value::Array(items.into_iter().map(normalize).collect()),
        Value::Object(map) => Value::Object(map.into_iter().map(|(k, v)| (k, normalize(v))).collect()),
        other => other,
    }
}

/// Write a shared project to the local agent.
///
/// @returns Whether anything changed.
pub fn apply_remote(db: &Database, agent_id: &str, remote: &Value, by: &str) -> AppResult<bool> {
    let local = local_project(db, agent_id)?;
    let mut changed = false;
    let new_name = remote.get("name").and_then(Value::as_str).filter(|name| !name.trim().is_empty());
    if let Some(name) = new_name.filter(|name| Some(*name) != local.get("name").and_then(Value::as_str)) {
        db.rename_agent(agent_id, name)?;
        changed = true;
    }
    if let Some(flow) = remote.get("flow").filter(|flow| flow.is_object() && Some(*flow) != local.get("flow")) {
        let yaml = serde_saphyr::to_string(flow)
            .map_err(|error| AppError::Workflow(format!("could not write the shared workflow: {error}")))?;
        let summary: String = format!("Edited by {by}").chars().take(120).collect();
        db.update_agent_flow(agent_id, &yaml, &summary)?;
        changed = true;
    }
    if let Some(Value::Object(layout)) = remote.get("layout") {
        let current = local_project(db, agent_id)?;
        if current.get("layout") != remote.get("layout") {
            let agent = db.get_agent(agent_id)?;
            let nodes: Vec<NodeLayout> = layout
                .iter()
                .filter_map(|(node_id, position)| {
                    Some(NodeLayout {
                        node_id: node_id.clone(),
                        x: position.get("x")?.as_f64()?,
                        y: position.get("y")?.as_f64()?,
                        width: position.get("width").and_then(Value::as_f64),
                        height: position.get("height").and_then(Value::as_f64),
                        collapsed: position.get("collapsed").and_then(Value::as_bool).unwrap_or(false),
                    })
                })
                .collect();
            db.save_node_layout(agent_id, agent.current_version, &nodes, None)?;
            changed = true;
        }
    }
    Ok(changed)
}

/// A new local agent from a shared project.
///
/// @returns Its id.
pub fn create_local(db: &Database, content: &Value, name: Option<&str>) -> AppResult<String> {
    let flow = content.get("flow").filter(|f| f.is_object()).ok_or_else(|| {
        AppError::InvalidInput("this shared project has no workflow yet: ask its owner to open it once".into())
    })?;
    let flow_yaml = serde_saphyr::to_string(flow)
        .map_err(|error| AppError::Workflow(format!("could not write the shared workflow: {error}")))?;
    let kind: AgentKind =
        content.get("kind").cloned().and_then(|k| serde_json::from_value(k).ok()).unwrap_or(AgentKind::Task);
    let name = content.get("name").and_then(Value::as_str).or(name).unwrap_or("Shared agent").to_owned();
    let description = content.get("description").and_then(Value::as_str).unwrap_or("").to_owned();
    let agent = db.create_agent(NewAgent { name, kind, description, flow_yaml })?;
    apply_remote(db, &agent.id, content, "the team")?;
    Ok(agent.id)
}
