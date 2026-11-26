//! Turning the two tracks into one transcript.
//!
//! Each track is transcribed on its own by a [`Transcriber`]; the segments are labelled
//! with the track's speaker ("You" for the mic, "Others" for the computer's sound) and
//! merged by start time. The local engine is whisper.cpp's `whisper-cli` ([`WhisperCli`]);
//! API engines (the Deepgram / AssemblyAI plugins) implement the same trait later.

use std::path::{Path, PathBuf};
use std::process::Stdio;

use futures::future::BoxFuture;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use tokio::process::Command;

use super::platform::{MeetingError, TrackKind};

/// One stretch of speech of one track, in milliseconds from the start of the recording.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Segment {
    pub start_ms: u64,
    pub end_ms: u64,
    pub text: String,
}

/// A segment with its speaker, as saved in `transcript.json`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TranscriptLine {
    pub start_ms: u64,
    pub end_ms: u64,
    pub track: TrackKind,
    pub speaker: String,
    pub text: String,
}

/// Transcribes one audio file into segments.
pub trait Transcriber: Send + Sync + std::fmt::Debug {
    fn transcribe<'a>(&'a self, audio: &'a Path) -> BoxFuture<'a, Result<Vec<Segment>, MeetingError>>;
}

/// whisper.cpp markers for stretches without speech, and empty lines.
fn is_noise(text: &str) -> bool {
    let trimmed = text.trim();
    if trimmed.is_empty() {
        return true;
    }
    let is_bracketed = (trimmed.starts_with('[') && trimmed.ends_with(']'))
        || (trimmed.starts_with('(') && trimmed.ends_with(')'))
        || (trimmed.starts_with('*') && trimmed.ends_with('*'));
    is_bracketed && trimmed.len() < 40
}

/// The segments of whisper-cli's `-oj` output (`transcription[].offsets.{from,to}`, `text`).
/// Silence markers (`[BLANK_AUDIO]`, `(music)`) are dropped.
///
/// # Errors
/// [`MeetingError::Parse`] when the JSON has no `transcription` array.
pub fn parse_whisper_json(json: &str) -> Result<Vec<Segment>, MeetingError> {
    let document: Value =
        serde_json::from_str(json).map_err(|error| MeetingError::Parse(format!("whisper output: {error}")))?;
    let entries = document
        .get("transcription")
        .and_then(Value::as_array)
        .ok_or_else(|| MeetingError::Parse("whisper output has no transcription".into()))?;
    let mut segments = Vec::new();
    for entry in entries {
        let text = entry.get("text").and_then(Value::as_str).unwrap_or("");
        if is_noise(text) {
            continue;
        }
        let offset = |key: &str| entry.get("offsets").and_then(|offsets| offsets.get(key)).and_then(Value::as_u64);
        let start_ms = offset("from").unwrap_or(0);
        let end_ms = offset("to").unwrap_or(start_ms).max(start_ms);
        segments.push(Segment { start_ms, end_ms, text: text.trim().to_owned() });
    }
    Ok(segments)
}

/// Both tracks' segments in one list ordered by start time; the mic first on a tie.
pub fn merge_tracks(tracks: Vec<(TrackKind, Vec<Segment>)>) -> Vec<TranscriptLine> {
    let mut lines: Vec<TranscriptLine> = tracks
        .into_iter()
        .flat_map(|(track, segments)| {
            segments.into_iter().map(move |segment| TranscriptLine {
                start_ms: segment.start_ms,
                end_ms: segment.end_ms,
                track,
                speaker: track.speaker_label().to_owned(),
                text: segment.text,
            })
        })
        .collect();
    lines.sort_by_key(|line| (line.start_ms, matches!(line.track, TrackKind::System)));
    lines
}

/// `[00:01:05] You: text`, one line per segment; consecutive segments of one speaker
/// are joined into one paragraph.
pub fn render_markdown(title: &str, lines: &[TranscriptLine]) -> String {
    let mut output = format!("# {title}\n\n");
    let mut previous_speaker: Option<&str> = None;
    for line in lines {
        if previous_speaker == Some(line.speaker.as_str()) {
            output.pop();
            output.push(' ');
            output.push_str(&line.text);
            output.push('\n');
            continue;
        }
        if previous_speaker.is_some() {
            output.push('\n');
        }
        output.push_str(&format!("[{}] {}: {}\n", format_timestamp(line.start_ms), line.speaker, line.text));
        previous_speaker = Some(line.speaker.as_str());
    }
    if lines.is_empty() {
        output.push_str("_No speech was recognized._\n");
    }
    output
}

fn format_timestamp(milliseconds: u64) -> String {
    let seconds = milliseconds / 1000;
    format!("{:02}:{:02}:{:02}", seconds / 3600, (seconds / 60) % 60, seconds % 60)
}

/// whisper.cpp's command-line tool with a ggml model.
#[derive(Debug, Clone)]
pub struct WhisperCli {
    pub program: PathBuf,
    pub model: PathBuf,
    /// `auto` detects the language of each file.
    pub language: String,
    pub threads: usize,
}

impl WhisperCli {
    /// whisper-cli arguments writing `<output_prefix>.json` for `audio`.
    pub fn arguments(&self, audio: &Path, output_prefix: &Path) -> Vec<String> {
        vec![
            "-m".into(),
            self.model.to_string_lossy().into_owned(),
            "-f".into(),
            audio.to_string_lossy().into_owned(),
            "-l".into(),
            self.language.clone(),
            "-t".into(),
            self.threads.to_string(),
            "-oj".into(),
            "-of".into(),
            output_prefix.to_string_lossy().into_owned(),
            "-np".into(),
        ]
    }
}

impl Transcriber for WhisperCli {
    fn transcribe<'a>(&'a self, audio: &'a Path) -> BoxFuture<'a, Result<Vec<Segment>, MeetingError>> {
        Box::pin(async move {
            let program_name = "whisper-cli".to_owned();
            if !self.model.is_file() {
                return Err(MeetingError::ToolMissing {
                    program: "the whisper model".into(),
                    reason: format!("{} does not exist", self.model.display()),
                });
            }
            let output_prefix = audio.with_extension("whisper");
            let mut command = Command::new(&self.program);
            crate::child_env::apply_tokio(&mut command);
            let output = command
                .args(self.arguments(audio, &output_prefix))
                .stdin(Stdio::null())
                .kill_on_drop(true)
                .output()
                .await
                .map_err(|error| MeetingError::ToolMissing {
                    program: program_name.clone(),
                    reason: error.to_string(),
                })?;
            if !output.status.success() {
                let stderr = String::from_utf8_lossy(&output.stderr);
                let reason = stderr.lines().rev().find(|line| !line.trim().is_empty()).unwrap_or("no error output");
                return Err(MeetingError::ToolFailed { program: program_name, reason: reason.trim().to_owned() });
            }
            let json_path = output_prefix.with_extension("whisper.json");
            let json = tokio::fs::read_to_string(&json_path).await?;
            if let Err(error) = tokio::fs::remove_file(&json_path).await {
                log::warn!("could not remove {}: {error}", json_path.display());
            }
            parse_whisper_json(&json)
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const WHISPER_JSON: &str = r#"{
        "params": {"model": "ggml-base.bin", "language": "auto"},
        "result": {"language": "en"},
        "transcription": [
            {"timestamps": {"from": "00:00:00,000", "to": "00:00:08,000"}, "offsets": {"from": 0, "to": 8000}, "text": " And so, my fellow Americans,"},
            {"timestamps": {"from": "00:00:08,000", "to": "00:00:09,000"}, "offsets": {"from": 8000, "to": 9000}, "text": " [BLANK_AUDIO]"},
            {"timestamps": {"from": "00:00:09,000", "to": "00:00:11,000"}, "offsets": {"from": 9000, "to": 11000}, "text": " ask what you can do."}
        ]
    }"#;

    fn segment(start_ms: u64, text: &str) -> Segment {
        Segment { start_ms, end_ms: start_ms + 1000, text: text.into() }
    }

    #[test]
    fn parses_whisper_segments_and_drops_silence_markers() {
        let segments = parse_whisper_json(WHISPER_JSON).expect("parses");
        assert_eq!(
            segments,
            vec![
                Segment { start_ms: 0, end_ms: 8000, text: "And so, my fellow Americans,".into() },
                Segment { start_ms: 9000, end_ms: 11000, text: "ask what you can do.".into() },
            ]
        );
    }

    #[test]
    fn rejects_json_without_a_transcription() {
        assert!(matches!(parse_whisper_json("{}"), Err(MeetingError::Parse(_))));
        assert!(matches!(parse_whisper_json("nope"), Err(MeetingError::Parse(_))));
    }

    #[test]
    fn noise_markers() {
        assert!(is_noise(" [BLANK_AUDIO]"));
        assert!(is_noise("(music)"));
        assert!(is_noise("*typing*"));
        assert!(is_noise("   "));
        assert!(!is_noise("[laughs] that was funny, said the long sentence here with words"));
        assert!(!is_noise("Hello"));
    }

    #[test]
    fn merges_tracks_by_start_time_with_speakers() {
        let lines = merge_tracks(vec![
            (TrackKind::System, vec![segment(1000, "Hi, can you hear me?"), segment(5000, "Great.")]),
            (TrackKind::Mic, vec![segment(3000, "Yes, loud and clear."), segment(5000, "Let's start.")]),
        ]);
        let spoken: Vec<(&str, &str)> = lines.iter().map(|line| (line.speaker.as_str(), line.text.as_str())).collect();
        assert_eq!(
            spoken,
            [
                ("Others", "Hi, can you hear me?"),
                ("You", "Yes, loud and clear."),
                ("You", "Let's start."),
                ("Others", "Great.")
            ]
        );
    }

    #[test]
    fn renders_a_readable_transcript() {
        let lines = merge_tracks(vec![
            (TrackKind::Mic, vec![segment(3000, "Okay."), segment(4000, "Let's begin.")]),
            (TrackKind::System, vec![segment(65_000, "Sounds good.")]),
        ]);
        assert_eq!(
            render_markdown("Zoom meeting", &lines),
            "# Zoom meeting\n\n[00:00:03] You: Okay. Let's begin.\n\n[00:01:05] Others: Sounds good.\n"
        );
        assert!(render_markdown("Empty", &[]).contains("No speech was recognized"));
    }

    #[test]
    fn whisper_cli_writes_json_next_to_the_audio() {
        let whisper = WhisperCli {
            program: "whisper-cli".into(),
            model: "/models/ggml-base.bin".into(),
            language: "auto".into(),
            threads: 4,
        };
        let arguments = whisper.arguments(Path::new("/m/mic.wav"), Path::new("/m/mic.whisper"));
        assert_eq!(
            arguments.join(" "),
            "-m /models/ggml-base.bin -f /m/mic.wav -l auto -t 4 -oj -of /m/mic.whisper -np"
        );
    }
}
