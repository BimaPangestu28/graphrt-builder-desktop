//! Plugins that only work with a linked account session (WhatsApp Web scanned by QR code).
//!
//! Installing, trusting and downloading the browser is not enough for these: until the
//! user links the session every step fails with `auth_error`. The app cannot ask the
//! plugin on every requirements check (that starts a browser), so it remembers the last
//! known state per plugin in the settings table (`plugins.session.<name>`) and updates it
//! whenever the plugin reports it: the status / login actions run from the UI, and run
//! steps that fail with `auth_error`. A plugin never checked counts as not linked.

use serde::{Deserialize, Serialize};

use crate::error::AppResult;
use crate::storage::Database;

/// The error kind graphrt-plugins nodes report when the session is not linked.
const AUTH_ERROR_TYPE: &str = "auth_error";
/// Settings key prefix; the plugin name follows.
const SETTING_SESSION_PREFIX: &str = "plugins.session.";

/// Last known state of a plugin's account session.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SessionState {
    Linked,
    NotLinked,
    /// Never checked, or the plugin could not tell (e.g. still loading).
    Unknown,
}

/// What the app stored about one plugin's session.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionRecord {
    pub state: SessionState,
    /// Unix milliseconds of the check.
    pub checked_at: i64,
}

/// A plugin that needs a linked session, and how it reports one.
struct SessionPlugin {
    name: &'static str,
    /// The node kind that reports the session without changing it; run by "check".
    status_kind: &'static str,
    /// Node kinds whose `outputs.data.status` tells the session state.
    reporting_kinds: &'static [&'static str],
    /// `data.status` values meaning linked / not linked; anything else is unknown.
    linked_status: &'static str,
    not_linked_status: &'static str,
}

/// Only `whatsapp-web` for now (see its README: `get_status` reports `logged_in`,
/// `needs_login` or `loading`; every other step fails with `auth_error` before the scan).
const SESSION_PLUGINS: &[SessionPlugin] = &[SessionPlugin {
    name: "whatsapp-web",
    status_kind: "whatsapp-web.get_status",
    reporting_kinds: &["whatsapp-web.get_status", "whatsapp-web.login"],
    linked_status: "logged_in",
    not_linked_status: "needs_login",
}];

fn session_plugin(plugin: &str) -> Option<&'static SessionPlugin> {
    SESSION_PLUGINS.iter().find(|candidate| candidate.name == plugin)
}

/// Whether `plugin` only works once its account session is linked.
pub(crate) fn needs_session(plugin: &str) -> bool {
    session_plugin(plugin).is_some()
}

/// The node kind that reports `plugin`'s session, when it has one.
pub(crate) fn status_kind(plugin: &str) -> Option<&'static str> {
    session_plugin(plugin).map(|session| session.status_kind)
}

/// The session state an action's outputs report; `None` when `kind` does not report one.
pub(crate) fn state_from_outputs(
    plugin: &str,
    kind: &str,
    outputs: &serde_json::Map<String, serde_json::Value>,
) -> Option<SessionState> {
    let session = session_plugin(plugin)?;
    if !session.reporting_kinds.contains(&kind) {
        return None;
    }
    let status = outputs.get("data").and_then(|data| data.get("status")).and_then(serde_json::Value::as_str);
    Some(match status {
        Some(status) if status == session.linked_status => SessionState::Linked,
        Some(status) if status == session.not_linked_status => SessionState::NotLinked,
        _ => SessionState::Unknown,
    })
}

/// `NotLinked` when a step of a session plugin failed because the session is not linked.
pub(crate) fn state_from_failure(plugin: &str, error_type: &str) -> Option<SessionState> {
    (needs_session(plugin) && error_type == AUTH_ERROR_TYPE).then_some(SessionState::NotLinked)
}

fn setting_key(plugin: &str) -> String {
    format!("{SETTING_SESSION_PREFIX}{plugin}")
}

/// The stored session record of `plugin`, or `None` when never checked (or unreadable).
///
/// # Errors
/// `Database` when the settings table cannot be read.
pub(crate) fn read_session(db: &Database, plugin: &str) -> AppResult<Option<SessionRecord>> {
    let Some(text) = db.get_setting(&setting_key(plugin))? else { return Ok(None) };
    match serde_json::from_str(&text) {
        Ok(record) => Ok(Some(record)),
        Err(error) => {
            log::warn!("ignoring the unreadable session state of plugin {plugin}: {error}");
            Ok(None)
        }
    }
}

/// Whether `plugin`'s session is known to be linked (never checked counts as not linked).
pub(crate) fn is_linked(db: &Database, plugin: &str) -> AppResult<bool> {
    Ok(read_session(db, plugin)?.is_some_and(|record| record.state == SessionState::Linked))
}

/// Stores `state` as the latest known session state of `plugin`, checked now.
///
/// An `Unknown` report (e.g. WhatsApp Web still loading) keeps a known state: it says
/// nothing new about the link.
///
/// # Errors
/// `Database` when the settings table cannot be written.
pub(crate) fn save_session(db: &Database, plugin: &str, state: SessionState) -> AppResult<()> {
    if state == SessionState::Unknown && read_session(db, plugin)?.is_some() {
        return Ok(());
    }
    let record = SessionRecord { state, checked_at: chrono::Utc::now().timestamp_millis() };
    db.set_setting(&setting_key(plugin), &serde_json::to_string(&record)?)
}

/// Whether a step error kind may mean an unlinked session (cheap check before looking up the step).
pub(crate) fn is_session_error(error_type: &str) -> bool {
    error_type == AUTH_ERROR_TYPE
}

/// The node kind of step `node_id` in `flow_yaml` (top-level steps only).
pub(crate) fn node_kind_in_flow(flow_yaml: &str, node_id: &str) -> Option<String> {
    let workflow = graphrt_core::Workflow::parse(flow_yaml).ok()?;
    workflow.graph.nodes.into_iter().find(|node| node.id == node_id).map(|node| node.kind)
}

/// Records `NotLinked` when a run step of a session plugin failed with `auth_error`.
/// Logs instead of failing: run bookkeeping must not stop over it.
pub(crate) fn record_step_failure(db: &Database, node_kind: &str, error_type: &str) {
    let Some((plugin, _)) = node_kind.split_once('.') else { return };
    let Some(state) = state_from_failure(plugin, error_type) else { return };
    if let Err(error) = save_session(db, plugin, state) {
        log::warn!("could not record the session state of plugin {plugin}: {error}");
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn test_database() -> Database {
        Database::open_in_memory().unwrap()
    }

    fn outputs_with_status(status: &str) -> serde_json::Map<String, serde_json::Value> {
        let json = serde_json::json!({ "data": { "status": status, "message": "Ready." } });
        json.as_object().cloned().unwrap()
    }

    #[test]
    fn status_and_login_results_tell_the_whatsapp_web_session_state() {
        let linked = outputs_with_status("logged_in");
        let not_linked = outputs_with_status("needs_login");
        let loading = outputs_with_status("loading");
        assert_eq!(state_from_outputs("whatsapp-web", "whatsapp-web.get_status", &linked), Some(SessionState::Linked));
        assert_eq!(state_from_outputs("whatsapp-web", "whatsapp-web.login", &linked), Some(SessionState::Linked));
        assert_eq!(
            state_from_outputs("whatsapp-web", "whatsapp-web.get_status", &not_linked),
            Some(SessionState::NotLinked)
        );
        assert_eq!(
            state_from_outputs("whatsapp-web", "whatsapp-web.get_status", &loading),
            Some(SessionState::Unknown)
        );
        assert_eq!(state_from_outputs("whatsapp-web", "whatsapp-web.list_chats", &linked), None);
        assert_eq!(state_from_outputs("whatsapp-api", "whatsapp-api.get_business_profile", &linked), None);
    }

    #[test]
    fn only_auth_errors_of_session_plugins_unlink() {
        assert_eq!(state_from_failure("whatsapp-web", "auth_error"), Some(SessionState::NotLinked));
        assert_eq!(state_from_failure("whatsapp-web", "browser_error"), None);
        assert_eq!(state_from_failure("whatsapp-api", "auth_error"), None);
    }

    #[test]
    fn the_stored_state_follows_the_latest_report() {
        let db = test_database();
        assert!(!is_linked(&db, "whatsapp-web").unwrap(), "never checked is not linked");
        assert_eq!(read_session(&db, "whatsapp-web").unwrap(), None);

        save_session(&db, "whatsapp-web", SessionState::Linked).unwrap();
        assert!(is_linked(&db, "whatsapp-web").unwrap());
        save_session(&db, "whatsapp-web", SessionState::Unknown).unwrap();
        assert!(is_linked(&db, "whatsapp-web").unwrap(), "an unknown report keeps the known state");

        record_step_failure(&db, "whatsapp-web.send_message", "auth_error");
        assert_eq!(read_session(&db, "whatsapp-web").unwrap().unwrap().state, SessionState::NotLinked);
        record_step_failure(&db, "whatsapp-web.send_message", "browser_error");
        assert!(!is_linked(&db, "whatsapp-web").unwrap());
    }

    #[test]
    fn an_unknown_first_report_is_stored_as_unknown() {
        let db = test_database();
        save_session(&db, "whatsapp-web", SessionState::Unknown).unwrap();
        assert_eq!(read_session(&db, "whatsapp-web").unwrap().unwrap().state, SessionState::Unknown);
        assert!(!is_linked(&db, "whatsapp-web").unwrap());
    }

    #[test]
    fn a_failed_step_is_found_by_its_id_in_the_flow() {
        let flow = r#"
version: "1"
name: send
graph:
  nodes:
    - { id: start, type: start }
    - { id: send, type: whatsapp-web.send_message, phone: "+62 812 3456 789", text: Hi }
  edges:
    - { source: start, target: send }
"#;
        assert_eq!(node_kind_in_flow(flow, "send").as_deref(), Some("whatsapp-web.send_message"));
        assert_eq!(node_kind_in_flow(flow, "missing"), None);
        assert_eq!(node_kind_in_flow("not: [a workflow", "send"), None);
        assert!(is_session_error("auth_error") && !is_session_error("timeout"));
    }

    #[test]
    fn whatsapp_web_is_the_only_session_plugin() {
        assert!(needs_session("whatsapp-web"));
        assert_eq!(status_kind("whatsapp-web"), Some("whatsapp-web.get_status"));
        assert!(!needs_session("whatsapp-api"));
        assert_eq!(status_kind("google-maps-scraper"), None);
    }
}
