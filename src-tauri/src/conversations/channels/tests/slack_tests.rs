//! Slack by Socket Mode against a fake Slack: the Web API on HTTP and a Socket Mode
//! WebSocket on `127.0.0.1`. A direct message and a mention get the bot's reply in the
//! right place, the owner's take-over reply goes out, tokens stay in the credential store.

use std::sync::{Arc, Mutex};

use futures::{SinkExt, StreamExt};
use graphrt_llm::mock::MockModel;
use serde_json::{json, Value as Json};
use tokio_tungstenite::tungstenite::Message;

use super::super::fake_http::{eventually, FakeRequest, FakeResponse, FakeServer};
use super::super::slack::{SlackService, SlackState, SlackTokens, APP_SETTING_KEY, SLACK_CHANNEL};
use super::{Base, REPLY_FLOW};
use crate::conversations::models::MessageAuthor;
use crate::conversations::ConversationManager;
use crate::error::AppError;

const BOT_TOKEN: &str = "xoxb-1111-2222-fakebottoken";
const APP_TOKEN: &str = "xapp-1-A111-2222-fakeapptoken";

/// A fake Slack: the Web API, and a socket that sends the queued envelopes.
struct FakeSlack {
    api: FakeServer,
    envelopes: Arc<Mutex<Vec<Json>>>,
    acks: Arc<Mutex<Vec<String>>>,
}

fn answer_api(socket_url: &str, request: &FakeRequest) -> FakeResponse {
    let method = request
        .path
        .split('?')
        .next()
        .unwrap_or_default()
        .trim_start_matches('/')
        .trim_start_matches("api/")
        .to_owned();
    let token = if method == "apps.connections.open" { APP_TOKEN } else { BOT_TOKEN };
    if request.header("authorization") != Some(&format!("Bearer {token}")) {
        return FakeResponse::json(200, &json!({ "ok": false, "error": "invalid_auth" }));
    }
    match method.as_str() {
        "auth.test" => FakeResponse::json(200, &json!({ "ok": true, "user_id": "U0BOT", "team": "Toko Kue" })),
        "apps.connections.open" => FakeResponse::json(200, &json!({ "ok": true, "url": socket_url })),
        "chat.postMessage" => FakeResponse::json(200, &json!({ "ok": true, "ts": "1700009999.000001" })),
        _ => FakeResponse::json(200, &json!({ "ok": true })),
    }
}

impl FakeSlack {
    async fn start() -> Self {
        let envelopes: Arc<Mutex<Vec<Json>>> = Arc::default();
        let acks: Arc<Mutex<Vec<String>>> = Arc::default();
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let socket_url = format!("ws://{}/link/?ticket=t", listener.local_addr().unwrap());
        let (queue, acked) = (envelopes.clone(), acks.clone());
        tokio::spawn(async move {
            while let Ok((stream, _)) = listener.accept().await {
                let (queue, acked) = (queue.clone(), acked.clone());
                tokio::spawn(async move {
                    let Ok(socket) = tokio_tungstenite::accept_async(stream).await else { return };
                    let (mut sink, mut source) = socket.split();
                    let hello = json!({ "type": "hello" }).to_string();
                    if sink.send(Message::Text(hello.into())).await.is_err() {
                        return;
                    }
                    let reader = tokio::spawn(async move {
                        while let Some(Ok(Message::Text(text))) = source.next().await {
                            let ack: Json = serde_json::from_str(text.as_str()).unwrap_or(Json::Null);
                            if let Some(id) = ack["envelope_id"].as_str() {
                                acked.lock().unwrap().push(id.to_owned());
                            }
                        }
                    });
                    while !reader.is_finished() {
                        let next = {
                            let mut queued = queue.lock().unwrap();
                            (!queued.is_empty()).then(|| queued.remove(0))
                        };
                        match next {
                            Some(envelope) => {
                                if sink.send(Message::Text(envelope.to_string().into())).await.is_err() {
                                    return;
                                }
                            }
                            None => tokio::time::sleep(std::time::Duration::from_millis(10)).await,
                        }
                    }
                });
            }
        });
        let api = FakeServer::start(move |request| answer_api(&socket_url, request)).await;
        Self { api, envelopes, acks }
    }

    fn push_event(&self, id: &str, event: Json) {
        let payload = json!({ "type": "event_callback", "team_id": "T1", "event": event });
        self.envelopes.lock().unwrap().push(json!({ "envelope_id": id, "type": "events_api", "payload": payload }));
    }

    /// The `chat.postMessage` calls, as `(channel, thread_ts, text)`.
    fn posts(&self) -> Vec<(String, Option<String>, String)> {
        self.api
            .requests_to("/chat.postMessage")
            .iter()
            .map(|request| {
                let body = request.json();
                (
                    body["channel"].as_str().unwrap_or_default().to_owned(),
                    body["thread_ts"].as_str().map(str::to_owned),
                    body["text"].as_str().unwrap_or_default().to_owned(),
                )
            })
            .collect()
    }
}

fn tokens() -> SlackTokens {
    SlackTokens { bot_token: BOT_TOKEN.into(), app_token: APP_TOKEN.into() }
}

fn app(base: &Base, fake: &FakeSlack) -> (Arc<SlackService>, Arc<ConversationManager>) {
    let slack = Arc::new(
        SlackService::new(base.db.clone(), base.credentials.clone()).unwrap().with_api_base(&fake.api.base_url),
    );
    let manager = base.manager(vec![slack.adapter()]);
    slack.attach(&manager);
    (slack, manager)
}

#[tokio::test]
async fn a_direct_message_and_a_mention_get_the_bots_reply_in_their_place() {
    let base = Base::new(REPLY_FLOW);
    let fake = FakeSlack::start().await;
    let (slack, manager) = app(&base, &fake);
    let connection = slack.connect(&base.agent.id, &tokens()).await.unwrap();
    assert_eq!((connection.app.bot_user_id.as_str(), connection.app.team.as_deref()), ("U0BOT", Some("Toko Kue")));
    assert!(
        eventually(5, || slack.connection(&base.agent.id).is_some_and(|c| c.state == SlackState::Connected)).await,
        "the socket is open"
    );
    // The tokens are in the credential store, never in SQLite.
    let stored = base.db.get_agent_setting(&base.agent.id, APP_SETTING_KEY).unwrap().unwrap().to_string();
    assert!(!stored.contains("xoxb") && !stored.contains("xapp"), "{stored}");
    assert_eq!(
        base.credentials.read_channel_secret(&format!("slack:{}:bot", base.agent.id)).unwrap().as_deref(),
        Some(BOT_TOKEN)
    );

    base.model.push(MockModel::text("Halo! Kue cokelat masih ada."));
    fake.push_event(
        "e1",
        json!({ "type": "message", "channel": "D1", "channel_type": "im", "user": "U7", "text": "Kue cokelat ada?",
                "ts": "1700000000.000100" }),
    );
    assert!(eventually(10, || !fake.posts().is_empty()).await, "the reply went out");
    assert_eq!(fake.posts()[0], ("D1".to_owned(), None, "Halo! Kue cokelat masih ada.".to_owned()));
    assert!(fake.acks.lock().unwrap().contains(&"e1".to_owned()));
    let chat = base.only_chat(&manager, SLACK_CHANNEL);
    let texts: Vec<(MessageAuthor, String)> = chat.messages.iter().map(|m| (m.author, m.text.clone())).collect();
    assert_eq!(texts[0], (MessageAuthor::Customer, "Kue cokelat ada?".to_owned()));

    // The owner takes over and writes: it goes to the same DM.
    manager.take_over(&chat.conversation.id).unwrap();
    manager.send_operator_reply(&chat.conversation.id, "Saya pemilik toko").await.unwrap();
    assert!(eventually(5, || fake.posts().iter().any(|(_, _, text)| text == "Saya pemilik toko")).await);

    // A mention in a channel is answered in its thread, a conversation of its own.
    base.model.push(MockModel::text("Buka sampai jam 9."));
    fake.push_event(
        "e2",
        json!({ "type": "app_mention", "channel": "C1", "user": "U8", "text": "<@U0BOT> buka sampai jam berapa?",
                "ts": "1700000100.000100" }),
    );
    assert!(eventually(10, || fake.posts().iter().any(|(channel, _, _)| channel == "C1")).await);
    let thread = fake.posts().into_iter().find(|(channel, _, _)| channel == "C1").unwrap();
    assert_eq!(thread, ("C1".to_owned(), Some("1700000100.000100".to_owned()), "Buka sampai jam 9.".to_owned()));
    assert_eq!(base.chats(&manager, SLACK_CHANNEL), 2);
    slack.stop_all();
}

#[tokio::test]
async fn wrong_tokens_are_said_in_plain_words_and_nothing_is_saved() {
    let base = Base::new(REPLY_FLOW);
    let fake = FakeSlack::start().await;
    let (slack, _manager) = app(&base, &fake);
    let not_a_token = SlackTokens { bot_token: "hello".into(), app_token: APP_TOKEN.into() };
    let refused = slack.check(&not_a_token).await.unwrap_err();
    assert!(matches!(&refused, AppError::InvalidInput(text) if text.contains("xoxb-")), "{refused:?}");
    let wrong_app = SlackTokens { bot_token: BOT_TOKEN.into(), app_token: "xapp-1-A111-2222-wrongtoken".into() };
    let refused = slack.connect(&base.agent.id, &wrong_app).await.unwrap_err();
    assert!(matches!(&refused, AppError::InvalidInput(text) if text.contains("app token")), "{refused:?}");
    assert!(base.credentials.read_channel_secret(&format!("slack:{}:bot", base.agent.id)).unwrap().is_none());
    assert!(slack.connection(&base.agent.id).is_none());

    slack.connect(&base.agent.id, &tokens()).await.unwrap();
    slack.disconnect(&base.agent.id).unwrap();
    assert!(slack.connection(&base.agent.id).is_none());
    assert!(base.credentials.read_channel_secret(&format!("slack:{}:app", base.agent.id)).unwrap().is_none());
}
