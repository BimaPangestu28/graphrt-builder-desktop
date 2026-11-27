//! Microsoft Teams of an online chatbot against a fake online copy (`graphrt serve
//! --channel teams`) and a fake Microsoft login server: chats shown in the Inbox once,
//! take-over and replies sent through the online copy, the setup step, going online.

use std::sync::{Arc, Mutex};

use serde_json::{json, Value as Json};

use super::super::fake_http::{eventually, FakeRequest, FakeResponse, FakeServer};
use super::super::teams_online::{deploy_secrets, TeamsBotInput, TeamsOnlineService, TEAMS_CHANNEL};
use super::super::whatsapp_online::OnlineChatbots;
use super::{Base, REPLY_FLOW};
use crate::conversations::models::{ConversationStatus, MessageAuthor};
use crate::deploy::http::ReqwestDeployHttp;
use crate::deploy::online::{own_server_instructions, OnlineFeatures};
use crate::error::AppResult;

const API_KEY: &str = "grk_online_copy_key";
const CHAT: &str = "a:1personal-chat";
const APP_ID: &str = "00000000-1111-2222-3333-444444444444";
const TENANT: &str = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
const PASSWORD: &str = "client-secret-value";

#[derive(Debug, Default)]
struct OnlineChat {
    messages: Vec<Json>,
    updated_ms: u64,
    human: bool,
}

impl OnlineChat {
    fn summary(&self) -> Json {
        json!({
            "id": "ch-teams-a_1personal-chat", "workflow": "toko-kue", "updated_ms": self.updated_ms,
            "channel": { "name": "teams", "kind": "teams", "chat_id": CHAT, "customer_name": "Rina",
                         "human": self.human, "waiting_run": null },
        })
    }

    fn add(&mut self, role: &str, content: &str) {
        self.updated_ms += 1;
        self.messages.push(json!({ "role": role, "content": content, "created_ms": self.updated_ms }));
    }
}

fn answer_online(chat: &Mutex<OnlineChat>, request: &FakeRequest) -> FakeResponse {
    if request.header("authorization") != Some(&format!("Bearer {API_KEY}")) {
        return FakeResponse::json(401, &json!({ "error": "unauthorized" }));
    }
    let mut chat = chat.lock().unwrap();
    let whatsapp =
        json!({ "id": "ch-whatsapp-1", "updated_ms": 9_999, "channel": { "kind": "whatsapp", "chat_id": "62" } });
    match (request.method.as_str(), request.path.split('?').next().unwrap_or_default()) {
        ("GET", "/v1/conversations") => {
            FakeResponse::json(200, &json!({ "conversations": [chat.summary(), whatsapp] }))
        }
        ("GET", "/v1/conversations/ch-teams-a_1personal-chat") => {
            let mut detail = chat.summary();
            detail["messages"] = json!(chat.messages);
            FakeResponse::json(200, &detail)
        }
        ("POST", "/v1/channels/teams/handoff") => {
            chat.human = request.json()["human"].as_bool().unwrap_or(false);
            FakeResponse::bytes(204, "text/plain", Vec::new())
        }
        ("POST", "/v1/channels/teams/messages") => {
            let text = request.json()["text"].as_str().unwrap_or_default().to_owned();
            chat.add("assistant", &text);
            FakeResponse::bytes(204, "text/plain", Vec::new())
        }
        _ => FakeResponse::json(404, &json!({ "error": "not found" })),
    }
}

#[derive(Debug)]
struct OneTeamsChatbot {
    agent_id: String,
    url: String,
}

impl OnlineChatbots for OneTeamsChatbot {
    fn whatsapp_agents(&self) -> Vec<String> {
        Vec::new()
    }

    fn teams_agents(&self) -> Vec<String> {
        vec![self.agent_id.clone()]
    }

    fn access(&self, _agent_id: &str) -> AppResult<(String, String)> {
        Ok((self.url.clone(), API_KEY.to_owned()))
    }
}

async fn rig() -> (Base, Arc<Mutex<OnlineChat>>, FakeServer, Arc<TeamsOnlineService>) {
    let base = Base::new(REPLY_FLOW);
    let chat = Arc::new(Mutex::new(OnlineChat { updated_ms: 1_000, ..OnlineChat::default() }));
    {
        let mut chat = chat.lock().unwrap();
        chat.add("user", "Where is my order?");
        chat.add("assistant", "It ships today.");
    }
    let handler_chat = chat.clone();
    let online = FakeServer::start(move |request| answer_online(&handler_chat, request)).await;
    let chatbots = Arc::new(OneTeamsChatbot { agent_id: base.agent.id.clone(), url: online.base_url.clone() });
    let service = Arc::new(
        TeamsOnlineService::new(
            base.db.clone(),
            base.credentials.clone(),
            chatbots,
            Arc::new(ReqwestDeployHttp::new().unwrap()),
        )
        .unwrap(),
    );
    (base, chat, online, service)
}

#[tokio::test]
async fn the_online_chatbots_teams_chats_appear_once_and_the_owners_reply_goes_through_it() {
    let (base, chat, online, service) = rig().await;
    let manager = base.manager(vec![service.adapter()]);
    service.attach(&manager);
    assert_eq!(service.sync(&base.agent.id).await.unwrap(), 2, "only the Teams chat, not the WhatsApp one");
    assert_eq!(service.sync(&base.agent.id).await.unwrap(), 0);
    let detail = base.only_chat(&manager, TEAMS_CHANNEL);
    assert_eq!(
        (detail.conversation.customer_handle.as_str(), detail.conversation.customer_name.as_str()),
        (CHAT, "Rina")
    );
    assert!(base.model.requests().is_empty(), "the online copy answers, not the app");

    manager.take_over(&detail.conversation.id).unwrap();
    assert!(eventually(5, || chat.lock().unwrap().human).await);
    let reply = manager.send_operator_reply(&detail.conversation.id, "Let me check").await.unwrap();
    assert!(reply.metadata.get("deliveryProblem").is_none(), "{}", reply.metadata);
    assert_eq!(
        online.requests_to("/v1/channels/teams/messages")[0].json(),
        json!({ "to": CHAT, "text": "Let me check" })
    );
    service.sync(&base.agent.id).await.unwrap();
    let messages = base.only_chat(&manager, TEAMS_CHANNEL).messages;
    assert_eq!(messages.iter().filter(|message| message.text == "Let me check").count(), 1);
    assert_eq!(messages.last().map(|message| message.author), Some(MessageAuthor::Operator));
    assert_eq!(base.only_chat(&manager, TEAMS_CHANNEL).conversation.status, ConversationStatus::YouReplying);
    manager.hand_back(&detail.conversation.id).unwrap();
    assert!(eventually(5, || !chat.lock().unwrap().human).await);
}

#[tokio::test]
async fn the_setup_step_checks_the_values_with_microsoft_and_keeps_them_in_the_credential_store() {
    let (base, _chat, online, service) = rig().await;
    let login = FakeServer::start(|request| {
        let body = request.body_text();
        let right = request.path == format!("/{TENANT}/oauth2/v2.0/token")
            && body.contains(&format!("client_id={APP_ID}"))
            && body.contains("scope=https%3A%2F%2Fapi.botframework.com%2F.default");
        match (right, body.contains(&format!("client_secret={PASSWORD}"))) {
            (true, true) => FakeResponse::json(200, &json!({ "access_token": "token", "expires_in": 3599 })),
            (true, false) => FakeResponse::json(401, &json!({ "error": "invalid_client" })),
            _ => FakeResponse::json(400, &json!({ "error": "unauthorized_client" })),
        }
    })
    .await;
    let service = Arc::try_unwrap(service).unwrap().with_login_base(&login.base_url);
    let input = |app_id: &str, password: &str, tenant: &str| TeamsBotInput {
        app_id: app_id.into(),
        app_password: password.into(),
        tenant_id: tenant.into(),
    };
    let not_a_guid = service.save(&base.agent.id, &input("my-bot", PASSWORD, TENANT)).await.unwrap_err();
    assert!(not_a_guid.to_string().contains("Microsoft App ID"), "{not_a_guid}");
    let wrong_secret = service.save(&base.agent.id, &input(APP_ID, "wrong", TENANT)).await.unwrap_err();
    assert!(wrong_secret.to_string().contains("client secret"), "{wrong_secret}");
    let other_tenant = "99999999-0000-0000-0000-000000000000";
    let wrong_tenant = service.save(&base.agent.id, &input(APP_ID, PASSWORD, other_tenant)).await.unwrap_err();
    assert!(wrong_tenant.to_string().contains("tenant"), "{wrong_tenant}");
    assert!(deploy_secrets(&base.credentials, &base.agent.id).is_err(), "nothing saved after a refusal");

    service.save(&base.agent.id, &input(APP_ID, PASSWORD, TENANT)).await.unwrap();
    let names: Vec<&str> =
        deploy_secrets(&base.credentials, &base.agent.id).unwrap().iter().map(|(n, _, _)| *n).collect();
    assert_eq!(names, ["TEAMS_APP_ID", "TEAMS_APP_PASSWORD", "TEAMS_TENANT_ID"]);
    let setup = service.setup(&base.agent.id, true).unwrap();
    assert!(setup.saved && setup.online);
    assert_eq!(setup.messaging_endpoint, Some(format!("{}/v1/channels/teams/webhook", online.base_url)));
    assert!(!serde_json::to_string(&setup).unwrap().contains(PASSWORD));
    service.forget(&base.agent.id).unwrap();
    assert!(!service.setup(&base.agent.id, true).unwrap().saved);
}

#[test]
fn teams_goes_online_as_a_channel_with_its_values_as_secrets() {
    let features = OnlineFeatures { teams: true, ..OnlineFeatures::default() };
    assert!(features.any() && features.needs_storage());
    let arguments = features.deploy_arguments();
    assert!(arguments.windows(2).any(|pair| pair == ["--channel", "teams"]), "{arguments:?}");
    let both = OnlineFeatures { teams: true, whatsapp: true, ..OnlineFeatures::default() };
    let instructions = own_server_instructions("toko-kue", &both, &[]);
    assert!(
        instructions.command.contains("--channel whatsapp=toko-kue --channel teams=toko-kue"),
        "{}",
        instructions.command
    );
    for name in ["TEAMS_APP_ID", "TEAMS_APP_PASSWORD", "TEAMS_TENANT_ID"] {
        assert!(instructions.command.contains(&format!("-e {name}=<from the Teams step>")), "{name}");
    }
    assert_eq!(
        instructions.teams_endpoint.as_deref(),
        Some("https://<the address of this server>/v1/channels/teams/webhook")
    );
}
