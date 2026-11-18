//! What one bot reply runs: the agent's flow with the saved setup applied,
//! the `sys` values it reads, and the hand-off rules the host enforces.

use super::brief::{chatbot_brief, handoff_rules_text, BriefPassage};
use super::overlay::{overlay_flow, BRIEF_SYS_NAME, HANDOFF_RULES_SYS_NAME, NO_KNOWLEDGE_SYS_NAME};
use super::{load_saved_settings, ChatbotSettings, HandoffRules};
use crate::credentials::CredentialStore;
use crate::error::AppResult;
use crate::knowledge::records;
use crate::knowledge::retrieval::knowledge_service_for_runs;
use crate::storage::models::Agent;
use crate::storage::Database;

/// Passages the host looks up for a flow without its own retrieval step.
const HOST_PASSAGE_COUNT: usize = 4;

/// The workflow and extra inputs of one bot reply.
#[derive(Debug, Clone, PartialEq)]
pub struct PreparedReply {
    /// The flow to run: the stored one, or its overlay (JSON) when the setup is saved.
    pub flow_text: String,
    /// Extra `sys.*` values for the run.
    pub sys_values: Vec<(String, String)>,
    /// Rules to enforce on the reply's hand-off, `None` when the setup was never saved.
    pub handoff_rules: Option<HandoffRules>,
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
        return Ok(PreparedReply { flow_text: agent.flow_yaml.clone(), sys_values: Vec::new(), handoff_rules: None });
    };
    let knowledge_base_ids = existing_knowledge_base_ids(db, &settings)?;
    let overlaid = overlay_flow(&agent.flow_yaml, &knowledge_base_ids)?;
    let passages = if overlaid.has_retrieval_step || knowledge_base_ids.is_empty() {
        None
    } else {
        Some(lookup_passages(db, credentials, &knowledge_base_ids, message_text).await)
    };
    let sys_values = vec![
        (BRIEF_SYS_NAME.to_owned(), chatbot_brief(&settings, passages.as_deref())),
        (HANDOFF_RULES_SYS_NAME.to_owned(), handoff_rules_text(&settings.handoff_rules)),
        (NO_KNOWLEDGE_SYS_NAME.to_owned(), String::new()),
    ];
    Ok(PreparedReply { flow_text: overlaid.flow_text, sys_values, handoff_rules: Some(settings.handoff_rules) })
}

/// Attached knowledge bases that still exist (a deleted one is skipped, not an error).
fn existing_knowledge_base_ids(db: &Database, settings: &ChatbotSettings) -> AppResult<Vec<String>> {
    let knowledge_bases = records::list_knowledge_bases(db)?;
    Ok(settings
        .knowledge_base_ids
        .iter()
        .filter(|attached| knowledge_bases.iter().any(|base| &base.id == *attached))
        .cloned()
        .collect())
}

async fn lookup_passages(
    db: &Database,
    credentials: &CredentialStore,
    knowledge_base_ids: &[String],
    message_text: &str,
) -> Vec<BriefPassage> {
    let service = match knowledge_service_for_runs(db, credentials) {
        Ok(service) => service,
        Err(error) => {
            log::warn!("the chatbot could not open its knowledge: {error}");
            return Vec::new();
        }
    };
    let request =
        graphrt_rag::RetrievalRequest::new(message_text, knowledge_base_ids.to_vec()).top_k(HOST_PASSAGE_COUNT);
    match service.retrieve(&request).await {
        Ok(hits) => hits
            .into_iter()
            .map(|hit| BriefPassage {
                source_name: hit
                    .metadata
                    .get("source_name")
                    .and_then(serde_json::Value::as_str)
                    .map_or_else(|| hit.title.clone(), str::to_owned),
                text: hit.content,
            })
            .collect(),
        Err(error) => {
            log::warn!("the chatbot's knowledge search failed: {error}");
            Vec::new()
        }
    }
}
