//! The personal WhatsApp (the `whatsapp-web` plugin, scripted here) as a chatbot channel:
//! only new customer messages are taken, each once, groups are left alone, and the
//! plugin's sending limit shows as a delivery problem.

use std::sync::{Arc, Mutex};

use futures::future::BoxFuture;
use graphrt_llm::mock::MockModel;
use serde_json::{json, Map, Value as Json};

use super::super::whatsapp_web::{PluginSteps, WhatsAppWebService, WhatsAppWebState, WHATSAPP_WEB_CHANNEL};
use super::{Base, REPLY_FLOW};
use crate::conversations::models::MessageAuthor;
use crate::error::{AppError, AppResult};

#[derive(Debug, Default)]
struct ScriptedPlugin {
    chats: Mutex<Json>,
    messages: Mutex<Json>,
    sent: Mutex<Vec<Json>>,
    /// The daily sending cap is reached.
    capped: Mutex<bool>,
    linked: Mutex<bool>,
}

impl PluginSteps for ScriptedPlugin {
    fn run<'a>(&'a self, plugin: &'a str, kind: &'a str, config: Json) -> BoxFuture<'a, AppResult<Map<String, Json>>> {
        Box::pin(async move {
            assert_eq!(plugin, "whatsapp-web");
            if !*self.linked.lock().unwrap() {
                return Err(AppError::Workflow("needs_login: scan the QR code".into()));
            }
            let data = match kind {
                "whatsapp-web.list_chats" => self.chats.lock().unwrap().clone(),
                "whatsapp-web.read_messages" => self.messages.lock().unwrap().clone(),
                "whatsapp-web.send_message" => {
                    if *self.capped.lock().unwrap() {
                        return Err(AppError::Workflow("rate_limited: the daily send limit (50) is reached".into()));
                    }
                    self.sent.lock().unwrap().push(config);
                    json!({ "sent": true })
                }
                other => panic!("unexpected step {other}"),
            };
            let mut outputs = Map::new();
            outputs.insert("data".into(), data);
            Ok(outputs)
        })
    }
}

fn message(id: &str, from_me: bool, chat_id: &str, text: &str) -> Json {
    json!({ "id": id, "from_me": from_me, "sender": null, "time": "10:00", "text": text, "status": null, "chat_id": chat_id })
}

#[tokio::test]
async fn new_customer_messages_are_answered_once_from_the_personal_number() {
    let base = Base::new(REPLY_FLOW);
    let plugin = Arc::new(ScriptedPlugin::default());
    *plugin.linked.lock().unwrap() = true;
    let service = Arc::new(WhatsAppWebService::new(base.db.clone(), plugin.clone()));
    let manager = base.manager(vec![service.adapter()]);
    service.attach(&manager);

    assert_eq!(service.poll_once().await.unwrap(), 0, "no chatbot answers the number yet");
    assert_eq!(service.channel().state, WhatsAppWebState::Off);
    service.assign(Some(&base.agent.id)).unwrap();

    *plugin.chats.lock().unwrap() = json!([{ "name": "Budi", "unread_count": 2, "last_message": "Dua kotak" }]);
    *plugin.messages.lock().unwrap() = json!([
        message("m1", false, "6281234@c.us", "Pesan lama yang sudah dibaca"),
        message("m2", true, "6281234@c.us", "Balasan saya kemarin"),
        message("m3", false, "6281234@c.us", "Halo, masih buka?"),
        message("m4", false, "6281234@c.us", "Dua kotak"),
    ]);
    base.model.push(MockModel::text("Masih buka, Kak."));
    base.model.push(MockModel::text("Siap, dua kotak."));
    assert_eq!(service.poll_once().await.unwrap(), 2);
    assert_eq!(service.channel().state, WhatsAppWebState::Connected);

    let sent = plugin.sent.lock().unwrap().clone();
    assert_eq!(
        sent,
        [
            json!({ "phone": "+6281234", "text": "Masih buka, Kak." }),
            json!({ "phone": "+6281234", "text": "Siap, dua kotak." })
        ]
    );
    let chat = base.only_chat(&manager, WHATSAPP_WEB_CHANNEL);
    let customer: Vec<&str> =
        chat.messages.iter().filter(|m| m.author == MessageAuthor::Customer).map(|m| m.text.as_str()).collect();
    assert_eq!(customer, ["Halo, masih buka?", "Dua kotak"], "the old message is not taken");

    // The same chat listed again (the phone did not mark it read in time): nothing twice.
    assert_eq!(service.poll_once().await.unwrap(), 0);
    assert_eq!(plugin.sent.lock().unwrap().len(), 2);

    // A group chat is left alone.
    *plugin.chats.lock().unwrap() = json!([{ "name": "Arisan", "unread_count": 1 }]);
    *plugin.messages.lock().unwrap() = json!([message("g1", false, "1203630@g.us", "Halo semua")]);
    assert_eq!(service.poll_once().await.unwrap(), 0);
    assert_eq!(base.chats(&manager, WHATSAPP_WEB_CHANNEL), 1);
}

#[tokio::test]
async fn the_plugins_sending_cap_and_a_lost_link_are_told_plainly() {
    let base = Base::new(REPLY_FLOW);
    let plugin = Arc::new(ScriptedPlugin::default());
    let service = Arc::new(WhatsAppWebService::new(base.db.clone(), plugin.clone()));
    let manager = base.manager(vec![service.adapter()]);
    service.attach(&manager);
    service.assign(Some(&base.agent.id)).unwrap();

    assert!(service.poll_once().await.is_err());
    assert_eq!(service.channel().state, WhatsAppWebState::NotLinked);

    *plugin.linked.lock().unwrap() = true;
    *plugin.capped.lock().unwrap() = true;
    *plugin.chats.lock().unwrap() = json!([{ "name": "Sari", "unread_count": 1 }]);
    *plugin.messages.lock().unwrap() = json!([message("s1", false, "628555@c.us", "Ada promo?")]);
    base.model.push(MockModel::text("Ada diskon 10%."));
    assert_eq!(service.poll_once().await.unwrap(), 1);
    let chat = base.only_chat(&manager, WHATSAPP_WEB_CHANNEL);
    let reply = chat.messages.iter().find(|m| m.author == MessageAuthor::Bot).unwrap();
    assert_eq!(reply.metadata["deliveryProblem"], "rate_limited", "{}", reply.metadata);
    assert!(plugin.sent.lock().unwrap().is_empty());

    // Only a chatbot may answer the personal number.
    let task = base
        .db
        .create_agent(crate::storage::models::NewAgent {
            name: "Laporan".into(),
            kind: crate::storage::models::AgentKind::Task,
            description: String::new(),
            flow_yaml: REPLY_FLOW.into(),
        })
        .unwrap();
    assert!(service.assign(Some(&task.id)).is_err());
    service.assign(None).unwrap();
    assert_eq!(service.channel().agent_id, None);
}
