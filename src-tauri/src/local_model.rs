//! Requests to a local model (Ollama) with the settings small models need.
//!
//! A turn that offers tools and leaves the temperature to the model is sent at temperature 0.
//! Ollama's default for llama3.2 is 0.8, and at that temperature the same request picked a
//! wrong argument in about half of the tries: replaying the first turn of "make this picture
//! 400 pixels wide" 20 times gave the description's example path `photos/cat.jpg` 5 times,
//! the default size 256 three times, `"null"` written as a value and a call written as broken
//! JSON. At temperature 0 all 20 calls were right. A step that sets its own temperature keeps
//! it; cloud models never pass through here.

use std::sync::Arc;

use futures::future::BoxFuture;
use graphrt_llm::{ChatModel, ChatRequest, ChatStream, LlmError};

/// The temperature of a tool turn that does not set one.
pub(crate) const TOOL_TURN_TEMPERATURE: f64 = 0.0;

/// A local model whose tool turns are sent at [`TOOL_TURN_TEMPERATURE`] unless they set their own.
#[derive(Debug)]
pub(crate) struct LocalModel {
    inner: Arc<dyn ChatModel>,
}

impl LocalModel {
    pub(crate) fn around(inner: Arc<dyn ChatModel>) -> Arc<dyn ChatModel> {
        Arc::new(Self { inner })
    }
}

/// `request` as it is sent to a local model.
pub(crate) fn for_local_model(mut request: ChatRequest) -> ChatRequest {
    if !request.tools.is_empty() && request.temperature.is_none() {
        request.temperature = Some(TOOL_TURN_TEMPERATURE);
    }
    request
}

impl ChatModel for LocalModel {
    fn chat(&self, request: ChatRequest) -> BoxFuture<'_, Result<ChatStream, LlmError>> {
        self.inner.chat(for_local_model(request))
    }
}

#[cfg(test)]
mod tests {
    use graphrt_core::tool::ToolSpec;
    use graphrt_llm::Message;
    use serde_json::json;

    use super::*;

    fn tool() -> ToolSpec {
        serde_json::from_value(json!({ "name": "resize", "description": "Resize", "parameters": { "type": "object" } }))
            .unwrap()
    }

    #[test]
    fn a_tool_turn_without_a_temperature_is_sent_at_zero() {
        let request = ChatRequest::new("llama3.2", vec![Message::user("x")]).with_tools(vec![tool()]);
        assert_eq!(for_local_model(request).temperature, Some(TOOL_TURN_TEMPERATURE));
    }

    #[test]
    fn a_turn_without_tools_or_with_its_own_temperature_is_unchanged() {
        let plain = ChatRequest::new("llama3.2", vec![Message::user("x")]);
        assert_eq!(for_local_model(plain).temperature, None);
        let own = ChatRequest::new("llama3.2", vec![Message::user("x")]).with_tools(vec![tool()]).with_temperature(0.7);
        assert_eq!(for_local_model(own).temperature, Some(0.7));
    }
}
