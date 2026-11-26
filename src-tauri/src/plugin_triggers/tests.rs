//! Subscriptions, the watch output contract and one watch call with a fake plugin.

use std::sync::Mutex;

use serde_json::json;

use super::*;
use crate::storage::models::{AgentKind, NewAgent};

fn agent(db: &Database, name: &str, status: AgentStatus) -> Agent {
    let agent = db
        .create_agent(NewAgent {
            name: name.into(),
            kind: AgentKind::Task,
            description: "notes".into(),
            flow_yaml: "nodes: []".into(),
        })
        .expect("agent");
    if status != AgentStatus::Draft {
        db.set_agent_status(&agent.id, status).expect("status");
    }
    db.get_agent(&agent.id).expect("agent")
}

fn recorded() -> TriggerRef {
    TriggerRef { plugin: "meeting-notes".into(), trigger: "meeting_recorded".into() }
}

fn object(value: Value) -> Map<String, Value> {
    value.as_object().cloned().expect("object")
}

#[test]
fn choosing_a_trigger_activates_the_agent_and_clearing_it_keeps_the_status() {
    let db = Database::open_in_memory().expect("db");
    let draft = agent(&db, "Meeting notes", AgentStatus::Draft);
    save_subscription(&db, &draft.id, Some(&recorded())).expect("save");
    assert_eq!(db.get_agent(&draft.id).expect("agent").status, AgentStatus::Active);
    assert_eq!(load_subscription(&db, &draft.id).expect("load"), Some(recorded()));

    save_subscription(&db, &draft.id, None).expect("clear");
    assert_eq!(load_subscription(&db, &draft.id).expect("load"), None);
    assert_eq!(db.get_agent(&draft.id).expect("agent").status, AgentStatus::Active);
    assert!(save_subscription(&db, "missing", Some(&recorded())).is_err());
}

#[test]
fn only_tested_or_active_agents_subscribe() {
    let db = Database::open_in_memory().expect("db");
    let active = agent(&db, "Notes to Notion", AgentStatus::Draft);
    let paused = agent(&db, "Paused", AgentStatus::Draft);
    let other = agent(&db, "Files", AgentStatus::Draft);
    save_subscription(&db, &active.id, Some(&recorded())).expect("save");
    save_subscription(&db, &paused.id, Some(&recorded())).expect("save");
    let files = TriggerRef { plugin: "file-watcher".into(), trigger: "file_added".into() };
    save_subscription(&db, &other.id, Some(&files)).expect("save");
    db.set_agent_status(&paused.id, AgentStatus::Paused).expect("pause");

    let names: Vec<String> = subscribers(&db, &recorded()).expect("list").into_iter().map(|agent| agent.name).collect();
    assert_eq!(names, ["Notes to Notion"]);
    assert_eq!(wanted_triggers(&db).expect("wanted"), BTreeSet::from([recorded(), files]));
}

#[test]
fn reads_watch_outputs_at_the_top_level_or_under_data() {
    let top = parse_watch_outputs(&object(json!({"events": [{"a": 1}], "cursor": "c1"}))).expect("parses");
    assert_eq!((top.events.len(), top.cursor.as_deref()), (1, Some("c1")));

    let plugin_shape = object(
        json!({"data": {"events": [{"meeting_id": "m1"}, {"meeting_id": "m2"}], "cursor": "c2"}, "next_cursor": null}),
    );
    let nested = parse_watch_outputs(&plugin_shape).expect("parses");
    assert_eq!(nested.events[1]["meeting_id"], "m2");
    assert_eq!(nested.cursor.as_deref(), Some("c2"));

    let next_cursor =
        parse_watch_outputs(&object(json!({"data": {"events": []}, "next_cursor": "c3"}))).expect("parses");
    assert_eq!(next_cursor.cursor.as_deref(), Some("c3"));
    assert_eq!(parse_watch_outputs(&object(json!({"events": [], "cursor": ""}))).expect("parses").cursor, None);

    assert!(parse_watch_outputs(&object(json!({"data": {"rows": []}}))).is_err());
    assert!(parse_watch_outputs(&object(json!({"events": [1]}))).is_err());
}

#[test]
fn watch_config_carries_the_cursor() {
    assert_eq!(
        watch_config(&json!({"timeout_seconds": 240}), Some("c1")),
        json!({"timeout_seconds": 240, "cursor": "c1"})
    );
    assert_eq!(watch_config(&json!({"cursor": "stale"}), None), json!({}));
}

#[test]
fn backs_off_up_to_five_minutes() {
    assert_eq!(backoff_after(1), Duration::from_secs(5));
    assert_eq!(backoff_after(2), Duration::from_secs(10));
    assert_eq!(backoff_after(4), Duration::from_secs(40));
    assert_eq!(backoff_after(30), Duration::from_secs(300));
}

/// A plugin with the `meeting_recorded` trigger whose watch step returns `responses` in turn.
#[derive(Debug, Default)]
struct FakeHost {
    ready: bool,
    responses: Mutex<Vec<AppResult<Map<String, Value>>>>,
    calls: Mutex<Vec<(String, String, Value)>>,
}

impl TriggerHost for FakeHost {
    fn available(&self) -> Vec<AvailableTrigger> {
        vec![AvailableTrigger {
            plugin: "meeting-notes".into(),
            plugin_display_name: "Meeting Notes".into(),
            trigger: "meeting_recorded".into(),
            title: "When a meeting is recorded".into(),
            description: String::new(),
            event_fields: vec!["meeting_id".into()],
            problem: (!self.ready).then(|| "trust meeting-notes".into()),
        }]
    }

    fn watch_step(&self, trigger: &TriggerRef) -> Option<(String, Value)> {
        (self.ready && *trigger == recorded())
            .then(|| ("meeting-notes.wait_for_recording_end".into(), json!({"timeout_seconds": 240})))
    }

    fn call(&self, plugin: &str, kind: &str, config: Value) -> BoxFuture<'_, AppResult<Map<String, Value>>> {
        self.calls.lock().expect("lock").push((plugin.into(), kind.into(), config));
        let response = self.responses.lock().expect("lock").remove(0);
        Box::pin(async move { response })
    }
}

#[derive(Debug, Default)]
struct FakeRuns {
    started: Mutex<Vec<(String, Value)>>,
}

impl TriggerRunStarter for FakeRuns {
    fn start<'a>(&'a self, agent_id: &'a str, inputs: Value) -> BoxFuture<'a, AppResult<String>> {
        let mut started = self.started.lock().expect("lock");
        started.push((agent_id.to_owned(), inputs));
        let run_id = format!("run-{}", started.len());
        Box::pin(async move { Ok(run_id) })
    }
}

fn service(
    ready: bool,
    responses: Vec<AppResult<Map<String, Value>>>,
) -> (Arc<Database>, Arc<FakeHost>, Arc<FakeRuns>, PluginTriggerService) {
    let db = Arc::new(Database::open_in_memory().expect("db"));
    let host = Arc::new(FakeHost { ready, responses: Mutex::new(responses), ..FakeHost::default() });
    let runs = Arc::new(FakeRuns::default());
    let service = PluginTriggerService::new(db.clone(), host.clone(), runs.clone());
    (db, host, runs, service)
}

#[tokio::test]
async fn each_event_starts_every_subscribed_agent_and_the_cursor_is_kept() {
    let first =
        object(json!({"data": {"events": [{"meeting_id": "m1", "meeting_title": "Zoom meeting"}], "cursor": "c1"}}));
    let second = object(json!({"data": {"events": [], "cursor": "c2"}}));
    let (db, host, runs, service) = service(true, vec![Ok(first), Ok(second)]);
    let notion = agent(&db, "Notes to Notion", AgentStatus::Draft);
    let slack = agent(&db, "Notes to Slack", AgentStatus::Draft);
    agent(&db, "Unrelated", AgentStatus::Active);
    service.set_subscription(&notion.id, Some(recorded())).expect("subscribe");
    service.set_subscription(&slack.id, Some(recorded())).expect("subscribe");

    assert_eq!(service.poll_once(&recorded()).await.expect("poll"), 2);
    let started = runs.started.lock().expect("lock").clone();
    let mut agent_ids: Vec<String> = started.iter().map(|(agent_id, _)| agent_id.clone()).collect();
    agent_ids.sort();
    let mut expected = vec![notion.id.clone(), slack.id.clone()];
    expected.sort();
    assert_eq!(agent_ids, expected);
    assert_eq!(started[0].1, json!({"meeting_id": "m1", "meeting_title": "Zoom meeting"}));

    assert_eq!(service.poll_once(&recorded()).await.expect("poll"), 0);
    let calls = host.calls.lock().expect("lock").clone();
    assert_eq!(calls[0].1, "meeting-notes.wait_for_recording_end");
    assert_eq!(calls[0].2, json!({"timeout_seconds": 240}), "no cursor the first time");
    assert_eq!(calls[1].2, json!({"timeout_seconds": 240, "cursor": "c1"}), "the stored cursor next time");
    assert_eq!(
        db.get_setting("plugin_trigger_cursor.meeting-notes.meeting_recorded").expect("get").as_deref(),
        Some("c2")
    );
}

#[tokio::test]
async fn a_failed_watch_call_starts_nothing_and_keeps_the_cursor() {
    let (db, _host, runs, service) = service(true, vec![Err(AppError::Internal("pw-dump failed".into()))]);
    let notes = agent(&db, "Notes", AgentStatus::Active);
    service.set_subscription(&notes.id, Some(recorded())).expect("subscribe");
    db.set_setting("plugin_trigger_cursor.meeting-notes.meeting_recorded", "c0").expect("set");

    assert!(service.poll_once(&recorded()).await.is_err());
    assert!(runs.started.lock().expect("lock").is_empty());
    assert_eq!(
        db.get_setting("plugin_trigger_cursor.meeting-notes.meeting_recorded").expect("get").as_deref(),
        Some("c0")
    );
}

#[tokio::test]
async fn untrusted_or_unknown_triggers_do_not_run() {
    let (db, host, _runs, service) = service(false, Vec::new());
    let notes = agent(&db, "Notes", AgentStatus::Active);
    assert!(service.poll_once(&recorded()).await.is_err());
    assert!(host.calls.lock().expect("lock").is_empty());
    let unknown = TriggerRef { plugin: "meeting-notes".into(), trigger: "nope".into() };
    assert!(matches!(service.set_subscription(&notes.id, Some(unknown)), Err(AppError::InvalidInput(_))));
    assert_eq!(service.available()[0].problem.as_deref(), Some("trust meeting-notes"));
}
