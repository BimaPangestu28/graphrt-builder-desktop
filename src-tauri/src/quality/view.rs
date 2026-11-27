//! A check as the screens show it, read from graphrt's eval report: per question whether
//! the answer was good and why not, and what moved since the check before (graphrt's
//! baseline comparison, with no tolerance on a single test).

use std::collections::HashMap;

use graphrt_eval::baseline::{Baseline, BaselineComparison, Change};
use graphrt_eval::{EvalReport, TestResult, TestStatus, Tolerance};
use serde::{Deserialize, Serialize};
use serde_json::Value as Json;

use super::release::needed_good;
use crate::storage::quality::{CheckRecord, CheckStatus};

/// Why an answer was not good, for the screens to say in the app language.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum NotGoodReason {
    /// The judge's own words (in the question's language).
    Judge { text: String },
    /// Words that had to be in the answer and are not.
    MissingWords { words: Vec<String> },
    /// Words that must not be in the answer and are.
    UnwantedWords { words: Vec<String> },
    /// The agent could not answer (an error, a timeout, or a step waiting for an OK).
    NoAnswer { message: String },
}

/// What moved for one question since the check before.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum QuestionChange {
    NowGood,
    NowNotGood,
    /// Not in the check before.
    New,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct QuestionResult {
    pub test_id: String,
    pub question: String,
    pub good: bool,
    /// The agent's answer (empty when it gave none).
    pub answer: String,
    /// Why it was good: the judge's words, when it gave some.
    pub good_because: Option<String>,
    pub not_good_because: Vec<NotGoodReason>,
    pub change: Option<QuestionChange>,
}

/// The check before, in numbers.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PreviousCheck {
    pub check_id: String,
    pub agent_version: i64,
    pub good: i64,
    pub total: i64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CheckView {
    pub id: String,
    pub agent_version: i64,
    pub status: CheckStatus,
    pub started_at: String,
    pub finished_at: Option<String>,
    pub good: i64,
    pub total: i64,
    pub required_percent: i64,
    /// Good answers needed at `required_percent`.
    pub needed: i64,
    /// Finished with at least `needed` good answers.
    pub enough_good: bool,
    /// The tests changed after this check ran.
    pub tests_changed_since: bool,
    pub error_message: Option<String>,
    pub questions: Vec<QuestionResult>,
    pub previous: Option<PreviousCheck>,
}

/// The words lists of one test when its check ran (the report keeps no assertion values).
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TestWords {
    pub test_id: String,
    pub must_include: Vec<String>,
    pub must_not_include: Vec<String>,
}

/// What `agent_checks.report_json` holds: graphrt's report and the word lists it checked.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StoredCheck {
    pub graphrt: Json,
    #[serde(default)]
    pub words: Vec<TestWords>,
}

impl StoredCheck {
    pub fn parse(json: &str) -> Option<Self> {
        match serde_json::from_str(json) {
            Ok(stored) => Some(stored),
            Err(error) => {
                log::warn!("a stored check cannot be read: {error}");
                None
            }
        }
    }

    fn report(&self) -> Option<EvalReport> {
        match serde_json::from_value(self.graphrt.clone()) {
            Ok(report) => Some(report),
            Err(error) => {
                log::warn!("a stored check report cannot be read: {error}");
                None
            }
        }
    }
}

/// Builds the view of `check`; `previous` is the finished check before it, if any.
pub fn check_view(check: &CheckRecord, current_fingerprint: &str, previous: Option<&CheckRecord>) -> CheckView {
    let stored = check.report_json.as_deref().and_then(StoredCheck::parse);
    let report = stored.as_ref().and_then(StoredCheck::report);
    let previous_stored = previous.and_then(|previous| previous.report_json.as_deref()).and_then(StoredCheck::parse);
    let changes = match (&report, &previous_stored) {
        (Some(report), Some(previous)) => question_changes(report, &previous.graphrt),
        _ => HashMap::new(),
    };
    let words_of =
        |test_id: &str| stored.as_ref().and_then(|stored| stored.words.iter().find(|words| words.test_id == test_id));
    let questions = report
        .as_ref()
        .map(|report| {
            report
                .tests
                .iter()
                .map(|result| question_result(result, words_of(&result.id), changes.get(&result.id).copied()))
                .collect()
        })
        .unwrap_or_default();
    let needed = needed_good(check.total, check.required_percent);
    CheckView {
        id: check.id.clone(),
        agent_version: check.agent_version,
        status: check.status,
        started_at: check.started_at.clone(),
        finished_at: check.finished_at.clone(),
        good: check.passed,
        total: check.total,
        required_percent: check.required_percent,
        needed,
        enough_good: check.status == CheckStatus::Finished && check.total > 0 && check.passed >= needed,
        tests_changed_since: check.tests_fingerprint != current_fingerprint,
        error_message: check.error_message.clone(),
        questions,
        previous: previous.map(|previous| PreviousCheck {
            check_id: previous.id.clone(),
            agent_version: previous.agent_version,
            good: previous.passed,
            total: previous.total,
        }),
    }
}

/// Per test id, how it moved since the `previous` report (graphrt's comparison).
pub fn question_changes(report: &EvalReport, previous: &Json) -> HashMap<String, QuestionChange> {
    let Ok(baseline) = Baseline::from_json("previous check", previous) else { return HashMap::new() };
    let comparison = BaselineComparison::compare(&Baseline::of(report, ""), &baseline, &Tolerance::default());
    comparison
        .tests
        .into_iter()
        .filter_map(|delta| {
            let change = match delta.change {
                Change::Improved => QuestionChange::NowGood,
                Change::Regressed => QuestionChange::NowNotGood,
                Change::New => QuestionChange::New,
                Change::Unchanged | Change::Missing => return None,
            };
            Some((delta.name, change))
        })
        .collect()
}

fn question_result(result: &TestResult, words: Option<&TestWords>, change: Option<QuestionChange>) -> QuestionResult {
    let answer = answer_text(result);
    let judge_words = result
        .assertions
        .iter()
        .find_map(|assertion| assertion.judge.as_ref().and_then(|judge| judge.reasoning.clone()))
        .filter(|text| !text.trim().is_empty());
    let good = result.status == TestStatus::Passed;
    let mut not_good_because = Vec::new();
    if !good {
        if result.status == TestStatus::Error {
            not_good_because.push(NotGoodReason::NoAnswer {
                message: result.run.error.clone().unwrap_or_else(|| "the agent stopped before answering".into()),
            });
        }
        for assertion in result.assertions.iter().filter(|assertion| !assertion.pass && assertion.gates()) {
            match assertion.kind.as_str() {
                "judge" => {
                    let text = assertion
                        .judge
                        .as_ref()
                        .and_then(|judge| judge.reasoning.clone())
                        .unwrap_or_else(|| assertion.reason.clone());
                    not_good_because.push(NotGoodReason::Judge { text });
                }
                "icontains-all" => not_good_because.push(NotGoodReason::MissingWords {
                    words: words.map(|words| words_matching(&words.must_include, &answer, false)).unwrap_or_default(),
                }),
                "not-icontains-any" => not_good_because.push(NotGoodReason::UnwantedWords {
                    words: words
                        .map(|words| words_matching(&words.must_not_include, &answer, true))
                        .unwrap_or_default(),
                }),
                _ => not_good_because.push(NotGoodReason::Judge { text: assertion.reason.clone() }),
            }
        }
    }
    QuestionResult {
        test_id: result.id.clone(),
        question: result.description.clone().unwrap_or_default(),
        good,
        answer,
        good_because: if good { judge_words } else { None },
        not_good_because,
        change,
    }
}

/// The answer as text: the streamed answer, else the run's output.
fn answer_text(result: &TestResult) -> String {
    if !result.run.answer.trim().is_empty() {
        return result.run.answer.trim().to_owned();
    }
    match &result.run.output {
        Json::Null => String::new(),
        Json::String(text) => text.trim().to_owned(),
        other => other.to_string(),
    }
}

/// The listed words that are (`present`) or are not in the answer, ignoring case.
fn words_matching(words: &[String], answer: &str, present: bool) -> Vec<String> {
    let lowered = answer.to_lowercase();
    words.iter().filter(|word| lowered.contains(&word.to_lowercase()) == present).cloned().collect()
}
