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
mod texts;

use std::collections::{BTreeMap, HashMap};

pub use self::failed_run::failed_run_report;
use self::models::{Problem, ProblemAction, ProblemActionKind, ProblemKind};
use self::needs::{provider_display_name, read_flow_needs, FlowNeeds};
use self::texts::ProblemTexts;
use crate::credentials::CredentialStore;
use crate::error::AppResult;
use crate::node_runtime::{BrowserRuntimeStatus, PluginRuntimeStatus};
use crate::plugins::display_name::humanize_plugin_name;
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
    pub plugin_runtime_status: PluginRuntimeStatus,
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

    let texts = ProblemTexts::for_database(sources.db);
    let mut problems = failed_run_problems(sources.db, &recent_runs, &agent_names, texts)?;
    problems.extend(credential_problems(sources, &agents, texts)?);
    problems.extend(plugin_problems(sources.plugins, &agents, texts));
    problems.extend(plugin_runtime_problems(sources, &agents, texts));
    problems.extend(browser_problems(sources, &agents, texts));
    problems.extend(schedule_problems(&triggers, &recent_runs, &agent_names, texts));
    Ok(problems)
}

fn active_agents(agents: &[AgentContext]) -> impl Iterator<Item = &AgentContext> {
    agents.iter().filter(|context| context.agent.status != AgentStatus::Draft)
}

/// The latest non-test run of each agent, when it failed. Newest first.
fn failed_run_problems(
    db: &Database,
    runs: &[Run],
    agent_names: &HashMap<&str, &str>,
    texts: ProblemTexts,
) -> AppResult<Vec<Problem>> {
    let mut seen_agents = std::collections::HashSet::new();
    let mut problems = Vec::new();
    for run in runs.iter().filter(|run| run.trigger != RunTrigger::Test) {
        if !seen_agents.insert(run.agent_id.as_str()) || run.status != RunStatus::Failed {
            continue;
        }
        let report = failed_run_report(db, &run.id)?;
        let mut actions = vec![ProblemAction::for_run(
            ProblemActionKind::OpenRun,
            &texts.see_what_happened(),
            &run.agent_id,
            &run.id,
        )];
        if report.retry.can_retry {
            actions.push(ProblemAction::for_run(
                ProblemActionKind::RetryRun,
                &texts.retry_from_start(),
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

/// "OpenAI key", or "Claude Code turned on" for a local CLI provider.
fn missing_provider_label(provider: &str, texts: ProblemTexts) -> String {
    if crate::local_cli::LocalCli::from_provider_name(provider).is_some() {
        texts.provider_turned_on(&provider_display_name(provider))
    } else {
        texts.provider_key(&provider_display_name(provider))
    }
}

/// What one agent is missing, in plain words ("OpenAI key", "WEATHER_TOKEN").
struct MissingItems {
    labels: Vec<String>,
    only_plugin_settings: bool,
}

fn missing_items(sources: &ProblemSources<'_>, needs: &FlowNeeds, texts: ProblemTexts) -> AppResult<MissingItems> {
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
        .map(|provider| missing_provider_label(provider, texts))
        .collect();
    for env_need in needs.env.iter().filter(|env_need| env_need.required) {
        if !sources.credentials.has_workflow_secret(&env_need.name)? {
            labels.push(env_need.name.clone());
        }
    }
    let other_count = labels.len();
    for plugin in sources.plugins.iter().filter(|plugin| needs.plugins.contains(&plugin.name)) {
        for setting in plugin.config.iter().filter(|setting| !setting.configured && !setting.optional) {
            labels.push(texts.plugin_setting(&plugin.display_name, &setting.name));
        }
    }
    Ok(MissingItems { only_plugin_settings: other_count == 0, labels })
}

fn credential_problems(
    sources: &ProblemSources<'_>,
    agents: &[AgentContext],
    texts: ProblemTexts,
) -> AppResult<Vec<Problem>> {
    let mut problems = Vec::new();
    for context in active_agents(agents) {
        let Some(needs) = &context.needs else { continue };
        let missing = missing_items(sources, needs, texts)?;
        if missing.labels.is_empty() {
            continue;
        }
        let action = if missing.only_plugin_settings {
            ProblemAction::new(ProblemActionKind::OpenPlugins, &texts.open_plugin_settings())
        } else {
            ProblemAction::new(ProblemActionKind::OpenConnections, &texts.open_connections())
        };
        problems.push(Problem {
            id: format!("missing_credentials:{}", context.agent.id),
            kind: ProblemKind::MissingCredentials,
            title: texts.missing_connection_title(&context.agent.name),
            detail: texts.missing_connection_detail(&missing.labels.join(", ")),
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

fn plugin_problem(id: String, kind: ProblemKind, title: String, detail: String, texts: ProblemTexts) -> Problem {
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
        actions: vec![ProblemAction::new(ProblemActionKind::OpenPlugins, &texts.open_plugins())],
    }
}

fn plugin_problems(plugins: &[InstalledPlugin], agents: &[AgentContext], texts: ProblemTexts) -> Vec<Problem> {
    let users = plugin_users(agents);
    let mut problems = Vec::new();
    for (plugin_name, agent_names) in &users {
        if !plugins.iter().any(|plugin| &plugin.name == plugin_name) {
            problems.push(plugin_problem(
                format!("plugin_missing:{plugin_name}"),
                ProblemKind::PluginMissing,
                texts.plugin_missing_title(&humanize_plugin_name(plugin_name)),
                texts.plugin_missing_detail(&agent_names.join(", ")),
                texts,
            ));
        }
    }
    for plugin in plugins {
        let used_by = users.get(&plugin.name);
        if let Some(load_error) = &plugin.load_error {
            let users_text = used_by.map(|names| texts.cannot_run_until_it_does(&names.join(", ")));
            problems.push(plugin_problem(
                format!("plugin_not_loaded:{}", plugin.name),
                ProblemKind::PluginNotLoaded,
                texts.plugin_not_loaded_title(&plugin.display_name),
                format!("{load_error}.{}", users_text.unwrap_or_default()),
                texts,
            ));
        } else if let Some(agent_names) = used_by.filter(|_| !plugin.trusted) {
            problems.push(plugin_problem(
                format!("plugin_untrusted:{}", plugin.name),
                ProblemKind::PluginUntrusted,
                texts.plugin_untrusted_title(&plugin.display_name),
                texts.plugin_untrusted_detail(&agent_names.join(", ")),
                texts,
            ));
        }
    }
    problems
}

/// Agents using an installed plugin that runs on Node while the plugin runtime is missing
/// (for example after updating from 0.1.x, which bundled Node).
fn plugin_runtime_problems(sources: &ProblemSources<'_>, agents: &[AgentContext], texts: ProblemTexts) -> Vec<Problem> {
    if sources.plugin_runtime_status != PluginRuntimeStatus::NotInstalled {
        return Vec::new();
    }
    let users = plugin_users(agents);
    let mut agent_names: Vec<String> = sources
        .plugins
        .iter()
        .filter(|plugin| plugin.needs_node_runtime)
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
        id: "plugin_runtime_missing".into(),
        kind: ProblemKind::PluginRuntimeMissing,
        title: texts.plugin_runtime_missing_title(),
        detail: texts.plugin_runtime_missing_detail(&agent_names.join(", ")),
        needs_attention: true,
        agent_id: None,
        agent_name: None,
        run_id: None,
        occurred_at: None,
        actions: vec![
            ProblemAction::new(ProblemActionKind::InstallPluginRuntime, &texts.install_plugin_runtime()),
            ProblemAction::new(ProblemActionKind::OpenPlugins, &texts.open_plugins()),
        ],
    }]
}

fn browser_problems(sources: &ProblemSources<'_>, agents: &[AgentContext], texts: ProblemTexts) -> Vec<Problem> {
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
        title: texts.browser_missing_title(),
        detail: texts.browser_missing_detail(&agent_names.join(", ")),
        needs_attention: true,
        agent_id: None,
        agent_name: None,
        run_id: None,
        occurred_at: None,
        actions: vec![
            ProblemAction::new(ProblemActionKind::InstallBrowser, &texts.install_browser()),
            ProblemAction::new(ProblemActionKind::OpenPlugins, &texts.open_plugins()),
        ],
    }]
}

fn schedule_problem(
    trigger: &Trigger,
    agent_name: &str,
    kind: ProblemKind,
    title: String,
    detail: String,
    texts: ProblemTexts,
) -> Problem {
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
            &texts.change_schedule(),
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

fn schedule_problems(
    triggers: &[Trigger],
    runs: &[Run],
    agent_names: &HashMap<&str, &str>,
    texts: ProblemTexts,
) -> Vec<Problem> {
    let mut problems = Vec::new();
    let mut reported_failing_agents = std::collections::HashSet::new();
    for trigger in triggers.iter().filter(|trigger| trigger.enabled) {
        let fallback_name = texts.an_agent();
        let agent_name = agent_names.get(trigger.agent_id.as_str()).copied().unwrap_or(fallback_name.as_str());
        if let Err(error) = ZonedSchedule::parse(&trigger.cron_expression, &trigger.timezone) {
            problems.push(schedule_problem(
                trigger,
                agent_name,
                ProblemKind::ScheduleInvalid,
                texts.schedule_invalid_title(agent_name),
                texts.schedule_invalid_detail(&error.to_string()),
                texts,
            ));
        } else if keeps_failing(runs, &trigger.agent_id) && reported_failing_agents.insert(trigger.agent_id.as_str()) {
            problems.push(schedule_problem(
                trigger,
                agent_name,
                ProblemKind::ScheduleFailing,
                texts.schedule_failing_title(agent_name),
                texts.schedule_failing_detail(FAILING_SCHEDULE_RUN_COUNT),
                texts,
            ));
        }
    }
    problems
}
