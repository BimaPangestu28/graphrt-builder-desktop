//! The builder prompt's dynamic section: the step types of installed plugins
//! and of catalog plugins that are not installed yet (the user is asked to
//! install those after the draft).

use graphrt_core::catalog::NodeDescriptor;

use super::host::PluginState;
use super::models::{CatalogIndex, CatalogNode, CatalogPlugin};
use super::placeholder::catalog_descriptor;

/// Most config fields listed per node kind (the rest are optional extras).
const MAX_FIELDS_PER_NODE: usize = 12;
/// Description excerpt length per node kind.
const MAX_DESCRIPTION_CHARS: usize = 220;
/// Catalog plugins are listed more briefly: there are many of them.
const MAX_CATALOG_FIELDS_PER_NODE: usize = 8;
const MAX_CATALOG_DESCRIPTION_CHARS: usize = 110;
/// Most catalog plugins whose steps are listed for one job. The catalog holds about 150
/// plugins with close to 2,000 steps: all of them is about 130,000 tokens, more than a
/// cloud model reads and 30 times what a local one does.
const MAX_JOB_CATALOG_PLUGINS: usize = 6;
/// Most steps listed per catalog plugin; the job's own words pick them first.
const MAX_CATALOG_NODES_PER_PLUGIN: usize = 30;
/// Words of plugin names that say nothing about the service.
const GENERIC_NAME_WORDS: &[&str] = &["api", "app", "web", "mcp", "the", "and", "for", "with", "tool", "tools", "data"];

const SECTION_HEADER: &str = "\
- Plugins add the step types listed below. Use a plugin step (its kind as the node `type`, its \
fields directly on the node) instead of a raw `http-request` whenever a listed plugin covers the service, \
installed or not: the app asks the user to install the plugins a draft uses. Their tokens and account settings are configured in the app (Connections > Plugins): never put them in \
`env` or in the document, and leave fields such as `access_token` out. Plugin steps output `data` (and \
`next_cursor` when listing); read results as `{{#<node id>.data...#}}`. Set only the fields the job needs: \
leave an optional field out (a folder, a file name, a limit) so the plugin's own default applies, unless the \
user asks for a specific value. Plugin steps that send, post, \
create, update or delete follow the approval rule above.";

/// The section for the published plugins and catalog, or an empty string when there are
/// none. `job` is what the agent should do (and for a change, also the change and the
/// plugins its document uses): catalog plugins it names are listed with their steps, the
/// others by name only.
pub fn installed_plugins_guide(job: &str) -> String {
    let catalog = super::active::current_catalog();
    match super::active::current() {
        Some(snapshot) => plugin_guide(&snapshot.plugins, catalog.as_deref(), job),
        None => plugin_guide(&[], catalog.as_deref(), job),
    }
}

/// How much of each node is listed.
#[derive(Clone, Copy)]
struct Detail {
    max_fields: usize,
    max_description_chars: usize,
}

const INSTALLED_DETAIL: Detail =
    Detail { max_fields: MAX_FIELDS_PER_NODE, max_description_chars: MAX_DESCRIPTION_CHARS };
const CATALOG_DETAIL: Detail =
    Detail { max_fields: MAX_CATALOG_FIELDS_PER_NODE, max_description_chars: MAX_CATALOG_DESCRIPTION_CHARS };

/// The section for `plugins` (only loaded ones are listed) and the `catalog`
/// plugins that are not among them: those `job` names with their steps, the rest by name.
pub(crate) fn plugin_guide(plugins: &[PluginState], catalog: Option<&CatalogIndex>, job: &str) -> String {
    let loaded: Vec<&PluginState> =
        plugins.iter().filter(|plugin| plugin.is_loaded() && !plugin.descriptors.is_empty()).collect();
    let not_installed: Vec<&CatalogPlugin> = catalog
        .map(|catalog| {
            catalog
                .plugins
                .iter()
                .filter(|entry| !entry.nodes.is_empty())
                .filter(|entry| !loaded.iter().any(|plugin| plugin.name == entry.name))
                .collect()
        })
        .unwrap_or_default();
    if loaded.is_empty() && not_installed.is_empty() {
        return String::new();
    }
    let mut section = SECTION_HEADER.to_owned();
    for plugin in loaded {
        section.push_str(&format!(
            "\n  Plugin `{}`: {}",
            plugin.name,
            one_line(&plugin.description, MAX_DESCRIPTION_CHARS)
        ));
        for descriptor in &plugin.descriptors {
            section
                .push_str(&format!("\n  - `{}`", describe_node(descriptor, &plugin.permissions.env, INSTALLED_DETAIL)));
        }
    }
    let job_words = words(job);
    let (named, others) = named_by_job(not_installed, &job_words);
    for entry in named {
        section.push_str(&format!(
            "\n  Plugin `{}` (not installed yet): {}",
            entry.name,
            one_line(&entry.description, MAX_DESCRIPTION_CHARS)
        ));
        let nodes = nodes_for_job(entry, &job_words);
        for node in &nodes {
            let descriptor = catalog_descriptor(node, &entry.name);
            section
                .push_str(&format!("\n  - `{}`", describe_node(&descriptor, &entry.permissions.env, CATALOG_DETAIL)));
        }
        if entry.nodes.len() > nodes.len() {
            section.push_str(&format!("\n  - and {} more steps of this plugin", entry.nodes.len() - nodes.len()));
        }
    }
    if !others.is_empty() {
        let names: Vec<&str> = others.iter().map(|entry| entry.name.as_str()).collect();
        section.push_str(&format!(
            "\n  Other plugins in the catalog, not installed (their steps are not listed here, so do not use them): {}.",
            names.join(", ")
        ));
    }
    section
}

/// The catalog plugins whose name the job uses (best match first, at most
/// [`MAX_JOB_CATALOG_PLUGINS`]), and the others.
///
/// @example a job "summarize a Wikipedia page" names `wikipedia`
fn named_by_job<'a>(
    plugins: Vec<&'a CatalogPlugin>,
    job_words: &[String],
) -> (Vec<&'a CatalogPlugin>, Vec<&'a CatalogPlugin>) {
    let mut scored: Vec<(usize, usize, &CatalogPlugin)> = Vec::new();
    let mut others = Vec::new();
    for (position, entry) in plugins.into_iter().enumerate() {
        let name_words = words(&format!("{} {}", entry.name, entry.display_name.as_deref().unwrap_or_default()));
        let matches = name_words
            .iter()
            .filter(|word| word.chars().count() >= 3 && !GENERIC_NAME_WORDS.contains(&word.as_str()))
            .filter(|word| has_word(job_words, word))
            .collect::<std::collections::BTreeSet<_>>()
            .len();
        if matches == 0 {
            others.push(entry);
        } else {
            scored.push((matches, position, entry));
        }
    }
    scored.sort_by_key(|(matches, position, _)| (std::cmp::Reverse(*matches), *position));
    let mut named = Vec::new();
    for (index, (_, _, entry)) in scored.into_iter().enumerate() {
        if index < MAX_JOB_CATALOG_PLUGINS {
            named.push(entry);
        } else {
            others.push(entry);
        }
    }
    others.sort_by(|left, right| left.name.cmp(&right.name));
    (named, others)
}

/// Up to [`MAX_CATALOG_NODES_PER_PLUGIN`] steps of `entry`: those sharing a word with the
/// job first, then in the plugin's own order.
fn nodes_for_job<'a>(entry: &'a CatalogPlugin, job_words: &[String]) -> Vec<&'a CatalogNode> {
    let shares_a_word = |node: &CatalogNode| {
        let operation = node.kind.split_once('.').map_or(node.kind.as_str(), |(_, operation)| operation);
        words(&format!("{operation} {}", node.title))
            .iter()
            .any(|word| word.chars().count() >= 3 && has_word(job_words, word))
    };
    let (mut chosen, rest): (Vec<&CatalogNode>, Vec<&CatalogNode>) =
        entry.nodes.iter().partition(|node| shares_a_word(node));
    chosen.extend(rest);
    chosen.truncate(MAX_CATALOG_NODES_PER_PLUGIN);
    // Listed in the plugin's own order, which groups related steps.
    chosen.sort_by_key(|node| entry.nodes.iter().position(|other| other.kind == node.kind));
    chosen
}

/// Whether `words` holds `word`, also as a plural ("emails" names "email").
fn has_word(words: &[String], word: &str) -> bool {
    words.iter().any(|candidate| candidate == word || candidate.strip_suffix('s') == Some(word))
}

/// Lowercase words of a job or of a name such as `google-sheets` or `send_email`.
fn words(text: &str) -> Vec<String> {
    text.to_lowercase()
        .split(|character: char| !character.is_alphanumeric())
        .filter(|word| !word.is_empty())
        .map(str::to_owned)
        .collect()
}

/// "kind` (Title): description. Fields: a*, b. Outputs: data" (the caller adds the opening backtick).
fn describe_node(descriptor: &NodeDescriptor, configured_env: &[String], detail: Detail) -> String {
    let mut line = format!("{}` ({})", descriptor.kind, descriptor.title);
    let description = one_line(&descriptor.description, detail.max_description_chars);
    if !description.is_empty() {
        line.push_str(&format!(": {description}"));
    }
    let fields = config_fields(&descriptor.config_schema, configured_env, detail.max_fields);
    if !fields.is_empty() {
        line.push_str(&format!(" Fields (* required): {}.", fields.join(", ")));
    }
    let outputs: Vec<&str> = descriptor.outputs.iter().map(|output| output.name.as_str()).collect();
    if !outputs.is_empty() {
        line.push_str(&format!(" Outputs: {}.", outputs.join(", ")));
    }
    line
}

/// `name*` / `name (type)` per schema property (required ones first), leaving out fields the app
/// configures (a property named like the end of a requested env variable,
/// e.g. `phone_number_id` for `WHATSAPP_PHONE_NUMBER_ID`, and `access_token`).
fn config_fields(schema: &serde_json::Value, configured_env: &[String], max_fields: usize) -> Vec<String> {
    let Some(properties) = schema.get("properties").and_then(serde_json::Value::as_object) else {
        return Vec::new();
    };
    let required: Vec<&str> = schema
        .get("required")
        .and_then(serde_json::Value::as_array)
        .map(|names| names.iter().filter_map(serde_json::Value::as_str).collect())
        .unwrap_or_default();
    let mut offered: Vec<(&String, &serde_json::Value)> =
        properties.iter().filter(|(name, _)| !is_configured_by_app(name, configured_env)).collect();
    // Required fields first, so the cap never hides one.
    offered.sort_by_key(|(name, _)| !required.contains(&name.as_str()));
    offered
        .into_iter()
        .take(max_fields)
        .map(|(name, property)| {
            let type_name = property.get("type").and_then(serde_json::Value::as_str).unwrap_or("any");
            let marker = if required.contains(&name.as_str()) { "*" } else { "" };
            format!("{name}{marker} ({type_name})")
        })
        .collect()
}

fn is_configured_by_app(field: &str, configured_env: &[String]) -> bool {
    let upper = field.to_ascii_uppercase();
    upper == "ACCESS_TOKEN" || configured_env.iter().any(|variable| variable.ends_with(&format!("_{upper}")))
}

fn one_line(text: &str, max_chars: usize) -> String {
    let collapsed = text.split_whitespace().collect::<Vec<_>>().join(" ");
    if collapsed.chars().count() <= max_chars {
        return collapsed;
    }
    let cut: String = collapsed.chars().take(max_chars).collect();
    format!("{}…", cut.trim_end())
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A catalog the size of the real one: `count` plugins of 12 steps each, plus `wikipedia`.
    fn large_catalog(count: usize) -> CatalogIndex {
        let mut plugins: Vec<serde_json::Value> = (0..count)
            .map(|index| {
                let name = format!("service{index}-api");
                let nodes: Vec<serde_json::Value> = (0..12)
                    .map(|step| serde_json::json!({ "kind": format!("{name}.list_items_{step}"), "title": format!("List items {step}") }))
                    .collect();
                serde_json::json!({
                    "name": name, "version": "1.0.0", "description": "A service with many steps.",
                    "tarball_url": format!("https://plugins.example.test/{name}.tgz"), "sha256": "0".repeat(64),
                    "size_bytes": 1, "nodes": nodes,
                })
            })
            .collect();
        plugins.push(serde_json::json!({
            "name": "wikipedia", "display_name": "Wikipedia", "version": "1.0.0",
            "description": "Read Wikipedia articles.", "tarball_url": "https://plugins.example.test/wikipedia.tgz",
            "sha256": "0".repeat(64), "size_bytes": 1,
            "nodes": [
                { "kind": "wikipedia.get_summary", "title": "Get page summary" },
                { "kind": "wikipedia.search", "title": "Search articles" },
            ],
        }));
        let index = serde_json::json!({ "schema": 1, "plugins": plugins });
        crate::plugins::catalog::parse_catalog(&serde_json::to_vec(&index).unwrap()).unwrap()
    }

    #[test]
    fn only_the_catalog_plugins_a_job_names_are_listed_with_their_steps() {
        let catalog = large_catalog(150);

        let guide = plugin_guide(&[], Some(&catalog), "Look up the Wikipedia page summary for Jakarta");

        assert!(guide.contains("Plugin `wikipedia` (not installed yet)"), "{guide}");
        assert!(guide.contains("`wikipedia.get_summary` (Get page summary)"), "{guide}");
        assert!(!guide.contains("service7-api.list_items_0"), "{guide}");
        assert!(guide.contains("Other plugins in the catalog") && guide.contains("service7-api"), "{guide}");
        // 150 plugins by name stay far below what a model reads (all steps were ~130,000 tokens).
        assert!(guide.len() < 6_000, "{} bytes", guide.len());
    }

    #[test]
    fn a_job_that_names_no_plugin_lists_the_catalog_by_name_only() {
        let catalog = large_catalog(3);

        let guide = plugin_guide(&[], Some(&catalog), "Write a polite reply to a complaint");

        assert!(!guide.contains("(not installed yet)"), "{guide}");
        assert!(guide.contains("service0-api, service1-api, service2-api, wikipedia."), "{guide}");
    }

    #[test]
    fn a_plugin_with_many_steps_lists_the_ones_the_job_names_first() {
        let mut catalog = large_catalog(0);
        let wikipedia = &mut catalog.plugins[0];
        let template = wikipedia.nodes[0].clone();
        wikipedia.nodes = (0..40)
            .map(|step| CatalogNode {
                kind: format!("wikipedia.op_{step}"),
                title: if step == 37 { "Random article".into() } else { format!("Step {step}") },
                ..template.clone()
            })
            .collect();

        let guide = plugin_guide(&[], Some(&catalog), "Show me a random Wikipedia article");

        assert!(guide.contains("`wikipedia.op_37` (Random article)"), "{guide}");
        assert!(guide.contains("and 10 more steps of this plugin"), "{guide}");
    }

    #[test]
    fn more_named_plugins_than_the_cap_are_ranked_by_how_many_words_match() {
        let names = ["google-sheets", "google-drive", "google-calendar", "google-docs", "google-forms", "google-maps"];
        let mut plugins: Vec<serde_json::Value> = names
            .iter()
            .map(|name| {
                serde_json::json!({
                    "name": name, "version": "1.0.0", "description": "Google.",
                    "tarball_url": format!("https://plugins.example.test/{name}.tgz"), "sha256": "0".repeat(64),
                    "size_bytes": 1, "nodes": [{ "kind": format!("{name}.op"), "title": "Op" }],
                })
            })
            .collect();
        plugins.push(serde_json::json!({
            "name": "google-slides", "version": "1.0.0", "description": "Google.",
            "tarball_url": "https://plugins.example.test/s.tgz", "sha256": "0".repeat(64), "size_bytes": 1,
            "nodes": [{ "kind": "google-slides.op", "title": "Op" }],
        }));
        let index = serde_json::json!({ "schema": 1, "plugins": plugins });
        let catalog = crate::plugins::catalog::parse_catalog(&serde_json::to_vec(&index).unwrap()).unwrap();

        let guide = plugin_guide(&[], Some(&catalog), "Add a row to my Google Sheets spreadsheet");

        assert!(guide.contains("Plugin `google-sheets` (not installed yet)"), "{guide}");
        assert_eq!(guide.matches("(not installed yet)").count(), MAX_JOB_CATALOG_PLUGINS, "{guide}");
    }
}
