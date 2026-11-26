//! Self learning: what an agent learned, what waits for the owner, and feedback on runs.
//!
//! Lessons, their rules and their storage are `graphrt_learn`'s. An agent reads only
//! approved lessons, and a run never writes one. This module is the owner's side:
//!
//! - [`LearningService::overview`] and the decisions (approve, reject, retire, edit,
//!   delete, apply to everyone, forget a person) for the "What this agent learned" screen;
//! - [`LearningService::record_feedback`]: thumbs up or down on a finished run. A comment
//!   becomes a proposal that waits for the owner.
//!
//! Rules this module keeps:
//! - **Nobody is verified here.** The desktop app has no sign-in, so feedback is always
//!   recorded as coming from an unverified author ([`AUTHOR_IS_VERIFIED`]). The runtime
//!   then treats it as derived: it can never approve itself, whatever the settings.
//! - **Secrets are hidden before a signal is recorded** ([`redact::hide_secrets`]): the
//!   comment and the run excerpt both.
//! - What the owner types themselves ("Add a note") is the owner's word and is added
//!   directly.

mod active;
pub mod models;
mod redact;
#[cfg(test)]
mod tests;

use std::path::Path;
use std::sync::Arc;

use graphrt_learn::{
    Decision, Forget, Learner, LearningPolicy, LessonFilter, LessonKind, LessonStore, NewLesson, Observation,
    ObservationKind,
};

pub(crate) use self::active::lessons_service;
use self::models::{AgentLearning, FeedbackOutcome, HistoryEntry, LessonDecision, LessonView, RunFeedback};
use crate::credentials::{CredentialStore, ModelProvider};
use crate::error::{AppError, AppResult};
use crate::storage::models::{Run, RunStatus};
use crate::storage::Database;

/// Folder of the lesson store inside the app data folder.
pub const LEARNING_DIR_NAME: &str = "learning";
/// Who acts when the person at this computer decides something.
const OWNER: &str = "owner";
/// Whether the app verified who wrote a piece of feedback. It never does: there is no
/// sign-in, and a customer on WhatsApp is not verified either. Keep `false` until the app
/// really checks identities; `true` would let feedback approve itself.
const AUTHOR_IS_VERIFIED: bool = false;
/// Longest comment accepted, in characters (a lesson holds at most 500).
pub(crate) const MAX_COMMENT_CHARS: usize = 500;
/// Most characters of a run's answer kept as the excerpt shown with a proposal.
const MAX_EXCERPT_CHARS: usize = 600;

/// The "What this agent learned" backend.
#[derive(Debug)]
pub struct LearningService {
    store: Arc<LessonStore>,
    learner: Learner,
    db: Arc<Database>,
    credentials: Arc<CredentialStore>,
}

impl LearningService {
    /// A service over the store in `<app data>/learning`. Nothing is read or created yet.
    pub fn new(app_data_dir: &Path, db: Arc<Database>, credentials: Arc<CredentialStore>) -> Self {
        let store = Arc::new(LessonStore::open(app_data_dir.join(LEARNING_DIR_NAME)));
        Self { learner: Learner::new(store.clone()), store, db, credentials }
    }

    /// Makes this service's store the one runs read lessons from (the app's service only).
    pub fn activate(&self) {
        active::publish(Some(self.store.clone()));
    }

    /// Every lesson of the agent, the automatic learning switch and the history.
    ///
    /// # Errors
    /// `NotFound` for an unknown agent; `Internal` when the store cannot be read.
    pub fn overview(&self, agent_id: &str) -> AppResult<AgentLearning> {
        self.db.get_agent(agent_id)?;
        let mut lessons = self.store.list(agent_id, &LessonFilter::default()).map_err(learning_error)?;
        lessons.sort_by_key(|lesson| std::cmp::Reverse(lesson.updated_at_ms));
        let policy = self.store.policy(agent_id).map_err(learning_error)?;
        // The log is written in order; several entries can share a millisecond, so the
        // order written is kept and only reversed.
        let mut audit = self.store.audit(agent_id).map_err(learning_error)?;
        audit.reverse();
        Ok(AgentLearning {
            agent_id: agent_id.to_owned(),
            history: audit.iter().map(|entry| HistoryEntry::of(entry, &lessons)).collect(),
            lessons: lessons.iter().map(LessonView::from).collect(),
            auto_learn: policy.auto_approve_user_feedback,
        })
    }

    /// Approves, rejects or retires a lesson.
    ///
    /// # Errors
    /// `NotFound` for an unknown lesson; `InvalidInput` when the lesson's state does not
    /// allow it or the agent already has as many lessons as allowed.
    pub fn decide(&self, agent_id: &str, lesson_id: &str, decision: LessonDecision) -> AppResult<LessonView> {
        let decision = match decision {
            LessonDecision::Approve => Decision::Approve,
            LessonDecision::Reject => Decision::Reject,
            LessonDecision::Retire => Decision::Retire,
        };
        let lesson = self.store.decide(agent_id, lesson_id, decision, OWNER).map_err(learning_error)?;
        Ok(LessonView::from(&lesson))
    }

    /// Replaces a lesson's text (checked like any lesson text).
    ///
    /// # Errors
    /// `NotFound`; `InvalidInput` for text that cannot be a lesson.
    pub fn edit(&self, agent_id: &str, lesson_id: &str, text: &str) -> AppResult<LessonView> {
        let lesson = self.store.edit(agent_id, lesson_id, text, OWNER).map_err(learning_error)?;
        Ok(LessonView::from(&lesson))
    }

    /// Deletes a lesson for good.
    ///
    /// # Errors
    /// `NotFound`.
    pub fn delete(&self, agent_id: &str, lesson_id: &str) -> AppResult<()> {
        self.store.delete(agent_id, lesson_id, OWNER).map_err(learning_error)
    }

    /// Makes one person's lesson apply to everyone the agent serves. Only the owner can
    /// widen a lesson; nothing a person teaches reaches other people by itself.
    ///
    /// # Errors
    /// `NotFound`; `InvalidInput` when it already applies to everyone.
    pub fn apply_to_everyone(&self, agent_id: &str, lesson_id: &str) -> AppResult<LessonView> {
        let lesson = self.store.promote(agent_id, lesson_id, OWNER).map_err(learning_error)?;
        Ok(LessonView::from(&lesson))
    }

    /// Forgets a person: every lesson about them and every lesson that came from them.
    /// Returns how many lessons were removed.
    ///
    /// # Errors
    /// `InvalidInput` for an empty name; `Internal` when the store cannot be written.
    pub fn forget_person(&self, agent_id: &str, user: &str) -> AppResult<usize> {
        self.store.forget(agent_id, &Forget::User(user.to_owned()), OWNER).map_err(learning_error)
    }

    /// Adds a note the owner wrote. It is the owner's word, so it applies at once.
    ///
    /// # Errors
    /// `NotFound` for an unknown agent; `InvalidInput` for text that cannot be a lesson.
    pub fn add_note(&self, agent_id: &str, text: &str) -> AppResult<LessonView> {
        self.db.get_agent(agent_id)?;
        let new_lesson =
            NewLesson { agent: agent_id.to_owned(), user: None, kind: LessonKind::Preference, text: text.to_owned() };
        let lesson = self.store.add(new_lesson, OWNER).map_err(learning_error)?;
        Ok(LessonView::from(&lesson))
    }

    /// Turns "learn automatically" on or off. Off is the default; even when on, anything
    /// risky, anything derived and anything about other people still waits for the owner.
    ///
    /// # Errors
    /// `NotFound` for an unknown agent.
    pub fn set_auto_learn(&self, agent_id: &str, enabled: bool) -> AppResult<bool> {
        self.db.get_agent(agent_id)?;
        let current = self.store.policy(agent_id).map_err(learning_error)?;
        let policy = LearningPolicy { auto_approve_user_feedback: enabled, ..current };
        self.store.set_policy(agent_id, policy, OWNER).map_err(learning_error)?;
        Ok(enabled)
    }

    /// Records thumbs up or down on a finished run. A comment becomes a proposal for the
    /// run's agent that waits for the owner; a rating without a comment proposes nothing.
    ///
    /// # Errors
    /// `NotFound` for an unknown run; `InvalidInput` for a run that has not finished or a
    /// comment that is too long.
    pub async fn record_feedback(&self, run_id: &str, feedback: &RunFeedback) -> AppResult<FeedbackOutcome> {
        let run = self.db.get_run(run_id)?;
        if matches!(run.status, RunStatus::Running | RunStatus::Paused) {
            return Err(AppError::InvalidInput("this run has not finished yet".into()));
        }
        let comment = feedback.comment.as_deref().map(str::trim).filter(|comment| !comment.is_empty());
        if comment.is_some_and(|comment| comment.chars().count() > MAX_COMMENT_CHARS) {
            return Err(AppError::InvalidInput(format!("the comment is longer than {MAX_COMMENT_CHARS} characters")));
        }
        let known_secrets = self.known_secrets();
        let observation = Observation {
            agent: run.agent_id.clone(),
            // A test run is the owner trying the agent: it is about nobody in particular.
            user: None,
            run_id: run.id.clone(),
            kind: ObservationKind::Feedback {
                value: Some(if feedback.helpful { 1.0 } else { -1.0 }),
                comment: comment.map(|comment| redact::hide_secrets(comment, &known_secrets)),
                author: None,
                authenticated: AUTHOR_IS_VERIFIED,
            },
            excerpt: run_excerpt(&run).map(|excerpt| redact::hide_secrets(&excerpt, &known_secrets)),
            at_ms: 0,
        };
        let recorded = self.learner.observe(observation).map_err(learning_error)?;
        if !recorded {
            return Ok(FeedbackOutcome {
                proposed: Vec::new(),
                not_recorded: Some("too much feedback is waiting to be looked at".into()),
            });
        }
        // Without a model this only turns comments into proposals: cheap, and off the run's path.
        let report = self.learner.distill(&run.agent_id, None).await.map_err(learning_error)?;
        Ok(FeedbackOutcome {
            proposed: report.lessons.iter().map(LessonView::from).collect(),
            not_recorded: report.skipped.first().cloned(),
        })
    }

    /// Every secret value the app holds, to hide wherever it appears in a signal. A
    /// keychain that cannot be read is logged; the pattern check still runs.
    fn known_secrets(&self) -> Vec<String> {
        let mut values = Vec::new();
        match crate::workflow_secrets::list_all_workflow_secrets(&self.db, &self.credentials, &crate::mcp::current()) {
            Ok(secrets) => {
                for secret in secrets {
                    match self.credentials.read_workflow_secret(&secret.name) {
                        Ok(Some(value)) => values.push(value),
                        Ok(None) => {}
                        Err(error) => log::warn!("could not read a secret to hide it in feedback: {error}"),
                    }
                }
            }
            Err(error) => log::warn!("could not list the secrets to hide in feedback: {error}"),
        }
        for provider in ModelProvider::all() {
            if let Ok(Some(key)) = self.credentials.read_api_key(provider) {
                values.push(key);
            }
        }
        values
    }
}

/// What the run answered (or why it failed), as the excerpt shown with a proposal.
fn run_excerpt(run: &Run) -> Option<String> {
    let text = match (&run.outputs, &run.error_message) {
        (Some(serde_json::Value::Object(outputs)), _) => outputs
            .values()
            .map(|value| match value {
                serde_json::Value::String(text) => text.clone(),
                other => other.to_string(),
            })
            .collect::<Vec<_>>()
            .join(" · "),
        (Some(other), _) => other.to_string(),
        (None, Some(error)) => error.clone(),
        (None, None) => return None,
    };
    let text: String = text.chars().take(MAX_EXCERPT_CHARS).collect();
    Some(text).filter(|text| !text.trim().is_empty())
}

/// A `graphrt_learn` error for the UI.
fn learning_error(error: graphrt_learn::Error) -> AppError {
    use graphrt_learn::Error;
    match error {
        Error::NotFound { .. } => AppError::NotFound("this note".into()),
        Error::Io { .. } | Error::Damaged(_) => {
            log::error!("lesson store: {error}");
            AppError::Internal("what this agent learned could not be read or saved".into())
        }
        other => AppError::InvalidInput(other.to_string()),
    }
}
