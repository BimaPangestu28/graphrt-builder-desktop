//! Turning "Create a skill" into a `SKILL.md`.
//!
//! This is the whole of drafting for now: a form (name, when to use it, steps) becomes
//! the file the runtime reads. The result then goes through the same check and install
//! as any other skill. When the runtime can draft a skill from plain language or example
//! conversations, [`draft_skill`] is the one function to replace: everything after it
//! only sees a [`SkillDraft`].

use super::models::AuthoredSkillInput;
use crate::error::{AppError, AppResult};

/// Longest title accepted, in characters.
pub(crate) const MAX_TITLE_CHARS: usize = 60;
/// Longest "when to use it" text, in characters (it becomes the skill's description).
pub(crate) const MAX_WHEN_TO_USE_CHARS: usize = 600;
/// Most steps, and the longest one in characters.
pub(crate) const MAX_STEPS: usize = 30;
pub(crate) const MAX_STEP_CHARS: usize = 1_000;
const MAX_NAME_CHARS: usize = 64;

/// A drafted skill: its technical name and the text of its `SKILL.md`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct SkillDraft {
    pub name: String,
    pub title: String,
    pub skill_file: String,
    /// The instructions part of the file, for the review screen.
    pub instructions: String,
}

/// Drafts a skill from the form.
///
/// # Errors
/// `InvalidInput` when the title has no letter or digit to name the skill with, a field
/// is empty or too long, or there is no step.
pub(crate) fn draft_skill(input: &AuthoredSkillInput) -> AppResult<SkillDraft> {
    let title = single_line(&input.title);
    if title.is_empty() {
        return Err(invalid("Give the skill a name"));
    }
    if title.chars().count() > MAX_TITLE_CHARS {
        return Err(invalid(&format!("The name is longer than {MAX_TITLE_CHARS} characters")));
    }
    let name = skill_name(&title).ok_or_else(|| invalid("Use at least one letter (a to z) or digit in the name"))?;
    let when_to_use = single_line(&input.when_to_use);
    if when_to_use.is_empty() {
        return Err(invalid("Say when the agent should use this skill"));
    }
    if when_to_use.chars().count() > MAX_WHEN_TO_USE_CHARS {
        return Err(invalid(&format!("\"When to use it\" is longer than {MAX_WHEN_TO_USE_CHARS} characters")));
    }
    let steps: Vec<String> = input.steps.iter().map(|step| single_line(step)).filter(|step| !step.is_empty()).collect();
    if steps.is_empty() {
        return Err(invalid("Add at least one step"));
    }
    if steps.len() > MAX_STEPS {
        return Err(invalid(&format!("A skill can have at most {MAX_STEPS} steps")));
    }
    if steps.iter().any(|step| step.chars().count() > MAX_STEP_CHARS) {
        return Err(invalid(&format!("A step is longer than {MAX_STEP_CHARS} characters")));
    }
    let numbered: Vec<String> =
        steps.iter().enumerate().map(|(index, step)| format!("{}. {step}", index + 1)).collect();
    let instructions = format!("# {title}\n\n## When to use\n\n{when_to_use}\n\n## Steps\n\n{}\n", numbered.join("\n"));
    let skill_file = format!(
        "---\nname: {name}\ndescription: {}\nmetadata:\n  title: {}\n---\n\n{instructions}",
        yaml_string(&when_to_use),
        yaml_string(&title),
    );
    Ok(SkillDraft { name, title, skill_file, instructions })
}

fn invalid(message: &str) -> AppError {
    AppError::InvalidInput(message.to_owned())
}

/// `text` on one line: line breaks and runs of white space become single spaces.
fn single_line(text: &str) -> String {
    text.split_whitespace().collect::<Vec<_>>().join(" ")
}

/// A double-quoted YAML scalar (JSON string escaping is valid YAML).
fn yaml_string(text: &str) -> String {
    serde_json::Value::String(text.to_owned()).to_string()
}

/// The technical name for `title`: lowercase letters and digits, other characters as
/// single hyphens ("Refund policy (EU)" gives `refund-policy-eu`). `None` when nothing
/// is left to name it with.
pub(crate) fn skill_name(title: &str) -> Option<String> {
    let mut name = String::new();
    for character in title.chars() {
        if character.is_ascii_alphanumeric() {
            name.push(character.to_ascii_lowercase());
        } else if !name.is_empty() && !name.ends_with('-') {
            name.push('-');
        }
    }
    let mut name: String = name.chars().take(MAX_NAME_CHARS).collect();
    while name.ends_with('-') {
        name.pop();
    }
    graphrt_skill::is_valid_name(&name).then_some(name)
}
