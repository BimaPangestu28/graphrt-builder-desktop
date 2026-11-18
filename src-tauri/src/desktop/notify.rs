//! System notifications when a run needs the user: it paused for approval, or it failed.
//!
//! [`NotifyingSink`] wraps another [`RunEventSink`]: every payload is passed
//! on unchanged, and a `status_changed` to `Paused` or `Failed` additionally
//! produces one [`RunNotification`] for the [`RunNotifier`], if the matching
//! setting is on ([`AppSettings::notify_on_approval`] / `notify_on_failure`).
//! Test runs (the builder's "Test" button) are not notified: the user is
//! watching them in the window.
//!
//! The app's notifier is [`TauriRunNotifier`]; clicking a notification shows
//! the main window and emits [`OPEN_RUN_EVENT`] so the frontend opens the run.

use std::collections::HashMap;
use std::fmt;
use std::sync::atomic::{AtomicI32, Ordering};
use std::sync::{Arc, Mutex};

use serde::Serialize;
use tauri::{AppHandle, Emitter};
use tauri_plugin_notification::NotificationExt;

use super::app_settings::AppSettings;
use crate::engine::{RunEventPayload, RunEventSink};
use crate::storage::models::{Run, RunStatus, RunTrigger};
use crate::storage::Database;

/// Tauri event asking the frontend to open a run; payload [`RunNotificationTarget`].
pub const OPEN_RUN_EVENT: &str = "open-run";

/// Which run a notification is about (also the [`OPEN_RUN_EVENT`] payload).
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RunNotificationTarget {
    pub run_id: String,
    pub agent_id: String,
}

/// One notification to show.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RunNotification {
    pub title: String,
    pub body: String,
    pub target: RunNotificationTarget,
}

/// Shows notifications. The app uses [`TauriRunNotifier`]; tests record them.
pub trait RunNotifier: Send + Sync + fmt::Debug {
    fn notify(&self, notification: RunNotification);
}

/// Shows notifications that are not about one run (chat hand-offs, the daily
/// summary). A click shows the main window.
pub trait PlainNotifier: Send + Sync + fmt::Debug {
    fn notify_plain(&self, title: String, body: String);
}

/// Forwards every run event to `inner` and notifies on runs that need the user.
#[derive(Debug)]
pub struct NotifyingSink {
    inner: Arc<dyn RunEventSink>,
    notifier: Arc<dyn RunNotifier>,
    db: Arc<Database>,
}

impl NotifyingSink {
    pub fn new(inner: Arc<dyn RunEventSink>, notifier: Arc<dyn RunNotifier>, db: Arc<Database>) -> Self {
        Self { inner, notifier, db }
    }

    fn notification_for(&self, payload: &RunEventPayload) -> Option<RunNotification> {
        if !is_attention_status_change(payload) {
            return None;
        }
        let settings = AppSettings::load_or_default(&self.db);
        let is_enabled = match payload.status {
            RunStatus::Paused => settings.notify_on_approval,
            _ => settings.notify_on_failure,
        };
        if !is_enabled {
            return None;
        }
        let run = match self.db.get_run(&payload.run_id) {
            Ok(run) => run,
            Err(error) => {
                log::warn!("not notifying about run {}: {error}", payload.run_id);
                return None;
            }
        };
        if run.trigger == RunTrigger::Test {
            return None;
        }
        let agent_name =
            self.db.get_agent(&payload.agent_id).map(|agent| agent.name).unwrap_or_else(|_| "An agent".into());
        Some(describe_run(&agent_name, &run, payload.status))
    }
}

impl RunEventSink for NotifyingSink {
    fn send(&self, payload: RunEventPayload) {
        let notification = self.notification_for(&payload);
        self.inner.send(payload);
        if let Some(notification) = notification {
            self.notifier.notify(notification);
        }
    }
}

/// True for the one `status_changed` event of a run reaching `Paused` or `Failed`.
fn is_attention_status_change(payload: &RunEventPayload) -> bool {
    let is_status_change = payload.event.get("type").and_then(|kind| kind.as_str()) == Some("status_changed");
    is_status_change && matches!(payload.status, RunStatus::Paused | RunStatus::Failed)
}

/// "Maps leads to WhatsApp needs your approval" / "Morning email digest failed".
fn describe_run(agent_name: &str, run: &Run, status: RunStatus) -> RunNotification {
    let target = RunNotificationTarget { run_id: run.id.clone(), agent_id: run.agent_id.clone() };
    if status == RunStatus::Paused {
        let waiting_count = run.pause_reasons.as_ref().and_then(|reasons| reasons.as_array()).map_or(1, Vec::len);
        let body = if waiting_count > 1 {
            format!("{waiting_count} items are waiting for you. Click to review them")
        } else {
            "Click to review it before anything is sent".to_owned()
        };
        return RunNotification { title: format!("{agent_name} needs your approval"), body, target };
    }
    let body = run.error_message.clone().unwrap_or_else(|| "Click to see what went wrong".to_owned());
    RunNotification { title: format!("{agent_name} failed"), body, target }
}

/// Shows notifications through `tauri-plugin-notification` and remembers which
/// run each one is about, so a click can open it.
#[derive(Clone)]
pub struct TauriRunNotifier {
    app_handle: AppHandle,
    targets: Arc<Mutex<HashMap<i32, RunNotificationTarget>>>,
    next_notification_id: Arc<AtomicI32>,
}

impl fmt::Debug for TauriRunNotifier {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.debug_struct("TauriRunNotifier").finish_non_exhaustive()
    }
}

/// Clicks are only remembered for this many recent notifications.
const REMEMBERED_NOTIFICATIONS: usize = 200;

impl TauriRunNotifier {
    /// Creates the notifier and registers the click handler (once per app).
    pub fn install(app_handle: AppHandle) -> Self {
        let notifier = Self {
            app_handle: app_handle.clone(),
            targets: Arc::new(Mutex::new(HashMap::new())),
            next_notification_id: Arc::new(AtomicI32::new(1)),
        };
        let click_handler = notifier.clone();
        let registered = app_handle.notification().on_action(move |performed| {
            let Some(notification_id) = performed.notification().map(|notification| notification.id()) else {
                super::window::show_main_window(&click_handler.app_handle);
                return;
            };
            click_handler.open_target(notification_id);
        });
        if let Err(error) = registered {
            log::warn!("notification clicks will not open runs: {error}");
        }
        notifier
    }

    fn open_target(&self, notification_id: i32) {
        super::window::show_main_window(&self.app_handle);
        let target = match self.targets.lock() {
            Ok(targets) => targets.get(&notification_id).cloned(),
            Err(_) => None,
        };
        let Some(target) = target else {
            return;
        };
        if let Err(error) = self.app_handle.emit(OPEN_RUN_EVENT, target) {
            log::warn!("could not ask the window to open the run: {error}");
        }
    }

    fn remember(&self, notification_id: i32, target: RunNotificationTarget) {
        if let Ok(mut targets) = self.targets.lock() {
            if targets.len() >= REMEMBERED_NOTIFICATIONS {
                let oldest_id = targets.keys().min().copied();
                if let Some(oldest_id) = oldest_id {
                    targets.remove(&oldest_id);
                }
            }
            targets.insert(notification_id, target);
        }
    }
}

impl RunNotifier for TauriRunNotifier {
    fn notify(&self, notification: RunNotification) {
        let notification_id = self.next_notification_id.fetch_add(1, Ordering::Relaxed);
        self.remember(notification_id, notification.target);
        let shown = self
            .app_handle
            .notification()
            .builder()
            .id(notification_id)
            .title(notification.title)
            .body(notification.body)
            .show();
        if let Err(error) = shown {
            log::warn!("could not show a notification: {error}");
        }
    }
}

impl PlainNotifier for TauriRunNotifier {
    /// The id is not remembered as a run target, so a click only shows the window.
    fn notify_plain(&self, title: String, body: String) {
        let notification_id = self.next_notification_id.fetch_add(1, Ordering::Relaxed);
        let shown = self.app_handle.notification().builder().id(notification_id).title(title).body(body).show();
        if let Err(error) = shown {
            log::warn!("could not show a notification: {error}");
        }
    }
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;
    use crate::storage::models::{AgentKind, NewAgent};

    #[derive(Debug, Default)]
    struct RecordingSink {
        payloads: Mutex<Vec<RunEventPayload>>,
    }

    impl RunEventSink for RecordingSink {
        fn send(&self, payload: RunEventPayload) {
            self.payloads.lock().unwrap().push(payload);
        }
    }

    #[derive(Debug, Default)]
    struct RecordingNotifier {
        notifications: Mutex<Vec<RunNotification>>,
    }

    impl RunNotifier for RecordingNotifier {
        fn notify(&self, notification: RunNotification) {
            self.notifications.lock().unwrap().push(notification);
        }
    }

    struct Fixture {
        sink: NotifyingSink,
        inner: Arc<RecordingSink>,
        notifier: Arc<RecordingNotifier>,
        db: Arc<Database>,
        run: Run,
    }

    fn fixture(trigger: RunTrigger) -> Fixture {
        let db = Arc::new(Database::open_in_memory().unwrap());
        let agent = db
            .create_agent(NewAgent {
                name: "Maps leads to WhatsApp".into(),
                kind: AgentKind::Task,
                description: "Find cafes".into(),
                flow_yaml: "nodes: []".into(),
            })
            .unwrap();
        let run = db.insert_run(&agent.id, 1, trigger).unwrap();
        let inner = Arc::new(RecordingSink::default());
        let notifier = Arc::new(RecordingNotifier::default());
        let sink = NotifyingSink::new(inner.clone(), notifier.clone(), db.clone());
        Fixture { sink, inner, notifier, db, run }
    }

    fn payload(run: &Run, status: RunStatus, event_type: &str) -> RunEventPayload {
        RunEventPayload {
            run_id: run.id.clone(),
            agent_id: run.agent_id.clone(),
            seq: 1,
            status,
            event: json!({"type": event_type}),
        }
    }

    fn notifications(fixture: &Fixture) -> Vec<RunNotification> {
        fixture.notifier.notifications.lock().unwrap().clone()
    }

    #[test]
    fn notifies_when_a_run_pauses_for_approval() {
        let fixture = fixture(RunTrigger::Schedule);
        let reasons = json!([{"node_id": "approve"}, {"node_id": "approve"}, {"node_id": "approve"}]);
        fixture.db.mark_run_paused(&fixture.run.id, "{}", &reasons).unwrap();

        fixture.sink.send(payload(&fixture.run, RunStatus::Paused, "status_changed"));

        let shown = notifications(&fixture);
        assert_eq!(shown.len(), 1);
        assert_eq!(shown[0].title, "Maps leads to WhatsApp needs your approval");
        assert!(shown[0].body.starts_with("3 items"));
        assert_eq!(shown[0].target.run_id, fixture.run.id);
        assert_eq!(fixture.inner.payloads.lock().unwrap().len(), 1, "the payload is forwarded");
    }

    #[test]
    fn notifies_when_a_run_fails() {
        let fixture = fixture(RunTrigger::Manual);
        fixture.db.finish_run(&fixture.run.id, RunStatus::Failed, None, Some("Gmail said no")).unwrap();

        fixture.sink.send(payload(&fixture.run, RunStatus::Failed, "status_changed"));

        let shown = notifications(&fixture);
        assert_eq!(shown.len(), 1);
        assert_eq!(shown[0].title, "Maps leads to WhatsApp failed");
        assert_eq!(shown[0].body, "Gmail said no");
    }

    #[test]
    fn other_events_and_statuses_are_only_forwarded() {
        let fixture = fixture(RunTrigger::Schedule);
        fixture.sink.send(payload(&fixture.run, RunStatus::Running, "status_changed"));
        fixture.sink.send(payload(&fixture.run, RunStatus::Succeeded, "status_changed"));
        fixture.sink.send(payload(&fixture.run, RunStatus::Aborted, "status_changed"));
        // The graphrt `run_failed` event itself is followed by `status_changed`; only that one counts.
        fixture.sink.send(payload(&fixture.run, RunStatus::Failed, "run_failed"));

        assert!(notifications(&fixture).is_empty());
        assert_eq!(fixture.inner.payloads.lock().unwrap().len(), 4);
    }

    #[test]
    fn respects_the_notification_settings() {
        let fixture = fixture(RunTrigger::Schedule);
        AppSettings { notify_on_approval: false, notify_on_failure: false, ..AppSettings::default() }
            .save(&fixture.db)
            .unwrap();

        fixture.sink.send(payload(&fixture.run, RunStatus::Paused, "status_changed"));
        fixture.sink.send(payload(&fixture.run, RunStatus::Failed, "status_changed"));
        assert!(notifications(&fixture).is_empty());

        AppSettings { notify_on_approval: false, ..AppSettings::default() }.save(&fixture.db).unwrap();
        fixture.sink.send(payload(&fixture.run, RunStatus::Paused, "status_changed"));
        fixture.sink.send(payload(&fixture.run, RunStatus::Failed, "status_changed"));
        assert_eq!(notifications(&fixture).len(), 1);
        assert!(notifications(&fixture)[0].title.ends_with("failed"));
    }

    #[test]
    fn test_runs_are_not_notified() {
        let fixture = fixture(RunTrigger::Test);
        fixture.sink.send(payload(&fixture.run, RunStatus::Failed, "status_changed"));
        assert!(notifications(&fixture).is_empty());
    }
}
