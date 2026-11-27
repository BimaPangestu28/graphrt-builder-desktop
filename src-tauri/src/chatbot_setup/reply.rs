//! What one bot reply runs: the agent's flow with the saved setup applied,
//! the `sys` values it reads, and the hand-off rules the host enforces.

use super::brief::{chatbot_brief, handoff_rules_text, BriefPassage};
use super::overlay::{overlay_flow, BRIEF_SYS_NAME, HANDOFF_RULES_SYS_NAME, NO_KNOWLEDGE_SYS_NAME};
use super::{load_saved_settings, ChatbotSettings, HandoffRules};
use crate::conversations::bot::RetrievedSource;
use crate::credentials::CredentialStore;
use crate::error::AppResult;
use crate::knowledge::records::{self, StoredKnowledgeBase};
use crate::knowledge::retrieval::{knowledge_service_for_runs, passage_pages, source_label};
use crate::storage::models::Agent;
use crate::storage::Database;

/// Most source names shown under one reply.
pub const MAX_CITATIONS: usize = 4;

/// The workflow and extra inputs of one bot reply.
#[derive(Debug, Clone, PartialEq)]
pub struct PreparedReply {
    /// The flow to run: the stored one, or its overlay (JSON) when the setup is saved.
    pub flow_text: String,
    /// Extra `sys.*` values for the run.
    pub sys_values: Vec<(String, String)>,
    /// Rules to enforce on the reply's hand-off, `None` when the setup was never saved.
    pub handoff_rules: Option<HandoffRules>,
    /// Passages the host looked up and put in the brief (flows without a retrieval step).
    pub host_sources: Vec<RetrievedSource>,
    /// Attached knowledge bases with "Always show the source in answers" on.
    pub cited_knowledge_base_ids: Vec<String>,
}

impl PreparedReply {
    /// Sources to show under the reply, e.g. `menu.pdf · p3, p12`: the files of
    /// the passages the bot was given (by the host or by the flow's retrieval
    /// steps) from knowledge bases that show their sources, best file first,
    /// with the pages of all its passages.
    pub fn citations(&self, retrieved_sources: &[RetrievedSource]) -> Vec<String> {
        let mut files: Vec<(&str, Vec<u32>)> = Vec::new();
        for source in self.host_sources.iter().chain(retrieved_sources) {
            if !self.cited_knowledge_base_ids.contains(&source.knowledge_base_id) {
                continue;
            }
            if let Some((_, pages)) = files.iter_mut().find(|(name, _)| *name == source.source_name) {
                pages.extend(&source.pages);
            } else if files.len() < MAX_CITATIONS {
                files.push((&source.source_name, source.pages.clone()));
            }
        }
        files
            .into_iter()
            .map(|(name, mut pages)| {
                pages.sort_unstable();
                pages.dedup();
                source_label(name, &pages)
            })
            .collect()
    }
}

/// Prepares one reply of `agent` to `message_text`.
///
/// # Errors
/// `Workflow` when the flow cannot be overlaid; storage errors. A failed
/// knowledge lookup is logged and the bot answers without passages.
pub async fn prepare_reply(
    db: &Database,
    credentials: &CredentialStore,
    agent: &Agent,
    message_text: &str,
) -> AppResult<PreparedReply> {
    let Some(settings) = load_saved_settings(db, &agent.id)? else {
        return Ok(PreparedReply {
            flow_text: agent.flow_yaml.clone(),
            sys_values: Vec::new(),
            handoff_rules: None,
            host_sources: Vec::new(),
            cited_knowledge_base_ids: Vec::new(),
        });
    };
    let knowledge_bases = attached_knowledge_bases(db, &settings)?;
    let knowledge_base_ids: Vec<String> = knowledge_bases.iter().map(|base| base.id.clone()).collect();
    let overlaid = overlay_flow(&agent.flow_yaml, &knowledge_base_ids)?;
    let passages = if overlaid.has_retrieval_step || knowledge_bases.is_empty() {
        None
    } else {
        Some(lookup_passages(db, credentials, &knowledge_bases, message_text).await)
    };
    let host_sources = passages
        .iter()
        .flatten()
        .map(|(knowledge_base_id, passage)| RetrievedSource {
            knowledge_base_id: knowledge_base_id.clone(),
            source_name: passage.source_name.clone(),
            pages: passage.pages.clone(),
        })
        .collect();
    let passages: Option<Vec<BriefPassage>> =
        passages.map(|found| found.into_iter().map(|(_, passage)| passage).collect());
    let sys_values = vec![
        (BRIEF_SYS_NAME.to_owned(), chatbot_brief(&settings, passages.as_deref())),
        (HANDOFF_RULES_SYS_NAME.to_owned(), handoff_rules_text(&settings.handoff_rules)),
        (NO_KNOWLEDGE_SYS_NAME.to_owned(), String::new()),
    ];
    let cited_knowledge_base_ids =
        knowledge_bases.iter().filter(|base| base.settings.show_sources).map(|base| base.id.clone()).collect();
    Ok(PreparedReply {
        flow_text: overlaid.flow_text,
        sys_values,
        handoff_rules: Some(settings.handoff_rules),
        host_sources,
        cited_knowledge_base_ids,
    })
}

/// Attached knowledge bases that still exist (a deleted one is skipped, not an error), in attach order.
fn attached_knowledge_bases(db: &Database, settings: &ChatbotSettings) -> AppResult<Vec<StoredKnowledgeBase>> {
    let knowledge_bases = records::list_knowledge_bases(db)?;
    Ok(settings
        .knowledge_base_ids
        .iter()
        .filter_map(|attached| knowledge_bases.iter().find(|base| &base.id == attached).cloned())
        .collect())
}

/// Passages to look up: the largest "Passages per answer" among the attached knowledge bases.
fn passage_count(knowledge_bases: &[StoredKnowledgeBase]) -> usize {
    let most = knowledge_bases.iter().map(|base| base.settings.passages_per_answer).max().unwrap_or(1);
    usize::try_from(most.max(1)).unwrap_or(1)
}

/// The best passages for `message_text`, each with its knowledge base id.
async fn lookup_passages(
    db: &Database,
    credentials: &CredentialStore,
    knowledge_bases: &[StoredKnowledgeBase],
    message_text: &str,
) -> Vec<(String, BriefPassage)> {
    let service = match knowledge_service_for_runs(db, credentials) {
        Ok(service) => service,
        Err(error) => {
            log::warn!("the chatbot could not open its knowledge: {error}");
            return Vec::new();
        }
    };
    let knowledge_base_ids = knowledge_bases.iter().map(|base| base.id.clone()).collect();
    let request =
        graphrt_rag::RetrievalRequest::new(message_text, knowledge_base_ids).top_k(passage_count(knowledge_bases));
    match service.retrieve(&request).await {
        Ok(hits) => hits
            .into_iter()
            .map(|hit| {
                let source_name = hit
                    .metadata
                    .get("source_name")
                    .and_then(serde_json::Value::as_str)
                    .map_or_else(|| hit.title.clone(), str::to_owned);
                let pages = passage_pages(&hit.metadata);
                (hit.dataset_id, BriefPassage { source_name, pages, text: hit.content })
            })
            .collect(),
        Err(error) => {
            log::warn!("the chatbot's knowledge search failed: {error}");
            Vec::new()
        }
    }
}
