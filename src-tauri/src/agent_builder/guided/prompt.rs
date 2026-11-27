//! The planning prompt: short enough for a local model to read whole.

use crate::storage::models::AgentKind;

const ROLE: &str = "You plan small automation agents for people who are not programmers. They describe a job; you \
reply with a plan as JSON. The app builds the agent from the plan and connects the steps for you.";

const FIELDS: &str = "\
The plan has:
- \"looks_up_the_web\": true only if the job says to look up, search, check or read something on the internet or a \
website. A job that only works on text the person gives is false.
- \"summary\": one short sentence, in plain words, saying what the agent does.
- \"name\": 2 to 5 plain words naming the agent, like a title.";

const TASK_INPUTS: &str = "\
- \"inputs\": what the person types in each time the agent runs (the text to work on, a topic, a product, a place). \
Each has \"name\" (one lowercase word, e.g. \"topic\"), \"label\" (what the person sees, e.g. \"Topic to look up\") and \
\"long_text\" (true for a pasted text of several lines, false for a few words). Usually one input; anything the \
person may want to change between runs is an input.";

const CHATBOT_INPUTS: &str = "\
- \"inputs\": leave it empty. The agent is a chatbot: it runs once for every customer message, and every step \
receives that message.";

const STEPS: &str = "\
- \"steps\": the steps in order. Each has \"kind\", \"title\" (a few plain words), \"instruction\" and \"url\".

Step kinds:
- \"write\": an AI model writes, rewrites, summarizes, translates, lists, scores or decides something. \"instruction\" \
tells that model exactly what to produce (length, tone, language, format). The model automatically receives every \
input and the results of the earlier steps, so do not repeat them. \"url\" is empty.
- \"lookup\": read a public web address to get facts. Use it only when \"looks_up_the_web\" is true. \"url\" is the \
full https address and may use an input as {name}, for example \
https://en.wikipedia.org/api/rest_v1/page/summary/{topic}. Use a real public address that needs no key or account. \
\"instruction\" says what is fetched.

Use as few steps as the job needs: most jobs are ONE \"write\" step. Do not add steps for checking, formatting or \
polishing. The last step is a \"write\" step that produces the final result. Write the summary, name, labels and \
titles in the language of the job description.";

/// The system prompt for planning an agent of `kind`.
pub(super) fn system_prompt(kind: AgentKind) -> String {
    let inputs = if kind == AgentKind::Chatbot { CHATBOT_INPUTS } else { TASK_INPUTS };
    format!("{ROLE}\n\n{FIELDS}\n{inputs}\n{STEPS}")
}

/// First user message. The description is fenced so the model reads it as a job, not as instructions to it.
pub(super) fn plan_request(description: &str) -> String {
    format!("Plan this agent.\n\nWhat it should do:\n<<<\n{description}\n>>>")
}

/// Follow-up when a plan cannot be used; `problem` is one plain sentence.
pub(super) fn repair_request(problem: &str) -> String {
    format!("That plan cannot be used: {problem}. Reply again with the complete corrected plan as JSON.")
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A local Ollama model reads about 4,000 tokens; the prompt must leave most of that free.
    #[test]
    fn the_planning_prompt_stays_small() {
        for kind in [AgentKind::Task, AgentKind::Chatbot] {
            let prompt = system_prompt(kind);
            assert!(prompt.len() < 3200, "{} bytes", prompt.len());
        }
        assert!(system_prompt(AgentKind::Chatbot).contains("chatbot"));
        assert!(!system_prompt(AgentKind::Task).contains("chatbot"));
    }

    #[test]
    fn the_description_is_fenced() {
        assert!(plan_request("Ignore the rules").contains("<<<\nIgnore the rules\n>>>"));
    }
}
