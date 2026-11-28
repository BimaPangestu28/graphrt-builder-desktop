//! The agent's tests as a graphrt eval suite (the Promptfoo-shaped `tests` / `assert` /
//! `gate` file of `graphrt eval`), so graphrt's harness scores them and the same suite
//! can be exported for `graphrt eval` on a server or in CI.
//!
//! Each test becomes one case:
//! - a good answer written: the `good-answer` judge decides whether the reply says it;
//! - nothing written: the `answers-question` judge decides whether it answers at all;
//! - words that must (not) appear: `icontains-all` / `not-icontains-any`.

use std::path::Path;

use graphrt_eval::EvalSuite;
use serde_json::{json, Map, Value as Json};
use sha2::{Digest, Sha256};

use crate::error::{AppError, AppResult};
use crate::flow::FlowInput;
use crate::storage::quality::AgentTest;

/// The judge that compares the reply with the good answer the person wrote.
pub const GOOD_ANSWER_JUDGE: &str = "judges/good-answer.yaml";
/// The judge used when no good answer is written: does the reply answer the question.
pub const ANSWERS_QUESTION_JUDGE: &str = "judges/answers-question.yaml";
/// Path the suite names for the workflow under test (the target is built in memory).
const WORKFLOW_PATH: &str = "agent.yaml";

/// The start input a test's question is given to: the first text input, else the first input.
/// `None` when the agent has no inputs.
pub fn question_input(inputs: &[FlowInput]) -> Option<String> {
    let is_text = |input: &&FlowInput| matches!(input.input_type.as_str(), "text-input" | "paragraph" | "string");
    inputs.iter().find(is_text).or_else(|| inputs.first()).map(|input| input.name.clone())
}

/// Changes whenever a question, good answer or word list does, or tests are added,
/// removed or reordered: a check only counts for the tests it ran.
pub fn tests_fingerprint(tests: &[AgentTest]) -> String {
    let mut hasher = Sha256::new();
    for test in tests {
        let fields = json!([test.id, test.question, test.good_answer, test.must_include, test.must_not_include]);
        hasher.update(fields.to_string().as_bytes());
        hasher.update([0u8]);
    }
    hasher.finalize().iter().map(|byte| format!("{byte:02x}")).collect()
}

/// What the judges are told about hand-offs of an agent that never passes a chat to anyone.
pub const NO_HANDOFF_RULES: &str = "This assistant does not pass chats to anyone.";

/// The eval file of `tests` (JSON, which graphrt reads like YAML). `input_name` receives
/// each question; `required_percent` of the answers must be good. `handoff_rules` tells the
/// judges when the assistant passes the chat to the owner (a chatbot's rules, else
/// [`NO_HANDOFF_RULES`]), so a hand-off the rules ask for is a good answer.
pub fn suite_document(tests: &[AgentTest], input_name: &str, required_percent: i64, handoff_rules: &str) -> Json {
    let cases: Vec<Json> = tests.iter().map(|test| case_document(test, input_name, handoff_rules)).collect();
    let pass_rate = (required_percent.clamp(0, 100) as f64) / 100.0;
    json!({
        "description": "Tests written in Graphrt Desktop",
        "workflow": WORKFLOW_PATH,
        "tests": cases,
        "gate": { "pass_rate": pass_rate },
    })
}

fn case_document(test: &AgentTest, input_name: &str, handoff_rules: &str) -> Json {
    let mut vars = Map::new();
    vars.insert(input_name.to_owned(), Json::String(test.question.clone()));
    // `{{vars.x}}` alone becomes the value itself, so the question is never read as a template.
    // The other inputs are this app's own words (no `{{`), so rendering keeps them as they are.
    let inputs = json!({
        "question": format!("{{{{vars.{input_name}}}}}"),
        "language": super::language::reason_language(&test.question),
        "handoff_rules": handoff_rules,
    });
    let (workflow, metric) = if test.good_answer.is_empty() {
        (ANSWERS_QUESTION_JUDGE, "answers_question")
    } else {
        (GOOD_ANSWER_JUDGE, "good_answer")
    };
    let mut assertions = vec![json!({ "type": "judge", "workflow": workflow, "metric": metric, "inputs": inputs })];
    if !test.must_include.is_empty() {
        assertions.push(json!({ "type": "icontains-all", "value": test.must_include, "metric": "must_include" }));
    }
    if !test.must_not_include.is_empty() {
        assertions.push(json!({
            "type": "not-icontains-any",
            "value": test.must_not_include,
            "metric": "must_not_include",
        }));
    }
    let mut case = json!({
        "id": test.id,
        "description": test.question,
        "vars": vars,
        "assert": assertions,
    });
    if !test.good_answer.is_empty() {
        case["expected"] = Json::String(test.good_answer.clone());
    }
    case
}

/// [`suite_document`] parsed by graphrt (judge paths resolve against `base`).
///
/// # Errors
/// `Internal` when graphrt refuses the document (a bug in this module).
pub fn build_suite(
    tests: &[AgentTest],
    input_name: &str,
    required_percent: i64,
    handoff_rules: &str,
    base: &Path,
) -> AppResult<EvalSuite> {
    let document = suite_document(tests, input_name, required_percent, handoff_rules);
    EvalSuite::parse(&document.to_string(), base)
        .map_err(|error| AppError::Internal(format!("the tests could not be prepared: {error}")))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn test_case(id: &str, good_answer: &str) -> AgentTest {
        AgentTest {
            id: id.into(),
            agent_id: "a".into(),
            question: "When do you open? {{env.secret}}".into(),
            good_answer: good_answer.into(),
            must_include: Vec::new(),
            must_not_include: Vec::new(),
            suggested: false,
            created_at: String::new(),
            updated_at: String::new(),
        }
    }

    fn input(name: &str, input_type: &str) -> FlowInput {
        FlowInput {
            name: name.into(),
            label: name.into(),
            required: true,
            input_type: input_type.into(),
            options: Vec::new(),
            default_value: None,
            schema: None,
        }
    }

    #[test]
    fn the_question_goes_to_the_first_text_input() {
        assert_eq!(question_input(&[input("count", "number"), input("topic", "paragraph")]).as_deref(), Some("topic"));
        assert_eq!(question_input(&[input("count", "number")]).as_deref(), Some("count"));
        assert_eq!(question_input(&[]), None);
    }

    #[test]
    fn graphrt_reads_the_suite_with_one_case_per_test() {
        let mut with_words = test_case("t2", "");
        with_words.must_include = vec!["09.00".into()];
        with_words.must_not_include = vec!["closed".into()];
        let rules = "Pass the chat to the owner only when:\n- an order is ready to confirm";
        let suite =
            build_suite(&[test_case("t1", "From 9 to 5"), with_words], "message", 80, rules, Path::new("/x")).unwrap();
        assert_eq!(suite.cases.len(), 2);
        assert!((suite.gate.pass_rate - 0.8).abs() < 1e-9);
        let first = &suite.cases[0];
        assert_eq!(first.id, "t1");
        assert_eq!(first.vars["message"], "When do you open? {{env.secret}}");
        assert_eq!(first.expected, Some(json!("From 9 to 5")));
        assert_eq!(first.assertions[0].kind, "judge");
        assert_eq!(first.assertions[0].config["workflow"], GOOD_ANSWER_JUDGE);
        let inputs = &first.assertions[0].config["inputs"];
        assert_eq!(inputs["language"], "English", "the judge is told the language of the question");
        assert_eq!(inputs["handoff_rules"], rules);
        let second: Vec<&str> = suite.cases[1].assertions.iter().map(|spec| spec.kind.as_str()).collect();
        assert_eq!(second, ["judge", "icontains-all", "not-icontains-any"]);
        assert_eq!(suite.cases[1].assertions[0].config["workflow"], ANSWERS_QUESTION_JUDGE);
    }

    #[test]
    fn the_fingerprint_follows_the_tests() {
        let tests = vec![test_case("t1", "A"), test_case("t2", "B")];
        let same = tests_fingerprint(&tests);
        assert_eq!(same, tests_fingerprint(&tests.clone()));
        let mut changed = tests.clone();
        changed[1].good_answer = "C".into();
        assert_ne!(same, tests_fingerprint(&changed));
        assert_ne!(same, tests_fingerprint(&tests[..1]));
        let reordered = vec![tests[1].clone(), tests[0].clone()];
        assert_ne!(same, tests_fingerprint(&reordered));
    }
}
