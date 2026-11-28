//! WhatsApp Business of an online chatbot against a fake online copy (`graphrt serve
//! --channel whatsapp`) and a fake Graph API: chats shown in the Inbox once, take-over and
//! replies sent through the online copy, the 24 hour window, and the setup step.

use std::sync::{Arc, Mutex};

use serde_json::{json, Value as Json};

use super::super::fake_http::{eventually, FakeRequest, FakeResponse, FakeServer};
use super::super::whatsapp_online::{
    deploy_secrets, OnlineChatbots, WhatsAppBusinessInput, WhatsAppOnlineService, WHATSAPP_CHANNEL,
};
use super::{Base, REPLY_FLOW};
use crate::conversations::channel::ChannelAdapter;
use crate::conversations::models::{ConversationStatus, MessageAuthor};
use crate::conversations::ConversationManager;
use crate::deploy::http::ReqwestDeployHttp;
use crate::deploy::online::{own_server_instructions, OnlineFeatures};
use crate::error::AppResult;

const API_KEY: &str = "grk_online_copy_key";
const CUSTOMER: &str = "6281234567890";
const PHONE_NUMBER_ID: &str = "106540352242922";
const ACCESS_TOKEN: &str = "EAAG-access-token-value";

fn now_ms() -> u64 {
    u64::try_from(std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_millis()).unwrap()
}

/// The online copy's WhatsApp conversation with one customer.
#[derive(Debug)]
struct OnlineChat {
    messages: Vec<Json>,
    updated_ms: u64,
    last_inbound_ms: u64,
    human: bool,
    waiting_run: Option<String>,
}

impl OnlineChat {
    fn summary(&self) -> Json {
        json!({
            "id": format!("ch-whatsapp-{CUSTOMER}"), "workflow": "toko-kue", "title": "", "created_ms": 1,
            "updated_ms": self.updated_ms, "message_count": self.messages.len(),
            "channel": { "name": "whatsapp", "kind": "whatsapp", "chat_id": CUSTOMER, "customer_name": "Budi",
                         "last_inbound_ms": self.last_inbound_ms, "human": self.human, "waiting_run": self.waiting_run },
        })
    }

    fn add(&mut self, role: &str, content: &str) {
        let created = self.updated_ms + 1;
        self.messages.push(json!({ "role": role, "content": content, "created_ms": created }));
        self.updated_ms = created;
    }
}

fn answer_online(chat: &Mutex<OnlineChat>, request: &FakeRequest) -> FakeResponse {
    if request.header("authorization") != Some(&format!("Bearer {API_KEY}")) {
        return FakeResponse::json(401, &json!({ "error": "unauthorized" }));
    }
    let mut chat = chat.lock().unwrap();
    let path = request.path.split('?').next().unwrap_or_default();
    match (request.method.as_str(), path) {
        ("GET", "/v1/conversations") => {
            FakeResponse::json(200, &json!({ "conversations": [chat.summary()], "next_cursor": null }))
        }
        ("GET", id) if id == format!("/v1/conversations/ch-whatsapp-{CUSTOMER}") => {
            let mut detail = chat.summary();
            detail["messages"] = json!(chat.messages);
            FakeResponse::json(200, &detail)
        }
        ("POST", "/v1/channels/whatsapp/handoff") => {
            chat.human = request.json()["human"].as_bool().unwrap_or(false);
            FakeResponse::bytes(204, "text/plain", Vec::new())
        }
        ("POST", "/v1/channels/whatsapp/messages") => {
            let text = request.json()["text"].as_str().unwrap_or_default().to_owned();
            // A team message is kept as an answer of the conversation.
            chat.add("assistant", &text);
            FakeResponse::bytes(204, "text/plain", Vec::new())
        }
        _ => FakeResponse::json(404, &json!({ "error": "not found" })),
    }
}

#[derive(Debug)]
struct OneOnlineChatbot {
    agent_id: String,
    url: String,
}

impl OnlineChatbots for OneOnlineChatbot {
    fn whatsapp_agents(&self) -> Vec<String> {
        vec![self.agent_id.clone()]
    }

    fn access(&self, _agent_id: &str) -> AppResult<(String, String)> {
        Ok((self.url.clone(), API_KEY.to_owned()))
    }
}

struct Rig {
    base: Base,
    chat: Arc<Mutex<OnlineChat>>,
    online: FakeServer,
    service: Arc<WhatsAppOnlineService>,
    manager: Arc<ConversationManager>,
}

impl Rig {
    async fn start() -> Self {
        let base = Base::new(REPLY_FLOW);
        let chat = Arc::new(Mutex::new(OnlineChat {
            messages: Vec::new(),
            updated_ms: 1_000,
            last_inbound_ms: now_ms(),
            human: false,
            waiting_run: None,
        }));
        {
            let mut chat = chat.lock().unwrap();
            chat.add("user", "Halo, kue lapis ada?");
            chat.add("assistant", "Ada, Kak. Mau berapa?");
        }
        let handler_chat = chat.clone();
        let online = FakeServer::start(move |request| answer_online(&handler_chat, request)).await;
        let chatbots = Arc::new(OneOnlineChatbot { agent_id: base.agent.id.clone(), url: online.base_url.clone() });
        let service = Arc::new(
            WhatsAppOnlineService::new(
                base.db.clone(),
                base.credentials.clone(),
                chatbots,
                Arc::new(ReqwestDeployHttp::new().unwrap()),
            )
            .unwrap(),
        );
        let manager = base.manager(vec![service.adapter()]);
        service.attach(&manager);
        Self { base, chat, online, service, manager }
    }

    fn messages(&self) -> Vec<(MessageAuthor, String)> {
        let chat = self.base.only_chat(&self.manager, WHATSAPP_CHANNEL);
        chat.messages.iter().map(|message| (message.author, message.text.clone())).collect()
    }
}

#[tokio::test]
async fn the_online_chatbots_whatsapp_chats_appear_in_the_inbox_once() {
    let rig = Rig::start().await;
    assert_eq!(rig.service.sync(&rig.base.agent.id).await.unwrap(), 2);
    assert_eq!(
        rig.messages(),
        [
            (MessageAuthor::Customer, "Halo, kue lapis ada?".to_owned()),
            (MessageAuthor::Bot, "Ada, Kak. Mau berapa?".to_owned()),
        ]
    );
    let chat = rig.base.only_chat(&rig.manager, WHATSAPP_CHANNEL);
    assert_eq!(
        (chat.conversation.customer_handle.as_str(), chat.conversation.customer_name.as_str()),
        (CUSTOMER, "Budi")
    );
    assert!(rig.base.model.requests().is_empty(), "the online copy answers, not the app");

    // Read again: nothing is stored twice. A new message is stored once.
    assert_eq!(rig.service.sync(&rig.base.agent.id).await.unwrap(), 0);
    rig.chat.lock().unwrap().add("user", "Dua kotak ya");
    assert_eq!(rig.service.sync(&rig.base.agent.id).await.unwrap(), 1);
    assert_eq!(rig.service.sync(&rig.base.agent.id).await.unwrap(), 0);
    assert_eq!(rig.messages().len(), 3);
    assert!(rig.base.model.requests().is_empty());
}

#[tokio::test]
async fn take_over_and_the_owners_reply_go_out_through_the_online_copy() {
    let rig = Rig::start().await;
    rig.service.sync(&rig.base.agent.id).await.unwrap();
    let id = rig.base.only_chat(&rig.manager, WHATSAPP_CHANNEL).conversation.id;

    rig.manager.take_over(&id).unwrap();
    assert!(eventually(5, || rig.chat.lock().unwrap().human).await, "the online bot stops for this customer");
    let reply = rig.manager.send_operator_reply(&id, "Saya pemilik toko, siap bantu").await.unwrap();
    assert!(reply.metadata.get("deliveryProblem").is_none(), "{}", reply.metadata);
    let sent = rig.online.requests_to("/v1/channels/whatsapp/messages");
    assert_eq!(sent[0].json(), json!({ "to": CUSTOMER, "text": "Saya pemilik toko, siap bantu" }));

    // The online copy keeps the owner's message as an answer: it is not shown twice.
    rig.service.sync(&rig.base.agent.id).await.unwrap();
    let messages = rig.messages();
    assert_eq!(messages.iter().filter(|(_, text)| text == "Saya pemilik toko, siap bantu").count(), 1, "{messages:?}");
    assert_eq!(messages.last().map(|(author, _)| *author), Some(MessageAuthor::Operator));
    assert_eq!(rig.base.only_chat(&rig.manager, WHATSAPP_CHANNEL).conversation.status, ConversationStatus::YouReplying);

    rig.manager.hand_back(&id).unwrap();
    assert!(eventually(5, || !rig.chat.lock().unwrap().human).await, "the online bot answers again");
}

#[tokio::test]
async fn a_reply_after_the_24_hour_window_is_refused_before_it_leaves() {
    let rig = Rig::start().await;
    rig.chat.lock().unwrap().last_inbound_ms = now_ms() - 25 * 60 * 60 * 1000;
    rig.service.sync(&rig.base.agent.id).await.unwrap();
    let id = rig.base.only_chat(&rig.manager, WHATSAPP_CHANNEL).conversation.id;
    let reply = rig.manager.send_operator_reply(&id, "Masih mau pesan?").await.unwrap();
    assert_eq!(reply.metadata["deliveryProblem"], "outside_window", "{}", reply.metadata);
    assert!(rig.online.requests_to("/v1/channels/whatsapp/messages").is_empty());
}

#[tokio::test]
async fn a_run_of_the_online_copy_that_waits_for_an_approval_waits_for_the_owner() {
    let rig = Rig::start().await;
    rig.service.sync(&rig.base.agent.id).await.unwrap();
    {
        let mut chat = rig.chat.lock().unwrap();
        chat.waiting_run = Some("run-1".into());
        chat.add("user", "Saya mau refund");
    }
    rig.service.sync(&rig.base.agent.id).await.unwrap();
    let chat = rig.base.only_chat(&rig.manager, WHATSAPP_CHANNEL);
    assert_eq!(chat.conversation.status, ConversationStatus::WaitingForYou);
    assert!(chat
        .messages
        .iter()
        .any(|message| message.author == MessageAuthor::System && message.text.contains("approval")));
}

#[tokio::test]
async fn the_setup_step_checks_the_values_with_meta_and_keeps_them_in_the_credential_store() {
    let rig = Rig::start().await;
    let graph = FakeServer::start(|request| {
        let known = request.path.starts_with(&format!("/v23.0/{PHONE_NUMBER_ID}?"));
        match (request.header("authorization"), known) {
            (Some(bearer), true) if bearer == format!("Bearer {ACCESS_TOKEN}") => FakeResponse::json(
                200,
                &json!({ "display_phone_number": "+62 812-3456-7890", "verified_name": "Toko Kue Sari", "id": PHONE_NUMBER_ID }),
            ),
            (_, true) => FakeResponse::json(401, &json!({ "error": { "code": 190, "message": "Invalid OAuth access token" } })),
            _ => FakeResponse::json(400, &json!({ "error": { "code": 100, "message": "Unsupported get request" } })),
        }
    })
    .await;
    let base = &rig.base;
    let service = WhatsAppOnlineService::new(
        base.db.clone(),
        base.credentials.clone(),
        Arc::new(OneOnlineChatbot { agent_id: base.agent.id.clone(), url: rig.online.base_url.clone() }),
        Arc::new(ReqwestDeployHttp::new().unwrap()),
    )
    .unwrap()
    .with_graph_base(&format!("{}/v23.0", graph.base_url));
    let input = |token: &str, id: &str| WhatsAppBusinessInput {
        access_token: token.into(),
        phone_number_id: id.into(),
        app_secret: "app-secret-value".into(),
    };

    let wrong_token = service.save(&base.agent.id, &input("EAAG-wrong", PHONE_NUMBER_ID)).await.unwrap_err();
    assert!(wrong_token.to_string().contains("does not accept the access token"), "{wrong_token}");
    let wrong_id = service.save(&base.agent.id, &input(ACCESS_TOKEN, "999")).await.unwrap_err();
    assert!(wrong_id.to_string().contains("phone number ID"), "{wrong_id}");
    let not_a_number = service.save(&base.agent.id, &input(ACCESS_TOKEN, "my number")).await.unwrap_err();
    assert!(not_a_number.to_string().contains("long number"), "{not_a_number}");
    assert!(deploy_secrets(&base.credentials, &base.agent.id).is_err(), "nothing saved after a refusal");

    let number = service.save(&base.agent.id, &input(ACCESS_TOKEN, PHONE_NUMBER_ID)).await.unwrap();
    assert_eq!(number.verified_name.as_deref(), Some("Toko Kue Sari"));
    let secrets = deploy_secrets(&base.credentials, &base.agent.id).unwrap();
    let names: Vec<&str> = secrets.iter().map(|(name, _, _)| *name).collect();
    assert_eq!(
        names,
        ["WHATSAPP_ACCESS_TOKEN", "WHATSAPP_PHONE_NUMBER_ID", "WHATSAPP_APP_SECRET", "WHATSAPP_VERIFY_TOKEN"]
    );
    let verify_token = service.verify_token(&base.agent.id).unwrap();
    assert!(verify_token.len() >= 32);
    // The same verify token after saving again (the owner typed it into Meta already).
    service.save(&base.agent.id, &input(ACCESS_TOKEN, PHONE_NUMBER_ID)).await.unwrap();
    assert_eq!(service.verify_token(&base.agent.id).unwrap(), verify_token);

    let setup = service.setup(&base.agent.id, true).unwrap();
    assert!(setup.saved && setup.online);
    assert_eq!(setup.webhook_url, Some(format!("{}/v1/channels/whatsapp/webhook", rig.online.base_url)));
    let as_json = serde_json::to_string(&setup).unwrap();
    assert!(
        !as_json.contains(ACCESS_TOKEN) && !as_json.contains("app-secret-value") && !as_json.contains(&verify_token)
    );
    // SQLite keeps the number Meta confirmed, none of the values.
    let stored = base.db.get_agent_setting(&base.agent.id, "whatsapp_business_number").unwrap().unwrap().to_string();
    assert!(stored.contains("Toko Kue Sari") && !stored.contains(ACCESS_TOKEN));

    service.forget(&base.agent.id).unwrap();
    assert!(deploy_secrets(&base.credentials, &base.agent.id).is_err());
}

#[tokio::test]
async fn a_meta_webhook_delivery_reads_as_a_customer_message() {
    let rig = Rig::start().await;
    let adapter = rig.service.adapter();
    let delivery = json!({
        "object": "whatsapp_business_account",
        "entry": [{ "id": "1", "changes": [{ "field": "messages", "value": {
            "messaging_product": "whatsapp",
            "metadata": { "display_phone_number": "6281200000000", "phone_number_id": PHONE_NUMBER_ID },
            "contacts": [{ "profile": { "name": "Budi" }, "wa_id": CUSTOMER }],
            "messages": [{ "from": CUSTOMER, "id": "wamid.1", "timestamp": "1700000000", "type": "text",
                           "text": { "body": "Halo" } }],
        } }] }],
    });
    let inbound = adapter.parse_inbound(&delivery).unwrap();
    assert_eq!((inbound.customer_handle.as_str(), inbound.text.as_str()), (CUSTOMER, "Halo"));
    assert_eq!(inbound.customer_name.as_deref(), Some("Budi"));
    assert!(adapter.answers_remotely());
}

#[test]
fn whatsapp_business_goes_online_as_a_channel_with_its_values_as_secrets() {
    let features = OnlineFeatures { whatsapp: true, ..OnlineFeatures::default() };
    assert!(features.any() && features.needs_storage(), "channel conversations outlive a restart");
    let arguments = features.deploy_arguments(None);
    assert!(arguments.windows(2).any(|pair| pair == ["--channel", "whatsapp"]), "{arguments:?}");
    assert!(!arguments.contains(&"--drop-store".to_owned()));

    let instructions = own_server_instructions("toko-kue", &features, &[], None);
    assert!(instructions.command.contains("--channel whatsapp=toko-kue"), "{}", instructions.command);
    for name in ["WHATSAPP_ACCESS_TOKEN", "WHATSAPP_PHONE_NUMBER_ID", "WHATSAPP_APP_SECRET", "WHATSAPP_VERIFY_TOKEN"] {
        assert!(instructions.command.contains(&format!("-e {name}=<from the WhatsApp step>")), "{name}");
    }
    assert_eq!(
        instructions.whatsapp_webhook.as_deref(),
        Some("https://<the address of this server>/v1/channels/whatsapp/webhook")
    );
}
