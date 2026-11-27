//! Ready-made agents a plugin ships: a finished workflow with a title, so the New agent
//! screen can make the agent without asking a model to write it (a small local model often
//! cannot).
//!
//! Released runtimes reject unknown manifest fields, so the agents are named in a file next
//! to the manifest that the runtime does not read, `graphrt-agents.json`:
//!
//! ```json
//! { "agents": [{ "id": "make-invoice", "title": "Make an invoice", "description": "...",
//!                "language": "en", "workflow": "agents/make-invoice.yaml" }] }
//! ```
//!
//! `id` is `[a-z0-9-]{1,64}` and unique in the file, `title` at most 120 characters,
//! `description` at most 400, `language` (optional) two lowercase letters, `workflow` a
//! `.yaml` file inside the plugin folder (forward slashes, no `..`, a plain file and not a
//! link, at most 64 KiB). Reading is lenient like `graphrt-settings.json`: an item that
//! cannot be used (an unknown key included) is logged and skipped, the others still load.
//!
//! A ready-made workflow is code from the plugin, placed in the user's agent list without a
//! model or a review, so it is held to more than a drafted one ([`check_workflow`]): only the
//! harmless core steps and the plugin's own operations, and nothing is sent or created before
//! an approval. An agent that fails the check is not offered.

use std::path::{Component, Path};

use serde_json::Value as Json;

use crate::flow::TrustedHosts;

/// The file a plugin ships next to its manifest.
pub(crate) const AGENTS_FILE_NAME: &str = "graphrt-agents.json";
const MAX_AGENTS_FILE_BYTES: u64 = 64 * 1024;
const MAX_WORKFLOW_BYTES: u64 = 64 * 1024;
const MAX_AGENTS: usize = 20;
const MAX_ID_CHARS: usize = 64;
const MAX_TITLE_CHARS: usize = 120;
const MAX_DESCRIPTION_CHARS: usize = 400;
const WORKFLOW_EXTENSION: &str = ".yaml";
const ITEM_KEYS: &[&str] = &["id", "title", "description", "language", "workflow"];

/// Core steps a ready-made agent may use: a form, branching, text templates, an approval and
/// the answer. No model, no web request, no code, no shell, no other plugin.
const SAFE_CORE_KINDS: &[&str] =
    &["start", "end", "answer", "human-input", "template-transform", "if-else", "variable-aggregator"];

/// An agent a plugin ships, as read from its folder (its workflow is not checked yet).
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct ReadyAgent {
    pub id: String,
    pub title: String,
    pub description: String,
    /// Two lowercase letters (`en`, `id`), when the plugin says which language it is in.
    pub language: Option<String>,
    pub workflow_yaml: String,
}

/// The ready-made agents in a plugin folder; empty when the plugin ships none.
pub(crate) fn read_ready_agents(plugin_dir: &Path) -> Vec<ReadyAgent> {
    let path = plugin_dir.join(AGENTS_FILE_NAME);
    let Some(bytes) = read_plain_file(&path, MAX_AGENTS_FILE_BYTES, true) else { return Vec::new() };
    let document: Json = match serde_json::from_slice(&bytes) {
        Ok(document) => document,
        Err(error) => {
            log::warn!("ignoring {}: {error}", path.display());
            return Vec::new();
        }
    };
    let Some(items) = document.get("agents").and_then(Json::as_array) else { return Vec::new() };
    let mut agents: Vec<ReadyAgent> = Vec::new();
    for item in items.iter().take(MAX_AGENTS) {
        match read_item(plugin_dir, item) {
            Ok(agent) if agents.iter().all(|known| known.id != agent.id) => agents.push(agent),
            Ok(agent) => log::warn!("ignoring the second agent `{}` in {}", agent.id, path.display()),
            Err(reason) => log::warn!("ignoring an agent in {}: {reason}", path.display()),
        }
    }
    agents
}

/// One item of the file with its workflow's text. `Err` says why the item is not used.
fn read_item(plugin_dir: &Path, item: &Json) -> Result<ReadyAgent, String> {
    let fields = item.as_object().ok_or("an item is not an object")?;
    if let Some(unknown) = fields.keys().find(|key| !ITEM_KEYS.contains(&key.as_str())) {
        return Err(format!("unknown field `{unknown}`"));
    }
    let text = |field: &str, max_chars: usize| -> Result<String, String> {
        let value = fields.get(field).and_then(Json::as_str).map(str::trim).unwrap_or_default();
        if value.is_empty() || value.chars().count() > max_chars {
            return Err(format!("`{field}` must be 1 to {max_chars} characters"));
        }
        Ok(value.to_owned())
    };
    let id = text("id", MAX_ID_CHARS)?;
    if !id.chars().all(|character| character.is_ascii_lowercase() || character.is_ascii_digit() || character == '-') {
        return Err(format!("the id `{id}` may only have a-z, 0-9 and -"));
    }
    let language = match fields.get("language") {
        None | Some(Json::Null) => None,
        Some(Json::String(code)) if code.len() == 2 && code.chars().all(|letter| letter.is_ascii_lowercase()) => {
            Some(code.clone())
        }
        Some(other) => return Err(format!("`{id}`: the language {other} is not two lowercase letters")),
    };
    let workflow = fields.get("workflow").and_then(Json::as_str).unwrap_or_default();
    let workflow_yaml = read_workflow(plugin_dir, workflow).map_err(|reason| format!("`{id}`: {reason}"))?;
    Ok(ReadyAgent {
        title: text("title", MAX_TITLE_CHARS)?,
        description: text("description", MAX_DESCRIPTION_CHARS)?,
        id,
        language,
        workflow_yaml,
    })
}

/// The text of `relative` inside `plugin_dir`. `Err` says why the file is not used.
fn read_workflow(plugin_dir: &Path, relative: &str) -> Result<String, String> {
    let stays_inside = !relative.is_empty()
        && !relative.contains('\\')
        && Path::new(relative).components().all(|component| matches!(component, Component::Normal(_)));
    if !stays_inside {
        return Err(format!("`{relative}` is not a path inside the plugin folder"));
    }
    if !relative.ends_with(WORKFLOW_EXTENSION) {
        return Err(format!("`{relative}` is not a {WORKFLOW_EXTENSION} file"));
    }
    let path = relative.split('/').fold(plugin_dir.to_path_buf(), |path, part| path.join(part));
    // Not a link itself (`read_plain_file`), and no linked folder on the way out of the plugin.
    let folder = plugin_dir.canonicalize().map_err(|error| error.to_string())?;
    let resolved = path.canonicalize().map_err(|error| format!("`{relative}`: {error}"))?;
    if !resolved.starts_with(&folder) {
        return Err(format!("`{relative}` leads out of the plugin folder"));
    }
    let bytes = read_plain_file(&path, MAX_WORKFLOW_BYTES, false)
        .ok_or_else(|| format!("`{relative}` is not a plain file of at most {MAX_WORKFLOW_BYTES} bytes"))?;
    String::from_utf8(bytes).map_err(|_| format!("`{relative}` is not text"))
}

/// The bytes of a plain file of at most `max_bytes`; `None` (logged, unless the file is just
/// missing and `missing_is_normal`) for anything else.
fn read_plain_file(path: &Path, max_bytes: u64, missing_is_normal: bool) -> Option<Vec<u8>> {
    let metadata = match std::fs::symlink_metadata(path) {
        Ok(metadata) => metadata,
        Err(error) => {
            if !(missing_is_normal && error.kind() == std::io::ErrorKind::NotFound) {
                log::warn!("could not read {}: {error}", path.display());
            }
            return None;
        }
    };
    if !metadata.is_file() || metadata.len() > max_bytes {
        log::warn!("ignoring {}: not a plain file of at most {max_bytes} bytes", path.display());
        return None;
    }
    std::fs::read(path).map_err(|error| log::warn!("could not read {}: {error}", path.display())).ok()
}

/// Checks a ready-made workflow of `plugin` before it becomes an agent.
///
/// # Errors
/// A sentence saying what is wrong: a step that is neither a safe core step nor one of the
/// plugin's own operations, a document `registry` does not compile, a step that sends or
/// creates something without an approval before it, or an approval that answers by itself.
pub(crate) fn check_workflow(
    plugin: &str,
    workflow_yaml: &str,
    registry: &graphrt_core::Registry,
) -> Result<(), String> {
    let workflow = graphrt_core::Workflow::parse(workflow_yaml).map_err(|error| error.to_string())?;
    let own_prefix = format!("{plugin}.");
    let foreign: Vec<&str> = workflow
        .graph
        .nodes
        .iter()
        .map(|node| node.kind.as_str())
        .filter(|kind| !SAFE_CORE_KINDS.contains(kind) && !kind.starts_with(&own_prefix))
        .collect();
    if !foreign.is_empty() {
        return Err(format!("a ready-made agent may not use these steps: {}", foreign.join(", ")));
    }
    let graph = graphrt_core::Graph::build(workflow, registry).map_err(|error| error.to_string())?;
    let trusted = TrustedHosts::none();
    let unapproved = crate::flow::unapproved_steps(&graph, &trusted);
    if !unapproved.is_empty() {
        let labels: Vec<&str> = unapproved.iter().map(|step| step.label.as_str()).collect();
        return Err(format!("these steps run without asking first: {}", labels.join(", ")));
    }
    if let Some(timeout) = crate::flow::timeouts_that_send(&graph, &trusted).first() {
        return Err(crate::flow::timeout_send_message(timeout));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    const ASK_THEN_ANSWER: &str = r#"
version: "1"
name: ask
graph:
  nodes:
    - id: start
      type: start
      variables:
        - { variable: client, label: Client, type: text-input, required: true }
    - id: ask
      type: human-input
      prompt: "Continue for {{#start.client#}}?"
      actions:
        - { id: yes, title: Yes }
    - { id: done, type: answer, answer: "Done for {{#start.client#}}" }
  edges:
    - { source: start, target: ask }
    - { source: ask, target: done, handle: yes }
"#;

    fn plugin_folder(agents_json: &str) -> tempfile::TempDir {
        let folder = tempfile::tempdir().unwrap();
        std::fs::create_dir(folder.path().join("agents")).unwrap();
        std::fs::write(folder.path().join("agents").join("ask.yaml"), ASK_THEN_ANSWER).unwrap();
        std::fs::write(folder.path().join(AGENTS_FILE_NAME), agents_json).unwrap();
        folder
    }

    #[test]
    fn reads_the_agents_a_plugin_ships_and_skips_the_ones_it_cannot_use() {
        let folder = plugin_folder(
            r#"{ "agents": [
                { "id": "ask", "title": " Ask first ", "description": "Asks, then answers", "language": "en", "workflow": "agents/ask.yaml" },
                { "id": "ask", "title": "Same id again", "description": "x", "workflow": "agents/ask.yaml" },
                { "id": "tanya", "title": "Tanya dulu", "description": "Bertanya, lalu menjawab", "workflow": "agents/ask.yaml" },
                { "id": "Bad_Id", "title": "x", "description": "x", "workflow": "agents/ask.yaml" },
                { "id": "no-title", "description": "x", "workflow": "agents/ask.yaml" },
                { "id": "odd-language", "title": "x", "description": "x", "language": "english", "workflow": "agents/ask.yaml" },
                { "id": "unknown-key", "title": "x", "description": "x", "workflow": "agents/ask.yaml", "prompt": "x" },
                { "id": "missing-file", "title": "x", "description": "x", "workflow": "agents/none.yaml" },
                "an item this app cannot read"
            ] }"#,
        );
        let agents = read_ready_agents(folder.path());
        let ask = ReadyAgent {
            id: "ask".into(),
            title: "Ask first".into(),
            description: "Asks, then answers".into(),
            language: Some("en".into()),
            workflow_yaml: ASK_THEN_ANSWER.into(),
        };
        assert_eq!(agents.len(), 2, "{agents:?}");
        assert_eq!(agents[0], ask);
        assert_eq!((agents[1].id.as_str(), agents[1].language.as_deref()), ("tanya", None));
    }

    #[test]
    fn a_plugin_without_the_file_or_with_a_broken_one_has_none() {
        let folder = tempfile::tempdir().unwrap();
        assert!(read_ready_agents(folder.path()).is_empty());
        for broken in ["{ not json", r#"{ "agents": "none" }"#, "[]"] {
            let folder = plugin_folder(broken);
            assert!(read_ready_agents(folder.path()).is_empty(), "{broken}");
        }
    }

    #[test]
    fn a_workflow_outside_the_plugin_folder_is_refused() {
        let outside = tempfile::tempdir().unwrap();
        let secret = outside.path().join("secret.yaml");
        std::fs::write(&secret, ASK_THEN_ANSWER).unwrap();
        let folder = plugin_folder("{}");
        let absolute = secret.to_string_lossy().into_owned();
        for path in [
            "../secret.yaml",
            "agents/../../secret.yaml",
            absolute.as_str(),
            "",
            "agents",
            "agents/ask.txt",
            "agents\\ask.yaml",
            "/agents/ask.yaml",
        ] {
            assert!(read_workflow(folder.path(), path).is_err(), "{path}");
        }
        assert!(read_workflow(folder.path(), "agents/missing.yaml").is_err());
        assert_eq!(read_workflow(folder.path(), "agents/ask.yaml").unwrap(), ASK_THEN_ANSWER);
    }

    #[cfg(unix)]
    #[test]
    fn a_link_out_of_the_plugin_folder_is_refused() {
        let outside = tempfile::tempdir().unwrap();
        std::fs::write(outside.path().join("secret.yaml"), ASK_THEN_ANSWER).unwrap();
        let folder = plugin_folder("{}");
        std::os::unix::fs::symlink(outside.path().join("secret.yaml"), folder.path().join("agents").join("link.yaml"))
            .unwrap();
        std::os::unix::fs::symlink(outside.path(), folder.path().join("linked")).unwrap();
        // A link to a file inside the folder is not a plain file either.
        std::os::unix::fs::symlink(
            folder.path().join("agents").join("ask.yaml"),
            folder.path().join("agents").join("inner.yaml"),
        )
        .unwrap();
        assert!(read_workflow(folder.path(), "agents/inner.yaml").is_err());
        assert!(read_workflow(folder.path(), "agents/link.yaml").is_err());
        assert!(read_workflow(folder.path(), "linked/secret.yaml").is_err());
    }

    #[test]
    fn a_workflow_that_is_too_large_is_refused() {
        let folder = plugin_folder("{}");
        let large = format!("{ASK_THEN_ANSWER}\n#{}", "x".repeat(MAX_WORKFLOW_BYTES as usize));
        std::fs::write(folder.path().join("agents").join("large.yaml"), large).unwrap();
        assert!(read_workflow(folder.path(), "agents/large.yaml").is_err());
    }

    #[test]
    fn only_safe_core_steps_and_the_plugins_own_operations_pass() {
        let registry = crate::flow::builtin_node_registry();
        assert_eq!(check_workflow("docs", ASK_THEN_ANSWER, &registry), Ok(()));

        for (kind, config) in [
            ("http-request", "method: get, url: \"https://example.org\""),
            ("code", "code: \"1\""),
            ("llm", "model: { provider: openai, name: gpt-4o-mini }"),
            ("other-plugin.send_text", "text: hi"),
        ] {
            let with_step = ASK_THEN_ANSWER.replace(
                "    - { id: done, type: answer,",
                &format!("    - {{ id: extra, type: {kind}, {config} }}\n    - {{ id: done, type: answer,"),
            );
            let refused = check_workflow("docs", &with_step, &registry).unwrap_err();
            assert!(refused.contains(kind), "{kind}: {refused}");
        }
        assert!(check_workflow("docs", "not: a workflow", &registry).is_err());
    }
}
