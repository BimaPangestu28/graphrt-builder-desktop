//! The texts a saved chatbot setup gives the bot's model steps on every reply.
//!
//! They reach the workflow as `sys` values (`sys.chatbot_brief`,
//! `sys.chatbot_handoff_rules`), never spliced into templates, so whatever the
//! owner types (or a knowledge passage contains) is never read as a
//! `{{#...#}}` reference.

use super::{ChatbotSettings, HandoffRules};

/// One passage handed to the bot when its flow has no retrieval step.
#[derive(Debug, Clone, PartialEq)]
pub struct BriefPassage {
    pub source_name: String,
    pub text: String,
}

/// Longest passage text kept in the brief, in characters.
const MAX_PASSAGE_CHARS: usize = 1200;

/// Persona, hand-off rules and (optional) knowledge passages for `llm` / `agent` steps.
pub fn chatbot_brief(settings: &ChatbotSettings, passages: Option<&[BriefPassage]>) -> String {
    let persona = &settings.persona;
    let mut sections = Vec::new();
    if !persona.display_name.is_empty() {
        sections.push(format!("You are {}, answering customers of this business in a chat.", persona.display_name));
    }
    if !persona.tone.is_empty() {
        sections.push(format!("Tone: {}.", persona.tone.trim_end_matches('.')));
    }
    if !persona.instructions.is_empty() {
        sections.push(format!("What to do:\n{}", persona.instructions));
    }
    sections.push(handoff_rules_text(&settings.handoff_rules));
    if let Some(passages) = passages {
        sections.push(knowledge_text(passages));
    }
    sections.join("\n\n")
}

/// The hand-off rules, also given to `question-classifier` steps.
pub fn handoff_rules_text(rules: &HandoffRules) -> String {
    let entries = rules.entries();
    let enabled: Vec<String> = entries
        .iter()
        .filter(|(is_enabled, _, _)| *is_enabled)
        .map(|(_, reason, words)| format!("- {words} (hand-off reason: {reason})"))
        .collect();
    let disabled: Vec<String> =
        entries.iter().filter(|(is_enabled, _, _)| !*is_enabled).map(|(_, _, words)| format!("- {words}")).collect();
    let mut text = if enabled.is_empty() {
        "Never pass the chat to the owner; always answer yourself.".to_owned()
    } else {
        format!("Pass the chat to the owner only when:\n{}", enabled.join("\n"))
    };
    if !disabled.is_empty() && !enabled.is_empty() {
        text.push_str(&format!(
            "\nDo not pass the chat to the owner just because:\n{}\nIn those cases keep answering yourself and do not say that the owner will reply.",
            disabled.join("\n")
        ));
    }
    text
}

fn knowledge_text(passages: &[BriefPassage]) -> String {
    if passages.is_empty() {
        return "Facts from the owner's knowledge: none match this message. Do not make up facts, prices or promises."
            .to_owned();
    }
    let listed: Vec<String> = passages
        .iter()
        .map(|passage| {
            let text: String = passage.text.chars().take(MAX_PASSAGE_CHARS).collect();
            format!("[{}]\n{}", passage.source_name, text.trim())
        })
        .collect();
    format!(
        "Facts from the owner's knowledge (answer only from these; say so when the answer is not there):\n\n{}",
        listed.join("\n\n")
    )
}
