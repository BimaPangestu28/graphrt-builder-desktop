//! Auto sync of connector sources: a background task that wakes every
//! [`TICK_SECONDS`] and syncs the sources whose schedule is due (every N
//! hours, daily at a time, or cron, see graphrt-connect's `SyncSchedule`).
//!
//! A source that never synced is due at once; a sync missed while the app was
//! closed runs once at the next start. Due sources of one knowledge base sync
//! together, in the background, so agents keep running.

use std::collections::BTreeMap;
use std::sync::Arc;
use std::time::Duration;

use super::connectors::{next_due, scheduled_sources};
use super::KnowledgeService;
use crate::error::AppResult;

/// How often the schedule is checked.
pub const TICK_SECONDS: u64 = 60;

/// The due sources at `now`, by knowledge base.
pub fn due_sources(service: &KnowledgeService, now: i64) -> AppResult<BTreeMap<String, Vec<String>>> {
    let mut due: BTreeMap<String, Vec<String>> = BTreeMap::new();
    for source in scheduled_sources(&service.db)? {
        if next_due(&source.schedule, source.last_synced_at.as_deref(), now).is_some_and(|at| at <= now) {
            due.entry(source.knowledge_base_id).or_default().push(source.source_id);
        }
    }
    Ok(due)
}

/// Starts the auto sync task.
pub fn spawn(service: Arc<KnowledgeService>) {
    tauri::async_runtime::spawn(async move {
        // Give the app a moment to start before the first sync.
        tokio::time::sleep(Duration::from_secs(10)).await;
        let mut ticks = tokio::time::interval(Duration::from_secs(TICK_SECONDS));
        ticks.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);
        loop {
            ticks.tick().await;
            let due = match due_sources(&service, chrono::Utc::now().timestamp()) {
                Ok(due) => due,
                Err(error) => {
                    log::warn!("could not check the knowledge sync schedule: {error}");
                    continue;
                }
            };
            for (knowledge_base_id, source_ids) in due {
                let service = Arc::clone(&service);
                tauri::async_runtime::spawn(async move {
                    if let Err(error) = service.sync_sources(&knowledge_base_id, &source_ids).await {
                        log::warn!("scheduled sync of knowledge base {knowledge_base_id} failed: {error}");
                    }
                });
            }
        }
    });
}
