//! Secrets a draft declares but never reads are dropped.
//!
//! A drafting model that uses a plugin often also declares the plugin's own settings as
//! secrets of the agent (`EMAIL_FROM`, `EMAIL_PASSWORD` for the email plugin), although the
//! plugin reads them from its settings in the app and no step reads them. A declared secret
//! must be set before the agent runs, so the run stops at "not set up yet" for a value
//! nothing uses. A declaration whose name appears nowhere else in the document is removed.
//!
//! A plugin step's own fields get the same care first: a field that reads such a secret
//! (`from: "{{#env.EMAIL_FROM#}}"`) is the plugin's setting, and an empty optional field
//! (`references: []`, `html: ""`) only fails the plugin's type check, so both are removed.

use serde_json::Value as Json;

/// Keys of a node that are not a plugin's own fields.
const NODE_KEYS: &[&str] = &["id", "type", "title", "parent", "timeout_ms", "retry", "error_strategy", "description"];

/// `flow_yaml` with the plugin steps' empty fields and fields that read a secret removed.
/// The document is returned as it is when there are none or it cannot be read.
pub(super) fn tidy_plugin_fields(flow_yaml: String) -> String {
    let Ok(Json::Object(mut document)) = serde_saphyr::from_str::<Json>(&flow_yaml) else { return flow_yaml };
    let Some(nodes) = document.get_mut("graph").and_then(|graph| graph.get_mut("nodes")).and_then(Json::as_array_mut)
    else {
        return flow_yaml;
    };
    let mut removed = 0;
    for node in nodes.iter_mut() {
        let is_plugin_step = node.get("type").and_then(Json::as_str).is_some_and(|kind| kind.contains('.'));
        let Some(fields) = node.as_object_mut().filter(|_| is_plugin_step) else { continue };
        let before = fields.len();
        fields.retain(|key, value| NODE_KEYS.contains(&key.as_str()) || !(is_empty(value) || reads_a_secret(value)));
        removed += before - fields.len();
    }
    if removed == 0 {
        return flow_yaml;
    }
    match serde_saphyr::to_string(&Json::Object(document)) {
        Ok(yaml) => {
            log::info!("{removed} empty or secret-reading plugin field(s) were removed");
            yaml
        }
        Err(error) => {
            log::warn!("could not write the document back after tidying plugin fields: {error}");
            flow_yaml
        }
    }
}

fn is_empty(value: &Json) -> bool {
    match value {
        Json::Null => true,
        Json::String(text) => text.trim().is_empty(),
        Json::Array(items) => items.is_empty(),
        Json::Object(fields) => fields.is_empty(),
        _ => false,
    }
}

fn reads_a_secret(value: &Json) -> bool {
    match value {
        Json::String(text) => text.contains("{{#env."),
        Json::Array(items) => items.iter().any(reads_a_secret),
        Json::Object(fields) => fields.values().any(reads_a_secret),
        _ => false,
    }
}

/// `flow_yaml` without the `env` entries no step reads. The document is returned as it is
/// when every entry is read or it cannot be read (compiling reports that).
pub(super) fn drop_unused_env(flow_yaml: String) -> String {
    let Ok(Json::Object(mut document)) = serde_saphyr::from_str::<Json>(&flow_yaml) else { return flow_yaml };
    let Some(Json::Array(entries)) = document.get("env") else { return flow_yaml };
    // Everything but the declarations: where a step would read a secret.
    let mut without_env = document.clone();
    without_env.remove("env");
    let rest = Json::Object(without_env).to_string();
    let kept: Vec<Json> = entries
        .iter()
        .filter(|entry| {
            let Some(name) = entry.get("name").and_then(Json::as_str) else { return true };
            is_read(&rest, name)
        })
        .cloned()
        .collect();
    if kept.len() == entries.len() {
        return flow_yaml;
    }
    let dropped = entries.len() - kept.len();
    if kept.is_empty() {
        document.remove("env");
    } else {
        document.insert("env".to_owned(), Json::Array(kept));
    }
    match serde_saphyr::to_string(&Json::Object(document)) {
        Ok(yaml) => {
            log::info!("{dropped} declared secret(s) no step reads were dropped");
            yaml
        }
        Err(error) => {
            log::warn!("could not write the document back after dropping unused secrets: {error}");
            flow_yaml
        }
    }
}

/// Whether `name` appears in `text` as a whole name (not as part of a longer one).
fn is_read(text: &str, name: &str) -> bool {
    let is_name_character = |character: char| character.is_ascii_alphanumeric() || character == '_';
    text.match_indices(name).any(|(start, _)| {
        let before = text[..start].chars().next_back();
        let after = text[start + name.len()..].chars().next();
        !before.is_some_and(is_name_character) && !after.is_some_and(is_name_character)
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    const PLUGIN_SETTINGS_AS_SECRETS: &str = r#"version: "1"
name: thanks
env:
  - { name: EMAIL_FROM, type: secret }
  - { name: EMAIL_SMTP_SETTINGS, type: secret }
  - { name: API_TOKEN, type: secret }
  - { name: API, type: secret }
graph:
  nodes:
    - { id: start, type: start }
    - id: fetch
      type: http-request
      method: get
      url: "https://api.example.test/items"
      authorization: { type: api-key, config: { type: bearer, api_key: "{{#env.API_TOKEN#}}" } }
    - { id: send, type: email.send_email, to: a@b.test, subject: Hi, text: "{{#fetch.text#}}" }
    - { id: end, type: end }
  edges:
    - { source: start, target: fetch }
    - { source: fetch, target: send }
    - { source: send, target: end }
"#;

    #[test]
    fn secrets_no_step_reads_are_dropped_and_read_ones_kept() {
        let cleaned = drop_unused_env(PLUGIN_SETTINGS_AS_SECRETS.to_owned());

        let document: Json = serde_saphyr::from_str(&cleaned).unwrap();
        let names: Vec<&str> =
            document["env"].as_array().unwrap().iter().filter_map(|entry| entry["name"].as_str()).collect();
        assert_eq!(names, ["API_TOKEN"], "{cleaned}");
        assert_eq!(document.pointer("/graph/nodes/2/type").and_then(Json::as_str), Some("email.send_email"));
    }

    #[test]
    fn a_document_whose_secrets_are_all_read_is_returned_untouched() {
        let all_read = PLUGIN_SETTINGS_AS_SECRETS
            .replace("  - { name: EMAIL_FROM, type: secret }\n  - { name: EMAIL_SMTP_SETTINGS, type: secret }\n", "")
            .replace("  - { name: API, type: secret }\n", "");
        assert_eq!(drop_unused_env(all_read.clone()), all_read);
        let without_env = all_read.replace("env:\n  - { name: API_TOKEN, type: secret }\n", "");
        assert_eq!(drop_unused_env(without_env.clone()), without_env);
    }

    #[test]
    fn a_plugin_steps_empty_and_secret_reading_fields_are_removed() {
        let draft = r#"version: "1"
name: thanks
env:
  - { name: EMAIL_FROM, type: secret }
graph:
  nodes:
    - { id: start, type: start }
    - id: send
      type: email.send_email
      title: Send it
      to: a@b.test
      from: "{{#env.EMAIL_FROM#}}"
      html: ""
      references: []
      attachments: []
      text: Hello
    - { id: end, type: end }
  edges:
    - { source: start, target: send }
    - { source: send, target: end }
"#;
        let tidy = drop_unused_env(tidy_plugin_fields(draft.to_owned()));

        let document: Json = serde_saphyr::from_str(&tidy).unwrap();
        let send = &document["graph"]["nodes"][1];
        let keys: Vec<&str> = send.as_object().unwrap().keys().map(String::as_str).collect();
        assert_eq!(keys, ["id", "type", "title", "to", "text"], "{tidy}");
        assert!(document.get("env").is_none(), "{tidy}");
        let simple = include_str!("../../fixtures/flows/simple_answer.yaml");
        assert_eq!(tidy_plugin_fields(simple.to_owned()), simple);
    }

    #[test]
    fn when_no_secret_is_read_the_env_list_goes() {
        let unread = PLUGIN_SETTINGS_AS_SECRETS.replace("{{#env.API_TOKEN#}}", "fixed");
        let cleaned = drop_unused_env(unread);
        assert!(!cleaned.contains("env:"), "{cleaned}");
    }
}
