//! Upgrades workflow documents written for the graphrt the app used to pin to
//! the fields graphrt main defines, so they stay valid now that unknown fields
//! are errors.
//!
//! `human-input` ("Ask me before continuing") steps:
//! - The time limit was the node's `timeout_ms`, which graphrt treats as the
//!   per-attempt timeout of any node. It is now the step's `expire_after_ms`.
//! - What happens when it runs out was the app's own `on_timeout` key. It is now
//!   graphrt's `on_expire`: `stop`, or `{ action: <id> }`. The bare action id the
//!   app also accepted becomes `{ action: <id> }`.
//!
//! [`migrate_flow_yaml`] is idempotent: a document it returns needs no further
//! change, and a document already in the new form is returned as `None`.

use serde_json::{Map, Value as Json};

use crate::error::{AppError, AppResult};

const APPROVAL_KIND: &str = "human-input";
const LEGACY_TIMEOUT_KEY: &str = "timeout_ms";
const EXPIRE_AFTER_KEY: &str = "expire_after_ms";
const LEGACY_ON_TIMEOUT_KEY: &str = "on_timeout";
const ON_EXPIRE_KEY: &str = "on_expire";
const STOP: &str = "stop";

/// The document in the current form, or `None` when it already is (or is not a
/// workflow document this upgrade applies to, such as an empty or unreadable one:
/// compiling reports those).
///
/// # Errors
/// `Workflow` when the upgraded document cannot be written back as YAML.
pub fn migrate_flow_yaml(flow_yaml: &str) -> AppResult<Option<String>> {
    let Ok(Json::Object(mut document)) = serde_saphyr::from_str::<Json>(flow_yaml) else {
        return Ok(None);
    };
    if !migrate_document(&mut document) {
        return Ok(None);
    }
    let yaml = serde_saphyr::to_string(&Json::Object(document))
        .map_err(|error| AppError::Workflow(format!("could not write the upgraded workflow document: {error}")))?;
    Ok(Some(format!("{}{yaml}", leading_comments(flow_yaml))))
}

/// [`migrate_flow_yaml`], keeping `flow_yaml` when nothing changes.
///
/// # Errors
/// Same as [`migrate_flow_yaml`].
pub fn upgraded_flow_yaml(flow_yaml: &str) -> AppResult<String> {
    Ok(migrate_flow_yaml(flow_yaml)?.unwrap_or_else(|| flow_yaml.to_owned()))
}

/// Upgrades every `human-input` node of `graph.nodes`; true when one changed.
fn migrate_document(document: &mut Map<String, Json>) -> bool {
    let Some(Json::Array(nodes)) = document.get_mut("graph").and_then(|graph| graph.get_mut("nodes")) else {
        return false;
    };
    let mut changed = false;
    for node in nodes.iter_mut().filter_map(Json::as_object_mut) {
        if node.get("type").and_then(Json::as_str) == Some(APPROVAL_KIND) {
            changed |= migrate_approval(node);
        }
    }
    changed
}

/// Moves the time limit and the expiry choice to graphrt's fields. A value
/// already in the new field wins; the old key is dropped either way.
fn migrate_approval(node: &mut Map<String, Json>) -> bool {
    let mut changed = false;
    if let Some(timeout) = node.remove(LEGACY_TIMEOUT_KEY) {
        changed = true;
        if !node.contains_key(EXPIRE_AFTER_KEY) && !timeout.is_null() {
            node.insert(EXPIRE_AFTER_KEY.to_owned(), timeout);
        }
    }
    if let Some(choice) = node.remove(LEGACY_ON_TIMEOUT_KEY) {
        changed = true;
        if let Some(on_expire) = on_expire_from(choice).filter(|_| !node.contains_key(ON_EXPIRE_KEY)) {
            node.insert(ON_EXPIRE_KEY.to_owned(), on_expire);
        }
    }
    changed
}

/// `stop` (also the default, so it is left out), `<id>` and `{ action: <id> }`
/// become graphrt's `on_expire`. Anything else made the run stop, like no setting.
fn on_expire_from(choice: Json) -> Option<Json> {
    let action = match &choice {
        Json::String(text) if text.trim() != STOP && !text.trim().is_empty() => text.trim(),
        Json::Object(fields) => {
            fields.get("action").and_then(Json::as_str).map(str::trim).filter(|id| !id.is_empty())?
        }
        _ => return None,
    };
    Some(serde_json::json!({ "action": action }))
}

/// The comment lines at the top of the document, which the YAML writer drops.
fn leading_comments(flow_yaml: &str) -> String {
    flow_yaml
        .lines()
        .take_while(|line| line.trim_start().starts_with('#') || line.trim().is_empty())
        .filter(|line| line.trim_start().starts_with('#'))
        .map(|line| format!("{line}\n"))
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    const LEGACY: &str = r#"# Approve before sending
version: "1"
graph:
  nodes:
    - id: start
      type: start
    - id: ask
      type: human-input
      title: Ask me before sending
      timeout_ms: 3600000
      on_timeout: { action: skip }
      actions: [{ id: send }, { id: skip }]
    - id: stop_ask
      type: human-input
      timeout_ms: 60000
      on_timeout: stop
    - id: bare
      type: human-input
      on_timeout: skip
      actions: [{ id: send }, { id: skip }]
    - id: lookup
      type: http-request
      method: get
      url: https://api.example.com
      timeout: { connect: 5, read: 30 }
      timeout_ms: 10000
    - id: end
      type: end
  edges:
    - { source: start, target: ask }
"#;

    fn node<'a>(document: &'a Json, id: &str) -> &'a Json {
        document["graph"]["nodes"].as_array().unwrap().iter().find(|node| node["id"] == id).unwrap()
    }

    fn parse(yaml: &str) -> Json {
        serde_saphyr::from_str(yaml).unwrap()
    }

    #[test]
    fn approval_time_limits_and_expiry_choices_move_to_graphrt_fields() {
        let migrated = parse(&migrate_flow_yaml(LEGACY).unwrap().expect("a legacy document changes"));
        let ask = node(&migrated, "ask");
        assert_eq!(ask["expire_after_ms"], 3_600_000);
        assert_eq!(ask["on_expire"], serde_json::json!({"action": "skip"}));
        assert!(ask.get("timeout_ms").is_none() && ask.get("on_timeout").is_none());
        let stop = node(&migrated, "stop_ask");
        assert_eq!(stop["expire_after_ms"], 60_000);
        assert!(stop.get("on_expire").is_none(), "stop is the default");
        assert_eq!(node(&migrated, "bare")["on_expire"], serde_json::json!({"action": "skip"}));
    }

    #[test]
    fn other_steps_keep_their_fields() {
        let migrated = parse(&migrate_flow_yaml(LEGACY).unwrap().unwrap());
        let lookup = node(&migrated, "lookup");
        assert_eq!(lookup["timeout_ms"], 10_000, "a node's own per-attempt timeout stays");
        assert_eq!(lookup["timeout"], serde_json::json!({"connect": 5, "read": 30}));
    }

    #[test]
    fn migrating_is_idempotent_and_reloads_the_same() {
        let once = migrate_flow_yaml(LEGACY).unwrap().unwrap();
        assert_eq!(migrate_flow_yaml(&once).unwrap(), None, "an upgraded document needs no further change");
        assert_eq!(parse(&upgraded_flow_yaml(&once).unwrap()), parse(&once));
        assert!(once.starts_with("# Approve before sending\n"), "leading comments are kept");
    }

    #[test]
    fn new_fields_win_over_legacy_ones() {
        let both = LEGACY.replace(
            "      timeout_ms: 3600000\n      on_timeout: { action: skip }\n",
            "      timeout_ms: 3600000\n      expire_after_ms: 5000\n      on_timeout: { action: skip }\n      on_expire: { action: send }\n",
        );
        let migrated = parse(&migrate_flow_yaml(&both).unwrap().unwrap());
        let ask = node(&migrated, "ask");
        assert_eq!(ask["expire_after_ms"], 5000);
        assert_eq!(ask["on_expire"], serde_json::json!({"action": "send"}));
    }

    #[test]
    fn current_and_unreadable_documents_are_left_alone() {
        let current = "version: \"1\"\ngraph:\n  nodes:\n    - id: ask\n      type: human-input\n      expire_after_ms: 1000\n      on_expire: stop\n";
        assert_eq!(migrate_flow_yaml(current).unwrap(), None);
        assert_eq!(migrate_flow_yaml("").unwrap(), None);
        assert_eq!(migrate_flow_yaml("graph: [").unwrap(), None);
        assert_eq!(upgraded_flow_yaml(current).unwrap(), current);
    }

    #[test]
    fn upgraded_documents_compile_against_strict_graphrt() {
        let upgraded = upgraded_flow_yaml(LEGACY).unwrap();
        // The legacy document is refused as it stands, the upgraded one compiles.
        assert!(super::super::compile_flow(LEGACY).is_err());
        super::super::compile_flow(&upgraded).unwrap();
    }
}
