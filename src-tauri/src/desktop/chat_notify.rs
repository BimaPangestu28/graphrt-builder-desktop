//! A notification when a chatbot hands a customer conversation over to the
//! user (status `waiting_for_you`), if [`AppSettings::notify_on_chat_handoff`] is on.
//!
//! [`ChatNotifyingSink`] wraps the conversation event sink the same way
//! [`super::notify::NotifyingSink`] wraps the run sink: every payload is passed
//! on unchanged. Conversations of the in-app "Try it" panel are not notified,
//! since the user is looking at them.

use std::sync::Arc;

use super::app_settings::AppSettings;
use super::notify::PlainNotifier;
use crate::conversations::channel::TEST_CHANNEL;
use crate::conversations::models::ConversationStatus;
use crate::conversations::{ConversationEventKind, ConversationEventPayload, ConversationEventSink};
use crate::storage::Database;

/// Forwards conversation events to `inner` and notifies on hand-offs.
#[derive(Debug)]
pub struct ChatNotifyingSink {
    inner: Arc<dyn ConversationEventSink>,
    notifier: Arc<dyn PlainNotifier>,
    db: Arc<Database>,
}

impl ChatNotifyingSink {
    pub fn new(inner: Arc<dyn ConversationEventSink>, notifier: Arc<dyn PlainNotifier>, db: Arc<Database>) -> Self {
        Self { inner, notifier, db }
    }

    /// Title and body for a hand-off worth telling the user about.
    fn notification_for(&self, payload: &ConversationEventPayload) -> Option<(String, String)> {
        let is_handoff =
            payload.kind == ConversationEventKind::StatusChanged && payload.status == ConversationStatus::WaitingForYou;
        let settings = AppSettings::load_or_default(&self.db);
        if !is_handoff || !settings.notify_on_chat_handoff {
            return None;
        }
        let strings = settings.ui_strings();
        let conversation = match self.db.get_conversation(&payload.conversation_id) {
            Ok(conversation) => conversation,
            Err(error) => {
                log::warn!("not notifying about conversation {}: {error}", payload.conversation_id);
                return None;
            }
        };
        if conversation.channel == TEST_CHANNEL {
            return None;
        }
        let agent_name =
            self.db.get_agent(&payload.agent_id).map(|agent| agent.name).unwrap_or_else(|_| strings.unknown_chatbot().into());
        let body = match conversation.last_message_text.filter(|text| !text.trim().is_empty()) {
            Some(last_message) => format!("{}: {last_message}", conversation.customer_name),
            None => strings.customer_waiting_body(&conversation.customer_name),
        };
        Some((strings.chat_needs_you_title(&agent_name), body))
    }
}

impl ConversationEventSink for ChatNotifyingSink {
    fn send(&self, payload: ConversationEventPayload) {
        let notification = self.notification_for(&payload);
        self.inner.send(payload);
        if let Some((title, body)) = notification {
            self.notifier.notify_plain(title, body);
        }
    }
}

#[cfg(test)]
mod tests {
    use std::sync::Mutex;

    use super::*;
    use crate::conversations::models::NewConversation;
    use crate::storage::models::{AgentKind, NewAgent};

    #[derive(Debug, Default)]
    struct RecordingSink {
        count: Mutex<usize>,
    }

    impl ConversationEventSink for RecordingSink {
        fn send(&self, _payload: ConversationEventPayload) {
            *self.count.lock().unwrap() += 1;
        }
    }

    #[derive(Debug, Default)]
    struct RecordingNotifier {
        shown: Mutex<Vec<(String, String)>>,
    }

    impl PlainNotifier for RecordingNotifier {
        fn notify_plain(&self, title: String, body: String) {
            self.shown.lock().unwrap().push((title, body));
        }
    }

    struct Fixture {
        sink: ChatNotifyingSink,
        inner: Arc<RecordingSink>,
        notifier: Arc<RecordingNotifier>,
        db: Arc<Database>,
        agent_id: String,
    }

    fn fixture() -> Fixture {
        let db = Arc::new(Database::open_in_memory().unwrap());
        let agent = db
            .create_agent(NewAgent {
                name: "Catering assistant".into(),
                kind: AgentKind::Chatbot,
                description: "Answers catering questions".into(),
                flow_yaml: "nodes: []".into(),
            })
            .unwrap();
        let inner = Arc::new(RecordingSink::default());
        let notifier = Arc::new(RecordingNotifier::default());
        let sink = ChatNotifyingSink::new(inner.clone(), notifier.clone(), db.clone());
        Fixture { sink, inner, notifier, db, agent_id: agent.id }
    }

    fn conversation_payload(fixture: &Fixture, channel: &str, kind: ConversationEventKind) -> ConversationEventPayload {
        let conversation = fixture
            .db
            .insert_conversation(&NewConversation {
                agent_id: fixture.agent_id.clone(),
                channel: channel.into(),
                customer_name: "[CUSTOMER NAME]".into(),
                customer_handle: "[HANDLE]".into(),
                origin: None,
            })
            .unwrap();
        ConversationEventPayload {
            kind,
            conversation_id: conversation.id,
            agent_id: fixture.agent_id.clone(),
            status: ConversationStatus::WaitingForYou,
            message: None,
        }
    }

    fn enable_notifications(fixture: &Fixture) {
        AppSettings { notify_on_chat_handoff: true, ..AppSettings::default() }.save(&fixture.db).unwrap();
    }

    #[test]
    fn notifies_on_a_handoff_when_enabled() {
        let fixture = fixture();
        enable_notifications(&fixture);
        fixture.sink.send(conversation_payload(&fixture, "whatsapp", ConversationEventKind::StatusChanged));
        let shown = fixture.notifier.shown.lock().unwrap().clone();
        assert_eq!(shown.len(), 1);
        assert_eq!(shown[0].0, "Catering assistant needs you in a chat");
        assert_eq!(shown[0].1, "[CUSTOMER NAME] is waiting for your reply");
        assert_eq!(*fixture.inner.count.lock().unwrap(), 1, "the payload is forwarded");
    }

    #[test]
    fn stays_quiet_when_off_for_test_chats_and_other_events() {
        let fixture = fixture();
        fixture.sink.send(conversation_payload(&fixture, "whatsapp", ConversationEventKind::StatusChanged));
        enable_notifications(&fixture);
        fixture.sink.send(conversation_payload(&fixture, TEST_CHANNEL, ConversationEventKind::StatusChanged));
        fixture.sink.send(conversation_payload(&fixture, "whatsapp", ConversationEventKind::MessageAdded));
        assert!(fixture.notifier.shown.lock().unwrap().is_empty());
        assert_eq!(*fixture.inner.count.lock().unwrap(), 3);
    }
}
