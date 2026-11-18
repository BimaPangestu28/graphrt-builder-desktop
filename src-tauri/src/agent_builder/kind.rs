//! Infers the agent kind from the description when the user picked none.
//!
//! Deliberately conservative: only clear phrases switch away from `Task`, since
//! a wrong "chatbot" or "team" shapes the whole draft.

use crate::storage::models::AgentKind;

const TEAM_PHRASES: &[&str] = &[
    "team of agents",
    "team of ai",
    "agent team",
    "multi-agent",
    "multiple agents",
    "several agents",
    "group of agents",
    "crew of agents",
    "agents that work together",
    "agents working together",
    "agents work together",
];

const CHATBOT_PHRASES: &[&str] = &[
    "chatbot",
    "chat bot",
    "chat with",
    "answer questions",
    "answers questions",
    "answer customer",
    "answers customer",
    "reply to customers",
    "replies to customers",
    "customer support bot",
    "talk to me",
    "talks to customers",
    "conversational",
];

const CHAIN_PHRASES: &[&str] = &[
    "chain of steps",
    "chain of agents",
    "chain of prompts",
    "prompt chain",
    "hand off",
    "hands off",
    "hand it off",
    "hands it off",
    "pass the result to",
    "passes the result to",
    "pass its result to",
    "passes its result to",
];

/// `Task` unless the description clearly asks for a team, chatbot or chain.
pub(super) fn infer_kind(description: &str) -> AgentKind {
    let lowered = description.to_lowercase();
    let mentions_any = |phrases: &[&str]| phrases.iter().any(|phrase| lowered.contains(phrase));
    if mentions_any(TEAM_PHRASES) {
        AgentKind::Team
    } else if mentions_any(CHATBOT_PHRASES) {
        AgentKind::Chatbot
    } else if mentions_any(CHAIN_PHRASES) {
        AgentKind::Chain
    } else {
        AgentKind::Task
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ordinary_jobs_are_tasks() {
        for description in [
            "Find cafes in Bandar Lampung on Google Maps, get their name and phone number, then send each one \
             a WhatsApp message offering our catering menu",
            "Summarize my inbox every morning",
            "Check our supply chain dashboard and email me the delays",
            "Our sales team of 5 needs a weekly report",
        ] {
            assert_eq!(infer_kind(description), AgentKind::Task, "{description}");
        }
    }

    #[test]
    fn clear_phrases_pick_other_kinds() {
        assert_eq!(infer_kind("A chatbot for my bakery's website"), AgentKind::Chatbot);
        assert_eq!(infer_kind("Answer questions about our opening hours"), AgentKind::Chatbot);
        assert_eq!(infer_kind("A team of agents: one researches, one writes"), AgentKind::Team);
        assert_eq!(infer_kind("Research a topic, then hand off to a writer step"), AgentKind::Chain);
    }

    #[test]
    fn team_wins_over_chatbot() {
        assert_eq!(infer_kind("Multiple agents that answer questions together"), AgentKind::Team);
    }
}
