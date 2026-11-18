//! Channels a chatbot talks to customers on.
//!
//! A [`ChannelAdapter`] turns what a channel delivers into an
//! [`InboundMessage`] and sends bot / owner replies back out. Only the in-app
//! [`TestChannel`] (the "Try it" panel) exists today; WhatsApp or Telegram plug
//! in by implementing the trait and registering with
//! `ConversationManager::with_channel`, without touching the reply pipeline.

use std::collections::HashMap;
use std::sync::Arc;

use futures::future::BoxFuture;

use super::models::{Conversation, MessageAuthor};
use crate::error::{AppError, AppResult};

/// Name of the in-app test channel.
pub const TEST_CHANNEL: &str = "test";

/// A customer message as received from a channel.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct InboundMessage {
    /// The customer's address on the channel (phone number, chat id...).
    pub customer_handle: String,
    /// Display name, when the channel knows one.
    pub customer_name: Option<String>,
    pub text: String,
}

/// A message to deliver to the customer of `conversation`.
#[derive(Debug, Clone, Copy)]
pub struct OutboundMessage<'a> {
    pub conversation: &'a Conversation,
    /// `Bot` or `Operator`.
    pub author: MessageAuthor,
    pub text: &'a str,
}

/// Receives customer messages from, and sends replies to, one messaging channel.
pub trait ChannelAdapter: Send + Sync + std::fmt::Debug {
    /// Stable channel name stored on conversations, e.g. `test` or `whatsapp`.
    fn name(&self) -> &'static str;

    /// Turns a payload delivered by the channel (webhook body, polled update...)
    /// into a customer message.
    ///
    /// # Errors
    /// `InvalidInput` when the payload is not a customer text message.
    fn parse_inbound(&self, payload: &serde_json::Value) -> AppResult<InboundMessage>;

    /// Delivers a bot or owner reply to the customer.
    ///
    /// # Errors
    /// Any `AppError`; the reply is still stored, with the error in its metadata.
    fn send<'a>(&'a self, outbound: OutboundMessage<'a>) -> BoxFuture<'a, AppResult<()>>;
}

/// The in-app channel behind the chatbot's "Try it" panel. The app window is
/// the customer's phone: replies are shown from storage, so sending is a no-op.
///
/// Inbound payload: `{"text": "...", "customerHandle": "...", "customerName": "..."}`
/// (only `text` is required; the handle defaults to `test-customer`).
#[derive(Debug, Default)]
pub struct TestChannel;

impl ChannelAdapter for TestChannel {
    fn name(&self) -> &'static str {
        TEST_CHANNEL
    }

    fn parse_inbound(&self, payload: &serde_json::Value) -> AppResult<InboundMessage> {
        let text_field = |field: &str| payload.get(field).and_then(serde_json::Value::as_str).map(str::trim);
        let text = text_field("text")
            .filter(|text| !text.is_empty())
            .ok_or_else(|| AppError::InvalidInput("a test message needs non-empty `text`".into()))?;
        Ok(InboundMessage {
            customer_handle: text_field("customerHandle")
                .filter(|handle| !handle.is_empty())
                .unwrap_or("test-customer")
                .to_owned(),
            customer_name: text_field("customerName").filter(|name| !name.is_empty()).map(str::to_owned),
            text: text.to_owned(),
        })
    }

    fn send<'a>(&'a self, _outbound: OutboundMessage<'a>) -> BoxFuture<'a, AppResult<()>> {
        Box::pin(async { Ok(()) })
    }
}

/// Channel adapters by name.
#[derive(Debug, Clone)]
pub struct ChannelRegistry {
    adapters: HashMap<&'static str, Arc<dyn ChannelAdapter>>,
}

impl Default for ChannelRegistry {
    /// Only the in-app test channel.
    fn default() -> Self {
        Self::empty().with(Arc::new(TestChannel))
    }
}

impl ChannelRegistry {
    /// A registry without any channel.
    pub fn empty() -> Self {
        Self { adapters: HashMap::new() }
    }

    /// Adds (or replaces) the adapter registered under its name.
    pub fn with(mut self, adapter: Arc<dyn ChannelAdapter>) -> Self {
        self.adapters.insert(adapter.name(), adapter);
        self
    }

    /// # Errors
    /// `InvalidInput` when no adapter is registered under `channel_name`.
    pub fn get(&self, channel_name: &str) -> AppResult<Arc<dyn ChannelAdapter>> {
        self.adapters
            .get(channel_name)
            .cloned()
            .ok_or_else(|| AppError::InvalidInput(format!("the {channel_name} channel is not connected")))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn test_channel_parses_text_and_defaults_the_handle() {
        let inbound = TestChannel.parse_inbound(&json!({"text": "  Halo  "})).unwrap();
        assert_eq!(
            inbound,
            InboundMessage { customer_handle: "test-customer".into(), customer_name: None, text: "Halo".into() }
        );
        let named = TestChannel
            .parse_inbound(&json!({"text": "Hi", "customerHandle": "+62 1", "customerName": "Budi"}))
            .unwrap();
        assert_eq!(named.customer_handle, "+62 1");
        assert_eq!(named.customer_name.as_deref(), Some("Budi"));
    }

    #[test]
    fn test_channel_rejects_payloads_without_text() {
        assert!(matches!(TestChannel.parse_inbound(&json!({"text": " "})), Err(AppError::InvalidInput(_))));
        assert!(matches!(TestChannel.parse_inbound(&json!({})), Err(AppError::InvalidInput(_))));
    }

    #[test]
    fn registry_finds_registered_channels_only() {
        let registry = ChannelRegistry::default();
        assert_eq!(registry.get(TEST_CHANNEL).unwrap().name(), TEST_CHANNEL);
        assert!(matches!(registry.get("whatsapp"), Err(AppError::InvalidInput(_))));
    }
}
