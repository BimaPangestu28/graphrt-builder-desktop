//! A simple energy-based voice activity detector for the recorded tracks.
//!
//! whisper invents text for silence ("Thank you.", "ndoong sotali…"), and a meeting's mic
//! track is mostly silent while the others talk. Before transcribing, each track is cut
//! into 30 ms frames; a frame is *voiced* when its RMS level is well above the track's
//! noise floor and above an absolute minimum. A track with almost no voiced audio is not
//! transcribed at all, and whisper segments that do not overlap voiced audio are dropped.
//!
//! Reads the 16-bit mono PCM WAV files `pw-record` writes (any sample rate).

use std::path::Path;

use super::platform::MeetingError;
use super::transcript::Segment;

const FRAME_MS: u64 = 30;
/// Frames quieter than this (RMS, 16-bit full scale is 32768) never count as speech.
const ABSOLUTE_MIN_RMS: f64 = 300.0;
/// A voiced frame is this many times louder than the noise floor.
const FLOOR_FACTOR: f64 = 3.0;
/// Voiced stretches closer than this are merged (pauses between words).
const MERGE_GAP_MS: u64 = 300;
/// A track with less speech than this is treated as silent.
pub const MIN_SPEECH_MS: u64 = 1_000;

/// Decoded audio: mono 16-bit samples.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Pcm {
    pub sample_rate: u32,
    pub samples: Vec<i16>,
}

/// A stretch of speech, in milliseconds from the start of the track.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct VoicedRange {
    pub start_ms: u64,
    pub end_ms: u64,
}

/// Decodes a 16-bit PCM WAV file (mono, or the first channel of a multi-channel one).
///
/// # Errors
/// [`MeetingError::Parse`] for files that are not 16-bit PCM WAV.
pub fn parse_wav(bytes: &[u8]) -> Result<Pcm, MeetingError> {
    let invalid = |reason: &str| MeetingError::Parse(format!("audio file: {reason}"));
    if bytes.len() < 12 || &bytes[0..4] != b"RIFF" || &bytes[8..12] != b"WAVE" {
        return Err(invalid("not a WAV file"));
    }
    let mut position = 12;
    let mut format: Option<(u16, u16, u32, u16)> = None;
    while position + 8 <= bytes.len() {
        let id = &bytes[position..position + 4];
        let declared =
            u32::from_le_bytes([bytes[position + 4], bytes[position + 5], bytes[position + 6], bytes[position + 7]])
                as usize;
        let body_start = position + 8;
        // A recording stopped hard leaves the data size unset (0 or 0xFFFFFFFF): read to the end.
        let body_end = if id == b"data" && (declared == 0 || body_start + declared > bytes.len()) {
            bytes.len()
        } else {
            body_start.saturating_add(declared).min(bytes.len())
        };
        let body = &bytes[body_start..body_end];
        if id == b"fmt " {
            if body.len() < 16 {
                return Err(invalid("short format chunk"));
            }
            let read_u16 = |offset: usize| u16::from_le_bytes([body[offset], body[offset + 1]]);
            let sample_rate = u32::from_le_bytes([body[4], body[5], body[6], body[7]]);
            format = Some((read_u16(0), read_u16(2), sample_rate, read_u16(14)));
        } else if id == b"data" {
            let (audio_format, channels, sample_rate, bits) = format.ok_or_else(|| invalid("data before format"))?;
            if audio_format != 1 || bits != 16 || channels == 0 {
                return Err(invalid("only 16-bit PCM is supported"));
            }
            let frame_bytes = 2 * usize::from(channels);
            let samples =
                body.chunks_exact(frame_bytes).map(|frame| i16::from_le_bytes([frame[0], frame[1]])).collect();
            return Ok(Pcm { sample_rate, samples });
        }
        position = body_end + (body_end - body_start) % 2;
    }
    Err(invalid("no audio data"))
}

/// Reads and decodes a WAV file.
pub fn read_wav(path: &Path) -> Result<Pcm, MeetingError> {
    parse_wav(&std::fs::read(path)?)
}

fn frame_levels(pcm: &Pcm) -> Vec<f64> {
    let frame_samples = (u64::from(pcm.sample_rate) * FRAME_MS / 1000).max(1) as usize;
    pcm.samples
        .chunks(frame_samples)
        .map(|frame| {
            let sum: f64 = frame.iter().map(|&sample| f64::from(sample) * f64::from(sample)).sum();
            (sum / frame.len() as f64).sqrt()
        })
        .collect()
}

/// The voiced stretches of `pcm`.
pub fn voiced_ranges(pcm: &Pcm) -> Vec<VoicedRange> {
    let levels = frame_levels(pcm);
    if levels.is_empty() {
        return Vec::new();
    }
    let mut sorted = levels.clone();
    sorted.sort_by(f64::total_cmp);
    // The quietest tenth of the track is its noise floor.
    let noise_floor = sorted[sorted.len() / 10];
    let threshold = (noise_floor * FLOOR_FACTOR).max(ABSOLUTE_MIN_RMS);

    let mut ranges: Vec<VoicedRange> = Vec::new();
    for (index, level) in levels.iter().enumerate() {
        if *level < threshold {
            continue;
        }
        let start_ms = index as u64 * FRAME_MS;
        let end_ms = start_ms + FRAME_MS;
        match ranges.last_mut() {
            Some(last) if start_ms <= last.end_ms + MERGE_GAP_MS => last.end_ms = end_ms,
            _ => ranges.push(VoicedRange { start_ms, end_ms }),
        }
    }
    ranges
}

/// Total voiced time.
pub fn speech_ms(ranges: &[VoicedRange]) -> u64 {
    ranges.iter().map(|range| range.end_ms - range.start_ms).sum()
}

/// Keeps the segments that overlap voiced audio (with `slack_ms` on each side, since
/// whisper's timestamps are coarse).
pub fn keep_voiced_segments(segments: Vec<Segment>, ranges: &[VoicedRange], slack_ms: u64) -> Vec<Segment> {
    segments
        .into_iter()
        .filter(|segment| {
            let start = segment.start_ms.saturating_sub(slack_ms);
            let end = segment.end_ms.max(segment.start_ms) + slack_ms;
            ranges.iter().any(|range| range.start_ms < end && start < range.end_ms)
        })
        .collect()
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;

    /// A 16-bit mono WAV with `parts` of (duration ms, amplitude) as a 440 Hz tone.
    pub(crate) fn wav(sample_rate: u32, parts: &[(u64, i16)]) -> Vec<u8> {
        let mut samples: Vec<i16> = Vec::new();
        for (duration_ms, amplitude) in parts {
            let count = u64::from(sample_rate) * duration_ms / 1000;
            for index in 0..count {
                let phase = index as f64 * 440.0 * std::f64::consts::TAU / f64::from(sample_rate);
                samples.push((phase.sin() * f64::from(*amplitude)) as i16);
            }
        }
        let data: Vec<u8> = samples.iter().flat_map(|sample| sample.to_le_bytes()).collect();
        let mut bytes = Vec::new();
        bytes.extend_from_slice(b"RIFF");
        bytes.extend_from_slice(&(36 + data.len() as u32).to_le_bytes());
        bytes.extend_from_slice(b"WAVEfmt ");
        bytes.extend_from_slice(&16_u32.to_le_bytes());
        bytes.extend_from_slice(&1_u16.to_le_bytes());
        bytes.extend_from_slice(&1_u16.to_le_bytes());
        bytes.extend_from_slice(&sample_rate.to_le_bytes());
        bytes.extend_from_slice(&(sample_rate * 2).to_le_bytes());
        bytes.extend_from_slice(&2_u16.to_le_bytes());
        bytes.extend_from_slice(&16_u16.to_le_bytes());
        bytes.extend_from_slice(b"data");
        bytes.extend_from_slice(&(data.len() as u32).to_le_bytes());
        bytes.extend_from_slice(&data);
        bytes
    }

    #[test]
    fn decodes_pw_record_wav() {
        let pcm = parse_wav(&wav(16_000, &[(500, 1000)])).expect("parses");
        assert_eq!(pcm.sample_rate, 16_000);
        assert_eq!(pcm.samples.len(), 8_000);
    }

    #[test]
    fn reads_a_wav_whose_data_size_was_never_written() {
        let mut bytes = wav(16_000, &[(100, 1000)]);
        let data_size_at = bytes.len() - 3_200 - 4;
        bytes[data_size_at..data_size_at + 4].copy_from_slice(&0_u32.to_le_bytes());
        assert_eq!(parse_wav(&bytes).expect("parses").samples.len(), 1_600);
    }

    #[test]
    fn rejects_other_files() {
        assert!(matches!(parse_wav(b"not audio"), Err(MeetingError::Parse(_))));
        let mut float_wav = wav(16_000, &[(10, 0)]);
        float_wav[20] = 3; // IEEE float
        assert!(matches!(parse_wav(&float_wav), Err(MeetingError::Parse(_))));
    }

    #[test]
    fn finds_speech_between_silence() {
        let pcm = parse_wav(&wav(16_000, &[(2_000, 20), (1_500, 8_000), (2_000, 20)])).expect("parses");
        let ranges = voiced_ranges(&pcm);
        assert_eq!(ranges.len(), 1);
        assert!(ranges[0].start_ms >= 1_950 && ranges[0].start_ms <= 2_010, "{ranges:?}");
        assert!(speech_ms(&ranges) >= 1_400 && speech_ms(&ranges) <= 1_560, "{ranges:?}");
    }

    #[test]
    fn a_quiet_room_has_no_speech() {
        let pcm = parse_wav(&wav(16_000, &[(5_000, 150)])).expect("parses");
        assert_eq!(speech_ms(&voiced_ranges(&pcm)), 0);
        let empty = Pcm { sample_rate: 16_000, samples: Vec::new() };
        assert!(voiced_ranges(&empty).is_empty());
    }

    #[test]
    fn short_pauses_stay_in_one_range() {
        let pcm = parse_wav(&wav(16_000, &[(1_000, 20), (500, 8_000), (150, 20), (500, 8_000), (1_000, 20)]))
            .expect("parses");
        assert_eq!(voiced_ranges(&pcm).len(), 1);
    }

    #[test]
    fn drops_segments_over_silence() {
        let ranges = [VoicedRange { start_ms: 2_000, end_ms: 4_000 }];
        let segment = |start_ms, end_ms, text: &str| Segment { start_ms, end_ms, text: text.into() };
        let kept = keep_voiced_segments(
            vec![
                segment(0, 1_000, "hallucinated"),
                segment(1_800, 3_000, "real"),
                segment(6_000, 7_000, "also invented"),
            ],
            &ranges,
            500,
        );
        assert_eq!(kept.iter().map(|segment| segment.text.as_str()).collect::<Vec<_>>(), ["real"]);
    }
}
