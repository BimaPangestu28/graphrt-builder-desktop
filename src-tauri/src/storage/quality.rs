//! Tests and releases of an agent (see `crate::quality`).
//!
//! - `agent_tests`: the questions an agent is checked with and what a good answer says.
//! - `agent_checks`: one row per check of one agent version, with graphrt's eval report.
//! - `agent_releases`: a checked version with its notes. Never changed once made (an
//!   `UPDATE` is refused by a trigger); removed only with the agent.
//! - `agent_release_switches`: which release is in use. Append-only, so going back to an
//!   older release is a new row and the history of what was in use stays readable.

use rusqlite::{params, Connection, OptionalExtension, Row};
use serde::{Deserialize, Serialize};

use super::agents::ensure_agent_exists;
use super::models::Agent;
use super::{now_rfc3339, Database};
use crate::error::{AppError, AppResult};

/// Most tests one agent can have.
pub const MAX_TESTS_PER_AGENT: usize = 100;
const MAX_QUESTION_CHARS: usize = 2_000;
const MAX_GOOD_ANSWER_CHARS: usize = 4_000;
const MAX_WORDS: usize = 20;
const MAX_WORD_CHARS: usize = 200;
const MAX_NOTES_CHARS: usize = 2_000;
const MAX_REASON_CHARS: usize = 500;

/// One question the agent is checked with.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentTest {
    pub id: String,
    pub agent_id: String,
    /// What the customer or user asks (the agent's main input).
    pub question: String,
    /// What a good answer says, in plain words. Empty: the answer only has to address the question.
    pub good_answer: String,
    /// Words the answer must contain (any case). Advanced.
    pub must_include: Vec<String>,
    /// Words the answer must not contain (any case). Advanced.
    pub must_not_include: Vec<String>,
    /// Suggested by the app and not changed by the person yet.
    pub suggested: bool,
    pub created_at: String,
    pub updated_at: String,
}

/// What the person writes for a test.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TestInput {
    pub question: String,
    #[serde(default)]
    pub good_answer: String,
    #[serde(default)]
    pub must_include: Vec<String>,
    #[serde(default)]
    pub must_not_include: Vec<String>,
    #[serde(default)]
    pub suggested: bool,
}

impl TestInput {
    /// Trimmed, with empty words dropped and every limit checked.
    ///
    /// # Errors
    /// `InvalidInput` for an empty question or text over a limit.
    pub fn checked(self) -> AppResult<Self> {
        let question = self.question.trim().to_owned();
        if question.is_empty() {
            return Err(AppError::InvalidInput("write the question to ask".into()));
        }
        check_length("the question", &question, MAX_QUESTION_CHARS)?;
        let good_answer = self.good_answer.trim().to_owned();
        check_length("the good answer", &good_answer, MAX_GOOD_ANSWER_CHARS)?;
        Ok(Self {
            question,
            good_answer,
            must_include: checked_words(self.must_include)?,
            must_not_include: checked_words(self.must_not_include)?,
            suggested: self.suggested,
        })
    }
}

fn check_length(what: &str, text: &str, max_chars: usize) -> AppResult<()> {
    if text.chars().count() > max_chars {
        return Err(AppError::InvalidInput(format!("{what} is too long (at most {max_chars} characters)")));
    }
    Ok(())
}

fn checked_words(words: Vec<String>) -> AppResult<Vec<String>> {
    let words: Vec<String> =
        words.into_iter().map(|word| word.trim().to_owned()).filter(|word| !word.is_empty()).collect();
    if words.len() > MAX_WORDS {
        return Err(AppError::InvalidInput(format!("at most {MAX_WORDS} words per list")));
    }
    for word in &words {
        check_length("a word", word, MAX_WORD_CHARS)?;
    }
    Ok(words)
}

/// Where a check is.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum CheckStatus {
    Running,
    /// Every test ran; `passed` of `total` were good.
    Finished,
    /// The check could not run to the end (`error_message` says why).
    Failed,
}

impl CheckStatus {
    fn as_db_text(self) -> &'static str {
        match self {
            Self::Running => "running",
            Self::Finished => "finished",
            Self::Failed => "failed",
        }
    }

    fn from_db_text(text: &str) -> rusqlite::Result<Self> {
        match text {
            "running" => Ok(Self::Running),
            "finished" => Ok(Self::Finished),
            "failed" => Ok(Self::Failed),
            other => Err(rusqlite::Error::FromSqlConversionFailure(
                0,
                rusqlite::types::Type::Text,
                format!("unknown check status {other:?}").into(),
            )),
        }
    }
}

/// One check of one agent version.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CheckRecord {
    pub id: String,
    pub agent_id: String,
    pub agent_version: i64,
    /// Fingerprint of the tests it ran (`crate::quality::suite::tests_fingerprint`).
    pub tests_fingerprint: String,
    pub status: CheckStatus,
    pub total: i64,
    pub passed: i64,
    /// How many answers had to be good, in percent, when it ran.
    pub required_percent: i64,
    /// graphrt's eval report (JSON) once finished.
    pub report_json: Option<String>,
    pub error_message: Option<String>,
    pub started_at: String,
    pub finished_at: Option<String>,
}

/// A released version. Never changes once made.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Release {
    pub agent_id: String,
    /// 1, 2, 3... per agent.
    pub number: i64,
    pub agent_version: i64,
    pub notes: String,
    /// The check it was released on (absent when released without one).
    pub check_id: Option<String>,
    pub passed: Option<i64>,
    pub total: Option<i64>,
    pub required_percent: i64,
    /// Set when it was released although the check did not allow it.
    pub override_reason: Option<String>,
    pub created_at: String,
}

/// What a new release records.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct NewRelease {
    pub agent_version: i64,
    pub notes: String,
    pub check_id: Option<String>,
    pub passed: Option<i64>,
    pub total: Option<i64>,
    pub required_percent: i64,
    pub override_reason: Option<String>,
}

/// Why a release came into use.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SwitchReason {
    Released,
    RolledBack,
}

impl SwitchReason {
    fn as_db_text(self) -> &'static str {
        match self {
            Self::Released => "released",
            Self::RolledBack => "rolled_back",
        }
    }
}

const TEST_COLUMNS: &str =
    "id, agent_id, question, good_answer, must_include_json, must_not_include_json, suggested, created_at, updated_at";
const CHECK_COLUMNS: &str = "id, agent_id, agent_version, tests_fingerprint, status, total, passed, required_percent, \
     report_json, error_message, started_at, finished_at";
const RELEASE_COLUMNS: &str = "agent_id, number, agent_version, notes, check_id, passed, total, required_percent, \
     override_reason, created_at";

impl Database {
    // ---- tests ----

    /// The agent's tests in the order they were added.
    pub fn list_agent_tests(&self, agent_id: &str) -> AppResult<Vec<AgentTest>> {
        let connection = self.lock()?;
        ensure_agent_exists(&connection, agent_id)?;
        list_tests(&connection, agent_id)
    }

    /// Adds tests after the existing ones, all or none.
    ///
    /// # Errors
    /// `InvalidInput` for a test over a limit or more than [`MAX_TESTS_PER_AGENT`] in all.
    pub fn add_agent_tests(&self, agent_id: &str, inputs: Vec<TestInput>) -> AppResult<Vec<AgentTest>> {
        let inputs = inputs.into_iter().map(TestInput::checked).collect::<AppResult<Vec<_>>>()?;
        let mut connection = self.lock()?;
        let transaction = connection.transaction()?;
        ensure_agent_exists(&transaction, agent_id)?;
        let existing: i64 =
            transaction
                .query_row("SELECT COUNT(*) FROM agent_tests WHERE agent_id = ?1", [agent_id], |row| row.get(0))?;
        let existing = usize::try_from(existing).unwrap_or(usize::MAX);
        if existing.saturating_add(inputs.len()) > MAX_TESTS_PER_AGENT {
            return Err(AppError::InvalidInput(format!("an agent can have at most {MAX_TESTS_PER_AGENT} tests")));
        }
        let mut position: i64 = transaction.query_row(
            "SELECT COALESCE(MAX(position), 0) FROM agent_tests WHERE agent_id = ?1",
            [agent_id],
            |row| row.get(0),
        )?;
        let now = now_rfc3339();
        for input in &inputs {
            position += 1;
            transaction.execute(
                &format!("INSERT INTO agent_tests ({TEST_COLUMNS}, position) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?8, ?9)"),
                params![
                    uuid::Uuid::new_v4().to_string(),
                    agent_id,
                    input.question,
                    input.good_answer,
                    serde_json::to_string(&input.must_include)?,
                    serde_json::to_string(&input.must_not_include)?,
                    input.suggested,
                    now,
                    position,
                ],
            )?;
        }
        let tests = list_tests(&transaction, agent_id)?;
        transaction.commit()?;
        Ok(tests)
    }

    /// Replaces what a test asks and expects. A changed test is no longer "suggested".
    ///
    /// # Errors
    /// `NotFound` when the agent has no such test.
    pub fn update_agent_test(&self, agent_id: &str, test_id: &str, input: TestInput) -> AppResult<AgentTest> {
        let input = input.checked()?;
        let connection = self.lock()?;
        let changed = connection.execute(
            "UPDATE agent_tests SET question = ?1, good_answer = ?2, must_include_json = ?3, must_not_include_json = ?4,
                 suggested = 0, updated_at = ?5 WHERE agent_id = ?6 AND id = ?7",
            params![
                input.question,
                input.good_answer,
                serde_json::to_string(&input.must_include)?,
                serde_json::to_string(&input.must_not_include)?,
                now_rfc3339(),
                agent_id,
                test_id,
            ],
        )?;
        if changed == 0 {
            return Err(AppError::NotFound(format!("test {test_id}")));
        }
        connection
            .query_row(
                &format!("SELECT {TEST_COLUMNS} FROM agent_tests WHERE agent_id = ?1 AND id = ?2"),
                params![agent_id, test_id],
                map_test_row,
            )
            .map_err(AppError::from)
    }

    /// Removes a test; succeeds when it was already gone.
    pub fn delete_agent_test(&self, agent_id: &str, test_id: &str) -> AppResult<()> {
        let connection = self.lock()?;
        connection.execute("DELETE FROM agent_tests WHERE agent_id = ?1 AND id = ?2", params![agent_id, test_id])?;
        Ok(())
    }

    // ---- checks ----

    /// Records a check that starts now.
    pub fn start_check(
        &self,
        agent_id: &str,
        agent_version: i64,
        tests_fingerprint: &str,
        total: i64,
        required_percent: i64,
    ) -> AppResult<CheckRecord> {
        let connection = self.lock()?;
        ensure_agent_exists(&connection, agent_id)?;
        let id = uuid::Uuid::new_v4().to_string();
        connection.execute(
            "INSERT INTO agent_checks (id, agent_id, agent_version, tests_fingerprint, status, total, passed,
                 required_percent, started_at) VALUES (?1, ?2, ?3, ?4, 'running', ?5, 0, ?6, ?7)",
            params![id, agent_id, agent_version, tests_fingerprint, total, required_percent, now_rfc3339()],
        )?;
        fetch_check(&connection, &id)
    }

    /// Stores the result of a check that ran to the end.
    pub fn finish_check(&self, check_id: &str, passed: i64, total: i64, report_json: &str) -> AppResult<CheckRecord> {
        let connection = self.lock()?;
        connection.execute(
            "UPDATE agent_checks SET status = ?1, passed = ?2, total = ?3, report_json = ?4, finished_at = ?5
             WHERE id = ?6",
            params![CheckStatus::Finished.as_db_text(), passed, total, report_json, now_rfc3339(), check_id],
        )?;
        fetch_check(&connection, check_id)
    }

    /// Marks a check that could not run to the end.
    pub fn fail_check(&self, check_id: &str, message: &str) -> AppResult<CheckRecord> {
        let connection = self.lock()?;
        connection.execute(
            "UPDATE agent_checks SET status = ?1, error_message = ?2, finished_at = ?3 WHERE id = ?4",
            params![CheckStatus::Failed.as_db_text(), message, now_rfc3339(), check_id],
        )?;
        fetch_check(&connection, check_id)
    }

    /// Checks left running when the app closed can never finish: marks them failed.
    pub fn fail_unfinished_checks(&self, message: &str) -> AppResult<usize> {
        let connection = self.lock()?;
        Ok(connection.execute(
            "UPDATE agent_checks SET status = 'failed', error_message = ?1, finished_at = ?2 WHERE status = 'running'",
            params![message, now_rfc3339()],
        )?)
    }

    pub fn get_check(&self, agent_id: &str, check_id: &str) -> AppResult<CheckRecord> {
        let connection = self.lock()?;
        let check = fetch_check(&connection, check_id)?;
        if check.agent_id != agent_id {
            return Err(AppError::NotFound(format!("check {check_id}")));
        }
        Ok(check)
    }

    /// The agent's checks, newest first.
    pub fn list_checks(&self, agent_id: &str, limit: u32) -> AppResult<Vec<CheckRecord>> {
        let connection = self.lock()?;
        ensure_agent_exists(&connection, agent_id)?;
        let mut statement = connection.prepare(&format!(
            "SELECT {CHECK_COLUMNS} FROM agent_checks WHERE agent_id = ?1 ORDER BY started_at DESC, rowid DESC LIMIT ?2"
        ))?;
        let checks = statement.query_map(params![agent_id, limit], map_check_row)?.collect::<Result<Vec<_>, _>>()?;
        Ok(checks)
    }

    // ---- releases ----

    /// Makes the next release and puts it in use, in one transaction.
    ///
    /// # Errors
    /// `NotFound` for an unknown agent or version; `InvalidInput` for notes or a reason over a limit.
    pub fn create_release(&self, agent_id: &str, release: NewRelease) -> AppResult<Release> {
        let notes = release.notes.trim().to_owned();
        check_length("the notes", &notes, MAX_NOTES_CHARS)?;
        let override_reason = release.override_reason.map(|reason| reason.trim().to_owned());
        if let Some(reason) = &override_reason {
            if reason.is_empty() {
                return Err(AppError::InvalidInput("say why it is released anyway".into()));
            }
            check_length("the reason", reason, MAX_REASON_CHARS)?;
        }
        let mut connection = self.lock()?;
        let transaction = connection.transaction()?;
        ensure_agent_exists(&transaction, agent_id)?;
        let version_exists: bool = transaction.query_row(
            "SELECT EXISTS (SELECT 1 FROM agent_versions WHERE agent_id = ?1 AND version = ?2)",
            params![agent_id, release.agent_version],
            |row| row.get(0),
        )?;
        if !version_exists {
            return Err(AppError::NotFound(format!("version {} of agent {agent_id}", release.agent_version)));
        }
        let number: i64 = transaction.query_row(
            "SELECT COALESCE(MAX(number), 0) + 1 FROM agent_releases WHERE agent_id = ?1",
            [agent_id],
            |row| row.get(0),
        )?;
        transaction.execute(
            &format!("INSERT INTO agent_releases ({RELEASE_COLUMNS}) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)"),
            params![
                agent_id,
                number,
                release.agent_version,
                notes,
                release.check_id,
                release.passed,
                release.total,
                release.required_percent,
                override_reason,
                now_rfc3339(),
            ],
        )?;
        insert_switch(&transaction, agent_id, number, SwitchReason::Released)?;
        let created = fetch_release(&transaction, agent_id, number)?;
        transaction.commit()?;
        Ok(created)
    }

    /// The agent's releases, newest first.
    pub fn list_releases(&self, agent_id: &str) -> AppResult<Vec<Release>> {
        let connection = self.lock()?;
        ensure_agent_exists(&connection, agent_id)?;
        let mut statement = connection.prepare(&format!(
            "SELECT {RELEASE_COLUMNS} FROM agent_releases WHERE agent_id = ?1 ORDER BY number DESC"
        ))?;
        let releases = statement.query_map([agent_id], map_release_row)?.collect::<Result<Vec<_>, _>>()?;
        Ok(releases)
    }

    pub fn get_release(&self, agent_id: &str, number: i64) -> AppResult<Release> {
        let connection = self.lock()?;
        fetch_release(&connection, agent_id, number)
    }

    /// The release in use: the one of the newest switch. `None` before the first release.
    pub fn release_in_use(&self, agent_id: &str) -> AppResult<Option<Release>> {
        let connection = self.lock()?;
        let number: Option<i64> = connection
            .query_row(
                "SELECT release_number FROM agent_release_switches WHERE agent_id = ?1 ORDER BY id DESC LIMIT 1",
                [agent_id],
                |row| row.get(0),
            )
            .optional()?;
        number.map(|number| fetch_release(&connection, agent_id, number)).transpose()
    }

    /// The agent as its release in use: the released version's flow and number, so what goes
    /// online (or into an agent file) is exactly what was checked and released.
    ///
    /// # Errors
    /// `NeedsRelease` before the first release; `NotFound` for an unknown agent.
    pub fn released_agent(&self, agent_id: &str) -> AppResult<Agent> {
        let mut agent = self.get_agent(agent_id)?;
        let release = self.release_in_use(agent_id)?.ok_or(AppError::NeedsRelease)?;
        if release.agent_version != agent.current_version {
            agent.flow_yaml = self.get_agent_version(agent_id, release.agent_version)?.flow_yaml;
            agent.current_version = release.agent_version;
        }
        Ok(agent)
    }

    /// Puts an existing release in use (a roll back, or matching what is online).
    ///
    /// # Errors
    /// `NotFound` when the agent has no such release.
    pub fn switch_release(&self, agent_id: &str, number: i64, reason: SwitchReason) -> AppResult<Release> {
        let mut connection = self.lock()?;
        let transaction = connection.transaction()?;
        let release = fetch_release(&transaction, agent_id, number)?;
        insert_switch(&transaction, agent_id, number, reason)?;
        transaction.commit()?;
        Ok(release)
    }
}

fn insert_switch(connection: &Connection, agent_id: &str, number: i64, reason: SwitchReason) -> AppResult<()> {
    connection.execute(
        "INSERT INTO agent_release_switches (agent_id, release_number, reason, created_at) VALUES (?1, ?2, ?3, ?4)",
        params![agent_id, number, reason.as_db_text(), now_rfc3339()],
    )?;
    Ok(())
}

fn list_tests(connection: &Connection, agent_id: &str) -> AppResult<Vec<AgentTest>> {
    let mut statement = connection.prepare(&format!(
        "SELECT {TEST_COLUMNS} FROM agent_tests WHERE agent_id = ?1 ORDER BY position ASC, rowid ASC"
    ))?;
    let tests = statement.query_map([agent_id], map_test_row)?.collect::<Result<Vec<_>, _>>()?;
    Ok(tests)
}

fn fetch_check(connection: &Connection, check_id: &str) -> AppResult<CheckRecord> {
    connection
        .query_row(&format!("SELECT {CHECK_COLUMNS} FROM agent_checks WHERE id = ?1"), [check_id], map_check_row)
        .optional()?
        .ok_or_else(|| AppError::NotFound(format!("check {check_id}")))
}

fn fetch_release(connection: &Connection, agent_id: &str, number: i64) -> AppResult<Release> {
    connection
        .query_row(
            &format!("SELECT {RELEASE_COLUMNS} FROM agent_releases WHERE agent_id = ?1 AND number = ?2"),
            params![agent_id, number],
            map_release_row,
        )
        .optional()?
        .ok_or_else(|| AppError::NotFound(format!("release {number} of agent {agent_id}")))
}

fn words_column(row: &Row<'_>, column: &str) -> rusqlite::Result<Vec<String>> {
    let text: String = row.get(column)?;
    serde_json::from_str(&text)
        .map_err(|error| rusqlite::Error::FromSqlConversionFailure(0, rusqlite::types::Type::Text, Box::new(error)))
}

fn map_test_row(row: &Row<'_>) -> rusqlite::Result<AgentTest> {
    Ok(AgentTest {
        id: row.get("id")?,
        agent_id: row.get("agent_id")?,
        question: row.get("question")?,
        good_answer: row.get("good_answer")?,
        must_include: words_column(row, "must_include_json")?,
        must_not_include: words_column(row, "must_not_include_json")?,
        suggested: row.get("suggested")?,
        created_at: row.get("created_at")?,
        updated_at: row.get("updated_at")?,
    })
}

fn map_check_row(row: &Row<'_>) -> rusqlite::Result<CheckRecord> {
    let status: String = row.get("status")?;
    Ok(CheckRecord {
        id: row.get("id")?,
        agent_id: row.get("agent_id")?,
        agent_version: row.get("agent_version")?,
        tests_fingerprint: row.get("tests_fingerprint")?,
        status: CheckStatus::from_db_text(&status)?,
        total: row.get("total")?,
        passed: row.get("passed")?,
        required_percent: row.get("required_percent")?,
        report_json: row.get("report_json")?,
        error_message: row.get("error_message")?,
        started_at: row.get("started_at")?,
        finished_at: row.get("finished_at")?,
    })
}

fn map_release_row(row: &Row<'_>) -> rusqlite::Result<Release> {
    Ok(Release {
        agent_id: row.get("agent_id")?,
        number: row.get("number")?,
        agent_version: row.get("agent_version")?,
        notes: row.get("notes")?,
        check_id: row.get("check_id")?,
        passed: row.get("passed")?,
        total: row.get("total")?,
        required_percent: row.get("required_percent")?,
        override_reason: row.get("override_reason")?,
        created_at: row.get("created_at")?,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::storage::models::{AgentKind, NewAgent};

    const FLOW: &str = "version: \"1\"\nname: t\ngraph:\n  nodes:\n    - { id: start, type: start }\n    - { id: end, type: end }\n  edges:\n    - { source: start, target: end }\n";

    fn database_with_agent() -> (Database, String) {
        let database = Database::open_in_memory().unwrap();
        let agent = database
            .create_agent(NewAgent {
                name: "Shop".into(),
                kind: AgentKind::Chatbot,
                description: String::new(),
                flow_yaml: FLOW.into(),
            })
            .unwrap();
        (database, agent.id)
    }

    fn question(text: &str) -> TestInput {
        TestInput { question: text.into(), good_answer: "Open 9 to 5".into(), ..TestInput::default() }
    }

    fn release_of(version: i64) -> NewRelease {
        NewRelease {
            agent_version: version,
            notes: " First ".into(),
            check_id: None,
            passed: Some(4),
            total: Some(5),
            required_percent: 80,
            override_reason: None,
        }
    }

    #[test]
    fn tests_are_trimmed_kept_in_order_and_edited() {
        let (database, agent_id) = database_with_agent();
        let mut first = question("  When do you open? ");
        first.must_include = vec![" 9 ".into(), "".into()];
        first.suggested = true;
        let tests = database.add_agent_tests(&agent_id, vec![first, question("Where are you?")]).unwrap();
        assert_eq!(tests.len(), 2);
        assert_eq!(tests[0].question, "When do you open?");
        assert_eq!(tests[0].must_include, ["9"]);
        assert!(tests[0].suggested);
        let edited = database.update_agent_test(&agent_id, &tests[0].id, question("When do you close?")).unwrap();
        assert_eq!(edited.question, "When do you close?");
        assert!(!edited.suggested, "a changed test is the person's own");
        database.delete_agent_test(&agent_id, &tests[1].id).unwrap();
        assert_eq!(database.list_agent_tests(&agent_id).unwrap().len(), 1);
    }

    #[test]
    fn an_empty_question_or_too_many_tests_are_refused() {
        let (database, agent_id) = database_with_agent();
        assert!(matches!(database.add_agent_tests(&agent_id, vec![question("  ")]), Err(AppError::InvalidInput(_))));
        let many = (0..=MAX_TESTS_PER_AGENT).map(|index| question(&format!("q{index}"))).collect();
        assert!(matches!(database.add_agent_tests(&agent_id, many), Err(AppError::InvalidInput(_))));
        assert!(database.list_agent_tests(&agent_id).unwrap().is_empty(), "all or none");
    }

    #[test]
    fn a_check_runs_then_finishes_or_fails() {
        let (database, agent_id) = database_with_agent();
        let check = database.start_check(&agent_id, 1, "abc", 5, 80).unwrap();
        assert_eq!(check.status, CheckStatus::Running);
        let finished = database.finish_check(&check.id, 4, 5, "{}").unwrap();
        assert_eq!((finished.status, finished.passed), (CheckStatus::Finished, 4));
        let other = database.start_check(&agent_id, 1, "abc", 5, 80).unwrap();
        assert_eq!(database.fail_unfinished_checks("The app closed").unwrap(), 1);
        let failed = database.get_check(&agent_id, &other.id).unwrap();
        assert_eq!(failed.status, CheckStatus::Failed);
        assert_eq!(database.list_checks(&agent_id, 10).unwrap().len(), 2);
        assert!(matches!(database.get_check("other-agent", &other.id), Err(AppError::NotFound(_))));
    }

    #[test]
    fn releases_count_up_go_in_use_and_never_change() {
        let (database, agent_id) = database_with_agent();
        assert_eq!(database.release_in_use(&agent_id).unwrap(), None);
        let first = database.create_release(&agent_id, release_of(1)).unwrap();
        assert_eq!((first.number, first.notes.as_str()), (1, "First"));
        database.update_agent_flow(&agent_id, &FLOW.replace("name: t", "name: u"), "Renamed").unwrap();
        let second = database.create_release(&agent_id, release_of(2)).unwrap();
        assert_eq!(second.number, 2);
        assert_eq!(database.release_in_use(&agent_id).unwrap().map(|release| release.number), Some(2));

        database.switch_release(&agent_id, 1, SwitchReason::RolledBack).unwrap();
        assert_eq!(database.release_in_use(&agent_id).unwrap().map(|release| release.number), Some(1));
        assert_eq!(database.list_releases(&agent_id).unwrap().len(), 2, "a roll back keeps every release");

        let connection = database.lock().unwrap();
        let changed = connection.execute("UPDATE agent_releases SET notes = 'x' WHERE agent_id = ?1", [&agent_id]);
        assert!(changed.is_err(), "a release cannot be changed");
    }

    #[test]
    fn the_released_agent_carries_the_released_flow() {
        let (database, agent_id) = database_with_agent();
        assert!(matches!(database.released_agent(&agent_id), Err(AppError::NeedsRelease)));
        database.create_release(&agent_id, release_of(1)).unwrap();
        let newer = FLOW.replace("name: t", "name: newer");
        database.update_agent_flow(&agent_id, &newer, "Draft").unwrap();
        let released = database.released_agent(&agent_id).unwrap();
        assert_eq!((released.current_version, released.flow_yaml.as_str()), (1, FLOW));
        assert_eq!(database.get_agent(&agent_id).unwrap().current_version, 2, "the draft is untouched");
    }

    #[test]
    fn a_release_needs_an_existing_version_and_a_reason_when_overridden() {
        let (database, agent_id) = database_with_agent();
        assert!(matches!(database.create_release(&agent_id, release_of(9)), Err(AppError::NotFound(_))));
        let mut blank_reason = release_of(1);
        blank_reason.override_reason = Some("  ".into());
        assert!(matches!(database.create_release(&agent_id, blank_reason), Err(AppError::InvalidInput(_))));
        assert!(matches!(database.switch_release(&agent_id, 3, SwitchReason::RolledBack), Err(AppError::NotFound(_))));
    }

    #[test]
    fn deleting_the_agent_removes_its_releases() {
        let (database, agent_id) = database_with_agent();
        database.create_release(&agent_id, release_of(1)).unwrap();
        database.add_agent_tests(&agent_id, vec![question("Hi?")]).unwrap();
        database.delete_agent(&agent_id).unwrap();
        let connection = database.lock().unwrap();
        let left: i64 = connection
            .query_row(
                "SELECT (SELECT COUNT(*) FROM agent_releases) + (SELECT COUNT(*) FROM agent_tests)
                    + (SELECT COUNT(*) FROM agent_release_switches)",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(left, 0);
    }
}
