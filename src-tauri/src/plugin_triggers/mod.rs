//! Plugin triggers: events from installed plugins that start agents ("When a meeting is
//! recorded", "When a file is added").
//!
//! A plugin declares a trigger in its manifest (`triggers`, Graphrt/graphrt#74): an id,
//! a title and a `watch` node kind. An agent chooses one trigger on its Schedule screen
//! (stored in `agent_settings`, [`SUBSCRIPTION_SETTING_KEY`]). While at least one tested
//! or active agent has chosen a trigger, [`PluginTriggerService`] calls the trigger's
//! watch step **outside Runs**, again and again, with the trigger's `config` and the last
//! `cursor`. The step long-polls and returns `events` and the next `cursor` (directly or
//! under `data`). Each event starts one run of every such agent, with the event's fields
//! as the run's inputs. Failed calls are retried with a backoff; the cursor is stored, so
//! an app restart neither loses nor repeats events.
//!
//! Nothing here knows any particular plugin.

#[cfg(test)]
mod tests;

use std::collections::{BTreeSet, HashMap};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use futures::future::BoxFuture;
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};

use crate::engine::RunManager;
use crate::error::{AppError, AppResult};
use crate::plugins::PluginService;
use crate::storage::models::{Agent, AgentStatus, RunTrigger};
use crate::storage::Database;

/// `agent_settings` key holding the agent's [`TriggerRef`].
pub const SUBSCRIPTION_SETTING_KEY: &str = "plugin_trigger";
/// How often the wanted triggers are compared with the running watchers.
const RECONCILE_INTERVAL: Duration = Duration::from_secs(15);
/// First and longest wait after a failed watch call.
const FIRST_BACKOFF: Duration = Duration::from_secs(5);
const MAX_BACKOFF: Duration = Duration::from_secs(300);
/// Shortest time between two watch calls, so a plugin that returns at once cannot spin.
const MIN_CALL_INTERVAL: Duration = Duration::from_secs(1);

/// One plugin trigger: `<plugin>.<trigger>`.
#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TriggerRef {
    pub plugin: String,
    pub trigger: String,
}

impl TriggerRef {
    fn cursor_setting_key(&self) -> String {
        format!("plugin_trigger_cursor.{}.{}", self.plugin, self.trigger)
    }
}

impl std::fmt::Display for TriggerRef {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(formatter, "{}.{}", self.plugin, self.trigger)
    }
}

/// A trigger of an installed plugin, for the Schedule screen.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AvailableTrigger {
    pub plugin: String,
    pub plugin_display_name: String,
    pub trigger: String,
    pub title: String,
    pub description: String,
    /// Field names of each event (the agent's run inputs).
    pub event_fields: Vec<String>,
    /// Why it cannot run now (plugin not loaded or not trusted), or `None`.
    pub problem: Option<String>,
}

/// The agent's chosen trigger, if any.
pub fn load_subscription(db: &Database, agent_id: &str) -> AppResult<Option<TriggerRef>> {
    let stored = db.get_agent_setting(agent_id, SUBSCRIPTION_SETTING_KEY)?;
    Ok(stored.and_then(|value| serde_json::from_value(value).ok()))
}

/// Saves (or clears) the agent's trigger. Choosing one activates the agent, like saving a
/// schedule does: an event-driven agent often cannot be test-run without a real event,
/// so it would otherwise stay a draft and never run.
pub fn save_subscription(db: &Database, agent_id: &str, subscription: Option<&TriggerRef>) -> AppResult<()> {
    let agent = db.get_agent(agent_id)?;
    let value = match subscription {
        Some(trigger) => serde_json::to_value(trigger)?,
        None => Value::Null,
    };
    db.set_agent_setting(agent_id, SUBSCRIPTION_SETTING_KEY, &value)?;
    if subscription.is_some() && matches!(agent.status, AgentStatus::Draft | AgentStatus::Tested | AgentStatus::Paused)
    {
        db.set_agent_status(agent_id, AgentStatus::Active)?;
    }
    Ok(())
}

/// Agents that run on `trigger`: they chose it and are tested or active.
pub fn subscribers(db: &Database, trigger: &TriggerRef) -> AppResult<Vec<Agent>> {
    let mut agents = Vec::new();
    for agent in db.list_agents()? {
        if !matches!(agent.status, AgentStatus::Tested | AgentStatus::Active) {
            continue;
        }
        if load_subscription(db, &agent.id)?.as_ref() == Some(trigger) {
            agents.push(agent);
        }
    }
    Ok(agents)
}

/// Every trigger at least one tested or active agent has chosen.
pub fn wanted_triggers(db: &Database) -> AppResult<BTreeSet<TriggerRef>> {
    let mut wanted = BTreeSet::new();
    for agent in db.list_agents()? {
        if !matches!(agent.status, AgentStatus::Tested | AgentStatus::Active) {
            continue;
        }
        if let Some(trigger) = load_subscription(db, &agent.id)? {
            wanted.insert(trigger);
        }
    }
    Ok(wanted)
}

/// What one watch call returned.
#[derive(Debug, Clone, PartialEq)]
pub struct WatchResult {
    pub events: Vec<Map<String, Value>>,
    pub cursor: Option<String>,
}

/// Reads a watch step's outputs: `events` and `cursor` at the top level or under `data`
/// (graphrt-plugins' shape, which also has `next_cursor`).
///
/// # Errors
/// `InvalidInput` when `events` is missing, not a list, or holds something other than
/// objects.
pub fn parse_watch_outputs(outputs: &Map<String, Value>) -> AppResult<WatchResult> {
    let container = match outputs.get("events") {
        Some(_) => outputs,
        None => outputs.get("data").and_then(Value::as_object).unwrap_or(outputs),
    };
    let events = container
        .get("events")
        .and_then(Value::as_array)
        .ok_or_else(|| AppError::InvalidInput("the trigger's watch step returned no `events` list".into()))?;
    let events = events
        .iter()
        .map(|event| {
            event.as_object().cloned().ok_or_else(|| AppError::InvalidInput("a trigger event is not an object".into()))
        })
        .collect::<AppResult<Vec<_>>>()?;
    let cursor = ["cursor", "next_cursor"]
        .iter()
        .find_map(|key| container.get(*key).and_then(Value::as_str))
        .or_else(|| outputs.get("next_cursor").and_then(Value::as_str))
        .map(str::to_owned)
        .filter(|cursor| !cursor.is_empty());
    Ok(WatchResult { events, cursor })
}

/// The trigger's watch call arguments: its `config` plus `cursor` when there is one.
fn watch_config(config: &Value, cursor: Option<&str>) -> Value {
    let mut fields = config.as_object().cloned().unwrap_or_default();
    match cursor {
        Some(cursor) => fields.insert("cursor".into(), Value::String(cursor.to_owned())),
        None => fields.remove("cursor"),
    };
    Value::Object(fields)
}

/// The next wait after `failures` consecutive failed calls.
pub fn backoff_after(failures: u32) -> Duration {
    let factor = 2_u32.saturating_pow(failures.saturating_sub(1).min(16));
    FIRST_BACKOFF.saturating_mul(factor).min(MAX_BACKOFF)
}

/// Where triggers come from and how a watch step runs. The app uses [`PluginService`].
pub trait TriggerHost: Send + Sync + std::fmt::Debug {
    /// Every trigger of the installed plugins.
    fn available(&self) -> Vec<AvailableTrigger>;
    /// The trigger's watch node kind and config, when it can run now.
    fn watch_step(&self, trigger: &TriggerRef) -> Option<(String, Value)>;
    /// Runs the watch node once with `config` and returns its outputs.
    fn call(&self, plugin: &str, kind: &str, config: Value) -> BoxFuture<'_, AppResult<Map<String, Value>>>;
}

impl TriggerHost for PluginService {
    fn available(&self) -> Vec<AvailableTrigger> {
        let snapshot = self.snapshot();
        let mut triggers = Vec::new();
        for plugin in &snapshot.plugins {
            for trigger in &plugin.triggers {
                let problem = if !plugin.is_loaded() {
                    Some(format!("{} is not loaded", plugin.name))
                } else if !plugin.trusted {
                    Some(format!("trust {} to let it start agents", plugin.name))
                } else {
                    None
                };
                triggers.push(AvailableTrigger {
                    plugin: plugin.name.clone(),
                    plugin_display_name: crate::plugins::display_name::humanize_plugin_name(&plugin.name),
                    trigger: trigger.id.clone(),
                    title: trigger.title.clone(),
                    description: trigger.description.clone(),
                    event_fields: trigger.outputs.iter().map(|output| output.name.clone()).collect(),
                    problem,
                });
            }
        }
        triggers
    }

    fn watch_step(&self, trigger: &TriggerRef) -> Option<(String, Value)> {
        let snapshot = self.snapshot();
        let plugin = snapshot.plugin(&trigger.plugin)?;
        if !plugin.is_loaded() || !plugin.trusted {
            return None;
        }
        let declared = plugin.triggers.iter().find(|declared| declared.id == trigger.trigger)?;
        plugin.declares_kind(&declared.watch).then(|| (declared.watch.clone(), declared.config.clone()))
    }

    fn call(&self, plugin: &str, kind: &str, config: Value) -> BoxFuture<'_, AppResult<Map<String, Value>>> {
        let plugin = plugin.to_owned();
        let kind = kind.to_owned();
        Box::pin(async move {
            let result = self.run_action(&plugin, &kind, config).await?;
            Ok(result.outputs)
        })
    }
}

/// Starts an agent's run for an event. The app uses [`RunManager`]; tests record calls.
pub trait TriggerRunStarter: Send + Sync + std::fmt::Debug {
    fn start<'a>(&'a self, agent_id: &'a str, inputs: Value) -> BoxFuture<'a, AppResult<String>>;
}

impl TriggerRunStarter for RunManager {
    /// Like a scheduled run, it starts without a click; it is listed as a manual run until
    /// runs record their trigger kind.
    fn start<'a>(&'a self, agent_id: &'a str, inputs: Value) -> BoxFuture<'a, AppResult<String>> {
        Box::pin(async move { self.start_run(agent_id, RunTrigger::Manual, inputs).await.map(|run| run.id) })
    }
}

/// Runs the watchers of the wanted triggers.
#[derive(Debug)]
pub struct PluginTriggerService {
    db: Arc<Database>,
    host: Arc<dyn TriggerHost>,
    runs: Arc<dyn TriggerRunStarter>,
    watchers: Mutex<HashMap<TriggerRef, tauri::async_runtime::JoinHandle<()>>>,
    wake: tokio::sync::Notify,
}

impl PluginTriggerService {
    pub fn new(db: Arc<Database>, host: Arc<dyn TriggerHost>, runs: Arc<dyn TriggerRunStarter>) -> Self {
        Self { db, host, runs, watchers: Mutex::new(HashMap::new()), wake: tokio::sync::Notify::new() }
    }

    /// Every trigger of the installed plugins.
    pub fn available(&self) -> Vec<AvailableTrigger> {
        self.host.available()
    }

    /// Saves the agent's trigger (see [`save_subscription`]) and updates the watchers.
    ///
    /// # Errors
    /// `InvalidInput` for a trigger no installed plugin declares; storage errors.
    pub fn set_subscription(&self, agent_id: &str, subscription: Option<TriggerRef>) -> AppResult<Option<TriggerRef>> {
        if let Some(trigger) = &subscription {
            let declared = self
                .host
                .available()
                .iter()
                .any(|item| item.plugin == trigger.plugin && item.trigger == trigger.trigger);
            if !declared {
                return Err(AppError::InvalidInput(format!("no installed plugin has the trigger {trigger}")));
            }
        }
        save_subscription(&self.db, agent_id, subscription.as_ref())?;
        self.wake.notify_one();
        Ok(subscription)
    }

    /// Compares the wanted triggers with the running watchers every few seconds (and when
    /// woken), for as long as the app runs.
    pub fn spawn(self: &Arc<Self>) {
        let service = Arc::clone(self);
        tauri::async_runtime::spawn(async move {
            loop {
                service.reconcile();
                let _woken = tokio::time::timeout(RECONCILE_INTERVAL, service.wake.notified()).await;
            }
        });
    }

    fn watchers(&self) -> std::sync::MutexGuard<'_, HashMap<TriggerRef, tauri::async_runtime::JoinHandle<()>>> {
        self.watchers.lock().unwrap_or_else(std::sync::PoisonError::into_inner)
    }

    /// Starts a watcher for each wanted trigger that can run, stops the others.
    pub fn reconcile(self: &Arc<Self>) {
        let wanted: BTreeSet<TriggerRef> = match wanted_triggers(&self.db) {
            Ok(wanted) => wanted.into_iter().filter(|trigger| self.host.watch_step(trigger).is_some()).collect(),
            Err(error) => {
                log::warn!("plugin triggers: could not read the agents' triggers: {error}");
                return;
            }
        };
        let mut watchers = self.watchers();
        watchers.retain(|trigger, handle| {
            let keep = wanted.contains(trigger);
            if !keep {
                handle.abort();
                log::info!("plugin trigger {trigger}: stopped watching");
            }
            keep
        });
        for trigger in wanted {
            if watchers.contains_key(&trigger) {
                continue;
            }
            log::info!("plugin trigger {trigger}: watching");
            let service = Arc::clone(self);
            let key = trigger.clone();
            let handle = tauri::async_runtime::spawn(async move { service.watch_loop(key).await });
            watchers.insert(trigger, handle);
        }
    }

    async fn watch_loop(self: Arc<Self>, trigger: TriggerRef) {
        let mut failures = 0_u32;
        loop {
            let started = tokio::time::Instant::now();
            match self.poll_once(&trigger).await {
                Ok(_) => failures = 0,
                Err(error) => {
                    failures = failures.saturating_add(1);
                    let wait = backoff_after(failures);
                    log::warn!("plugin trigger {trigger}: {error}; trying again in {} s", wait.as_secs());
                    tokio::time::sleep(wait).await;
                }
            }
            let elapsed = started.elapsed();
            if elapsed < MIN_CALL_INTERVAL {
                tokio::time::sleep(MIN_CALL_INTERVAL.saturating_sub(elapsed)).await;
            }
        }
    }

    /// One watch call: waits for events, stores the cursor and starts the subscribed
    /// agents' runs. Returns how many runs started.
    ///
    /// # Errors
    /// `InvalidInput` when the trigger cannot run now; the watch step's and storage errors.
    pub async fn poll_once(&self, trigger: &TriggerRef) -> AppResult<usize> {
        let (kind, config) = self
            .host
            .watch_step(trigger)
            .ok_or_else(|| AppError::InvalidInput(format!("the trigger {trigger} cannot run now")))?;
        let cursor_key = trigger.cursor_setting_key();
        let cursor = self.db.get_setting(&cursor_key)?;
        let outputs = self.host.call(&trigger.plugin, &kind, watch_config(&config, cursor.as_deref())).await?;
        let result = parse_watch_outputs(&outputs)?;
        if let Some(next) = &result.cursor {
            self.db.set_setting(&cursor_key, next)?;
        }
        let mut started = 0;
        for event in result.events {
            for agent in subscribers(&self.db, trigger)? {
                match self.runs.start(&agent.id, Value::Object(event.clone())).await {
                    Ok(run_id) => {
                        started += 1;
                        log::info!("plugin trigger {trigger}: started run {run_id} of {}", agent.name);
                    }
                    Err(error) => log::warn!("plugin trigger {trigger}: could not start {}: {error}", agent.name),
                }
            }
        }
        Ok(started)
    }
}
