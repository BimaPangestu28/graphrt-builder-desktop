//! The `meeting.transcribe` step: turns a recorded meeting into a transcript inside a
//! workflow, so summarizing and sending it are ordinary steps (`llm`, plugin steps).
//!
//! ```yaml
//! - id: transcribe
//!   type: meeting.transcribe
//!   meeting_id: "{{#start.meeting_id#}}"   # from the "when a meeting is recorded" trigger
//!   language: auto                        # or en, id, …
//!   timeout_ms: 1800000                   # minutes of audio take minutes; the default step limit is 2 min
//! ```
//!
//! Outputs `text` (the transcript as `[00:01:05] You: …` lines), `lines` (list of
//! `{start_ms, end_ms, speaker, text}`) and `title`. whisper.cpp is downloaded the first
//! time; the meeting's audio is deleted afterwards unless "Keep meeting audio" is on.
//!
//! The step runs on the app's [`MeetingTranscription`] host, installed once at start-up
//! ([`install_host`]); graphrt's node factories get no app state.

use std::sync::{Arc, OnceLock};

use futures::future::BoxFuture;
use graphrt_core::catalog::{NodeCategory, NodeDescriptor, OutputDescriptor};
use graphrt_core::dsl::NodeDoc;
use graphrt_core::node::{parse_config, ConfigError, Node, NodeContext, NodeError, NodeOutput, NodeResult, Registry};
use graphrt_core::template::Template;
use graphrt_core::{Selector, Value, ValueType};
use serde::Deserialize;

use super::platform::MeetingError;
use super::transcript::TranscriptLine;

pub const TRANSCRIBE_KIND: &str = "meeting.transcribe";

/// What the step gets back.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct MeetingTranscript {
    pub title: String,
    pub markdown: String,
    pub lines: Vec<TranscriptLine>,
}

/// Transcribes a stored meeting. Implemented by `MeetingService`; tests use a fake.
pub trait MeetingTranscription: Send + Sync + std::fmt::Debug {
    fn transcribe_meeting<'a>(
        &'a self,
        meeting_id: &'a str,
        language: &'a str,
    ) -> BoxFuture<'a, Result<MeetingTranscript, MeetingError>>;
}

static HOST: OnceLock<Arc<dyn MeetingTranscription>> = OnceLock::new();

/// Makes `host` the transcriber of every `meeting.transcribe` step (once, at start-up).
pub fn install_host(host: Arc<dyn MeetingTranscription>) {
    if HOST.set(host).is_err() {
        log::warn!("the meeting transcription host was already installed");
    }
}

#[derive(Debug, Clone, Deserialize)]
struct Config {
    meeting_id: String,
    #[serde(default = "default_language")]
    language: String,
}

fn default_language() -> String {
    "auto".to_owned()
}

#[derive(Debug)]
pub struct TranscribeNode {
    meeting_id: Template,
    language: String,
    host: Option<Arc<dyn MeetingTranscription>>,
}

impl TranscribeNode {
    pub fn from_doc(doc: &NodeDoc, host: Option<Arc<dyn MeetingTranscription>>) -> Result<Self, ConfigError> {
        let config: Config = parse_config(doc)?;
        if config.meeting_id.trim().is_empty() {
            return Err(ConfigError::new(doc, "`meeting_id` is required, e.g. \"{{#start.meeting_id#}}\""));
        }
        let language = config.language.trim().to_lowercase();
        let is_valid_language =
            language == "auto" || (2..=3).contains(&language.len()) && language.chars().all(|c| c.is_ascii_lowercase());
        if !is_valid_language {
            return Err(ConfigError::new(doc, "`language` is `auto` or a language code such as `en` or `id`"));
        }
        Ok(Self { meeting_id: Template::parse(config.meeting_id.trim()), language, host })
    }
}

impl Node for TranscribeNode {
    fn run(&self, ctx: NodeContext) -> BoxFuture<'_, NodeResult> {
        Box::pin(async move {
            let host = self
                .host
                .clone()
                .or_else(|| HOST.get().cloned())
                .ok_or_else(|| NodeError::fatal("meeting", "meeting notes are not available in this app"))?;
            let meeting_id = self.meeting_id.render(&ctx.pool);
            let meeting_id = meeting_id.trim();
            if meeting_id.is_empty() {
                return Err(NodeError::invalid_input("no meeting to transcribe: `meeting_id` is empty"));
            }
            let transcript =
                host.transcribe_meeting(meeting_id, &self.language).await.map_err(|error| match error {
                    MeetingError::NotFound(_) | MeetingError::InvalidState(_) => {
                        NodeError::invalid_input(error.to_string())
                    }
                    MeetingError::Unsupported => NodeError::fatal("meeting", error.to_string()),
                    other => NodeError::new("meeting", other.to_string()),
                })?;
            let lines = serde_json::to_value(&transcript.lines)
                .map_err(|error| NodeError::fatal("meeting", format!("could not read the transcript: {error}")))?;
            Ok(NodeOutput::new()
                .with("text", transcript.markdown)
                .with("lines", Value::from_json(lines))
                .with("title", transcript.title)
                .into())
        })
    }

    fn inputs(&self) -> Vec<Selector> {
        self.meeting_id.selectors().cloned().collect()
    }
}

fn descriptor() -> NodeDescriptor {
    NodeDescriptor::new(TRANSCRIBE_KIND, "Transcribe meeting", NodeCategory::Integration)
        .describe(
            "Transcribe a meeting recorded on this computer (your microphone as \"You\", the computer's sound as \"Others\") with whisper.cpp, locally.",
        )
        .icon("mic")
        .source("graphrt desktop")
        .schema(serde_json::json!({
            "type": "object",
            "required": ["meeting_id"],
            "properties": {
                "meeting_id": {"type": "string", "description": "The meeting, usually \"{{#start.meeting_id#}}\" from the meeting trigger."},
                "language": {"type": "string", "default": "auto", "description": "auto, or a language code such as en or id."}
            }
        }))
        .output(OutputDescriptor::new("text", ValueType::String).describe("The transcript: one \"[hh:mm:ss] Speaker: text\" paragraph per turn."))
        .output(OutputDescriptor::new("lines", ValueType::ArrayObject).describe("Segments: {start_ms, end_ms, speaker, text}."))
        .output(OutputDescriptor::new("title", ValueType::String).describe("The meeting's title."))
}

/// Registers `meeting.transcribe` (desktop builtin, never a plugin kind).
pub fn register(registry: &mut Registry) {
    registry.register_described(descriptor(), |doc| {
        let node: Arc<dyn Node> = Arc::new(TranscribeNode::from_doc(doc, None)?);
        Ok(node)
    });
}

#[cfg(test)]
mod tests {
    use std::sync::Mutex;

    use graphrt_core::node::NodeOutcome;
    use graphrt_core::pool::VariablePool;

    use super::*;
    use crate::meeting::platform::TrackKind;

    #[derive(Debug, Default)]
    struct FakeHost {
        calls: Mutex<Vec<(String, String)>>,
    }

    impl MeetingTranscription for FakeHost {
        fn transcribe_meeting<'a>(
            &'a self,
            meeting_id: &'a str,
            language: &'a str,
        ) -> BoxFuture<'a, Result<MeetingTranscript, MeetingError>> {
            self.calls.lock().expect("lock").push((meeting_id.to_owned(), language.to_owned()));
            Box::pin(async move {
                if meeting_id == "missing" {
                    return Err(MeetingError::NotFound("meeting missing".into()));
                }
                Ok(MeetingTranscript {
                    title: "Zoom meeting".into(),
                    markdown: "[00:00:01] You: Hi.\n".into(),
                    lines: vec![TranscriptLine {
                        start_ms: 1000,
                        end_ms: 1500,
                        track: TrackKind::Mic,
                        speaker: "You".into(),
                        text: "Hi.".into(),
                    }],
                })
            })
        }
    }

    fn node(config: serde_json::Value, host: &Arc<FakeHost>) -> Result<TranscribeNode, ConfigError> {
        let doc = NodeDoc::new("transcribe", TRANSCRIBE_KIND, config);
        let host: Arc<dyn MeetingTranscription> = host.clone();
        TranscribeNode::from_doc(&doc, Some(host))
    }

    fn pool_with_meeting(id: &str) -> VariablePool {
        let mut pool = VariablePool::new();
        pool.insert("start", "meeting_id", Value::from(id));
        pool
    }

    #[tokio::test]
    async fn transcribes_the_meeting_from_the_trigger() {
        let host = Arc::new(FakeHost::default());
        let step =
            node(serde_json::json!({"meeting_id": "{{#start.meeting_id#}}", "language": "ID"}), &host).expect("valid");
        assert_eq!(step.inputs().len(), 1);
        let outcome = step.run(NodeContext::for_test("transcribe", pool_with_meeting("m1"))).await.expect("runs");
        let NodeOutcome::Completed(output) = outcome else { panic!("not completed") };
        assert_eq!(output.outputs.get("text"), Some(&Value::from("[00:00:01] You: Hi.\n")));
        assert_eq!(output.outputs.get("title"), Some(&Value::from("Zoom meeting")));
        assert!(output.outputs.get("lines").is_some());
        assert_eq!(host.calls.lock().expect("lock").clone(), [("m1".to_owned(), "id".to_owned())]);
    }

    #[tokio::test]
    async fn a_missing_meeting_is_an_input_error() {
        let host = Arc::new(FakeHost::default());
        let step = node(serde_json::json!({"meeting_id": "{{#start.meeting_id#}}"}), &host).expect("valid");
        let error = step.run(NodeContext::for_test("t", pool_with_meeting("missing"))).await.expect_err("fails");
        assert_eq!((error.kind.as_str(), error.retryable), ("invalid_input", false));
        let empty = step.run(NodeContext::for_test("t", VariablePool::new())).await.expect_err("fails");
        assert!(empty.message.contains("empty"));
    }

    #[test]
    fn checks_its_configuration() {
        let host = Arc::new(FakeHost::default());
        assert!(node(serde_json::json!({"meeting_id": " "}), &host).is_err());
        assert!(node(serde_json::json!({}), &host).is_err());
        assert!(node(serde_json::json!({"meeting_id": "m1", "language": "english!"}), &host).is_err());
        assert_eq!(node(serde_json::json!({"meeting_id": "m1"}), &host).expect("valid").language, "auto");
    }

    #[test]
    fn is_registered_with_a_description() {
        let mut registry = Registry::new();
        register(&mut registry);
        let descriptor = registry.descriptor(TRANSCRIBE_KIND).expect("registered");
        assert_eq!(descriptor.kind, TRANSCRIBE_KIND);
    }
}
