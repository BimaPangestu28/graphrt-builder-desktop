//! "When something goes wrong" (screen 23): every problem the desktop can
//! detect right now, each in plain words with buttons that fix it.
//!
//! [`collect_problems`] aggregates, in this order:
//! - failed runs: the latest non-test run of each agent, when it failed;
//! - missing credentials: providers, `env.*` values and plugin settings an
//!   agent's flow uses that are not set (drafts are left out);
//! - plugins: used but not installed, failed to load, or not trusted;
//! - the browser runtime, when an agent uses a browser plugin and Chromium is missing;
//! - schedules whose cron no longer parses, or whose last runs all failed.
//!
//! [`failed_run_report`] explains one failed run and [`retry::inputs_for_retry`]
//! gives the inputs "Retry from the start" uses.

mod failed_run;
pub mod models;
mod needs;
pub mod retry;
#[cfg(test)]
mod tests;

use std::collections::{BTreeMap, HashMap};

pub use self::failed_run::failed_run_report;
use self::models::{Problem, ProblemAction, ProblemActionKind, ProblemKind};
use self::needs::{provider_display_name, read_flow_needs, FlowNeeds};
use crate::credentials::CredentialStore;
use crate::error::AppResult;
use crate::node_runtime::BrowserRuntimeStatus;
use crate::plugins::models::InstalledPlugin;
use crate::scheduler::ZonedSchedule;
use crate::storage::models::{Agent, AgentStatus, Run, RunFilter, RunStatus, RunTrigger, Trigger};
use crate::storage::Database;

/// How many recent runs are scanned for failures.
const RECENT_RUN_LIMIT: i64 = 1000;
/// A schedule "keeps failing" when this many of its latest runs failed in a row.
const FAILING_SCHEDULE_RUN_COUNT: usize = 3;

/// Everything problems are read from. The command fills it from `AppState`.
pub struct ProblemSources<'a> {
    pub db: &'a Database,
    pub credentials: &'a CredentialStore,
    /// From `PluginService::list_installed`.
    pub plugins: &'a [InstalledPlugin],
    pub browser_status: BrowserRuntimeStatus,
}

/// Agents with what their flow needs, read once.
struct AgentContext {
    agent: Agent,
    needs: Option<FlowNeeds>,
}

/// Every current problem, most urgent kinds first.
///
/// @throws AppError::Database - when agents, runs or triggers cannot be read
/// @throws AppError::Credentials - when the keychain cannot be read
pub fn collect_problems(sources: &ProblemSources<'_>) -> AppResult<Vec<Problem>> {
    let agents: Vec<AgentContext> = sources
        .db
        .list_agents()?
        .into_iter()
        .map(|agent| AgentContext { needs: read_flow_needs(&agent.flow_yaml), agent })
        .collect();
    let agent_names: HashMap<&str, &str> =
        agents.iter().map(|context| (context.agent.id.as_str(), context.agent.name.as_str())).collect();
    let recent_runs =
        sources.db.list_runs(&RunFilter { agent_id: None, status: None, limit: Some(RECENT_RUN_LIMIT) })?;
    let triggers = sources.db.list_triggers(None)?;

    let mut problems = failed_run_problems(sources.db, &recent_runs, &agent_names)?;
    problems.extend(credential_problems(sources, &agents)?);
    problems.extend(plugin_problems(sources.plugins, &agents));
    problems.extend(browser_problems(sources, &agents));
    problems.extend(schedule_problems(&triggers, &recent_runs, &agent_names));
    Ok(problems)
}

fn active_agents(agents: &[AgentContext]) -> impl Iterator<Item = &AgentContext> {
    agents.iter().filter(|context| context.agent.status != AgentStatus::Draft)
}

/// The latest non-test run of each agent, when it failed. Newest first.
fn failed_run_problems(db: &Database, runs: &[Run], agent_names: &HashMap<&str, &str>) -> AppResult<Vec<Problem>> {
    let mut seen_agents = std::collections::HashSet::new();
    let mut problems = Vec::new();
    for run in runs.iter().filter(|run| run.trigger != RunTrigger::Test) {
        if !seen_agents.insert(run.agent_id.as_str()) || run.status != RunStatus::Failed {
            continue;
        }
        let report = failed_run_report(db, &run.id)?;
        let mut actions =
            vec![ProblemAction::for_run(ProblemActionKind::OpenRun, "See what happened", &run.agent_id, &run.id)];
        if report.retry.can_retry {
            actions.push(ProblemAction::for_run(
                ProblemActionKind::RetryRun,
                "Retry from the start",
                &run.agent_id,
                &run.id,
            ));
        }
        problems.push(Problem {
            id: format!("failed_run:{}", run.id),
            kind: ProblemKind::FailedRun,
            title: report.title,
            detail: report.explanation,
            needs_attention: false,
            agent_id: Some(run.agent_id.clone()),
            agent_name: agent_names.get(run.agent_id.as_str()).map(|name| (*name).to_owned()),
            run_id: Some(run.id.clone()),
            occurred_at: Some(run.started_at.clone()),
            actions,
        });
    }
    Ok(problems)
}

/// What one agent is missing, in plain words ("OpenAI key", "WEATHER_TOKEN").
struct MissingItems {
    labels: Vec<String>,
    only_plugin_settings: bool,
}

fn missing_items(sources: &ProblemSources<'_>, needs: &FlowNeeds) -> AppResult<MissingItems> {
    let statuses = sources.credentials.provider_statuses(sources.db)?;
    let is_configured = |provider: &str| {
        statuses.iter().any(|status| {
            status.configured
                && serde_json::to_value(status.provider).ok().as_ref().and_then(serde_json::Value::as_str)
                    == Some(provider)
        })
    };
    let mut labels: Vec<String> = needs
        .model_providers
        .iter()
        .filter(|provider| !is_configured(provider))
        .map(|provider| format!("{} key", provider_display_name(provider)))
        .collect();
    for env_need in needs.env.iter().filter(|env_need| env_need.required) {
        if !sources.credentials.has_workflow_secret(&env_need.name)? {
            labels.push(env_need.name.clone());
        }
    }
    let other_count = labels.len();
    for plugin in sources.plugins.iter().filter(|plugin| needs.plugins.contains(&plugin.name)) {
        for setting in plugin.config.iter().filter(|setting| !setting.configured) {
            labels.push(format!("{} setting {}", plugin.name, setting.name));
        }
    }
    Ok(MissingItems { only_plugin_settings: other_count == 0, labels })
}

fn credential_problems(sources: &ProblemSources<'_>, agents: &[AgentContext]) -> AppResult<Vec<Problem>> {
    let mut problems = Vec::new();
    for context in active_agents(agents) {
        let Some(needs) = &context.needs else { continue };
        let missing = missing_items(sources, needs)?;
        if missing.labels.is_empty() {
            continue;
        }
        let action = if missing.only_plugin_settings {
            ProblemAction::new(ProblemActionKind::OpenPlugins, "Open plugin settings")
        } else {
            ProblemAction::new(ProblemActionKind::OpenConnections, "Open Connections")
        };
        problems.push(Problem {
            id: format!("missing_credentials:{}", context.agent.id),
            kind: ProblemKind::MissingCredentials,
            title: format!("{} is missing a connection", context.agent.name),
            detail: format!("It needs {}. Its runs cannot start until this is set", missing.labels.join(", ")),
            needs_attention: true,
            agent_id: Some(context.agent.id.clone()),
            agent_name: Some(context.agent.name.clone()),
            run_id: None,
            occurred_at: None,
            actions: vec![action],
        });
    }
    Ok(problems)
}

/// Names of the non-draft agents using each plugin.
fn plugin_users(agents: &[AgentContext]) -> BTreeMap<String, Vec<String>> {
    let mut users: BTreeMap<String, Vec<String>> = BTreeMap::new();
    for context in active_agents(agents) {
        for plugin_name in context.needs.iter().flat_map(|needs| needs.plugins.iter()) {
            users.entry(plugin_name.clone()).or_default().push(context.agent.name.clone());
        }
    }
    users
}

fn plugin_problem(id: String, kind: ProblemKind, title: String, detail: String) -> Problem {
    Problem {
        id,
        kind,
        title,
        detail,
        needs_attention: true,
        agent_id: None,
        agent_name: None,
        run_id: None,
        occurred_at: None,
        actions: vec![ProblemAction::new(ProblemActionKind::OpenPlugins, "Open plugins")],
    }
}

fn plugin_problems(plugins: &[InstalledPlugin], agents: &[AgentContext]) -> Vec<Problem> {
    let users = plugin_users(agents);
    let mut problems = Vec::new();
    for (plugin_name, agent_names) in &users {
        if !plugins.iter().any(|plugin| &plugin.name == plugin_name) {
            problems.push(plugin_problem(
                format!("plugin_missing:{plugin_name}"),
                ProblemKind::PluginMissing,
                format!("The {plugin_name} plugin is not installed"),
                format!("{} uses it. Install it from Connections, Plugins", agent_names.join(", ")),
            ));
        }
    }
    for plugin in plugins {
        let used_by = users.get(&plugin.name);
        if let Some(load_error) = &plugin.load_error {
            let users_text = used_by.map(|names| format!(" {} cannot run until it does.", names.join(", ")));
            problems.push(plugin_problem(
                format!("plugin_not_loaded:{}", plugin.name),
                ProblemKind::PluginNotLoaded,
                format!("The {} plugin could not start", plugin.name),
                format!("{load_error}.{}", users_text.unwrap_or_default()),
            ));
        } else if let Some(agent_names) = used_by.filter(|_| !plugin.trusted) {
            problems.push(plugin_problem(
                format!("plugin_untrusted:{}", plugin.name),
                ProblemKind::PluginUntrusted,
                format!("The {} plugin is not trusted yet", plugin.name),
                format!("{} uses it. Plugins only run after you trust them", agent_names.join(", ")),
            ));
        }
    }
    problems
}

fn browser_problems(sources: &ProblemSources<'_>, agents: &[AgentContext]) -> Vec<Problem> {
    if sources.browser_status != BrowserRuntimeStatus::NotInstalled {
        return Vec::new();
    }
    let users = plugin_users(agents);
    let mut agent_names: Vec<String> = sources
        .plugins
        .iter()
        .filter(|plugin| plugin.needs_browser)
        .filter_map(|plugin| users.get(&plugin.name))
        .flatten()
        .cloned()
        .collect();
    agent_names.sort();
    agent_names.dedup();
    if agent_names.is_empty() {
        return Vec::new();
    }
    vec![Problem {
        id: "browser_missing".into(),
        kind: ProblemKind::BrowserMissing,
        title: "The browser for web steps is not installed".into(),
        detail: format!("{} open web pages and need it. It is a one-time download", agent_names.join(", ")),
        needs_attention: true,
        agent_id: None,
        agent_name: None,
        run_id: None,
        occurred_at: None,
        actions: vec![
            ProblemAction::new(ProblemActionKind::InstallBrowser, "Install the browser"),
            ProblemAction::new(ProblemActionKind::OpenPlugins, "Open plugins"),
        ],
    }]
}

fn schedule_problem(trigger: &Trigger, agent_name: &str, kind: ProblemKind, title: String, detail: String) -> Problem {
    Problem {
        id: format!(
            "{}:{}",
            if kind == ProblemKind::ScheduleInvalid { "schedule_invalid" } else { "schedule_failing" },
            trigger.id
        ),
        kind,
        title,
        detail,
        needs_attention: true,
        agent_id: Some(trigger.agent_id.clone()),
        agent_name: Some(agent_name.to_owned()),
        run_id: None,
        occurred_at: None,
        actions: vec![ProblemAction::for_agent(
            ProblemActionKind::OpenSchedule,
            "Change the schedule",
            &trigger.agent_id,
        )],
    }
}

/// True when the agent's latest scheduled runs (newest first in `runs`) all failed.
fn keeps_failing(runs: &[Run], agent_id: &str) -> bool {
    let latest: Vec<&Run> = runs
        .iter()
        .filter(|run| run.agent_id == agent_id && run.trigger == RunTrigger::Schedule)
        .take(FAILING_SCHEDULE_RUN_COUNT)
        .collect();
    latest.len() == FAILING_SCHEDULE_RUN_COUNT && latest.iter().all(|run| run.status == RunStatus::Failed)
}

fn schedule_problems(triggers: &[Trigger], runs: &[Run], agent_names: &HashMap<&str, &str>) -> Vec<Problem> {
    let mut problems = Vec::new();
    let mut reported_failing_agents = std::collections::HashSet::new();
    for trigger in triggers.iter().filter(|trigger| trigger.enabled) {
        let agent_name = agent_names.get(trigger.agent_id.as_str()).copied().unwrap_or("An agent");
        if let Err(error) = ZonedSchedule::parse(&trigger.cron_expression, &trigger.timezone) {
            problems.push(schedule_problem(
                trigger,
                agent_name,
                ProblemKind::ScheduleInvalid,
                format!("The schedule of {agent_name} cannot be read"),
                format!("It will not run until the schedule is fixed. {error}"),
            ));
        } else if keeps_failing(runs, &trigger.agent_id) && reported_failing_agents.insert(trigger.agent_id.as_str()) {
            problems.push(schedule_problem(
                trigger,
                agent_name,
                ProblemKind::ScheduleFailing,
                format!("{agent_name} keeps failing on schedule"),
                format!(
                    "Its last {FAILING_SCHEDULE_RUN_COUNT} scheduled runs failed. Fix the cause, or turn the schedule off for now"
                ),
            ));
        }
    }
    problems
}
