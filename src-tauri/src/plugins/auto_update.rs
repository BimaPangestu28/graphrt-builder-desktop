//! Keeping installed plugins up to date without asking for every new version.
//!
//! Policy (Settings › Updates › "Automatically update plugins", on by default):
//!
//! - Once shortly after launch and then every [`CHECK_INTERVAL`], the catalog is
//!   fetched again (the saved copy when offline) and every installed plugin whose
//!   catalog version differs is updated, **only** when the new version asks for
//!   nothing more than the installed one ([`PluginPermissions::asks_for_more_than`]).
//!   Updates asking for more settings or plaintext secrets wait for the user
//!   ("needs your approval") and are never installed here. The same limit is checked
//!   against the downloaded manifest before it replaces anything, so trust never
//!   changes in the background.
//! - Nothing is updated while any agent run is running or paused (a paused run
//!   resumes with the plugins it compiled with); the check is retried after
//!   [`RETRY_INTERVAL`].
//! - Plugins are never installed or removed here, and trust is never changed.
//! - Sideloaded (`local`) plugins are skipped: never auto-updated, never matched against
//!   the catalog, even when it lists a plugin of the same name
//!   ([`PluginService::catalog_matched_plugins`]).
//! - Community plugins (`source: community` in the catalog entry or in the install record)
//!   are never updated here, whatever they ask for: their code comes from a third party, so
//!   each new version waits for the user and is listed in `needs_approval`
//!   ([`hold_back_community`]).
//! - Every automatic update is remembered (name, from → to, when) in the settings
//!   table (`plugins.auto_updated`, newest first, at most [`HISTORY_LIMIT`]) so Home
//!   can say "Updated google-maps-scraper to 0.2.1".
//!
//! "Update all" on Home uses the same rule ([`PluginService::update_all_ready`]),
//! started by the user, so it neither waits for idle runs nor records history. It does
//! offer community updates (the user asked for them), with the same permission limit.

use std::collections::HashSet;
use std::sync::Arc;
use std::time::Duration;

use serde::{Deserialize, Serialize};

use super::catalog::update_asks_for_more;
use super::host::PluginState;
use super::models::{CatalogIndex, PluginPermissions, PluginSource};
use super::{settings, source, InstallMode, PluginService};
use crate::desktop::app_settings::AppSettings;
use crate::error::AppResult;
use crate::storage::Database;

/// Time between two automatic checks.
pub const CHECK_INTERVAL: Duration = Duration::from_secs(6 * 60 * 60);
/// Time before the next try when runs were in progress.
pub const RETRY_INTERVAL: Duration = Duration::from_secs(15 * 60);
/// Delay after launch, so start-up (and the first runs) are not slowed down.
const FIRST_CHECK_DELAY: Duration = Duration::from_secs(60);
/// Settings row holding the recent automatic updates.
const SETTING_AUTO_UPDATE_HISTORY: &str = "plugins.auto_updated";
/// Automatic updates remembered.
pub const HISTORY_LIMIT: usize = 20;

/// One plugin moved from one version to another.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PluginVersionChange {
    pub name: String,
    pub from_version: String,
    pub to_version: String,
}

/// An update installed automatically (`list_plugin_auto_updates`).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PluginAutoUpdate {
    pub name: String,
    pub from_version: String,
    pub to_version: String,
    /// RFC 3339 UTC.
    pub updated_at: String,
}

/// An update that could not be installed.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PluginUpdateFailure {
    pub name: String,
    pub message: String,
}

/// What one pass over the pending updates did (`update_all_plugins`).
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PluginBulkUpdateSummary {
    pub updated: Vec<PluginVersionChange>,
    /// Updates left for the user because they ask for more permissions (and, for
    /// automatic updates, every community plugin update).
    pub needs_approval: Vec<String>,
    pub failed: Vec<PluginUpdateFailure>,
}

/// What an automatic check did.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum AutoUpdateOutcome {
    /// "Automatically update plugins" is off.
    Disabled,
    /// Agent runs were running or paused: try again after [`RETRY_INTERVAL`].
    RunsActive,
    /// Neither the catalog nor its saved copy could be read.
    CatalogUnavailable(String),
    /// The pass ran; `stopped_for_runs` when a run started part way through.
    Checked { summary: PluginBulkUpdateSummary, stopped_for_runs: bool },
}

impl AutoUpdateOutcome {
    /// How long to wait before the next check.
    pub fn next_check_in(&self) -> Duration {
        match self {
            Self::RunsActive | Self::Checked { stopped_for_runs: true, .. } => RETRY_INTERVAL,
            _ => CHECK_INTERVAL,
        }
    }
}

/// An update that may be installed without asking: it asks for at most `permissions`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(super) struct ReadyUpdate {
    pub change: PluginVersionChange,
    /// The installed version's permissions: the limit for the new one.
    pub permissions: PluginPermissions,
}

/// Pending updates of installed plugins, split by whether they need the user.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub(super) struct UpdatePlan {
    pub ready: Vec<ReadyUpdate>,
    pub needs_approval: Vec<String>,
}

/// Moves the ready updates of community plugins (`community` names) to `needs_approval`:
/// automatic updates never install third-party code the user has not looked at.
pub(super) fn hold_back_community(plan: UpdatePlan, community: &HashSet<String>) -> UpdatePlan {
    let (held, ready): (Vec<ReadyUpdate>, Vec<ReadyUpdate>) =
        plan.ready.into_iter().partition(|update| community.contains(&update.change.name));
    let mut needs_approval = plan.needs_approval;
    for update in held {
        log::info!(
            "plugin {} {} is a community plugin; the update waits for the user",
            update.change.name,
            update.change.to_version
        );
        needs_approval.push(update.change.name);
    }
    UpdatePlan { ready, needs_approval }
}

/// Splits the installed plugins with a newer catalog version (the same rule as the
/// catalog's `update_available`) into updates that ask for nothing more and updates
/// that need the user's approval. Plugins the catalog does not list are left alone.
pub(super) fn plan_updates(index: &CatalogIndex, installed: &[PluginState]) -> UpdatePlan {
    let mut plan = UpdatePlan::default();
    for state in installed {
        let Some(entry) = index.plugins.iter().find(|plugin| plugin.name == state.name) else { continue };
        if !super::catalog::is_newer_version(&entry.version, &state.version) {
            continue;
        }
        if update_asks_for_more(entry, state) {
            plan.needs_approval.push(state.name.clone());
            continue;
        }
        plan.ready.push(ReadyUpdate {
            change: PluginVersionChange {
                name: state.name.clone(),
                from_version: state.version.clone(),
                to_version: entry.version.clone(),
            },
            permissions: state.permissions.clone(),
        });
    }
    plan
}

impl PluginService {
    /// Installs every pending update that asks for nothing more than the installed
    /// version ("Update all"); the others are listed in `needs_approval`.
    ///
    /// # Errors
    /// The catalog fetch error when there is neither a fetched nor a saved catalog.
    pub async fn update_all_ready(&self) -> AppResult<PluginBulkUpdateSummary> {
        let index = match self.cached_catalog() {
            Some(index) => index,
            None => Arc::new(self.fetch_catalog().await?.0),
        };
        let plan = plan_updates(&index, &self.catalog_matched_plugins());
        Ok(self.apply_plan(plan, false).await.0)
    }

    /// One automatic check (see the module docs for the policy).
    pub async fn run_auto_update_cycle(&self) -> AutoUpdateOutcome {
        if !AppSettings::load_or_default(&self.db).auto_update_plugins {
            return AutoUpdateOutcome::Disabled;
        }
        if has_active_runs(&self.db) {
            return AutoUpdateOutcome::RunsActive;
        }
        let index = match self.fetch_catalog().await {
            Ok((index, _)) => index,
            Err(error) => return AutoUpdateOutcome::CatalogUnavailable(error.to_string()),
        };
        let plan = plan_updates(&index, &self.catalog_matched_plugins());
        let plan = hold_back_community(plan, &self.community_plugin_names(&index));
        let (summary, stopped_for_runs) = self.apply_plan(plan, true).await;
        if let Err(error) = record_auto_updates(&self.db, &summary.updated, &crate::storage::now_rfc3339()) {
            log::warn!("could not remember the automatic plugin updates: {error}");
        }
        AutoUpdateOutcome::Checked { summary, stopped_for_runs }
    }

    /// Plugins that are community plugins by the catalog entry or by their install record.
    /// An unreadable install record counts every installed plugin as community (safe side).
    fn community_plugin_names(&self, index: &CatalogIndex) -> HashSet<String> {
        let mut names: HashSet<String> = index
            .plugins
            .iter()
            .filter(|entry| source::catalog_entry_source(entry) == PluginSource::Community)
            .map(|entry| entry.name.clone())
            .collect();
        match settings::install_records(&self.db) {
            Ok(records) => names.extend(
                records
                    .into_iter()
                    .filter(|(_, record)| record.source == PluginSource::Community)
                    .map(|(name, _)| name),
            ),
            Err(error) => {
                log::warn!("could not read the plugin install records; no plugin updates by itself: {error}");
                names.extend(self.snapshot().plugins.iter().map(|plugin| plugin.name.clone()));
            }
        }
        names
    }

    /// The remembered automatic updates, newest first.
    ///
    /// # Errors
    /// `Database` when the settings table cannot be read.
    pub fn recent_auto_updates(&self) -> AppResult<Vec<PluginAutoUpdate>> {
        read_history(&self.db)
    }

    /// Installs `plan.ready` one by one within each plugin's current permissions.
    /// With `waits_for_idle_runs`, stops (returning `true`) once a run is active.
    async fn apply_plan(&self, plan: UpdatePlan, waits_for_idle_runs: bool) -> (PluginBulkUpdateSummary, bool) {
        let mut summary = PluginBulkUpdateSummary { needs_approval: plan.needs_approval, ..Default::default() };
        for ready in plan.ready {
            if waits_for_idle_runs && has_active_runs(&self.db) {
                return (summary, true);
            }
            let name = ready.change.name.clone();
            match self.install_with(&name, &InstallMode::within(ready.permissions)).await {
                Ok(installed) => {
                    log::info!("updated plugin {name} from {} to {}", ready.change.from_version, installed.version);
                    summary.updated.push(PluginVersionChange { to_version: installed.version, ..ready.change });
                }
                Err(error) => {
                    log::warn!("could not update plugin {name}: {error}");
                    summary.failed.push(PluginUpdateFailure { name, message: error.to_string() });
                }
            }
        }
        (summary, false)
    }
}

/// Whether any run is running or paused; an unreadable table counts as busy (safe side).
fn has_active_runs(db: &Database) -> bool {
    db.count_active_runs().map(|count| count > 0).unwrap_or_else(|error| {
        log::warn!("could not count active runs, postponing plugin updates: {error}");
        true
    })
}

pub(super) fn read_history(db: &Database) -> AppResult<Vec<PluginAutoUpdate>> {
    let Some(text) = db.get_setting(SETTING_AUTO_UPDATE_HISTORY)? else { return Ok(Vec::new()) };
    Ok(serde_json::from_str(&text).unwrap_or_else(|error| {
        log::warn!("ignoring the unreadable automatic plugin update history: {error}");
        Vec::new()
    }))
}

/// Puts `changes` (made at `updated_at`) first in the history, keeping [`HISTORY_LIMIT`].
pub(super) fn record_auto_updates(db: &Database, changes: &[PluginVersionChange], updated_at: &str) -> AppResult<()> {
    if changes.is_empty() {
        return Ok(());
    }
    let mut history: Vec<PluginAutoUpdate> = changes
        .iter()
        .map(|change| PluginAutoUpdate {
            name: change.name.clone(),
            from_version: change.from_version.clone(),
            to_version: change.to_version.clone(),
            updated_at: updated_at.to_owned(),
        })
        .collect();
    history.extend(read_history(db)?);
    history.truncate(HISTORY_LIMIT);
    db.set_setting(SETTING_AUTO_UPDATE_HISTORY, &serde_json::to_string(&history)?)
}

/// Starts the automatic update loop on the Tauri async runtime.
pub fn spawn(plugins: Arc<PluginService>) {
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(FIRST_CHECK_DELAY).await;
        loop {
            let outcome = plugins.run_auto_update_cycle().await;
            match &outcome {
                AutoUpdateOutcome::RunsActive => log::info!("agent runs are active; plugin updates wait"),
                AutoUpdateOutcome::CatalogUnavailable(message) => {
                    log::warn!("could not check for plugin updates: {message}")
                }
                AutoUpdateOutcome::Disabled | AutoUpdateOutcome::Checked { .. } => {}
            }
            tokio::time::sleep(outcome.next_check_in()).await;
        }
    });
}
