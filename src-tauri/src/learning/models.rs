//! What the "What this agent learned" screen reads and sends (camelCase on the wire).
//!
//! Views over `graphrt_learn`'s lessons. Enum values keep the runtime's snake_case names
//! and risk reasons keep their stable `code`, so the UI can word everything itself in the
//! person's language.

use graphrt_learn::{AuditEntry, Lesson, LessonKind, LessonStatus, Risk, Signal, Trust};
use serde::{Deserialize, Serialize};

/// Why a lesson is marked high risk.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RiskReasonView {
    /// Stable code the UI translates, e.g. `sending`.
    pub code: String,
    /// The runtime's English sentence, shown for codes the UI does not know.
    pub message: String,
}

/// One thing the agent learned, or was proposed to learn.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LessonView {
    pub id: String,
    pub text: String,
    pub kind: LessonKind,
    /// `proposed` waits for the owner; only `approved` reaches a run.
    pub status: LessonStatus,
    /// `owner`, `user` (the verified author's own words) or `derived` (taken from what a
    /// run read or produced, or from feedback nobody verified).
    pub trust: Trust,
    pub risk: Risk,
    pub risk_reasons: Vec<RiskReasonView>,
    /// The one person it applies to; `None` applies to everyone the agent serves.
    pub user: Option<String>,
    /// Where it came from: `manual`, `feedback`, `run_outcome` or `reflection`.
    pub signal: Signal,
    pub run_id: Option<String>,
    pub author: Option<String>,
    /// A short excerpt of the run it came from (secrets already hidden).
    pub evidence: Option<String>,
    /// RFC 3339.
    pub created_at: Option<String>,
    pub updated_at: Option<String>,
    /// For a proposal: when it lapses without a decision.
    pub expires_at: Option<String>,
    pub decided_by: Option<String>,
}

impl From<&Lesson> for LessonView {
    fn from(lesson: &Lesson) -> Self {
        Self {
            id: lesson.id.clone(),
            text: lesson.text.clone(),
            kind: lesson.kind,
            status: lesson.status,
            trust: lesson.trust,
            risk: lesson.risk,
            risk_reasons: lesson
                .risk_reasons
                .iter()
                .map(|reason| RiskReasonView { code: reason.code.clone(), message: reason.message.clone() })
                .collect(),
            user: lesson.user.clone(),
            signal: lesson.origin.signal,
            run_id: lesson.origin.run_id.clone(),
            author: lesson.origin.author.clone(),
            evidence: lesson.origin.evidence.clone(),
            created_at: rfc3339(lesson.created_at_ms),
            updated_at: rfc3339(lesson.updated_at_ms),
            expires_at: lesson.expires_at_ms.and_then(rfc3339),
            decided_by: lesson.decided_by.clone(),
        }
    }
}

/// One line of the history: who did what to which lesson.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HistoryEntry {
    pub at: Option<String>,
    /// `owner` for what was done in this app, `system` for what happened by itself.
    pub actor: String,
    /// `add`, `propose`, `approve`, `auto_approve`, `reject`, `retire`, `edit`, `promote`,
    /// `delete`, `forget`, `expire` or `policy`.
    pub action: String,
    pub lesson_id: Option<String>,
    /// The lesson's text now, when it still exists.
    pub lesson_text: Option<String>,
}

impl HistoryEntry {
    pub(super) fn of(entry: &AuditEntry, lessons: &[Lesson]) -> Self {
        let lesson_text = entry
            .lesson_id
            .as_ref()
            .and_then(|id| lessons.iter().find(|lesson| &lesson.id == id))
            .map(|lesson| lesson.text.clone());
        Self {
            at: rfc3339(entry.at_ms),
            actor: entry.actor.clone(),
            action: entry.action.clone(),
            lesson_id: entry.lesson_id.clone(),
            lesson_text,
        }
    }
}

/// Everything the screen shows for one agent.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentLearning {
    pub agent_id: String,
    /// Every lesson, newest change first (proposals, approved, rejected and retired).
    pub lessons: Vec<LessonView>,
    /// "Learn automatically": low-risk feedback of a verified person may apply to that
    /// person without the owner. Off unless the owner turned it on.
    pub auto_learn: bool,
    /// Enough approved notes for everyone describe how to do the work that they can be
    /// written up as one skill.
    pub can_become_skill: bool,
    /// Newest first.
    pub history: Vec<HistoryEntry>,
}

/// What the owner decides about a lesson.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum LessonDecision {
    Approve,
    Reject,
    /// Stop using an approved lesson without deleting it.
    Retire,
}

/// Thumbs up or down on a finished run, with an optional comment.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RunFeedback {
    pub helpful: bool,
    #[serde(default)]
    pub comment: Option<String>,
}

/// What happened with a piece of feedback.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FeedbackOutcome {
    /// Lessons now waiting for the owner because of this feedback.
    pub proposed: Vec<LessonView>,
    /// The comment is saved but cannot be shown as a note yet (too many notes are
    /// waiting); it becomes one once the owner has decided on some of them.
    pub kept_for_later: bool,
    /// Why a comment did not become a proposal and is not kept, when that happened.
    pub not_recorded: Option<String>,
}

/// What asking the model for suggestions from recent runs gave.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RunSuggestions {
    /// How many runs the model read; `0` when there was no run it had not read yet.
    pub runs_read: usize,
    /// The suggestions now waiting for the owner.
    pub proposed: Vec<LessonView>,
}

fn rfc3339(milliseconds: u64) -> Option<String> {
    let milliseconds = i64::try_from(milliseconds).ok().filter(|milliseconds| *milliseconds > 0)?;
    chrono::DateTime::<chrono::Utc>::from_timestamp_millis(milliseconds).map(|time| time.to_rfc3339())
}
