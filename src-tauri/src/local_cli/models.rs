//! The model choices each CLI offers, without spending usage.
//!
//! - Claude Code: "CLI default" plus the `--model` aliases its help names (always
//!   including `sonnet`, `opus` and `haiku`), which follow the latest models.
//! - Codex: "CLI default" plus the listed models of its bundled catalog
//!   (`codex debug models --bundled`, read locally, no network).

use std::path::PathBuf;
use std::sync::Mutex;
use std::time::Duration;

use serde_json::Value as Json;

use super::detect::Detection;
use super::process::run_quick;
use super::{LocalCli, CLI_DEFAULT_MODEL};
use crate::model_catalog::AvailableModel;

const CATALOG_TIMEOUT: Duration = Duration::from_secs(10);
/// Aliases every Claude Code version since 1.0 understands.
const CLAUDE_BASE_ALIASES: [&str; 3] = ["sonnet", "opus", "haiku"];

/// The models `cli` offers, "CLI default" first.
pub fn list_models(cli: LocalCli, detection: &Detection) -> Vec<AvailableModel> {
    let mut models =
        vec![AvailableModel { id: CLI_DEFAULT_MODEL.to_owned(), display_name: Some("CLI default".to_owned()) }];
    match cli {
        LocalCli::ClaudeCode => models.extend(claude_models(&detection.model_aliases)),
        LocalCli::Codex => models.extend(codex_models(detection)),
    }
    models
}

/// Claude Code aliases as models: `sonnet` → "Sonnet (latest)".
pub fn claude_models(help_aliases: &[String]) -> Vec<AvailableModel> {
    let mut aliases: Vec<String> = CLAUDE_BASE_ALIASES.iter().map(|alias| (*alias).to_owned()).collect();
    for alias in help_aliases {
        if !aliases.contains(alias) && alias != CLI_DEFAULT_MODEL {
            aliases.push(alias.clone());
        }
    }
    aliases
        .into_iter()
        .map(|alias| AvailableModel { display_name: Some(alias_display_name(&alias)), id: alias })
        .collect()
}

fn alias_display_name(alias: &str) -> String {
    let mut characters = alias.chars();
    let capitalized: String =
        characters.next().map(|first| first.to_uppercase().chain(characters).collect()).unwrap_or_default();
    format!("{capitalized} (latest)")
}

fn codex_models(detection: &Detection) -> Vec<AvailableModel> {
    static CACHE: Mutex<Option<(PathBuf, Vec<AvailableModel>)>> = Mutex::new(None);
    let Some(binary) = &detection.binary else { return Vec::new() };
    if let Ok(cache) = CACHE.lock() {
        if let Some((_, models)) = cache.as_ref().filter(|(cached_binary, _)| cached_binary == binary) {
            return models.clone();
        }
    }
    let output = run_quick(binary, &["debug", "models", "--bundled"], detection.child_path.as_deref(), CATALOG_TIMEOUT);
    let models =
        output.filter(|output| output.success).map(|output| parse_codex_catalog(&output.stdout)).unwrap_or_default();
    if let Ok(mut cache) = CACHE.lock() {
        *cache = Some((binary.clone(), models.clone()));
    }
    models
}

/// The listed (not hidden) models of `codex debug models` output, in catalog order.
pub fn parse_codex_catalog(stdout: &str) -> Vec<AvailableModel> {
    let Ok(catalog) = serde_json::from_str::<Json>(stdout.trim()) else { return Vec::new() };
    let mut entries: Vec<&Json> = catalog.get("models").and_then(Json::as_array).into_iter().flatten().collect();
    entries.sort_by_key(|entry| entry.get("priority").and_then(Json::as_i64).unwrap_or(i64::MAX));
    entries
        .into_iter()
        .filter(|entry| entry.get("visibility").and_then(Json::as_str).is_none_or(|visibility| visibility == "list"))
        .filter_map(|entry| {
            let slug = entry.get("slug").and_then(Json::as_str)?.trim();
            let display_name = entry.get("display_name").and_then(Json::as_str).map(str::to_owned);
            (!slug.is_empty()).then(|| AvailableModel { id: slug.to_owned(), display_name })
        })
        .collect()
}
