//! "Create a skill": drafting one with a model, and checking what the person then edited.
//!
//! The runtime does the drafting (`graphrt_skill::draft_skill`): a description in plain
//! words, or an example conversation, goes to the person's own model as quoted material
//! and comes back as a draft. The person reads and edits it, and what they send back is
//! checked again from scratch ([`checked_draft`], through `SkillDraft::new`) before the
//! usual review and install. A draft has no special standing: the same safety check runs
//! on it, it may only ask for tools this computer has, and asking allows nothing.
//!
//! Without a model the person can write the draft themselves; it takes the same path.

use graphrt_core::text_model::TextModel;
use graphrt_skill::{DraftRequest, DraftSource, SkillDraft, Turn};

use super::models::{AuthoredSkillInput, SkillDraftSource, SkillDraftView};
use crate::crash_reports::scrub::Scrubber;
use crate::error::{AppError, AppResult};
use crate::plugins::display_name::humanize_plugin_name;

/// Longest name accepted, in characters.
pub(crate) const MAX_TITLE_CHARS: usize = 60;
/// Longest source text (description or conversation) accepted, in characters.
pub(crate) const MAX_SOURCE_CHARS: usize = 24_000;
/// A line of a pasted conversation starts a new turn when it begins with a short
/// speaker label before a colon ("Customer: ...").
const LONGEST_SPEAKER_LABEL_CHARS: usize = 24;
/// Who a line without a speaker label is attributed to.
const UNLABELLED_SPEAKER: &str = "user";
const MAX_NAME_CHARS: usize = 64;

/// A draft the person approved the wording of: checked by the runtime, with the name
/// people see.
#[derive(Debug, Clone)]
pub(crate) struct CheckedDraft {
    pub title: String,
    pub draft: SkillDraft,
}

/// Asks `model` to draft a skill from `source`. The draft may ask only for tools in
/// `available_tools`. Secret-looking text is removed from the source first.
///
/// # Errors
/// `InvalidInput` for an empty or too long source; `Model` when the model fails or its
/// answer is not a skill.
pub(crate) async fn draft_from_source(
    model: &dyn TextModel,
    source: &SkillDraftSource,
    available_tools: Vec<String>,
) -> AppResult<SkillDraftView> {
    let text = match source {
        SkillDraftSource::Description { text } | SkillDraftSource::Conversation { text } => text.trim(),
    };
    if text.is_empty() {
        return Err(invalid("Describe what the agent should do first"));
    }
    if text.chars().count() > MAX_SOURCE_CHARS {
        return Err(invalid(&format!("That is longer than {MAX_SOURCE_CHARS} characters; shorten it")));
    }
    let text = Scrubber::new(None).scrub(text);
    let draft_source = match source {
        SkillDraftSource::Description { .. } => DraftSource::Description(text),
        SkillDraftSource::Conversation { .. } => DraftSource::Conversation(conversation_turns(&text)),
    };
    let request = DraftRequest { source: draft_source, available_tools };
    let draft = graphrt_skill::draft_skill(model, &request).await.map_err(|error| match error {
        graphrt_skill::Error::Draft(message) => AppError::Model(message),
        other => AppError::Model(other.to_string()),
    })?;
    Ok(SkillDraftView {
        title: humanize_plugin_name(&draft.name),
        description: draft.description,
        instructions: draft.body,
        requested_tools: draft.requested_tools,
    })
}

/// The turns of a pasted conversation. A line that starts with a short label and a colon
/// ("Customer: hello") starts a turn of that speaker; other lines continue the turn before.
pub(crate) fn conversation_turns(text: &str) -> Vec<Turn> {
    let mut turns: Vec<Turn> = Vec::new();
    for line in text.lines().map(str::trim).filter(|line| !line.is_empty()) {
        let labelled = line.split_once(':').filter(|(label, said)| {
            let label = label.trim();
            !label.is_empty()
                && label.chars().count() <= LONGEST_SPEAKER_LABEL_CHARS
                // "https://..." is a link, not a speaker called "https".
                && !said.starts_with("//")
                && !said.trim().is_empty()
        });
        match (labelled, turns.last_mut()) {
            (Some((label, said)), _) => {
                turns.push(Turn { role: label.trim().to_owned(), text: said.trim().to_owned() })
            }
            (None, Some(previous)) => {
                previous.text.push('\n');
                previous.text.push_str(line);
            }
            (None, None) => turns.push(Turn { role: UNLABELLED_SPEAKER.to_owned(), text: line.to_owned() }),
        }
    }
    turns
}

/// Checks a draft as the person left it: a usable name, a line saying when to use it,
/// instructions, and everything the runtime checks in a skill file.
///
/// # Errors
/// `InvalidInput` naming what is missing or not allowed.
pub(crate) fn checked_draft(input: &AuthoredSkillInput) -> AppResult<CheckedDraft> {
    let title = single_line(&input.title);
    if title.is_empty() {
        return Err(invalid("Give the skill a name"));
    }
    if title.chars().count() > MAX_TITLE_CHARS {
        return Err(invalid(&format!("The name is longer than {MAX_TITLE_CHARS} characters")));
    }
    let name = skill_name(&title).ok_or_else(|| invalid("Use at least one letter (a to z) or digit in the name"))?;
    let description = single_line(&input.description);
    if description.is_empty() {
        return Err(invalid("Say when the agent should use this skill"));
    }
    if input.instructions.trim().is_empty() {
        return Err(invalid("Write what the agent should do"));
    }
    let draft = SkillDraft::new(&name, &description, input.instructions.trim(), &input.requested_tools)
        .map_err(|error| AppError::InvalidInput(error.to_string()))?;
    Ok(CheckedDraft { title, draft })
}

fn invalid(message: &str) -> AppError {
    AppError::InvalidInput(message.to_owned())
}

/// `text` on one line: line breaks and runs of white space become single spaces.
fn single_line(text: &str) -> String {
    text.split_whitespace().collect::<Vec<_>>().join(" ")
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
