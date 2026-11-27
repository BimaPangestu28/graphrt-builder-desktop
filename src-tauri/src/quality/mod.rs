//! Tests and releases ("Versions" page of an agent).
//!
//! The pipeline: the person writes test questions (or has them suggested), a check runs
//! the agent's latest version on them with graphrt's eval harness (`graphrt-eval`: LLM
//! judges, pass rate, comparison with the check before), and a version with enough good
//! answers is released. A release never changes; the one in use is what goes online
//! (`deploy`). Going back to an older release is one click.
//!
//! - [`suite`]: the tests as a graphrt eval suite
//! - [`target`]: the agent under test, run the way it runs for real
//! - [`judges`]: the two judge workflows, on the person's default model
//! - [`view`]: a check as the screens show it
//! - [`release`]: when a version may be released, and why not
//! - [`suggest`]: draft tests from what the agent is for
//!
//! Storage: `storage::quality`. Nothing here holds or logs a key: models come from the
//! keychain through the same path as any run.

pub mod judges;
#[cfg(test)]
mod live_check;
pub mod release;
pub mod suggest;
pub mod suite;
pub mod target;
#[cfg(test)]
mod tests;
pub mod view;

use std::collections::HashSet;
use std::path::Path;
use std::sync::{Arc, Mutex};

use graphrt_eval::{Runner, RunnerOptions};
use serde::{Deserialize, Serialize};

use self::release::{readiness, ReleaseFacts, ReleaseReadiness, DEFAULT_REQUIRED_PERCENT};
use self::suggest::{SuggestedTest, SuggestionMaterial};
use self::target::{AgentTarget, CheckDependencies};
use self::view::{check_view, CheckView, StoredCheck, TestWords};
use crate::error::{AppError, AppResult};
use crate::skills::DraftModelSource;
use crate::storage::models::{Agent, AgentKind};
use crate::storage::quality::{AgentTest, CheckRecord, CheckStatus, NewRelease, Release, SwitchReason, TestInput};

/// `agent_settings` key of [`QualitySettings`].
const SETTINGS_KEY: &str = "release_checks";
/// Questions asked at the same time during a check.
const CHECK_CONCURRENCY: usize = 4;
/// Checks kept in view (the newest).
const CHECKS_SHOWN: u32 = 20;
const MAX_TIMES_EACH: u32 = 5;
/// Why a check that was running when the app closed never finished.
pub const APP_CLOSED_MESSAGE: &str = "The app closed before the check finished";

/// How strict releases are. Advanced settings; the defaults suit most agents.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct QualitySettings {
    /// Share of good answers a release needs, in percent.
    pub required_percent: i64,
    /// How many times each question is asked in a check (answers vary a little).
    pub times_each: u32,
}

impl Default for QualitySettings {
    fn default() -> Self {
        Self { required_percent: DEFAULT_REQUIRED_PERCENT, times_each: 1 }
    }
}

impl QualitySettings {
    fn checked(self) -> AppResult<Self> {
        if !(0..=100).contains(&self.required_percent) {
            return Err(AppError::InvalidInput("the share of good answers is between 0 and 100 percent".into()));
        }
        if !(1..=MAX_TIMES_EACH).contains(&self.times_each) {
            return Err(AppError::InvalidInput(format!("ask each question 1 to {MAX_TIMES_EACH} times")));
        }
        Ok(self)
    }
}

/// Progress of a running check (Tauri event [`CHECK_EVENT`]).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CheckProgress {
    pub agent_id: String,
    pub check_id: String,
    pub done: usize,
    pub total: usize,
    pub finished: bool,
}

/// Tauri event carrying [`CheckProgress`].
pub const CHECK_EVENT: &str = "agent-check-event";

/// Where check progress goes (the window in the app, nowhere in tests).
pub trait CheckProgressSink: Send + Sync + std::fmt::Debug {
    fn send(&self, progress: CheckProgress);
}

/// Sends check progress to every window.
#[derive(Debug)]
pub struct TauriCheckSink {
    app_handle: tauri::AppHandle,
}

impl TauriCheckSink {
    pub fn new(app_handle: tauri::AppHandle) -> Self {
        Self { app_handle }
    }
}

impl CheckProgressSink for TauriCheckSink {
    fn send(&self, progress: CheckProgress) {
        use tauri::Emitter;
        if let Err(error) = self.app_handle.emit(CHECK_EVENT, progress) {
            log::warn!("could not emit check progress: {error}");
        }
    }
}

/// Everything the Versions page shows about tests and releases.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct QualityOverview {
    pub agent_id: String,
    pub current_version: i64,
    pub tests: Vec<AgentTest>,
    /// The newest check of any version.
    pub latest_check: Option<CheckView>,
    pub readiness: ReleaseReadiness,
    /// Newest first.
    pub releases: Vec<Release>,
    pub in_use: Option<Release>,
    pub settings: QualitySettings,
    /// Whether the agent can be checked at all (it has an input to ask the question with).
    pub can_check: bool,
}

#[derive(Debug)]
pub struct QualityService {
    dependencies: CheckDependencies,
    draft_model: Arc<dyn DraftModelSource>,
    sink: Arc<dyn CheckProgressSink>,
    running: Arc<Mutex<HashSet<String>>>,
}

impl QualityService {
    /// Marks checks left running by an earlier app session as not finished.
    pub fn new(
        dependencies: CheckDependencies,
        draft_model: Arc<dyn DraftModelSource>,
        sink: Arc<dyn CheckProgressSink>,
    ) -> Self {
        match dependencies.db.fail_unfinished_checks(APP_CLOSED_MESSAGE) {
            Ok(0) => {}
            Ok(count) => log::info!("{count} check(s) did not finish before the app closed"),
            Err(error) => log::warn!("could not close unfinished checks: {error}"),
        }
        Self { dependencies, draft_model, sink, running: Arc::default() }
    }

    fn db(&self) -> &crate::storage::Database {
        &self.dependencies.db
    }

    pub fn settings(&self, agent_id: &str) -> AppResult<QualitySettings> {
        Ok(self
            .db()
            .get_agent_setting(agent_id, SETTINGS_KEY)?
            .map(serde_json::from_value)
            .transpose()?
            .unwrap_or_default())
    }

    pub fn set_settings(&self, agent_id: &str, settings: QualitySettings) -> AppResult<QualitySettings> {
        let settings = settings.checked()?;
        self.db().set_agent_setting(agent_id, SETTINGS_KEY, &serde_json::to_value(settings)?)?;
        Ok(settings)
    }

    // ---- tests ----

    pub fn add_tests(&self, agent_id: &str, inputs: Vec<TestInput>) -> AppResult<Vec<AgentTest>> {
        self.db().add_agent_tests(agent_id, inputs)
    }

    pub fn update_test(&self, agent_id: &str, test_id: &str, input: TestInput) -> AppResult<AgentTest> {
        self.db().update_agent_test(agent_id, test_id, input)
    }

    pub fn delete_test(&self, agent_id: &str, test_id: &str) -> AppResult<()> {
        self.db().delete_agent_test(agent_id, test_id)
    }

    /// Draft tests from what the agent is for; nothing is saved.
    ///
    /// # Errors
    /// `MissingCredentials` without a connected model; `Model` when it suggests nothing.
    pub async fn suggest_tests(&self, agent_id: &str) -> AppResult<Vec<SuggestedTest>> {
        let agent = self.db().get_agent(agent_id)?;
        let steps = crate::flow::summarize_flow(&agent.flow_yaml)
            .map(|summary| summary.steps.into_iter().map(|step| step.title).collect())
            .unwrap_or_default();
        let instructions = crate::flow::compile_draft(&agent.flow_yaml)
            .map(|graph| suggest::step_instructions(&graph))
            .unwrap_or_default();
        let brief = match agent.kind {
            AgentKind::Chatbot => chatbot_brief(&self.dependencies, &agent).await,
            AgentKind::Task | AgentKind::Chain | AgentKind::Team => None,
        };
        let material =
            SuggestionMaterial { agent_name: agent.name, description: agent.description, steps, instructions, brief };
        let model = self.draft_model.text_model()?;
        suggest::suggest_tests(model.as_ref(), &material).await
    }

    // ---- checks ----

    /// Starts a check of the agent's latest version in the background; progress goes to the
    /// sink. Returns the check as it starts.
    ///
    /// # Errors
    /// `InvalidInput` without tests or input; `Conflict` while a check of this agent runs;
    /// whatever preparing a run reports (missing keys, plugins, a broken flow).
    pub fn start_check(&self, agent_id: &str) -> AppResult<CheckView> {
        let prepared = self.prepare_check(agent_id)?;
        if !self.running.lock().map_err(|_| lock_error())?.insert(agent_id.to_owned()) {
            return Err(AppError::Conflict("A check of this agent is already running".into()));
        }
        let started = self.db().start_check(
            agent_id,
            prepared.agent.current_version,
            &prepared.fingerprint,
            prepared.planned_total(),
            prepared.settings.required_percent,
        );
        let check = match started {
            Ok(check) => check,
            Err(error) => {
                self.forget_running(agent_id);
                return Err(error);
            }
        };
        let view = check_view(&check, &prepared.fingerprint, None);
        let task = CheckTask {
            dependencies: self.dependencies.clone(),
            sink: self.sink.clone(),
            running: self.running.clone(),
        };
        tauri::async_runtime::spawn(async move { task.run(check, prepared).await });
        Ok(view)
    }

    /// Runs a check to the end (what [`Self::start_check`] runs in the background).
    pub async fn run_check_now(&self, agent_id: &str) -> AppResult<CheckView> {
        let prepared = self.prepare_check(agent_id)?;
        let check = self.db().start_check(
            agent_id,
            prepared.agent.current_version,
            &prepared.fingerprint,
            prepared.planned_total(),
            prepared.settings.required_percent,
        )?;
        let fingerprint = prepared.fingerprint.clone();
        let task = CheckTask {
            dependencies: self.dependencies.clone(),
            sink: self.sink.clone(),
            running: self.running.clone(),
        };
        let finished = task.run(check, prepared).await;
        let previous = self.previous_finished(agent_id, &finished)?;
        Ok(check_view(&finished, &fingerprint, previous.as_ref()))
    }

    fn prepare_check(&self, agent_id: &str) -> AppResult<PreparedCheck> {
        let agent = self.db().get_agent(agent_id)?;
        let tests = self.db().list_agent_tests(agent_id)?;
        if tests.is_empty() {
            return Err(AppError::InvalidInput("add a test question first".into()));
        }
        let input_name = input_name_of(&agent)?;
        let settings = self.settings(agent_id)?;
        let judge_model = crate::credentials::default_model(&self.dependencies.credentials, self.db())?;
        // Fails here, before a check is recorded, when the agent cannot run (keys, plugins, flow).
        let target = AgentTarget::new(self.dependencies.clone(), agent.clone())?;
        Ok(PreparedCheck {
            fingerprint: suite::tests_fingerprint(&tests),
            agent,
            tests,
            input_name,
            settings,
            judge_model,
            target,
        })
    }

    fn forget_running(&self, agent_id: &str) {
        if let Ok(mut running) = self.running.lock() {
            running.remove(agent_id);
        }
    }

    pub fn get_check(&self, agent_id: &str, check_id: &str) -> AppResult<CheckView> {
        let check = self.db().get_check(agent_id, check_id)?;
        let fingerprint = suite::tests_fingerprint(&self.db().list_agent_tests(agent_id)?);
        let previous = self.previous_finished(agent_id, &check)?;
        Ok(check_view(&check, &fingerprint, previous.as_ref()))
    }

    /// The finished check of this agent right before `check`.
    fn previous_finished(&self, agent_id: &str, check: &CheckRecord) -> AppResult<Option<CheckRecord>> {
        let checks = self.db().list_checks(agent_id, CHECKS_SHOWN)?;
        Ok(checks
            .into_iter()
            .skip_while(|candidate| candidate.id != check.id)
            .skip(1)
            .find(|candidate| candidate.status == CheckStatus::Finished))
    }

    pub fn overview(&self, agent_id: &str) -> AppResult<QualityOverview> {
        let agent = self.db().get_agent(agent_id)?;
        let tests = self.db().list_agent_tests(agent_id)?;
        let checks = self.db().list_checks(agent_id, CHECKS_SHOWN)?;
        let releases = self.db().list_releases(agent_id)?;
        let settings = self.settings(agent_id)?;
        let fingerprint = suite::tests_fingerprint(&tests);
        let readiness = readiness(&ReleaseFacts {
            current_version: agent.current_version,
            tests_count: tests.len(),
            tests_fingerprint: &fingerprint,
            checks: &checks,
            releases: &releases,
            required_percent: settings.required_percent,
        });
        let latest_check = checks.first().map(|latest| {
            let previous = checks.iter().skip(1).find(|candidate| candidate.status == CheckStatus::Finished);
            check_view(latest, &fingerprint, previous)
        });
        Ok(QualityOverview {
            agent_id: agent.id.clone(),
            current_version: agent.current_version,
            can_check: input_name_of(&agent).is_ok(),
            tests,
            latest_check,
            readiness,
            in_use: self.db().release_in_use(agent_id)?,
            releases,
            settings,
        })
    }

    // ---- releases ----

    /// Releases the latest version. Without `override_reason` it must be ready (see
    /// [`release::readiness`]); with one, any block that allows it is passed.
    ///
    /// # Errors
    /// `InvalidInput` with the plain reason when the version may not be released.
    pub fn create_release(&self, agent_id: &str, notes: &str, override_reason: Option<String>) -> AppResult<Release> {
        let overview = self.overview(agent_id)?;
        let override_reason = override_reason.filter(|reason| !reason.trim().is_empty());
        let (check_id, passed, total) = match (&overview.readiness, &override_reason) {
            (ReleaseReadiness::Ready { check_id, good, total }, _) => {
                (Some(check_id.clone()), Some(*good), Some(*total))
            }
            (ReleaseReadiness::Blocked { can_override: true, check_id, .. }, Some(_)) => {
                let check = check_id.as_deref().map(|id| self.db().get_check(agent_id, id)).transpose()?;
                (check_id.clone(), check.as_ref().map(|check| check.passed), check.as_ref().map(|check| check.total))
            }
            (ReleaseReadiness::Blocked { block, .. }, _) => {
                return Err(AppError::InvalidInput(blocked_message(block)));
            }
        };
        let override_reason = match overview.readiness {
            ReleaseReadiness::Ready { .. } => None,
            ReleaseReadiness::Blocked { .. } => override_reason,
        };
        let release = self.db().create_release(
            agent_id,
            NewRelease {
                agent_version: overview.current_version,
                notes: notes.to_owned(),
                check_id,
                passed,
                total,
                required_percent: overview.settings.required_percent,
                override_reason,
            },
        )?;
        log::info!("agent {agent_id}: released version {} as release {}", release.agent_version, release.number);
        Ok(release)
    }

    /// Puts an older (or newer) release back in use.
    ///
    /// # Errors
    /// `InvalidInput` when it is already in use or does not exist.
    pub fn switch_release(&self, agent_id: &str, number: i64) -> AppResult<Release> {
        let releases = self.db().list_releases(agent_id)?;
        let in_use = self.db().release_in_use(agent_id)?;
        if !release::can_switch_to(&releases, in_use.as_ref(), number) {
            return Err(AppError::InvalidInput(format!("release {number} is already in use or does not exist")));
        }
        let release = self.db().switch_release(agent_id, number, SwitchReason::RolledBack)?;
        log::info!("agent {agent_id}: release {number} is in use again");
        Ok(release)
    }
}

/// English reason a release is blocked (the screens show their own translated words).
fn blocked_message(block: &release::ReleaseBlock) -> String {
    use release::ReleaseBlock;
    match block {
        ReleaseBlock::AlreadyReleased { number } => format!("This version is already release {number}"),
        ReleaseBlock::CheckRunning => "Wait for the check to finish".into(),
        ReleaseBlock::NoTests => {
            "Add test questions and check the agent first, or say why you release it anyway".into()
        }
        ReleaseBlock::NotChecked => "Check this version first, or say why you release it anyway".into(),
        ReleaseBlock::TestsChanged => "The tests changed after the last check. Check again first".into(),
        ReleaseBlock::CheckDidNotFinish => "The last check did not finish. Check again first".into(),
        ReleaseBlock::NotEnoughGood { good, total, needed, .. } => {
            format!("Only {good} of {total} answers were good; {needed} are needed")
        }
    }
}

fn lock_error() -> AppError {
    AppError::Internal("the list of running checks is not available".into())
}

/// The start input that receives each question.
fn input_name_of(agent: &Agent) -> AppResult<String> {
    if agent.kind == AgentKind::Chatbot {
        return Ok(crate::conversations::bot::MESSAGE_INPUT.to_owned());
    }
    let summary = crate::flow::summarize_flow(&agent.flow_yaml)?;
    suite::question_input(&summary.inputs)
        .ok_or_else(|| AppError::InvalidInput("this agent has no input to ask a question with".into()))
}

/// A chatbot's brief (persona, rules and the knowledge that fits its description).
async fn chatbot_brief(dependencies: &CheckDependencies, agent: &Agent) -> Option<String> {
    let query = if agent.description.trim().is_empty() { agent.name.as_str() } else { agent.description.as_str() };
    match crate::chatbot_setup::reply::prepare_reply(&dependencies.db, &dependencies.credentials, agent, query).await {
        Ok(prepared) => prepared
            .sys_values
            .into_iter()
            .find(|(name, _)| name == crate::chatbot_setup::overlay::BRIEF_SYS_NAME)
            .map(|(_, brief)| brief),
        Err(error) => {
            log::info!("suggesting tests without the chatbot's brief: {error}");
            None
        }
    }
}

/// A check ready to run.
struct PreparedCheck {
    agent: Agent,
    tests: Vec<AgentTest>,
    fingerprint: String,
    input_name: String,
    settings: QualitySettings,
    judge_model: crate::credentials::ModelChoice,
    target: AgentTarget,
}

impl PreparedCheck {
    /// Answers the check will score: every question, as many times as set.
    fn planned_total(&self) -> i64 {
        let times = usize::try_from(self.settings.times_each).unwrap_or(1);
        i64::try_from(self.tests.len().saturating_mul(times)).unwrap_or(i64::MAX)
    }
}

/// The background part of a check: runs it, stores the result, says it is done.
struct CheckTask {
    dependencies: CheckDependencies,
    sink: Arc<dyn CheckProgressSink>,
    running: Arc<Mutex<HashSet<String>>>,
}

impl CheckTask {
    async fn run(self, check: CheckRecord, prepared: PreparedCheck) -> CheckRecord {
        let db = self.dependencies.db.clone();
        let agent_id = check.agent_id.clone();
        let outcome = self.evaluate(&check, &prepared).await;
        let stored = match outcome {
            Ok((passed, total, json)) => db.finish_check(&check.id, passed, total, &json),
            Err(error) => {
                log::warn!("check {} of agent {agent_id} did not finish: {error}", check.id);
                db.fail_check(&check.id, &error.to_string())
            }
        };
        if let Ok(mut running) = self.running.lock() {
            running.remove(&agent_id);
        }
        let total = usize::try_from(check.total).unwrap_or_default();
        self.sink.send(CheckProgress { agent_id, check_id: check.id.clone(), done: total, total, finished: true });
        stored.unwrap_or(check)
    }

    async fn evaluate(&self, check: &CheckRecord, prepared: &PreparedCheck) -> AppResult<(i64, i64, String)> {
        let suite = suite::build_suite(
            &prepared.tests,
            &prepared.input_name,
            prepared.settings.required_percent,
            Path::new(""),
        )?;
        let registry = judges::registry(self.dependencies.clone(), prepared.judge_model.clone());
        let mut options = RunnerOptions::default();
        options.concurrency = CHECK_CONCURRENCY;
        options.trials = prepared.settings.times_each;
        let runner = Runner::new(options).with_registry(registry);
        let total = usize::try_from(check.total).unwrap_or_default();
        let mut done = 0;
        let report = runner
            .run(&suite, &prepared.target, |_result| {
                done += 1;
                self.sink.send(CheckProgress {
                    agent_id: check.agent_id.clone(),
                    check_id: check.id.clone(),
                    done,
                    total,
                    finished: false,
                });
            })
            .await
            .map_err(|error| AppError::Internal(format!("the check could not run: {error}")))?;
        let passed = i64::try_from(report.summary.passed).unwrap_or(i64::MAX);
        let total = i64::try_from(report.summary.total).unwrap_or(i64::MAX);
        let words = prepared
            .tests
            .iter()
            .map(|test| TestWords {
                test_id: test.id.clone(),
                must_include: test.must_include.clone(),
                must_not_include: test.must_not_include.clone(),
            })
            .collect();
        let stored = StoredCheck { graphrt: serde_json::to_value(&report)?, words };
        log::info!("check {} of agent {}: {passed} of {total} good", check.id, check.agent_id);
        Ok((passed, total, serde_json::to_string(&stored)?))
    }
}
