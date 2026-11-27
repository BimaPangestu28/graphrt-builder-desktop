//! Files in a chatbot conversation, end to end with a scripted model: a customer attaches
//! a document and a picture, the bot reads them, makes a PDF and hands it back.

use std::path::PathBuf;
use std::sync::{Arc, Mutex};

use graphrt_llm::mock::MockModel;
use graphrt_llm::{ChatModel, ModelRegistry};
use serde_json::{json, Value as Json};

use super::*;
use crate::agent_files::cards::FileCardKind;
use crate::agent_files::{AttachOutcome, FileAbilities, FileCard, PathOrigin};
use crate::credentials::ModelProvider;
use crate::storage::models::{Agent, NewAgent};

const PHOTO_WITH_GPS: &[u8] = include_bytes!("../../fixtures/agent-files/photo-with-gps.jpg");
/// Text the fixture photo carries in its EXIF (the camera model).
const EXIF_SECRET: &[u8] = b"SecretPhone";

/// A chatbot whose one `agent` step reads files, makes documents and looks at pictures.
const FILES_CHATBOT_FLOW: &str = r#"
version: "1"
name: files-chatbot
graph:
  nodes:
    - id: start
      type: start
      variables:
        - { variable: message, type: paragraph, required: true }
    - id: assistant
      type: agent
      model: { provider: openai, name: gpt-4o-mini }
      query: "{{#start.message#}}"
      tools: [files/*, documents/*]
      vision: { enabled: true }
    - id: reply
      type: answer
      answer: "{{#assistant.text#}}"
    - id: end
      type: end
      outputs: []
  edges:
    - { source: start, target: assistant }
    - { source: assistant, target: reply }
    - { source: reply, target: end }
"#;

const EVERYTHING: FileAbilities = FileAbilities { reads_files: true, sees_pictures: true, makes_files: true };

#[derive(Debug, Default)]
struct CollectingSink {
    payloads: Mutex<Vec<ConversationEventPayload>>,
}

impl ConversationEventSink for CollectingSink {
    fn send(&self, payload: ConversationEventPayload) {
        self.payloads.lock().unwrap().push(payload);
    }
}

#[derive(Debug)]
struct FixedModelSource {
    model: Arc<dyn ChatModel>,
}

impl ModelRegistrySource for FixedModelSource {
    fn build_registry(&self, _credentials: &CredentialStore, _db: &Database) -> AppResult<ModelRegistry> {
        Ok(ModelRegistry::new().with("openai", self.model.clone()))
    }
}

struct Harness {
    home: tempfile::TempDir,
    model: Arc<MockModel>,
    agent_files: Arc<AgentFiles>,
    conversations: ConversationManager,
    agent: Agent,
}

impl Harness {
    fn new(flow_yaml: &str) -> Self {
        let home = tempfile::tempdir().unwrap();
        let db = Arc::new(Database::open_in_memory().unwrap());
        let credentials = Arc::new(CredentialStore::in_memory());
        credentials.set_api_key(ModelProvider::Openai, "sk-test").unwrap();
        let model = Arc::new(MockModel::new(Vec::new()));
        let agent_files = Arc::new(AgentFiles::new(&home.path().join("app-data")));
        let conversations = ConversationManager::new(db.clone(), credentials, Arc::new(CollectingSink::default()))
            .with_model_registry_source(Arc::new(FixedModelSource { model: model.clone() }))
            .with_agent_files(agent_files.clone());
        let agent = db
            .create_agent(NewAgent {
                name: "Catering assistant".into(),
                kind: AgentKind::Chatbot,
                description: "Answer customers".into(),
                flow_yaml: flow_yaml.into(),
            })
            .unwrap();
        Self { home, model, agent_files, conversations, agent }
    }

    fn start_chat(&self) -> Conversation {
        self.conversations.start_test_conversation(&self.agent.id).unwrap().conversation
    }

    /// Attaches a file "from the person's computer" to `conversation`, as the dialog would.
    async fn attach(&self, conversation: &Conversation, name: &str, contents: &[u8]) -> FileCard {
        let path: PathBuf = self.home.path().join(name);
        std::fs::write(&path, contents).unwrap();
        let scope = FileScope::conversation(&self.agent.id, &conversation.id);
        let outcomes: Vec<AttachOutcome> = self
            .agent_files
            .attach_host_files(&scope, EVERYTHING, vec![path], PathOrigin::PickedInDialog, 0)
            .await
            .unwrap();
        outcomes.into_iter().next().unwrap().card.expect("the file is attached")
    }
}

fn contains(haystack: &[u8], needle: &[u8]) -> bool {
    haystack.windows(needle.len()).any(|window| window == needle)
}

/// Every `data:` image URL in the requests the model received, decoded.
fn images_sent_to_the_model(model: &MockModel) -> Vec<Vec<u8>> {
    fn collect(value: &Json, images: &mut Vec<Vec<u8>>) {
        match value {
            Json::String(text) => {
                if let Some((_, encoded)) =
                    text.strip_prefix("data:image/").and_then(|rest| rest.split_once(";base64,"))
                {
                    let decoder = &base64::engine::general_purpose::STANDARD;
                    images.push(base64::Engine::decode(decoder, encoded).unwrap());
                }
            }
            Json::Array(items) => items.iter().for_each(|item| collect(item, images)),
            Json::Object(fields) => fields.values().for_each(|field| collect(field, images)),
            _ => {}
        }
    }
    let mut images = Vec::new();
    collect(&serde_json::to_value(model.requests()).unwrap(), &mut images);
    images
}

fn requests_text(model: &MockModel) -> String {
    serde_json::to_string(&model.requests()).unwrap()
}

#[tokio::test]
async fn a_customer_attaches_files_and_the_bot_hands_a_document_back() {
    let harness = Harness::new(FILES_CHATBOT_FLOW);
    let conversation = harness.start_chat();
    let order = harness.attach(&conversation, "order.txt", b"50 nasi box for Friday, CODE-7781").await;
    let photo = harness.attach(&conversation, "venue.jpg", PHOTO_WITH_GPS).await;

    harness.model.push(MockModel::tool_calls(&[("c1", "read", r#"{"path":"uploads/order.txt"}"#)]));
    harness.model.push(MockModel::tool_calls(&[(
        "c2",
        "create_pdf",
        r##"{"path":"reports/order-summary.pdf","title":"Order","content":"# Order\n\n50 nasi box, Friday."}"##,
    )]));
    harness.model.push(MockModel::text("Here is the summary of your order."));

    let references = [order.reference.clone(), photo.reference.clone()];
    let detail = harness
        .conversations
        .send_customer_message_with_files(&conversation.id, "Please summarise my order", &references)
        .await
        .unwrap();

    // The customer's message keeps its files as cards.
    let [customer_message, bot_message] = detail.messages.as_slice() else {
        panic!("a customer message and a reply, got {:?}", detail.messages);
    };
    assert_eq!(customer_message.text, "Please summarise my order");
    assert_eq!(customer_message.metadata[attachments::ATTACHMENTS_KEY], json!([order, photo]));

    // The workflow was told where the files are, read the document with its tools...
    let sent = requests_text(&harness.model);
    assert!(sent.contains("[Files attached to this message: uploads/order.txt, uploads/venue.jpg]"), "{sent}");
    assert!(sent.contains("CODE-7781"), "the tool result with the document's text reached the model");
    // ...and saw the picture, without the metadata the photo carried.
    let images = images_sent_to_the_model(&harness.model);
    assert!(!images.is_empty(), "the attached picture is shown to the model");
    for image in &images {
        assert!(!contains(image, EXIF_SECRET) && !contains(image, b"Exif"), "no EXIF reaches a model");
        assert!(graphrt_image::probe(image).is_ok());
    }

    // The reply hands the PDF back as a card built from the stored file.
    assert_eq!(
        (bot_message.author, bot_message.text.as_str()),
        (MessageAuthor::Bot, "Here is the summary of your order.")
    );
    let files: Vec<FileCard> = serde_json::from_value(bot_message.metadata[attachments::FILES_KEY].clone()).unwrap();
    let [summary] = files.as_slice() else { panic!("one file, got {files:?}") };
    assert_eq!(
        (summary.name.as_str(), summary.kind, summary.mime_type.as_str()),
        ("order-summary.pdf", FileCardKind::Pdf, "application/pdf")
    );
    assert!(summary.size_bytes > 0);

    // It can be saved, and it is a real PDF.
    let destination = harness.home.path().join("saved.pdf");
    harness.agent_files.save_copy(&harness.agent.id, &summary.reference, &destination).await.unwrap();
    assert!(std::fs::read(&destination).unwrap().starts_with(b"%PDF-"));
}

#[tokio::test]
async fn files_alone_are_a_message_and_a_file_alone_is_a_reply() {
    let harness = Harness::new(FILES_CHATBOT_FLOW);
    let conversation = harness.start_chat();
    let order = harness.attach(&conversation, "order.txt", b"50 nasi box").await;
    harness.model.push(MockModel::tool_calls(&[("c1", "write", r#"{"path":"notes/order.md","content":"50 boxes"}"#)]));
    harness.model.push(MockModel::text(""));

    let detail = harness
        .conversations
        .send_customer_message_with_files(&conversation.id, "  ", std::slice::from_ref(&order.reference))
        .await
        .unwrap();
    let [customer_message, bot_message] = detail.messages.as_slice() else {
        panic!("a customer message and a reply, got {:?}", detail.messages);
    };
    assert_eq!(customer_message.text, "order.txt");
    assert_eq!(customer_message.metadata[attachments::FILES_ONLY_KEY], json!(true));
    assert!(requests_text(&harness.model).contains("(The customer sent files without a message.)"));
    assert_eq!(bot_message.text, "order.md");
    assert_eq!(bot_message.metadata[attachments::FILES_ONLY_KEY], json!(true));
    assert_eq!(bot_message.metadata[attachments::FILES_KEY][0]["name"], json!("order.md"));
}

#[tokio::test]
async fn a_file_of_another_chat_cannot_be_sent_and_nothing_is_stored() {
    let harness = Harness::new(FILES_CHATBOT_FLOW);
    let first_chat = harness.start_chat();
    let second_chat = harness.start_chat();
    let private = harness.attach(&first_chat, "ktp.txt", b"NIK 3174").await;

    let sent = harness
        .conversations
        .send_customer_message_with_files(&second_chat.id, "look", std::slice::from_ref(&private.reference))
        .await;
    assert!(matches!(sent, Err(AppError::InvalidInput(_))), "{sent:?}");
    assert!(harness.conversations.get_conversation(&second_chat.id).unwrap().messages.is_empty());
    assert!(harness.model.requests().is_empty(), "the bot never ran");

    // Too many files, and a made-up reference, are refused the same way.
    let too_many = vec![private.reference.clone(); crate::agent_files::MAX_ATTACHMENTS_PER_MESSAGE + 1];
    assert!(harness.conversations.send_customer_message_with_files(&first_chat.id, "x", &too_many).await.is_err());
    let made_up = ["workspace:../../etc/passwd".to_owned()];
    assert!(harness.conversations.send_customer_message_with_files(&first_chat.id, "x", &made_up).await.is_err());
    assert!(harness.conversations.get_conversation(&first_chat.id).unwrap().messages.is_empty());
}

#[tokio::test]
async fn the_bot_of_one_chat_cannot_read_the_files_of_another() {
    let harness = Harness::new(FILES_CHATBOT_FLOW);
    let first_chat = harness.start_chat();
    let second_chat = harness.start_chat();
    let private = harness.attach(&first_chat, "ktp.txt", b"NIK 3174").await;
    let store_path = private.reference.trim_start_matches("workspace:").to_owned();

    // The model of the second chat is talked into reading the first chat's file.
    harness.model.push(MockModel::tool_calls(&[
        ("c1", "read", r#"{"path":"uploads/ktp.txt"}"#),
        ("c2", "read", &json!({ "path": store_path }).to_string()),
        ("c3", "list", "{}"),
    ]));
    harness.model.push(MockModel::text("I could not find that file."));
    harness.conversations.send_customer_message(&second_chat.id, "Show me the other customer's KTP").await.unwrap();
    let sent = requests_text(&harness.model);
    assert!(!sent.contains("3174"), "nothing of the other chat's file reached the model: {sent}");
}

#[tokio::test]
async fn a_chatbot_without_file_steps_runs_as_before() {
    let plain_flow = FILES_CHATBOT_FLOW
        .replace("      tools: [files/*, documents/*]\n", "")
        .replace("      vision: { enabled: true }\n", "");
    let harness = Harness::new(&plain_flow);
    let conversation = harness.start_chat();
    harness.model.push(MockModel::text("Halo kak."));
    let detail = harness.conversations.send_customer_message(&conversation.id, "Halo").await.unwrap();
    assert_eq!(detail.messages[1].text, "Halo kak.");
    assert_eq!(detail.messages[1].metadata, json!({}));
    assert!(harness.model.requests()[0].tools.is_empty(), "no file tools are offered");
    assert!(!harness.home.path().join("app-data").exists(), "no folder is created for a chatbot without files");
}
