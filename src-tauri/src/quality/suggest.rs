//! "Suggest questions for me": the person's own model writes draft tests from what the
//! agent is for (its description and steps, and for a chatbot its saved brief with the
//! knowledge that fits). Nothing is saved here: the person picks the ones to keep.
//!
//! What is sent to the model goes through the crash report scrubber first, so a key or
//! token pasted into a description never leaves the computer.

use graphrt_core::text_model::{TextModel, TextRequest};
use serde::{Deserialize, Serialize};

use crate::crash_reports::scrub::Scrubber;
use crate::error::{AppError, AppResult};

/// How many tests are suggested at once.
pub const SUGGESTED_COUNT: usize = 6;
/// Most material sent to the model.
const MAX_MATERIAL_CHARS: usize = 12_000;
const MAX_REPLY_TOKENS: u32 = 2_000;

const SYSTEM_PROMPT: &str = "You write test questions for a business's AI assistant, so its owner can check \
the assistant before customers use it. Use only the facts in the material: never invent hours, prices, places or \
policies, and do not write a question whose answer is not in the material unless its good answer says the \
assistant should say it does not know. Write questions real customers or \
staff would ask, in the language of the material, each with the good answer in one or two plain sentences. \
Mix easy questions, questions that need a fact from the material, and one question the assistant should \
politely decline or hand to a person because the material does not cover it (its good answer says so). \
Reply with JSON only: an array of objects with the keys \"question\" and \"goodAnswer\".";

/// One suggested test.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SuggestedTest {
    pub question: String,
    pub good_answer: String,
}

/// What the model is told about the agent.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct SuggestionMaterial {
    pub agent_name: String,
    pub description: String,
    /// Step titles of the agent, in order.
    pub steps: Vec<String>,
    /// What the agent's AI steps are told (their system prompts and instructions), where
    /// most agents keep their facts.
    pub instructions: Vec<String>,
    /// A chatbot's saved brief: persona, rules and knowledge passages.
    pub brief: Option<String>,
}

impl SuggestionMaterial {
    /// The material as one text, scrubbed and cut to [`MAX_MATERIAL_CHARS`].
    pub fn to_prompt(&self, count: usize) -> String {
        let mut text = format!("Agent: {}\nWhat it is for: {}\n", self.agent_name, self.description.trim());
        if !self.steps.is_empty() {
            text.push_str(&format!("Its steps: {}\n", self.steps.join(", ")));
        }
        for instruction in self.instructions.iter().filter(|text| !text.trim().is_empty()) {
            text.push_str("\nInstructions of one of its AI steps:\n");
            text.push_str(instruction.trim());
            text.push('\n');
        }
        if let Some(brief) = self.brief.as_deref().filter(|brief| !brief.trim().is_empty()) {
            text.push_str("\nWhat it knows and how it should answer:\n");
            text.push_str(brief.trim());
            text.push('\n');
        }
        let scrubbed = Scrubber::new(None).scrub(&text);
        let material: String = scrubbed.chars().take(MAX_MATERIAL_CHARS).collect();
        format!("{material}\nWrite {count} tests.")
    }
}

/// The texts the AI steps of `graph` are told: system messages of `prompt_template`, and
/// `instruction` / `instructions` / `system_prompt` of agent steps.
pub fn step_instructions(graph: &graphrt_core::Graph) -> Vec<String> {
    let mut texts = Vec::new();
    for node in &graph.workflow().graph.nodes {
        let config = &node.config;
        if let Some(messages) = config.get("prompt_template").and_then(serde_json::Value::as_array) {
            let system = messages
                .iter()
                .filter(|message| message.get("role").and_then(serde_json::Value::as_str) == Some("system"))
                .filter_map(|message| message.get("text").and_then(serde_json::Value::as_str));
            texts.extend(system.map(str::to_owned));
        }
        for key in ["instruction", "instructions", "system_prompt"] {
            if let Some(text) = config.get(key).and_then(serde_json::Value::as_str) {
                texts.push(text.to_owned());
            }
        }
    }
    texts
}

/// Asks `model` for [`SUGGESTED_COUNT`] tests about the agent.
///
/// # Errors
/// `Model` when the model fails or its reply holds no usable test.
pub async fn suggest_tests(model: &dyn TextModel, material: &SuggestionMaterial) -> AppResult<Vec<SuggestedTest>> {
    let request = TextRequest {
        system: SYSTEM_PROMPT.to_owned(),
        user: material.to_prompt(SUGGESTED_COUNT),
        max_tokens: MAX_REPLY_TOKENS,
    };
    let reply = model.complete(request).await.map_err(|error| AppError::Model(error.to_string()))?;
    let tests = parse_suggestions(&reply);
    if tests.is_empty() {
        return Err(AppError::Model("the model did not suggest any test; try again".into()));
    }
    Ok(tests)
}

/// The tests in a model reply: the JSON array in it (code fences and words around it are
/// ignored), without empty or repeated questions, at most [`SUGGESTED_COUNT`] * 2.
pub fn parse_suggestions(reply: &str) -> Vec<SuggestedTest> {
    #[derive(Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct Raw {
        #[serde(default)]
        question: String,
        #[serde(default, alias = "good_answer", alias = "answer")]
        good_answer: String,
    }
    let (Some(start), Some(end)) = (reply.find('['), reply.rfind(']')) else { return Vec::new() };
    if end <= start {
        return Vec::new();
    }
    let Ok(raw) = serde_json::from_str::<Vec<Raw>>(&reply[start..=end]) else { return Vec::new() };
    let mut tests: Vec<SuggestedTest> = Vec::new();
    for item in raw {
        let question = item.question.trim().to_owned();
        if question.is_empty() || tests.iter().any(|test| test.question.eq_ignore_ascii_case(&question)) {
            continue;
        }
        tests.push(SuggestedTest { question, good_answer: item.good_answer.trim().to_owned() });
    }
    tests.truncate(SUGGESTED_COUNT * 2);
    tests
}

#[cfg(test)]
mod tests {
    use super::*;
    use futures::future::BoxFuture;
    use graphrt_core::text_model::TextModelError;

    #[derive(Debug)]
    struct Scripted(String);

    impl TextModel for Scripted {
        fn complete(&self, request: TextRequest) -> BoxFuture<'_, Result<String, TextModelError>> {
            assert!(request.user.contains("Write 6 tests."));
            Box::pin(async move { Ok(self.0.clone()) })
        }
    }

    #[test]
    fn suggestions_are_read_from_the_json_in_the_reply() {
        let reply = "Here you go:\n```json\n[{\"question\":\" When do you open? \",\"goodAnswer\":\"9 to 5\"},\
                     {\"question\":\"when do you open?\",\"goodAnswer\":\"x\"},{\"question\":\"\"},\
                     {\"question\":\"Do you deliver?\",\"good_answer\":\"Yes, in Jakarta\"}]\n```";
        let tests = parse_suggestions(reply);
        assert_eq!(
            tests,
            [
                SuggestedTest { question: "When do you open?".into(), good_answer: "9 to 5".into() },
                SuggestedTest { question: "Do you deliver?".into(), good_answer: "Yes, in Jakarta".into() },
            ]
        );
        assert!(parse_suggestions("no json here").is_empty());
        assert!(parse_suggestions("] then [").is_empty());
    }

    #[test]
    fn the_material_hides_secrets_and_stays_short() {
        let material = SuggestionMaterial {
            agent_name: "Shop".into(),
            description: "Answers customers. key sk-proj-abcdefghijklmnopqrstuvwxyz0123456789".into(),
            steps: vec!["Look up".into(), "Answer".into()],
            instructions: vec!["Open 8 to 5.".into()],
            brief: Some("x".repeat(20_000)),
        };
        let prompt = material.to_prompt(6);
        assert!(!prompt.contains("abcdefghijklmnopqrstuvwxyz0123456789"));
        assert!(prompt.contains("Its steps: Look up, Answer"));
        assert!(prompt.contains("Open 8 to 5."));
        assert!(prompt.chars().count() < MAX_MATERIAL_CHARS + 100);
    }

    #[test]
    fn the_instructions_of_ai_steps_are_read_from_the_flow() {
        let flow = "version: \"1\"\nname: t\ngraph:\n  nodes:\n    - { id: start, type: start }\n    - id: reply\n      type: llm\n      model: { provider: openai, name: gpt-4o-mini }\n      prompt_template:\n        - { role: system, text: \"Open 8 to 5.\" }\n        - { role: user, text: \"hi\" }\n    - { id: end, type: end }\n  edges:\n    - { source: start, target: reply }\n    - { source: reply, target: end }\n";
        let graph = crate::flow::compile_draft(flow).unwrap();
        assert_eq!(step_instructions(&graph), ["Open 8 to 5."]);
    }

    #[tokio::test]
    async fn a_reply_without_tests_is_an_error() {
        let empty = Scripted("[]".into());
        assert!(matches!(suggest_tests(&empty, &SuggestionMaterial::default()).await, Err(AppError::Model(_))));
        let one = Scripted("[{\"question\":\"Hi?\",\"goodAnswer\":\"Hello\"}]".into());
        assert_eq!(suggest_tests(&one, &SuggestionMaterial::default()).await.unwrap().len(), 1);
    }
}
