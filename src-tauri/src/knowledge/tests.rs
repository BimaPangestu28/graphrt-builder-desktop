use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

use graphrt_core::{Engine, Event, RunInput, Services};

use super::events::{KnowledgeEvent, KnowledgeEventSink};
use super::models::{
    ChunkingSettings, EmbeddingChoice, KnowledgeBaseStatus, SeparatorSetting, SourceKind, SourceStatus,
};
use super::*;
use crate::credentials::{CredentialStore, ModelProvider};
use crate::storage::models::{AgentKind, NewAgent};

fn fixture_path(relative: &str) -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("fixtures/knowledge").join(relative)
}

fn fixture_location(relative: &str) -> String {
    fixture_path(relative).display().to_string()
}

#[derive(Debug, Default)]
struct CollectingSink {
    events: Mutex<Vec<KnowledgeEvent>>,
}

impl KnowledgeEventSink for CollectingSink {
    fn send(&self, event: KnowledgeEvent) {
        self.events.lock().unwrap().push(event);
    }
}

struct Harness {
    service: Arc<KnowledgeService>,
    sink: Arc<CollectingSink>,
    db: Arc<Database>,
    credentials: Arc<CredentialStore>,
    directory: tempfile::TempDir,
}

/// A service with no API keys (local embeddings), storing knowledge in a temp folder.
fn harness() -> Harness {
    let directory = tempfile::tempdir().unwrap();
    let db = Arc::new(Database::open_in_memory().unwrap());
    let credentials = Arc::new(CredentialStore::in_memory());
    let sink = Arc::new(CollectingSink::default());
    let service = Arc::new(KnowledgeService::new(
        db.clone(),
        credentials.clone(),
        directory.path().join(KNOWLEDGE_DIR_NAME),
        sink.clone(),
    ));
    Harness { service, sink, db, credentials, directory }
}

async fn knowledge_base_with_faq(harness: &Harness) -> (String, String) {
    let knowledge_base = harness.service.create_knowledge_base("Catering menu and prices", "").unwrap();
    let source =
        harness.service.add_source(&knowledge_base.id, SourceKind::File, &fixture_location("catering-faq.md")).unwrap();
    harness.service.sync_knowledge_base(&knowledge_base.id).await.unwrap();
    (knowledge_base.id, source.id)
}

#[tokio::test]
async fn indexes_a_markdown_file_and_finds_the_right_passage_without_any_key() {
    let harness = harness();
    let (knowledge_base_id, source_id) = knowledge_base_with_faq(&harness).await;

    let detail = harness.service.get_knowledge_base(&knowledge_base_id).unwrap();
    assert_eq!(detail.knowledge_base.settings.embedding, EmbeddingChoice::Local);
    assert_eq!(detail.knowledge_base.status, KnowledgeBaseStatus::UpToDate);
    assert!(detail.knowledge_base.last_synced_at.is_some());
    assert!(detail.knowledge_base.storage_bytes > 0);
    let source = &detail.sources[0];
    assert_eq!(source.id, source_id);
    assert_eq!(source.name, "catering-faq.md");
    assert_eq!(source.status, SourceStatus::Indexed);
    assert_eq!(source.document_count, 1);
    assert!(source.passage_count >= 3, "one passage per section, got {}", source.passage_count);

    let passages = harness.service.search("delivery fee for small orders", None, 3).await.unwrap();
    let best = passages.first().expect("a passage matches");
    assert!(best.text.contains("delivery fee based on distance"), "{best:?}");
    assert_eq!(best.knowledge_base_id, knowledge_base_id);
    assert_eq!(best.knowledge_base_name, "Catering menu and prices");
    assert_eq!(best.source_id.as_deref(), Some(source_id.as_str()));
    assert_eq!(best.source_name, "catering-faq.md");
    assert_eq!(best.location.as_deref(), Some("Catering FAQ > Delivery"));
    assert!(best.score > 0.0 && best.score <= 1.0);

    let payment = harness.service.search("bank transfer deposit", Some(vec![knowledge_base_id]), 1).await.unwrap();
    assert!(payment[0].text.contains("bank transfer"));
}

#[tokio::test]
async fn resyncing_an_unchanged_source_is_a_no_op_and_changes_are_reindexed() {
    let harness = harness();
    let copied_file = harness.directory.path().join("faq.md");
    std::fs::copy(fixture_path("catering-faq.md"), &copied_file).unwrap();
    let knowledge_base = harness.service.create_knowledge_base("FAQ", "").unwrap();
    harness.service.add_source(&knowledge_base.id, SourceKind::File, &copied_file.display().to_string()).unwrap();

    let first = harness.service.sync_knowledge_base(&knowledge_base.id).await.unwrap();
    assert_eq!((first.documents_indexed, first.documents_unchanged), (1, 0));
    let passages_before = harness.service.knowledge_base_summary(&knowledge_base.id).unwrap().passage_count;

    let second = harness.service.sync_knowledge_base(&knowledge_base.id).await.unwrap();
    assert_eq!((second.documents_indexed, second.documents_unchanged), (0, 1));
    assert_eq!(harness.service.knowledge_base_summary(&knowledge_base.id).unwrap().passage_count, passages_before);

    let mut changed_text = std::fs::read_to_string(&copied_file).unwrap();
    changed_text.push_str("\n## Allergies\n\nTell us about nut allergies when you order.\n");
    std::fs::write(&copied_file, changed_text).unwrap();
    let third = harness.service.sync_knowledge_base(&knowledge_base.id).await.unwrap();
    assert_eq!(third.documents_indexed, 1);
    let allergy = harness.service.search("nut allergies", None, 1).await.unwrap();
    assert!(allergy[0].text.contains("nut allergies"));
}

#[tokio::test]
async fn folder_sources_index_supported_files_and_drop_deleted_ones() {
    let harness = harness();
    let folder = harness.directory.path().join("policies");
    std::fs::create_dir_all(&folder).unwrap();
    for name in ["opening-hours.txt", "cancellations.md", "logo.bin"] {
        std::fs::copy(fixture_path(&format!("policies/{name}")), folder.join(name)).unwrap();
    }
    let knowledge_base = harness.service.create_knowledge_base("Policies", "").unwrap();
    let source =
        harness.service.add_source(&knowledge_base.id, SourceKind::Folder, &folder.display().to_string()).unwrap();
    assert_eq!(source.name, "policies");
    harness.service.sync_knowledge_base(&knowledge_base.id).await.unwrap();

    let source = records::get_source(&harness.db, &source.id).unwrap();
    assert_eq!(source.status, SourceStatus::Indexed);
    assert_eq!(source.document_count, 2, "the .bin file is skipped");
    let hours = harness.service.search("when is the kitchen open on sunday", None, 1).await.unwrap();
    assert_eq!(hours[0].source_name, "opening-hours.txt");

    std::fs::remove_file(folder.join("opening-hours.txt")).unwrap();
    let report = harness.service.sync_knowledge_base(&knowledge_base.id).await.unwrap();
    assert_eq!((report.documents_removed, report.documents_unchanged), (1, 1));
    let after = harness.service.search("kitchen open sunday", None, 5).await.unwrap();
    assert!(after.iter().all(|passage| passage.source_name != "opening-hours.txt"));
}

#[tokio::test]
async fn deleting_a_knowledge_base_removes_its_store_and_records() {
    let harness = harness();
    let (knowledge_base_id, source_id) = knowledge_base_with_faq(&harness).await;
    let store_path = PathBuf::from(records::get_knowledge_base(&harness.db, &knowledge_base_id).unwrap().store_path);
    assert!(store_path.exists());

    harness.service.delete_knowledge_base(&knowledge_base_id).unwrap();
    assert!(!store_path.exists());
    assert!(harness.service.list_knowledge_bases().unwrap().is_empty());
    assert!(matches!(records::get_source(&harness.db, &source_id), Err(AppError::NotFound(_))));
    assert!(records::list_documents(&harness.db, &source_id).unwrap().is_empty());
    let search = harness.service.search("delivery", Some(vec![knowledge_base_id]), 3).await;
    assert!(matches!(search, Err(AppError::NotFound(_))));
}

#[tokio::test]
async fn removing_a_source_removes_its_passages() {
    let harness = harness();
    let (knowledge_base_id, source_id) = knowledge_base_with_faq(&harness).await;
    harness.service.remove_source(&source_id).await.unwrap();
    assert!(harness.service.search("delivery fee", None, 3).await.unwrap().is_empty());
    let summary = harness.service.knowledge_base_summary(&knowledge_base_id).unwrap();
    assert_eq!((summary.source_count, summary.passage_count, summary.status), (0, 0, KnowledgeBaseStatus::Empty));
}

#[tokio::test]
async fn reports_progress_events_while_syncing() {
    let harness = harness();
    let (knowledge_base_id, source_id) = knowledge_base_with_faq(&harness).await;
    let events = harness.sink.events.lock().unwrap().clone();
    assert!(matches!(&events[0], KnowledgeEvent::SyncStarted { knowledge_base_id: id } if *id == knowledge_base_id));
    let statuses: Vec<SourceStatus> = events
        .iter()
        .filter_map(|event| match event {
            KnowledgeEvent::SourceUpdated { source, .. } if source.id == source_id => Some(source.status),
            _ => None,
        })
        .collect();
    assert_eq!(statuses, [SourceStatus::Reading, SourceStatus::Indexed]);
    match events.last() {
        Some(KnowledgeEvent::SyncFinished { knowledge_base, .. }) => {
            assert_eq!(knowledge_base.status, KnowledgeBaseStatus::UpToDate);
            assert!(knowledge_base.sync_progress.is_none());
        }
        other => panic!("expected sync_finished last, got {other:?}"),
    }
    let serialized = serde_json::to_value(&events[0]).unwrap();
    assert_eq!(serialized, serde_json::json!({ "type": "sync_started", "knowledgeBaseId": knowledge_base_id }));
}

#[tokio::test]
async fn a_moved_file_fails_its_source_with_a_message() {
    let harness = harness();
    let copied_file = harness.directory.path().join("menu.md");
    std::fs::copy(fixture_path("catering-faq.md"), &copied_file).unwrap();
    let knowledge_base = harness.service.create_knowledge_base("Menu", "").unwrap();
    let source =
        harness.service.add_source(&knowledge_base.id, SourceKind::File, &copied_file.display().to_string()).unwrap();
    std::fs::remove_file(&copied_file).unwrap();
    harness.service.sync_knowledge_base(&knowledge_base.id).await.unwrap();

    let source = records::get_source(&harness.db, &source.id).unwrap();
    assert_eq!(source.status, SourceStatus::Failed);
    assert_eq!(source.status_message.as_deref(), Some("menu.md was moved or deleted"));
    let summary = harness.service.knowledge_base_summary(&knowledge_base.id).unwrap();
    assert_eq!(summary.status, KnowledgeBaseStatus::NeedsAttention);
}

#[tokio::test]
async fn links_to_the_local_network_are_refused_by_the_egress_policy() {
    let harness = harness();
    let knowledge_base = harness.service.create_knowledge_base("Website", "").unwrap();
    let source = harness.service.add_source(&knowledge_base.id, SourceKind::Url, "http://127.0.0.1:9/menu").unwrap();
    assert_eq!(source.name, "127.0.0.1:9/menu");
    harness.service.sync_knowledge_base(&knowledge_base.id).await.unwrap();

    let source = records::get_source(&harness.db, &source.id).unwrap();
    assert_eq!(source.status, SourceStatus::Failed);
    let message = source.status_message.unwrap_or_default();
    assert!(message.starts_with("this link is not allowed"), "{message}");
}

#[test]
fn rejects_unusable_sources_and_duplicates() {
    let harness = harness();
    let knowledge_base = harness.service.create_knowledge_base("Docs", "").unwrap();
    let add = |kind, location: &str| harness.service.add_source(&knowledge_base.id, kind, location);

    assert!(matches!(add(SourceKind::File, "relative/file.md"), Err(AppError::InvalidInput(_))));
    assert!(matches!(add(SourceKind::File, &fixture_location("policies/logo.bin")), Err(AppError::InvalidInput(_))));
    assert!(matches!(add(SourceKind::Folder, &fixture_location("catering-faq.md")), Err(AppError::InvalidInput(_))));
    assert!(matches!(add(SourceKind::Url, "ftp://example.com/menu"), Err(AppError::InvalidInput(_))));
    add(SourceKind::File, &fixture_location("catering-faq.md")).unwrap();
    assert!(matches!(add(SourceKind::File, &fixture_location("catering-faq.md")), Err(AppError::InvalidInput(_))));
    assert!(matches!(
        harness.service.add_source("kb_missing", SourceKind::Url, "https://example.com"),
        Err(AppError::NotFound(_))
    ));
}

#[test]
fn validates_names_and_settings() {
    let harness = harness();
    assert!(matches!(harness.service.create_knowledge_base("  ", ""), Err(AppError::InvalidInput(_))));
    let knowledge_base = harness.service.create_knowledge_base("Docs", "Company documents").unwrap();
    let renamed = harness.service.rename_knowledge_base(&knowledge_base.id, " Office documents ").unwrap();
    assert_eq!(renamed.name, "Office documents");

    let mut settings = knowledge_base.settings;
    settings.passages_per_answer = 0;
    assert!(settings.validate().is_err());
    settings.passages_per_answer = 4;
    settings.min_score = 1.5;
    assert!(settings.validate().is_err());
}

#[tokio::test]
async fn openai_embeddings_need_a_key_and_new_bases_use_it_when_present() {
    let harness = harness();
    let knowledge_base = harness.service.create_knowledge_base("Docs", "").unwrap();
    let openai = KnowledgeSettings { embedding: EmbeddingChoice::Openai, ..knowledge_base.settings.clone() };
    let refused = harness.service.update_settings(&knowledge_base.id, openai).await;
    assert!(matches!(refused, Err(AppError::InvalidInput(_))));

    let tuned = KnowledgeSettings { min_score: 0.4, passages_per_answer: 8, ..knowledge_base.settings };
    let (saved, needs_sync) = harness.service.update_settings(&knowledge_base.id, tuned).await.unwrap();
    assert!(!needs_sync);
    assert_eq!(saved.settings.passages_per_answer, 8);

    harness.credentials.set_api_key(ModelProvider::Openai, "sk-test-placeholder").unwrap();
    let with_key = harness.service.create_knowledge_base("Cloud docs", "").unwrap();
    assert_eq!(with_key.settings.embedding, EmbeddingChoice::Openai);
}

#[tokio::test]
async fn openai_knowledge_without_a_key_still_searches_by_keyword() {
    let harness = harness();
    let (knowledge_base_id, _) = knowledge_base_with_faq(&harness).await;
    // Simulate a knowledge base indexed with OpenAI whose key was removed since.
    let mut stored = records::get_knowledge_base(&harness.db, &knowledge_base_id).unwrap();
    stored.settings.embedding = EmbeddingChoice::Openai;
    records::update_settings(&harness.db, &knowledge_base_id, &stored.settings).unwrap();

    let passages = harness.service.search("payment by bank transfer", None, 1).await.unwrap();
    assert!(passages[0].text.contains("bank transfer"));
}

#[tokio::test]
async fn sync_tracker_lets_one_sync_run_and_requests_a_rerun() {
    let tracker = SyncTracker::default();
    assert!(tracker.begin("kb").unwrap());
    assert!(!tracker.begin("kb").unwrap());
    assert!(tracker.progress("kb").is_some());
    assert!(tracker.finish("kb"), "a rerun was requested");
    assert!(!tracker.finish("kb"));
    assert!(tracker.progress("kb").is_none());
}

#[tokio::test]
async fn usage_lists_agents_whose_flow_mentions_the_knowledge_base() {
    let harness = harness();
    let knowledge_base = harness.service.create_knowledge_base("FAQ", "").unwrap();
    harness
        .db
        .create_agent(NewAgent {
            name: "Catering assistant".into(),
            kind: AgentKind::Chatbot,
            description: "Answers questions".into(),
            flow_yaml: format!("dataset_ids: [{}]", knowledge_base.id),
        })
        .unwrap();
    let listed = harness.service.list_knowledge_bases().unwrap();
    assert_eq!(listed[0].used_by.len(), 1);
    assert_eq!(listed[0].used_by[0].agent_name, "Catering assistant");
}

const RETRIEVAL_FLOW: &str = r#"
version: "1"
name: look-up-knowledge
graph:
  nodes:
    - id: start
      type: start
      variables:
        - { variable: question, type: text-input, required: true }
    - id: look_up
      type: knowledge-retrieval
      query_variable_selector: [start, question]
      dataset_ids: ["DATASET"]
      multiple_retrieval_config: { top_k: 1 }
    - id: end
      type: end
      outputs:
        - { variable: passages, value_selector: [look_up, result] }
  edges:
    - { source: start, target: look_up }
    - { source: look_up, target: end }
"#;

async fn run_retrieval_flow(harness: &Harness, dataset: &str, question: &str) -> serde_json::Value {
    let graph = crate::flow::compile_flow(&RETRIEVAL_FLOW.replace("DATASET", dataset)).unwrap();
    let knowledge = knowledge_service_for_runs(&harness.db, &harness.credentials).unwrap();
    let engine = Engine::new(Arc::new(graph)).with_services(Services::new().with(knowledge));
    match engine.run_to_end(RunInput::new().input("question", question)).await {
        Event::RunSucceeded { outputs, .. } => {
            serde_json::to_value(outputs.get("passages").cloned().unwrap_or(graphrt_core::Value::Null)).unwrap()
        }
        other => panic!("run did not succeed: {other:?}"),
    }
}

#[tokio::test]
async fn workflows_retrieve_from_knowledge_bases_by_id_or_name() {
    let harness = harness();
    let (knowledge_base_id, _) = knowledge_base_with_faq(&harness).await;

    let by_id = run_retrieval_flow(&harness, &knowledge_base_id, "minimum order for packages").await;
    let content = by_id[0]["content"].as_str().unwrap_or_default().to_owned();
    assert!(content.contains("minimum order of 20 boxes"), "{by_id}");
    assert_eq!(by_id[0]["dataset_id"], serde_json::json!(knowledge_base_id));

    let by_name = run_retrieval_flow(&harness, "Catering menu and prices", "cash on delivery").await;
    assert!(by_name[0]["content"].as_str().unwrap_or_default().contains("cash on delivery"), "{by_name}");
}

#[tokio::test]
async fn new_chunking_is_saved_flagged_and_applied_by_the_next_sync() {
    let harness = harness();
    let (knowledge_base_id, source_id) = knowledge_base_with_faq(&harness).await;
    let before = harness.service.knowledge_base_summary(&knowledge_base_id).unwrap();
    assert!(!before.needs_reindex, "default chunking matches what was indexed");

    let small = ChunkingSettings {
        max_tokens: 50,
        overlap_tokens: 0,
        respect_headings: false,
        separators: vec![SeparatorSetting::Sentence, SeparatorSetting::Word],
        ..ChunkingSettings::default()
    };
    let settings = KnowledgeSettings { chunking: small.clone(), ..before.settings.clone() };
    let (saved, needs_sync) = harness.service.update_settings(&knowledge_base_id, settings).await.unwrap();
    assert!(!needs_sync, "chunking waits for the person to index again");
    assert!(saved.needs_reindex);
    assert_eq!(saved.passage_count, before.passage_count, "passages stay searchable meanwhile");
    assert_eq!(records::get_knowledge_base(&harness.db, &knowledge_base_id).unwrap().settings.chunking, small);
    let documents = harness.service.list_source_documents(&source_id).unwrap();
    assert!(documents[0].needs_reindex);

    // The file did not change, but the next sync cuts it again.
    let report = harness.service.sync_knowledge_base(&knowledge_base_id).await.unwrap();
    assert_eq!(report.documents_indexed, 1);
    let after = harness.service.knowledge_base_summary(&knowledge_base_id).unwrap();
    assert!(!after.needs_reindex);
    // Without headings the small sections are cut by size instead (415 characters, 200 per passage).
    assert_eq!((before.passage_count, after.passage_count), (4, 3));

    let documents = harness.service.list_source_documents(&source_id).unwrap();
    assert!(documents[0].indexed_at.is_some() && !documents[0].needs_reindex);
    let page = harness.service.list_document_chunks(&source_id, &documents[0].document_id, "", 0, 20).await.unwrap();
    assert_eq!(page.total, after.passage_count);
    assert_eq!(page.chunks.len(), 3);
    assert!(page.chunks.iter().all(|chunk| chunk.char_count <= 200 && chunk.heading.is_none()));
    assert!(page.chunks.windows(2).all(|pair| pair[0].index < pair[1].index));
    assert!(page.chunks.iter().all(|chunk| chunk.char_start.is_some() && chunk.char_end.is_some()));

    let filtered = harness
        .service
        .list_document_chunks(&source_id, &documents[0].document_id, "BANK transfer", 0, 50)
        .await
        .unwrap();
    assert!(filtered.matching >= 1 && filtered.matching < filtered.total);
    assert!(filtered.chunks.iter().all(|chunk| chunk.text.to_lowercase().contains("bank")));

    // A sync with the same settings again changes nothing.
    let again = harness.service.sync_knowledge_base(&knowledge_base_id).await.unwrap();
    assert_eq!((again.documents_indexed, again.documents_unchanged), (0, 1));
}

#[tokio::test]
async fn unusable_chunking_is_refused() {
    let harness = harness();
    let knowledge_base = harness.service.create_knowledge_base("Docs", "").unwrap();
    let chunking = ChunkingSettings {
        separators: vec![SeparatorSetting::Pattern { value: "(unclosed".into() }],
        ..ChunkingSettings::default()
    };
    let settings = KnowledgeSettings { chunking, ..knowledge_base.settings.clone() };
    let refused = harness.service.update_settings(&knowledge_base.id, settings).await;
    assert!(matches!(refused, Err(AppError::InvalidInput(_))), "{refused:?}");
    let unknown = harness.service.list_document_chunks("src_missing", "doc", "", 0, 10).await;
    assert!(matches!(unknown, Err(AppError::NotFound(_))));
}
