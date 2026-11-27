//! Telegram against a fake Bot API: messages in, bot replies and take-over replies out,
//! redeliveries, a restart in the middle of a poll, long replies, files and buttons, and
//! the failures the connect step names.

use std::sync::{Arc, Mutex};
use std::time::Duration;

use graphrt_llm::mock::MockModel;
use serde_json::{json, Value as Json};

use super::super::fake_http::{eventually, FakeRequest, FakeResponse, FakeServer};
use super::super::telegram::{backoff_after, TelegramService, TelegramState, CURSOR_SETTING_KEY, TELEGRAM_CHANNEL};
use super::{Base, FILES_AND_CHART_FLOW, REPLY_FLOW};
use crate::conversations::inbound::CHANNEL_MESSAGE_ID_KEY;
use crate::conversations::models::{ConversationStatus, MessageAuthor, NewConversation};
use crate::conversations::ConversationManager;
use crate::error::AppError;

const TOKEN: &str = "123456:ABCdefGhIJKlmnoPQR";
const CHAT: i64 = 777;

#[derive(Debug, Default)]
struct BotApi {
    /// Updates Telegram still holds (an update below the asked offset is confirmed and dropped).
    updates: Vec<Json>,
    /// Chats whose customer blocked the bot.
    blocked: Vec<String>,
    /// How many `getUpdates` calls fail (Telegram unreachable) before they work again.
    failing_polls: u32,
    /// The file a customer sent.
    file: Vec<u8>,
    next_message_id: i64,
}

struct FakeTelegram {
    server: FakeServer,
    api: Arc<Mutex<BotApi>>,
}

fn ok(result: Json) -> FakeResponse {
    FakeResponse::json(200, &json!({ "ok": true, "result": result }))
}

fn refused(status: u16, description: &str) -> FakeResponse {
    FakeResponse::json(status, &json!({ "ok": false, "error_code": status, "description": description }))
}

fn answer(api: &Mutex<BotApi>, request: &FakeRequest) -> FakeResponse {
    let mut api = api.lock().unwrap();
    if let Some(rest) = request.path.strip_prefix("/file/bot") {
        return match rest.split_once('/') {
            Some((token, _)) if token == TOKEN => FakeResponse::bytes(200, "text/plain", api.file.clone()),
            _ => refused(401, "Unauthorized"),
        };
    }
    let Some((token, method)) = request.path.strip_prefix("/bot").and_then(|rest| rest.split_once('/')) else {
        return refused(404, "Not Found");
    };
    if token != TOKEN {
        return refused(401, "Unauthorized");
    }
    let body = request.json();
    api.next_message_id += 1;
    let message_id = api.next_message_id;
    match method {
        "getMe" => ok(json!({ "id": 4242, "is_bot": true, "first_name": "Toko Kue Bot", "username": "toko_kue_bot" })),
        "getWebhookInfo" => ok(json!({ "url": "" })),
        "deleteWebhook" | "sendChatAction" | "answerCallbackQuery" => ok(json!(true)),
        "getUpdates" => {
            if api.failing_polls > 0 {
                api.failing_polls -= 1;
                return refused(502, "Bad Gateway");
            }
            let offset = body["offset"].as_i64().unwrap_or(0);
            api.updates.retain(|update| update["update_id"].as_i64().unwrap_or(0) >= offset);
            if api.updates.is_empty() {
                // A long poll with nothing new: answer after a short wait.
                ok(json!([])).after(Duration::from_millis(150))
            } else {
                ok(json!(api.updates.clone()))
            }
        }
        "sendMessage" => {
            let chat = body["chat_id"].as_str().map(str::to_owned).unwrap_or_else(|| body["chat_id"].to_string());
            if api.blocked.contains(&chat) {
                return refused(403, "Forbidden: bot was blocked by the user");
            }
            ok(json!({ "message_id": message_id }))
        }
        "sendPhoto" | "sendDocument" => ok(json!({ "message_id": message_id })),
        "getFile" => {
            ok(json!({ "file_id": body["file_id"], "file_path": "documents/menu.txt", "file_size": api.file.len() }))
        }
        _ => refused(404, "Not Found: method not found"),
    }
}

impl FakeTelegram {
    async fn start() -> Self {
        let api: Arc<Mutex<BotApi>> = Arc::default();
        let handler_api = api.clone();
        let server = FakeServer::start(move |request| answer(&handler_api, request)).await;
        Self { server, api }
    }

    fn push(&self, update: Json) {
        self.api.lock().unwrap().updates.push(update);
    }

    /// The texts sent to `chat` with `sendMessage`, in order.
    fn sent_texts(&self) -> Vec<String> {
        self.server
            .requests_to("/sendMessage")
            .iter()
            .filter(|request| request.json()["chat_id"].as_str() == Some(&CHAT.to_string()))
            .map(|request| request.json()["text"].as_str().unwrap_or_default().to_owned())
            .collect()
    }

    /// The `offset` of every `getUpdates`, in order.
    fn offsets(&self) -> Vec<Option<i64>> {
        self.server.requests_to("/getUpdates").iter().map(|request| request.json()["offset"].as_i64()).collect()
    }
}

fn text_update(update_id: i64, message_id: i64, text: &str) -> Json {
    json!({
        "update_id": update_id,
        "message": {
            "message_id": message_id, "date": 1_700_000_000, "text": text,
            "chat": { "id": CHAT, "type": "private" },
            "from": { "id": CHAT, "is_bot": false, "first_name": "Sari" },
        },
    })
}

struct Rig {
    base: Base,
    fake: FakeTelegram,
    telegram: Arc<TelegramService>,
    manager: Arc<ConversationManager>,
}

impl Rig {
    async fn start(flow_yaml: &str) -> Self {
        let base = Base::new(flow_yaml);
        let fake = FakeTelegram::start().await;
        let (telegram, manager) = Self::app(&base, &fake);
        telegram.connect(&base.agent.id, TOKEN).await.unwrap();
        Self { base, fake, telegram, manager }
    }

    /// The app's channel side, as `lib.rs` wires it.
    fn app(base: &Base, fake: &FakeTelegram) -> (Arc<TelegramService>, Arc<ConversationManager>) {
        let telegram = Arc::new(
            TelegramService::new(base.db.clone(), base.credentials.clone())
                .unwrap()
                .with_api_base(&fake.server.base_url),
        );
        let manager = base.manager(vec![telegram.adapter()]);
        telegram.attach(&manager);
        (telegram, manager)
    }

    fn cursor(&self) -> Option<i64> {
        self.base
            .db
            .get_agent_setting(&self.base.agent.id, CURSOR_SETTING_KEY)
            .unwrap()
            .and_then(|value| value.as_i64())
    }

    fn messages(&self) -> Vec<(MessageAuthor, String)> {
        let chat = self.base.only_chat(&self.manager, TELEGRAM_CHANNEL);
        chat.messages.iter().map(|message| (message.author, message.text.clone())).collect()
    }
}

impl Drop for Rig {
    fn drop(&mut self) {
        self.telegram.stop_all();
    }
}

#[tokio::test]
async fn a_customer_message_gets_the_bots_reply_and_the_owners_take_over_reply_goes_out() {
    let rig = Rig::start(REPLY_FLOW).await;
    let connection = rig.telegram.connection(&rig.base.agent.id).unwrap();
    assert_eq!(connection.bot.username.as_deref(), Some("toko_kue_bot"));
    assert_eq!(connection.link.as_deref(), Some("https://t.me/toko_kue_bot"));
    assert!(rig.manager.is_channel_connected_for(TELEGRAM_CHANNEL, &rig.base.agent.id));
    assert_eq!(rig.manager.channel_account(TELEGRAM_CHANNEL, &rig.base.agent.id).as_deref(), Some("@toko_kue_bot"));
    // The token is in the credential store, never in SQLite.
    let stored = rig.base.db.get_agent_setting(&rig.base.agent.id, "telegram_bot").unwrap().unwrap().to_string();
    assert!(!stored.contains(TOKEN) && !stored.contains("ABCdef"), "{stored}");

    rig.base.model.push(MockModel::text("Halo Sari! Kue cokelat masih ada."));
    rig.fake.push(text_update(100, 1, "Masih ada kue cokelat?"));
    assert!(eventually(10, || rig.fake.sent_texts().iter().any(|text| text.contains("Kue cokelat masih ada"))).await);
    assert_eq!(rig.cursor(), Some(100));
    assert!(eventually(5, || rig.fake.offsets().contains(&Some(101))).await, "the next poll confirms update 100");
    assert!(!rig.fake.server.requests_to("/sendChatAction").is_empty(), "the customer saw the bot typing");

    // A reply is sent, then stored.
    assert!(eventually(5, || rig.messages().len() == 2).await);
    let chat = rig.base.only_chat(&rig.manager, TELEGRAM_CHANNEL);
    assert_eq!(chat.conversation.customer_handle, CHAT.to_string());
    assert_eq!(chat.conversation.customer_name, "Sari");
    assert_eq!(
        rig.messages(),
        [
            (MessageAuthor::Customer, "Masih ada kue cokelat?".to_owned()),
            (MessageAuthor::Bot, "Halo Sari! Kue cokelat masih ada.".to_owned()),
        ]
    );

    rig.manager.send_operator_reply(&chat.conversation.id, "Saya pemiliknya, mau pesan berapa?").await.unwrap();
    assert!(rig.fake.sent_texts().iter().any(|text| text.contains("Saya pemiliknya")));
    let chat = rig.base.only_chat(&rig.manager, TELEGRAM_CHANNEL);
    assert_eq!(chat.conversation.status, ConversationStatus::YouReplying);

    // While the owner replies, a customer message waits for the owner: the bot stays quiet.
    let replies_before = rig.fake.sent_texts().len();
    rig.fake.push(text_update(101, 2, "Dua kotak"));
    assert!(eventually(10, || rig.cursor() == Some(101)).await);
    tokio::time::sleep(Duration::from_millis(300)).await;
    assert_eq!(rig.fake.sent_texts().len(), replies_before);
    assert_eq!(rig.messages().last().map(|(author, _)| *author), Some(MessageAuthor::Customer));
}

#[tokio::test]
async fn a_redelivered_update_or_message_is_stored_and_answered_once() {
    let rig = Rig::start(REPLY_FLOW).await;
    rig.base.model.push(MockModel::text("Siap."));
    rig.fake.push(text_update(200, 5, "Pesan satu"));
    assert!(eventually(10, || rig.fake.sent_texts().len() == 1).await);

    // Telegram sends the same update again, and the same message under a new update id
    // (what happens when a confirmation was lost).
    rig.fake.push(text_update(200, 5, "Pesan satu"));
    rig.fake.push(text_update(201, 5, "Pesan satu"));
    assert!(eventually(10, || rig.cursor() == Some(201)).await);
    tokio::time::sleep(Duration::from_millis(300)).await;
    assert_eq!(rig.fake.sent_texts().len(), 1, "answered once");
    assert_eq!(rig.messages().iter().filter(|(author, _)| *author == MessageAuthor::Customer).count(), 1);
}

#[tokio::test]
async fn a_restart_in_the_middle_of_a_poll_loses_and_repeats_nothing() {
    let rig = Rig::start(REPLY_FLOW).await;
    rig.base.model.push(MockModel::text("Jawaban pertama"));
    rig.fake.push(text_update(300, 10, "Pertama"));
    assert!(eventually(10, || rig.fake.sent_texts().len() == 1).await);
    // The app stops while a long poll is open.
    assert!(eventually(5, || rig.fake.offsets().contains(&Some(301))).await);
    rig.telegram.stop_all();

    // While it is closed, a customer writes. Another customer's message was stored before the
    // stop and never answered (the app stopped right after storing it).
    rig.fake.push(text_update(301, 11, "Kedua"));
    let other = rig
        .base
        .db
        .insert_conversation(&NewConversation {
            agent_id: rig.base.agent.id.clone(),
            channel: TELEGRAM_CHANNEL.into(),
            customer_name: "Budi".into(),
            customer_handle: "888".into(),
            origin: None,
        })
        .unwrap();
    rig.base
        .db
        .insert_conversation_message(
            &other.id,
            MessageAuthor::Customer,
            "Masih buka?",
            &json!({ CHANNEL_MESSAGE_ID_KEY: "9" }),
        )
        .unwrap();

    // The app starts again: same storage and credential store, a new process. As in
    // `lib.rs`: the saved bots start, then the unanswered messages are answered.
    let (telegram, manager) = Rig::app(&rig.base, &rig.fake);
    rig.base.model.push(MockModel::text("Masih buka sampai jam 9"));
    rig.base.model.push(MockModel::text("Jawaban kedua"));
    telegram.start_saved();
    assert_eq!(manager.answer_unanswered_channel_messages().await.unwrap(), 1);
    let all_texts = || -> Vec<String> {
        rig.fake
            .server
            .requests_to("/sendMessage")
            .iter()
            .map(|r| r.json()["text"].as_str().unwrap_or_default().to_owned())
            .collect()
    };
    assert!(eventually(10, || all_texts().len() == 3).await, "{:?}", all_texts());
    telegram.stop_all();

    // Each reply went to its own customer, whichever the model wrote first.
    assert_eq!(rig.fake.sent_texts().len(), 2, "{:?}", rig.fake.sent_texts());
    let to_other: Vec<FakeRequest> =
        rig.fake.server.requests_to("/sendMessage").into_iter().filter(|r| r.json()["chat_id"] == "888").collect();
    assert_eq!(to_other.len(), 1);
    let texts = all_texts();
    assert!(texts.iter().any(|text| text.contains("Masih buka sampai jam 9")), "{texts:?}");
    assert!(texts.iter().any(|text| text.contains("Jawaban kedua")), "{texts:?}");
    let restarted_offsets: Vec<Option<i64>> = rig.fake.offsets();
    assert!(restarted_offsets.iter().all(|offset| offset.is_none_or(|offset| offset >= 301)), "{restarted_offsets:?}");
    assert_eq!(rig.cursor(), Some(301));
    let first =
        rig.base.db.find_open_conversation(&rig.base.agent.id, TELEGRAM_CHANNEL, &CHAT.to_string()).unwrap().unwrap();
    let messages = rig.base.db.list_conversation_messages(&first.id).unwrap();
    let customers = messages.iter().filter(|message| message.author == MessageAuthor::Customer).count();
    assert_eq!(customers, 2, "Pertama and Kedua, each once");
}

#[tokio::test]
async fn a_long_reply_goes_out_in_parts_within_telegrams_limit() {
    let rig = Rig::start(REPLY_FLOW).await;
    let paragraph = "Kue lapis legit kami dibuat dengan resep keluarga. ".repeat(20);
    let long_reply = std::iter::repeat_n(paragraph.trim(), 9).collect::<Vec<_>>().join("\n\n");
    assert!(long_reply.chars().count() > 9000);
    rig.base.model.push(MockModel::text(&long_reply));
    rig.fake.push(text_update(400, 20, "Ceritakan kue lapis"));
    assert!(eventually(10, || rig.fake.sent_texts().len() >= 3).await, "{:?}", rig.fake.sent_texts().len());
    for part in rig.fake.sent_texts() {
        assert!(part.encode_utf16().count() <= 4096, "a part of {} units", part.encode_utf16().count());
    }
    // The Inbox keeps the reply whole.
    assert!(eventually(5, || rig.messages().len() == 2).await);
    assert_eq!(rig.messages()[1].1.trim(), long_reply.trim());
}

#[tokio::test]
async fn a_customer_file_comes_in_and_a_chart_buttons_and_the_owners_file_go_out() {
    let rig = Rig::start(FILES_AND_CHART_FLOW).await;
    rig.fake.api.lock().unwrap().file = b"Menu: lapis legit 250000, brownies 90000".to_vec();
    rig.base.model.push(MockModel::text("Menu Anda sudah saya baca."));
    rig.fake.push(json!({
        "update_id": 500,
        "message": {
            "message_id": 30, "date": 1_700_000_000, "caption": "Ini menu saya",
            "document": { "file_id": "doc-1", "file_name": "menu.txt", "mime_type": "text/plain", "file_size": 40 },
            "chat": { "id": CHAT, "type": "private" },
            "from": { "id": CHAT, "is_bot": false, "first_name": "Sari" },
        },
    }));
    assert!(eventually(10, || rig.fake.sent_texts().iter().any(|text| text.contains("sudah saya baca"))).await);

    let chat = rig.base.only_chat(&rig.manager, TELEGRAM_CHANNEL);
    let customer = &chat.messages[0];
    assert_eq!(customer.text, "Ini menu saya");
    assert_eq!(customer.metadata["attachments"][0]["name"], "menu.txt", "{}", customer.metadata);
    assert!(!rig.fake.server.requests_to("/getFile").is_empty());
    let model_saw =
        rig.base.model.requests().last().map(|request| format!("{:?}", request.messages)).unwrap_or_default();
    assert!(model_saw.contains("uploads/menu.txt"), "the bot was told where the file is");

    // The chart went out as a picture, and the card's choices as buttons under the text.
    assert_eq!(rig.fake.server.requests_to("/sendPhoto").len(), 1);
    let with_buttons = rig.fake.server.requests_to("/sendMessage").into_iter().last().unwrap().json();
    let buttons = with_buttons["reply_markup"]["inline_keyboard"].to_string();
    assert!(buttons.contains("Yes, today") && buttons.contains("Later"), "{with_buttons}");

    // The customer taps "Later": it reads as that card button.
    rig.base.model.push(MockModel::text("Baik, nanti saja."));
    rig.fake.push(json!({
        "update_id": 501,
        "callback_query": {
            "id": "cb-1", "data": "2",
            "from": { "id": CHAT, "is_bot": false, "first_name": "Sari" },
            "message": { "message_id": 31, "chat": { "id": CHAT, "type": "private" } },
        },
    }));
    assert!(eventually(10, || rig.fake.sent_texts().iter().any(|text| text.contains("nanti saja"))).await);
    assert!(eventually(5, || rig.messages().last().is_some_and(|(_, text)| text.contains("nanti saja"))).await);
    let chat = rig.base.only_chat(&rig.manager, TELEGRAM_CHANNEL);
    let tap = chat.messages.iter().rfind(|message| message.author == MessageAuthor::Customer).unwrap();
    assert_eq!(tap.metadata["cardAction"]["title"], "Later", "{}", tap.metadata);
    assert!(!rig.fake.server.requests_to("/answerCallbackQuery").is_empty(), "the button stopped spinning");

    // The owner sends a file.
    let file = rig.base._home.path().join("price-list.txt");
    std::fs::write(&file, "Harga terbaru").unwrap();
    let scope = crate::agent_files::FileScope::conversation(&rig.base.agent.id, &chat.conversation.id);
    let outcomes = rig
        .base
        .agent_files
        .attach_host_files(
            &scope,
            crate::agent_files::FileAbilities { reads_files: true, sees_pictures: true, makes_files: false },
            vec![file],
            crate::agent_files::PathOrigin::PickedInDialog,
            0,
        )
        .await
        .unwrap();
    let reference = outcomes[0].card.as_ref().unwrap().reference.clone();
    rig.manager.send_operator_reply_with_files(&chat.conversation.id, "Daftar harga", &[reference]).await.unwrap();
    let documents = rig.fake.server.requests_to("/sendDocument");
    assert_eq!(documents.len(), 1);
    assert!(documents[0].body_text().contains("price-list.txt") && documents[0].body_text().contains("Harga terbaru"));
}

#[tokio::test]
async fn a_wrong_token_a_blocked_customer_and_a_lost_connection_are_told_plainly() {
    let base = Base::new(REPLY_FLOW);
    let fake = FakeTelegram::start().await;
    let (telegram, manager) = Rig::app(&base, &fake);
    let refused = telegram.check_token("999999:WrongTokenValue").await.unwrap_err();
    assert!(matches!(&refused, AppError::InvalidInput(text) if text.contains("does not know this token")), "{refused}");
    let not_a_token = telegram.check_token("hello world").await.unwrap_err();
    assert!(not_a_token.to_string().contains("not a Telegram bot token"), "{not_a_token}");
    let checked = telegram.check_token(&format!("  {TOKEN} ")).await.unwrap();
    assert_eq!(checked.bot.name.as_deref(), Some("Toko Kue Bot"));

    // Telegram cannot be reached for one poll: the bot says "offline", then picks up again.
    fake.api.lock().unwrap().failing_polls = 1;
    telegram.connect(&base.agent.id, TOKEN).await.unwrap();
    let state = || telegram.connection(&base.agent.id).map(|connection| connection.state);
    assert!(eventually(5, || state() == Some(TelegramState::Offline)).await, "{:?}", state());
    assert!(eventually(10, || state() == Some(TelegramState::Connected)).await, "{:?}", state());

    // The customer blocked the bot: the owner's reply is kept with the reason.
    fake.api.lock().unwrap().blocked.push(CHAT.to_string());
    let conversation = base
        .db
        .insert_conversation(&NewConversation {
            agent_id: base.agent.id.clone(),
            channel: TELEGRAM_CHANNEL.into(),
            customer_name: "Sari".into(),
            customer_handle: CHAT.to_string(),
            origin: None,
        })
        .unwrap();
    let reply = manager.send_operator_reply(&conversation.id, "Halo?").await.unwrap();
    assert_eq!(reply.metadata["deliveryProblem"], "blocked", "{}", reply.metadata);
    telegram.stop_all();

    // A token revoked in @BotFather: polling stops and says so.
    let other = FakeTelegram::start().await;
    let revoked = Arc::new(
        TelegramService::new(base.db.clone(), base.credentials.clone()).unwrap().with_api_base(&other.server.base_url),
    );
    let manager = base.manager(vec![revoked.adapter()]);
    revoked.attach(&manager);
    base.credentials.set_channel_secret(&format!("telegram:{}", base.agent.id), "123456:RevokedTokenValue").unwrap();
    revoked.start_saved();
    assert!(
        eventually(5, || revoked.connection(&base.agent.id).map(|c| c.state) == Some(TelegramState::TokenWrong)).await
    );
    revoked.stop_all();
}

#[tokio::test]
async fn a_bot_connected_to_one_chatbot_is_refused_for_another_and_switching_off_holds_messages() {
    let rig = Rig::start(REPLY_FLOW).await;
    let second = rig
        .base
        .db
        .create_agent(crate::storage::models::NewAgent {
            name: "Toko Roti".into(),
            kind: crate::storage::models::AgentKind::Chatbot,
            description: String::new(),
            flow_yaml: REPLY_FLOW.into(),
        })
        .unwrap();
    let refused = rig.telegram.connect(&second.id, TOKEN).await.unwrap_err();
    assert!(refused.to_string().contains("already answers for Toko Kue"), "{refused}");

    // The owner switches Telegram off for the chatbot: no update is taken from Telegram.
    let mut settings =
        crate::chatbot_setup::get_chatbot_setup(&rig.base.db, &rig.base.agent.id, &|_| true.into()).unwrap().settings;
    settings.disabled_channels = vec![TELEGRAM_CHANNEL.into()];
    crate::chatbot_setup::save_chatbot_settings(&rig.base.db, &rig.base.agent.id, settings, &|_| true.into()).unwrap();
    let polls = rig.fake.offsets().len();
    assert!(
        eventually(12, || rig.telegram.connection(&rig.base.agent.id).map(|c| c.state)
            == Some(TelegramState::SwitchedOff))
        .await
    );
    rig.fake.push(text_update(600, 40, "Halo"));
    tokio::time::sleep(Duration::from_millis(500)).await;
    assert!(rig.fake.offsets().len() <= polls + 1, "at most the poll that was open");
    assert_eq!(rig.base.chats(&rig.manager, TELEGRAM_CHANNEL), 0);

    rig.telegram.disconnect(&rig.base.agent.id).unwrap();
    assert!(rig.telegram.connection(&rig.base.agent.id).is_none());
    assert!(rig.base.credentials.read_channel_secret(&format!("telegram:{}", rig.base.agent.id)).unwrap().is_none());
}

#[test]
fn the_backoff_doubles_up_to_a_minute() {
    assert_eq!(backoff_after(1), Duration::from_secs(2));
    assert_eq!(backoff_after(2), Duration::from_secs(4));
    assert_eq!(backoff_after(5), Duration::from_secs(32));
    assert_eq!(backoff_after(40), Duration::from_secs(60));
}
