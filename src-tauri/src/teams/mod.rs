//! Teams (screen 13): what the team did, its guardrails, and the coordinator chat.
//!
//! A team is an agent whose coordinator `agent` step calls member agents as
//! tools (`agent_steps`). Everything here is read from real runs:
//! - [`list_team_activity`]: the team's recent runs, the member calls inside them
//!   (read from their events, see `run_calls`) and the members' own runs.
//! - [`list_coordinator_chat`]: each run of the team agent as one exchange, the
//!   goal it was started with (its start input) and what it answered (its outputs).
//!   A new message starts a run (`commands::teams::send_coordinator_message`);
//!   graphrt runs keep no memory between them, so each message is a new goal.
//! - [`guardrails`]: limits that are enforced, nothing else.

pub mod guardrails;
pub mod run_calls;
#[cfg(test)]
mod tests;

use std::collections::HashMap;

use serde::{Deserialize, Serialize};
use serde_json::Value as Json;

use self::run_calls::{member_calls, shorten, start_inputs, tool_node_agents, CallOutcome, MemberCall};
use crate::agent_steps::{self, InputValueType};
use crate::error::{AppError, AppResult};
use crate::storage::models::{Agent, Run, RunFilter, RunStatus};
use crate::storage::Database;

/// Team runs read for the activity log and the chat.
const TEAM_RUN_WINDOW: i64 = 10;
/// Own runs read per member for the activity log.
const MEMBER_RUN_WINDOW: i64 = 5;
/// Most activity entries returned.
const MAX_ACTIVITY_ENTRIES: usize = 30;
const MAX_ERROR_CHARS: usize = 160;
/// Name the screen gives the team's coordinator step.
const COORDINATOR_NAME: &str = "Coordinator";

/// A piece of an activity sentence; member and coordinator names are bold.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ActivityPart {
    pub text: String,
    pub is_member: bool,
}

/// One line of the activity log.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TeamActivityEntry {
    pub id: String,
    /// RFC 3339.
    pub at: String,
    pub parts: Vec<ActivityPart>,
    /// The run the line comes from.
    pub run_id: String,
    pub agent_id: String,
}

/// A member call as shown under a coordinator reply.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CoordinatorMemberCall {
    pub member_name: String,
    /// What it was asked, or how it ended when the arguments carry no text.
    pub task: String,
    pub status: MemberCallStatus,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum MemberCallStatus {
    Working,
    Done,
    Failed,
}

/// One run of the team agent as a chat exchange.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CoordinatorExchange {
    pub run_id: String,
    pub sent_at: String,
    /// The goal the run started with (its start input), empty when unknown.
    pub message: String,
    pub status: RunStatus,
    /// What the run answered, once it succeeded.
    pub reply_text: Option<String>,
    pub error_message: Option<String>,
    pub member_calls: Vec<CoordinatorMemberCall>,
    /// E.g. "3 agent calls of max 20".
    pub note: Option<String>,
}

/// A team run with the member calls read from its events.
struct TeamRun {
    run: Run,
    message: String,
    calls: Vec<MemberCall>,
}

/// The newest activity first.
///
/// # Errors
/// `NotFound` for an unknown team agent; storage errors.
pub fn list_team_activity(db: &Database, team_agent_id: &str) -> AppResult<Vec<TeamActivityEntry>> {
    let team_agent = db.get_agent(team_agent_id)?;
    let agents = db.list_agents()?;
    let names = agent_names(&agents);
    let mut entries = Vec::new();
    for team_run in load_team_runs(db, &team_agent, &agents)? {
        entries.extend(team_run_entries(&team_run, &names));
    }
    let team = agent_steps::team_overview(db, team_agent_id)?;
    for member in &team.members {
        let filter =
            RunFilter { agent_id: Some(member.agent_id.clone()), status: None, limit: Some(MEMBER_RUN_WINDOW) };
        for run in db.list_runs(&filter)? {
            entries.push(member_run_entry(&run, &member.name));
        }
    }
    // Each run's entries are in event order: reversed, a stable sort keeps
    // same-instant entries newest first.
    entries.reverse();
    entries.sort_by(|first, second| second.at.cmp(&first.at));
    entries.truncate(MAX_ACTIVITY_ENTRIES);
    Ok(entries)
}

/// The team agent's recent runs as chat exchanges, oldest first.
///
/// # Errors
/// `NotFound` for an unknown team agent; storage errors.
pub fn list_coordinator_chat(db: &Database, team_agent_id: &str) -> AppResult<Vec<CoordinatorExchange>> {
    let team_agent = db.get_agent(team_agent_id)?;
    let agents = db.list_agents()?;
    let names = agent_names(&agents);
    let limit = guardrails::max_agent_calls_per_run(db, team_agent_id);
    let mut exchanges: Vec<CoordinatorExchange> = load_team_runs(db, &team_agent, &agents)?
        .into_iter()
        .map(|team_run| to_exchange(team_run, &names, limit))
        .collect();
    exchanges.reverse();
    Ok(exchanges)
}

/// The run inputs carrying `message` for the team: its only text input, or the
/// first required one.
///
/// # Errors
/// `InvalidInput` for a blank message or a team with no text input;
/// `Workflow` when the team's flow does not compile.
pub fn coordinator_run_inputs(team_agent: &Agent, message: &str) -> AppResult<Json> {
    let message = message.trim();
    if message.is_empty() {
        return Err(AppError::InvalidInput("write a message first".into()));
    }
    let signature = agent_steps::read_signature(&team_agent.flow_yaml)?;
    let text_inputs: Vec<_> =
        signature.inputs.iter().filter(|input| input.value_type == InputValueType::String).collect();
    let chosen = match text_inputs.as_slice() {
        [only] => Some(*only),
        _ => text_inputs.iter().find(|input| input.required).or(text_inputs.first()).copied(),
    };
    let Some(input) = chosen else {
        return Err(AppError::InvalidInput(format!("{} has no text input to send a message to", team_agent.name)));
    };
    let other_required: Vec<&str> = signature
        .inputs
        .iter()
        .filter(|other| other.required && other.name != input.name)
        .map(|other| other.label.as_str())
        .collect();
    if !other_required.is_empty() {
        return Err(AppError::InvalidInput(format!(
            "{} also needs {}; start it from Test run",
            team_agent.name,
            other_required.join(", ")
        )));
    }
    let mut inputs = serde_json::Map::new();
    inputs.insert(input.name.clone(), Json::String(message.to_owned()));
    Ok(Json::Object(inputs))
}

fn agent_names(agents: &[Agent]) -> HashMap<String, String> {
    agents.iter().map(|agent| (agent.id.clone(), agent.name.clone())).collect()
}

fn load_team_runs(db: &Database, team_agent: &Agent, agents: &[Agent]) -> AppResult<Vec<TeamRun>> {
    let known_agent_ids: Vec<String> = agents.iter().map(|agent| agent.id.clone()).collect();
    let versions = db.list_agent_versions(&team_agent.id)?;
    let mut tool_nodes_by_version: HashMap<i64, HashMap<String, String>> = HashMap::new();
    let filter = RunFilter { agent_id: Some(team_agent.id.clone()), status: None, limit: Some(TEAM_RUN_WINDOW) };
    let mut team_runs = Vec::new();
    for run in db.list_runs(&filter)? {
        let tool_nodes = tool_nodes_by_version.entry(run.agent_version).or_insert_with(|| {
            let flow_yaml = versions
                .iter()
                .find(|version| version.version == run.agent_version)
                .map_or(team_agent.flow_yaml.as_str(), |version| version.flow_yaml.as_str());
            tool_node_agents(flow_yaml)
        });
        let events = db.list_run_events(&run.id)?;
        let message = start_inputs(&events).map(|inputs| first_text(&Json::Object(inputs))).unwrap_or_default();
        let calls = member_calls(&events, tool_nodes, &known_agent_ids);
        team_runs.push(TeamRun { run, message, calls });
    }
    Ok(team_runs)
}

fn bold(text: &str) -> ActivityPart {
    ActivityPart { text: text.to_owned(), is_member: true }
}

fn plain(text: impl Into<String>) -> ActivityPart {
    ActivityPart { text: text.into(), is_member: false }
}

fn member_name<'a>(names: &'a HashMap<String, String>, agent_id: &'a str) -> &'a str {
    names.get(agent_id).map_or(agent_id, String::as_str)
}

fn team_run_entries(team_run: &TeamRun, names: &HashMap<String, String>) -> Vec<TeamActivityEntry> {
    let run = &team_run.run;
    let entry = |suffix: &str, at: &str, parts: Vec<ActivityPart>| TeamActivityEntry {
        id: format!("{}:{suffix}", run.id),
        at: at.to_owned(),
        parts,
        run_id: run.id.clone(),
        agent_id: run.agent_id.clone(),
    };
    let goal =
        if team_run.message.is_empty() { String::new() } else { format!(": {}", shorten(&team_run.message, 80)) };
    let mut entries =
        vec![entry("start", &run.started_at, vec![bold(COORDINATOR_NAME), plain(format!(" started on a goal{goal}"))])];
    for (index, call) in team_run.calls.iter().enumerate() {
        let name = member_name(names, &call.member_agent_id);
        let task = if call.task.is_empty() { String::new() } else { format!(": {}", call.task) };
        entries.push(entry(
            &format!("call-{index}"),
            &call.called_at,
            vec![bold(COORDINATOR_NAME), plain(" asked "), bold(name), plain(task)],
        ));
        if let Some(finished_at) = &call.finished_at {
            let result = match &call.outcome {
                CallOutcome::Failed(Some(error)) => format!(" failed: {}", shorten(error, MAX_ERROR_CHARS)),
                CallOutcome::Failed(None) => " failed".to_owned(),
                _ => " finished and reported back".to_owned(),
            };
            entries.push(entry(&format!("result-{index}"), finished_at, vec![bold(name), plain(result)]));
        }
    }
    if let Some(words) = run_end_words(run) {
        let at = run.finished_at.as_deref().unwrap_or(&run.started_at);
        entries.push(entry("end", at, vec![bold(COORDINATOR_NAME), plain(words)]));
    }
    entries
}

fn run_end_words(run: &Run) -> Option<String> {
    match run.status {
        RunStatus::Running => None,
        RunStatus::Succeeded => Some(" finished the goal".into()),
        RunStatus::Paused => Some(" is waiting for you".into()),
        RunStatus::Aborted => Some(" was stopped".into()),
        RunStatus::Failed => Some(match &run.error_message {
            Some(error) => format!(" stopped: {}", shorten(error, MAX_ERROR_CHARS)),
            None => " stopped with an error".into(),
        }),
    }
}

fn member_run_entry(run: &Run, member_name: &str) -> TeamActivityEntry {
    let words = match run.status {
        RunStatus::Running => " is running on its own",
        RunStatus::Paused => " is waiting for you",
        RunStatus::Succeeded => " finished a run of its own",
        RunStatus::Failed => " failed a run of its own",
        RunStatus::Aborted => " was stopped",
    };
    TeamActivityEntry {
        id: format!("{}:member", run.id),
        at: run.finished_at.clone().unwrap_or_else(|| run.started_at.clone()),
        parts: vec![bold(member_name), plain(words)],
        run_id: run.id.clone(),
        agent_id: run.agent_id.clone(),
    }
}

fn to_exchange(team_run: TeamRun, names: &HashMap<String, String>, limit: Option<u32>) -> CoordinatorExchange {
    let TeamRun { run, message, calls } = team_run;
    let member_calls = calls
        .iter()
        .map(|call| {
            let (status, fallback) = match &call.outcome {
                CallOutcome::Pending => (MemberCallStatus::Working, "working on it"),
                CallOutcome::Succeeded => (MemberCallStatus::Done, "done"),
                CallOutcome::Failed(_) => (MemberCallStatus::Failed, "failed"),
            };
            CoordinatorMemberCall {
                member_name: member_name(names, &call.member_agent_id).to_owned(),
                task: if call.task.is_empty() { fallback.to_owned() } else { call.task.clone() },
                status,
            }
        })
        .collect();
    let note = match (calls.len(), limit) {
        (0, None) => None,
        (count, Some(limit)) => Some(format!("{count} agent {} of max {limit}", calls_word(count))),
        (count, None) => Some(format!("{count} agent {}", calls_word(count))),
    };
    let reply_text =
        (run.status == RunStatus::Succeeded).then(|| run.outputs.as_ref().map(reply_from_outputs)).flatten();
    CoordinatorExchange {
        run_id: run.id,
        sent_at: run.started_at,
        message,
        status: run.status,
        reply_text,
        error_message: run.error_message,
        member_calls,
        note,
    }
}

fn calls_word(count: usize) -> &'static str {
    if count == 1 {
        "call"
    } else {
        "calls"
    }
}

/// The reply in a run's outputs: `text` / `answer`, the only text output, or the outputs as JSON.
fn reply_from_outputs(outputs: &Json) -> String {
    for key in ["text", "answer", "reply", "result"] {
        if let Some(text) = outputs.get(key).and_then(Json::as_str) {
            return text.trim().to_owned();
        }
    }
    match outputs.as_object() {
        Some(fields) if fields.len() == 1 => match fields.values().next() {
            Some(Json::String(text)) => text.trim().to_owned(),
            Some(other) => other.to_string(),
            None => String::new(),
        },
        Some(fields) if fields.is_empty() => String::new(),
        _ => outputs.to_string(),
    }
}

fn first_text(inputs: &Json) -> String {
    inputs.as_object().and_then(|fields| fields.values().find_map(Json::as_str)).unwrap_or_default().trim().to_owned()
}
