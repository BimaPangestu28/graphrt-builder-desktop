//! Who captures the microphone, from `pw-dump`'s JSON (PipeWire's full object list).
//!
//! A mic user is a `Stream/Input/Audio` node that a link feeds from an `Audio/Source*`
//! node (a real microphone). Captures of a sink monitor (`Audio/Sink`, the computer's
//! sound) do not count, nor do our own recorder streams ([`OWN_STREAM_PREFIX`]).

use std::collections::{BTreeSet, HashMap};

use serde_json::Value;

use crate::meeting::platform::{MeetingError, MicUser};

/// `node.name` prefix of the notetaker's own `pw-record` streams.
pub const OWN_STREAM_PREFIX: &str = "graphrt-meeting-";

struct Node<'a> {
    props: &'a serde_json::Map<String, Value>,
}

impl<'a> Node<'a> {
    fn text(&self, key: &str) -> Option<&'a str> {
        self.props.get(key).and_then(Value::as_str).map(str::trim).filter(|value| !value.is_empty())
    }

    fn number(&self, key: &str) -> Option<u32> {
        number_value(self.props.get(key)?)
    }

    fn media_class(&self) -> &'a str {
        self.text("media.class").unwrap_or("")
    }
}

/// pw-dump writes ids as numbers, but some properties (`application.process.id`) are
/// strings in older versions.
fn number_value(value: &Value) -> Option<u32> {
    match value {
        Value::Number(number) => number.as_u64().and_then(|number| u32::try_from(number).ok()),
        Value::String(text) => text.trim().parse().ok(),
        _ => None,
    }
}

/// The programs capturing a microphone, in stream id order. `own_pid` (this app) is skipped.
///
/// # Errors
/// [`MeetingError::Parse`] when `json` is not pw-dump's array of objects.
pub fn parse_mic_users(json: &str, own_pid: u32) -> Result<Vec<MicUser>, MeetingError> {
    let objects: Vec<Value> =
        serde_json::from_str(json).map_err(|error| MeetingError::Parse(format!("pw-dump output: {error}")))?;

    let mut nodes: HashMap<u32, Node<'_>> = HashMap::new();
    let mut clients: HashMap<u32, Node<'_>> = HashMap::new();
    let mut links: Vec<(u32, u32)> = Vec::new();
    for object in &objects {
        let Some(id) = object.get("id").and_then(number_value) else { continue };
        let kind = object.get("type").and_then(Value::as_str).unwrap_or("");
        let info = object.get("info");
        if kind.ends_with(":Link") {
            let output = info.and_then(|info| info.get("output-node-id")).and_then(number_value);
            let input = info.and_then(|info| info.get("input-node-id")).and_then(number_value);
            if let (Some(output), Some(input)) = (output, input) {
                links.push((output, input));
            }
            continue;
        }
        let Some(props) = info.and_then(|info| info.get("props")).and_then(Value::as_object) else { continue };
        if kind.ends_with(":Node") {
            nodes.insert(id, Node { props });
        } else if kind.ends_with(":Client") {
            clients.insert(id, Node { props });
        }
    }

    let fed_by_microphone: BTreeSet<u32> = links
        .iter()
        .filter(|(output, _)| nodes.get(output).is_some_and(|node| node.media_class().starts_with("Audio/Source")))
        .map(|(_, input)| *input)
        .collect();

    let mut users = Vec::new();
    for stream_id in fed_by_microphone {
        let Some(stream) = nodes.get(&stream_id) else { continue };
        if stream.media_class() != "Stream/Input/Audio" {
            continue;
        }
        if stream.text("node.name").is_some_and(|name| name.starts_with(OWN_STREAM_PREFIX)) {
            continue;
        }
        let client = stream.number("client.id").and_then(|client_id| clients.get(&client_id));
        let from_stream_or_client = |key: &str| stream.text(key).or_else(|| client.and_then(|client| client.text(key)));
        let pid = stream
            .number("application.process.id")
            .or_else(|| client.and_then(|client| client.number("application.process.id")))
            .or_else(|| client.and_then(|client| client.number("pipewire.sec.pid")));
        if pid == Some(own_pid) {
            continue;
        }
        let app_name = from_stream_or_client("application.name")
            .or_else(|| stream.text("node.name"))
            .unwrap_or("Unknown program")
            .to_owned();
        let binary = from_stream_or_client("application.process.binary").map(str::to_owned);
        users.push(MicUser { stream_id, app_name, binary, pid });
    }
    Ok(users)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Trimmed from a real `pw-dump` (PipeWire 1.6) with Chrome in a call, our own two
    /// recorder streams, a capture of the speakers' monitor and a stream without a link.
    const FIXTURE: &str = include_str!("../../../fixtures/meeting/pw-dump-call.json");

    #[test]
    fn finds_programs_capturing_the_microphone() {
        let users = parse_mic_users(FIXTURE, 1).expect("fixture parses");
        assert_eq!(
            users,
            vec![
                MicUser {
                    stream_id: 77,
                    app_name: "Google Chrome input".into(),
                    binary: Some("chrome".into()),
                    pid: Some(28727),
                },
                MicUser {
                    stream_id: 90,
                    app_name: "ZOOM VoiceEngine".into(),
                    binary: Some("zoom".into()),
                    pid: Some(5150)
                },
            ]
        );
    }

    #[test]
    fn skips_this_app_by_pid() {
        let users = parse_mic_users(FIXTURE, 5150).expect("fixture parses");
        assert_eq!(users.iter().map(|user| user.stream_id).collect::<Vec<_>>(), [77]);
    }

    #[test]
    fn an_idle_system_has_no_mic_users() {
        let idle = r#"[
            {"id": 46, "type": "PipeWire:Interface:Node", "info": {"props": {"media.class": "Audio/Source", "node.name": "mic"}}},
            {"id": 57, "type": "PipeWire:Interface:Node", "info": {"props": {"media.class": "Audio/Sink", "node.name": "speakers"}}}
        ]"#;
        assert_eq!(parse_mic_users(idle, 1).expect("parses"), []);
    }

    #[test]
    fn reads_pids_written_as_strings() {
        let json = r#"[
            {"id": 1, "type": "PipeWire:Interface:Node", "info": {"props": {"media.class": "Audio/Source"}}},
            {"id": 2, "type": "PipeWire:Interface:Node", "info": {"props": {"media.class": "Stream/Input/Audio", "application.name": "arecord", "application.process.id": "321"}}},
            {"id": 3, "type": "PipeWire:Interface:Link", "info": {"output-node-id": 1, "input-node-id": 2}}
        ]"#;
        let users = parse_mic_users(json, 1).expect("parses");
        assert_eq!(users[0].pid, Some(321));
        assert_eq!(users[0].binary, None);
    }

    #[test]
    fn rejects_output_that_is_not_pw_dump() {
        assert!(matches!(parse_mic_users("not json", 1), Err(MeetingError::Parse(_))));
        assert!(matches!(parse_mic_users("{}", 1), Err(MeetingError::Parse(_))));
    }
}
