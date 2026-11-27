//! Coalesces streamed `node_chunk` events before they are stored.
//!
//! A model answer streams one `node_chunk` per token; storing each as its own
//! `run_events` row would write thousands of rows per answer. The driver still
//! sends every chunk to the UI live, but stores them through this buffer:
//! consecutive chunks of one stream — same `frame`, `node_id`, `exec_id` and
//! output `field` — are combined into ONE `node_chunk` event with the same
//! shape, the texts concatenated and `"coalesced": <count>` added (a lone chunk
//! is stored unchanged).
//!
//! Each stream has its own pending chunk, so parallel nodes streaming at the
//! same time still produce few rows. Pending chunks are kept in the order of
//! their first chunk and are always released as a prefix of that order, which
//! keeps the seq each pending chunk will get predictable (see
//! [`ChunkPosition::Pending`]). Pending chunks are released:
//! - all of them when any non-chunk event arrives: the driver stores them
//!   before that event, so they also precede terminal and paused events,
//! - when a stream's text reaches [`ChunkBufferLimits::max_bytes`] (with every
//!   chunk pending before it),
//! - when [`ChunkBufferLimits::max_age`] has passed since a pending chunk's
//!   first piece (the driver also wakes up at [`ChunkBuffer::deadline`] while
//!   the stream is quiet).
//!
//! Text of one stream is stored in order; rows of two interleaved streams are
//! grouped per stream, and every row precedes the non-chunk event that followed
//! its chunks.

use std::time::Duration;

use graphrt_core::Event;
use serde_json::{json, Value as Json};
use tokio::time::Instant;

/// Text size at which a pending chunk is stored right away.
const DEFAULT_MAX_BUFFERED_BYTES: usize = 4 * 1024;
/// Longest time a chunk waits in the buffer before it is stored.
const DEFAULT_MAX_BUFFER_AGE: Duration = Duration::from_millis(500);

/// When a pending chunk must be stored even though its stream continues.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) struct ChunkBufferLimits {
    pub(crate) max_bytes: usize,
    pub(crate) max_age: Duration,
}

impl Default for ChunkBufferLimits {
    fn default() -> Self {
        Self { max_bytes: DEFAULT_MAX_BUFFERED_BYTES, max_age: DEFAULT_MAX_BUFFER_AGE }
    }
}

/// Where the text of a just-buffered chunk is.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum ChunkPosition {
    /// In `ready[index]` of the same [`ChunkPush`], to be stored now.
    Ready(usize),
    /// Still pending, with `index` pending chunks ahead of it: it will be
    /// stored as the `index + 1`-th row after the rows stored so far.
    Pending(usize),
}

/// Result of [`ChunkBuffer::push`].
#[derive(Debug)]
pub(crate) struct ChunkPush {
    /// Combined chunks to store now, in order.
    pub(crate) ready: Vec<Json>,
    pub(crate) position: ChunkPosition,
}

/// Identifies one chunk stream: an output field of one node execution in one frame.
#[derive(Debug, Clone, PartialEq, Eq)]
struct ChunkStreamKey {
    frame: String,
    node_id: String,
    exec_id: String,
    field: String,
}

/// Chunks of one stream that are not stored yet.
#[derive(Debug)]
struct PendingChunk {
    key: ChunkStreamKey,
    /// The first chunk's JSON; its `chunk` text is replaced when combined.
    first_chunk_json: Json,
    text: String,
    chunk_count: u64,
    first_buffered_at: Instant,
}

impl PendingChunk {
    /// The stored event: the first chunk's JSON with the combined text.
    fn into_combined_json(self) -> Json {
        let mut combined_json = self.first_chunk_json;
        if self.chunk_count > 1 {
            if let Some(fields) = combined_json.as_object_mut() {
                fields.insert("chunk".to_owned(), Json::String(self.text));
                fields.insert("coalesced".to_owned(), json!(self.chunk_count));
            }
        }
        combined_json
    }
}

/// Pending chunks per stream; see the module docs for the rules.
#[derive(Debug)]
pub(crate) struct ChunkBuffer {
    limits: ChunkBufferLimits,
    /// Ordered by `first_buffered_at` (new streams are appended).
    pending: Vec<PendingChunk>,
}

impl ChunkBuffer {
    pub(crate) fn new(limits: ChunkBufferLimits) -> Self {
        Self { limits, pending: Vec::new() }
    }

    /// When the oldest pending chunk must be stored at the latest, if there is one.
    pub(crate) fn deadline(&self) -> Option<Instant> {
        self.pending.first().map(|oldest| oldest.first_buffered_at + self.limits.max_age)
    }

    /// Buffers a `node_chunk` event (`event_json` is its stored JSON form) and
    /// returns what to store now. Returns `None` for any other event kind.
    pub(crate) fn push(&mut self, event: &Event, event_json: Json, now: Instant) -> Option<ChunkPush> {
        let Event::NodeChunk { frame, node_id, exec_id, field, chunk } = event else {
            return None;
        };
        let key = ChunkStreamKey {
            frame: frame.to_string(),
            node_id: node_id.to_string(),
            exec_id: exec_id.to_string(),
            field: field.to_string(),
        };
        let index = self.append(key, chunk, event_json, now);
        let size_reached = self.pending[index].text.len() >= self.limits.max_bytes;
        let release_count = if size_reached { index + 1 } else { 0 }.max(self.due_count(now));
        let position = if index < release_count {
            ChunkPosition::Ready(index)
        } else {
            ChunkPosition::Pending(index - release_count)
        };
        Some(ChunkPush { ready: self.release(release_count), position })
    }

    /// Removes every pending chunk, combined, in order.
    pub(crate) fn take_all(&mut self) -> Vec<Json> {
        self.release(self.pending.len())
    }

    /// Removes the pending chunks whose age limit has passed at `now`, in order.
    pub(crate) fn take_due(&mut self, now: Instant) -> Vec<Json> {
        self.release(self.due_count(now))
    }

    /// Adds the chunk to its stream's pending chunk; returns that chunk's index.
    fn append(&mut self, key: ChunkStreamKey, chunk: &str, event_json: Json, now: Instant) -> usize {
        if let Some(index) = self.pending.iter().position(|pending| pending.key == key) {
            let pending = &mut self.pending[index];
            pending.text.push_str(chunk);
            pending.chunk_count += 1;
            return index;
        }
        self.pending.push(PendingChunk {
            key,
            first_chunk_json: event_json,
            text: chunk.to_owned(),
            chunk_count: 1,
            first_buffered_at: now,
        });
        self.pending.len() - 1
    }

    /// How many leading pending chunks are due (they are ordered by age).
    fn due_count(&self, now: Instant) -> usize {
        self.pending.iter().take_while(|pending| now >= pending.first_buffered_at + self.limits.max_age).count()
    }

    fn release(&mut self, count: usize) -> Vec<Json> {
        self.pending.drain(..count).map(PendingChunk::into_combined_json).collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn chunk_event(node_id: &str, field: &str, text: &str) -> Event {
        Event::NodeChunk {
            frame: "".into(),
            node_id: node_id.into(),
            exec_id: format!("{node_id}-1").into(),
            field: field.into(),
            chunk: text.into(),
        }
    }

    fn push_chunk(buffer: &mut ChunkBuffer, event: &Event, now: Instant) -> ChunkPush {
        buffer.push(event, serde_json::to_value(event).unwrap(), now).unwrap()
    }

    fn large_limits() -> ChunkBufferLimits {
        ChunkBufferLimits { max_bytes: usize::MAX, max_age: Duration::from_secs(3600) }
    }

    #[test]
    fn consecutive_chunks_of_one_stream_combine_into_one_event() {
        let mut buffer = ChunkBuffer::new(large_limits());
        let now = Instant::now();
        for text in ["Hel", "lo", " world"] {
            let pushed = push_chunk(&mut buffer, &chunk_event("llm", "text", text), now);
            assert!(pushed.ready.is_empty());
            assert_eq!(pushed.position, ChunkPosition::Pending(0));
        }
        let combined = buffer.take_all();
        assert_eq!(combined.len(), 1);
        assert_eq!(combined[0]["type"], "node_chunk");
        assert_eq!(combined[0]["node_id"], "llm");
        assert_eq!(combined[0]["exec_id"], "llm-1");
        assert_eq!(combined[0]["field"], "text");
        assert_eq!(combined[0]["chunk"], "Hello world");
        assert_eq!(combined[0]["coalesced"], 3);
        assert!(buffer.take_all().is_empty());
        assert_eq!(buffer.deadline(), None);
    }

    #[test]
    fn a_lone_chunk_is_stored_unchanged_and_other_events_are_not_buffered() {
        let mut buffer = ChunkBuffer::new(large_limits());
        let event = chunk_event("llm", "text", "Hi");
        push_chunk(&mut buffer, &event, Instant::now());
        assert_eq!(buffer.take_all(), [serde_json::to_value(&event).unwrap()]);

        let skipped = Event::NodeSkipped { frame: "".into(), node_id: "other".into() };
        assert!(buffer.push(&skipped, serde_json::to_value(&skipped).unwrap(), Instant::now()).is_none());
    }

    #[test]
    fn interleaved_streams_are_buffered_separately_in_first_chunk_order() {
        let mut buffer = ChunkBuffer::new(large_limits());
        let now = Instant::now();
        let pieces =
            [("first", "text", "a"), ("second", "text", "b"), ("first", "text", "c"), ("second", "reasoning", "d")];
        let positions: Vec<ChunkPosition> = pieces
            .iter()
            .map(|(node_id, field, text)| push_chunk(&mut buffer, &chunk_event(node_id, field, text), now).position)
            .collect();
        use ChunkPosition::Pending;
        assert_eq!(positions, [Pending(0), Pending(1), Pending(0), Pending(2)]);

        let combined = buffer.take_all();
        let summary: Vec<(&str, &str, &str)> = combined
            .iter()
            .map(|event| {
                (event["node_id"].as_str().unwrap(), event["field"].as_str().unwrap(), event["chunk"].as_str().unwrap())
            })
            .collect();
        assert_eq!(summary, [("first", "text", "ac"), ("second", "text", "b"), ("second", "reasoning", "d")]);
    }

    #[test]
    fn size_limit_releases_the_stream_and_every_older_pending_chunk() {
        let mut buffer = ChunkBuffer::new(ChunkBufferLimits { max_bytes: 5, max_age: Duration::from_secs(3600) });
        let now = Instant::now();
        assert!(push_chunk(&mut buffer, &chunk_event("first", "text", "x"), now).ready.is_empty());
        assert!(push_chunk(&mut buffer, &chunk_event("second", "text", "abc"), now).ready.is_empty());
        push_chunk(&mut buffer, &chunk_event("third", "text", "y"), now);

        let pushed = push_chunk(&mut buffer, &chunk_event("second", "text", "de"), now);
        let released: Vec<&str> = pushed.ready.iter().map(|event| event["chunk"].as_str().unwrap()).collect();
        assert_eq!(released, ["x", "abcde"]);
        assert_eq!(pushed.position, ChunkPosition::Ready(1));
        assert_eq!(buffer.take_all()[0]["chunk"], "y");
    }

    #[test]
    fn age_limit_releases_the_oldest_chunks_on_push_and_on_deadline() {
        let max_age = Duration::from_millis(100);
        let mut buffer = ChunkBuffer::new(ChunkBufferLimits { max_bytes: usize::MAX, max_age });
        let start = Instant::now();
        push_chunk(&mut buffer, &chunk_event("first", "text", "a"), start);
        push_chunk(&mut buffer, &chunk_event("second", "text", "b"), start + Duration::from_millis(50));
        assert_eq!(buffer.deadline(), Some(start + max_age));
        assert!(buffer.take_due(start + Duration::from_millis(99)).is_empty());
        let due = buffer.take_due(start + max_age);
        assert_eq!(due.len(), 1);
        assert_eq!(due[0]["chunk"], "a");
        assert_eq!(buffer.deadline(), Some(start + Duration::from_millis(150)));

        let pushed = push_chunk(&mut buffer, &chunk_event("third", "text", "c"), start + Duration::from_millis(150));
        assert_eq!(pushed.ready.len(), 1);
        assert_eq!(pushed.ready[0]["chunk"], "b");
        assert_eq!(pushed.position, ChunkPosition::Pending(0));
    }
}
