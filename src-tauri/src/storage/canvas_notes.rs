//! Sticky notes on the Nodes canvas, per agent version.
//!
//! graphrt drops `note` nodes from workflow documents, so notes live here, next to
//! the node positions (`node_layouts.rs`), and the builder model never sees them.
//! Saving replaces every note of a version (moving or editing a note adds no
//! version). When a new version is saved (chat change, Nodes edit or restore), all
//! notes of the previous version are copied forward ([`copy_notes_forward`]): notes
//! are not tied to a node, so none is dropped. Rows go with their agent
//! (`ON DELETE CASCADE`).

use std::collections::HashSet;

use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};

use super::agents::ensure_agent_exists;
use super::Database;
use crate::error::{AppError, AppResult};

/// Longest note text kept (characters); a canvas note is a short remark, not a document.
pub const MAX_NOTE_TEXT_CHARS: usize = 4_000;
/// Most notes one version can hold.
pub const MAX_NOTES_PER_VERSION: usize = 200;
/// Note colors the canvas offers.
pub const NOTE_COLORS: &[&str] = &["yellow", "blue", "green", "pink", "gray"];

/// One sticky note. Coordinates and size are canvas units (React Flow positions).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CanvasNote {
    pub note_id: String,
    pub x: f64,
    pub y: f64,
    #[serde(rename = "w")]
    pub width: f64,
    #[serde(rename = "h")]
    pub height: f64,
    pub text: String,
    /// One of [`NOTE_COLORS`].
    pub color: String,
}

/// The notes of one agent version.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CanvasNoteSet {
    pub agent_id: String,
    pub version: i64,
    pub notes: Vec<CanvasNote>,
}

const NOTE_COLUMNS: &str = "note_id, x, y, w, h, text, color";

impl Database {
    /// The notes of `version` (empty when it has none).
    ///
    /// # Errors
    /// `NotFound` when the agent or the version does not exist.
    pub fn get_canvas_notes(&self, agent_id: &str, version: i64) -> AppResult<CanvasNoteSet> {
        let connection = self.lock()?;
        ensure_version_exists(&connection, agent_id, version)?;
        let notes = read_note_rows(&connection, agent_id, version)?;
        Ok(CanvasNoteSet { agent_id: agent_id.to_owned(), version, notes })
    }

    /// Replaces the notes of `version` with `notes`.
    ///
    /// # Errors
    /// - `NotFound` when the agent or the version does not exist.
    /// - `InvalidInput` for an empty or repeated note id, a position that is not a finite
    ///   number, a size that is not positive, an unknown color, a text over
    ///   [`MAX_NOTE_TEXT_CHARS`] or more than [`MAX_NOTES_PER_VERSION`] notes.
    pub fn save_canvas_notes(&self, agent_id: &str, version: i64, notes: &[CanvasNote]) -> AppResult<CanvasNoteSet> {
        validate_notes(notes)?;
        let mut connection = self.lock()?;
        let transaction = connection.transaction()?;
        ensure_version_exists(&transaction, agent_id, version)?;
        transaction
            .execute("DELETE FROM canvas_notes WHERE agent_id = ?1 AND version = ?2", params![agent_id, version])?;
        for note in notes {
            transaction.execute(
                &format!(
                    "INSERT INTO canvas_notes (agent_id, version, {NOTE_COLUMNS}) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)"
                ),
                params![agent_id, version, note.note_id, note.x, note.y, note.width, note.height, note.text, note.color],
            )?;
        }
        let saved = read_note_rows(&transaction, agent_id, version)?;
        transaction.commit()?;
        Ok(CanvasNoteSet { agent_id: agent_id.to_owned(), version, notes: saved })
    }
}

/// Copies every note of `from_version` to `to_version`. Must run inside the caller's transaction.
pub(super) fn copy_notes_forward(
    connection: &Connection,
    agent_id: &str,
    from_version: i64,
    to_version: i64,
) -> AppResult<()> {
    connection.execute(
        &format!(
            "INSERT OR REPLACE INTO canvas_notes (agent_id, version, {NOTE_COLUMNS})
             SELECT agent_id, ?3, {NOTE_COLUMNS} FROM canvas_notes WHERE agent_id = ?1 AND version = ?2"
        ),
        params![agent_id, from_version, to_version],
    )?;
    Ok(())
}

fn ensure_version_exists(connection: &Connection, agent_id: &str, version: i64) -> AppResult<()> {
    ensure_agent_exists(connection, agent_id)?;
    let exists: bool = connection.query_row(
        "SELECT EXISTS (SELECT 1 FROM agent_versions WHERE agent_id = ?1 AND version = ?2)",
        params![agent_id, version],
        |row| row.get(0),
    )?;
    if exists {
        Ok(())
    } else {
        Err(AppError::NotFound(format!("version {version} of agent {agent_id}")))
    }
}

fn read_note_rows(connection: &Connection, agent_id: &str, version: i64) -> AppResult<Vec<CanvasNote>> {
    let mut statement = connection.prepare(&format!(
        "SELECT {NOTE_COLUMNS} FROM canvas_notes WHERE agent_id = ?1 AND version = ?2 ORDER BY note_id"
    ))?;
    let rows = statement
        .query_map(params![agent_id, version], |row| {
            Ok(CanvasNote {
                note_id: row.get("note_id")?,
                x: row.get("x")?,
                y: row.get("y")?,
                width: row.get("w")?,
                height: row.get("h")?,
                text: row.get("text")?,
                color: row.get("color")?,
            })
        })?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(rows)
}

fn validate_notes(notes: &[CanvasNote]) -> AppResult<()> {
    if notes.len() > MAX_NOTES_PER_VERSION {
        return Err(AppError::InvalidInput(format!("a canvas holds at most {MAX_NOTES_PER_VERSION} notes")));
    }
    let mut seen_ids = HashSet::new();
    for note in notes {
        validate_note(note)?;
        if !seen_ids.insert(note.note_id.as_str()) {
            return Err(AppError::InvalidInput(format!("note `{}` is listed more than once", note.note_id)));
        }
    }
    Ok(())
}

fn validate_note(note: &CanvasNote) -> AppResult<()> {
    if note.note_id.trim().is_empty() {
        return Err(AppError::InvalidInput("a note needs an id".into()));
    }
    if !note.x.is_finite() || !note.y.is_finite() {
        return Err(AppError::InvalidInput(format!("the position of note `{}` is not a number", note.note_id)));
    }
    let has_bad_size = [note.width, note.height].into_iter().any(|size| !size.is_finite() || size <= 0.0);
    if has_bad_size {
        return Err(AppError::InvalidInput(format!("the size of note `{}` must be positive", note.note_id)));
    }
    if !NOTE_COLORS.contains(&note.color.as_str()) {
        return Err(AppError::InvalidInput(format!("note `{}` has an unknown color `{}`", note.note_id, note.color)));
    }
    if note.text.chars().count() > MAX_NOTE_TEXT_CHARS {
        return Err(AppError::InvalidInput(format!(
            "note `{}` is longer than {MAX_NOTE_TEXT_CHARS} characters",
            note.note_id
        )));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::storage::models::{AgentKind, NewAgent};
    use crate::storage::test_support::test_database;

    const ONE_STEP: &str = "graph:\n  nodes:\n    - { id: start, type: start }\n";
    const TWO_STEPS: &str = "graph:\n  nodes:\n    - { id: start, type: start }\n    - { id: write, type: llm }\n";

    fn note(note_id: &str, text: &str) -> CanvasNote {
        CanvasNote {
            note_id: note_id.into(),
            x: 10.0,
            y: -20.5,
            width: 200.0,
            height: 120.0,
            text: text.into(),
            color: "yellow".into(),
        }
    }

    fn create_agent(database: &Database) -> String {
        let new_agent = NewAgent {
            name: "Notes".into(),
            kind: AgentKind::Task,
            description: "Notes".into(),
            flow_yaml: ONE_STEP.into(),
        };
        database.create_agent(new_agent).unwrap().id
    }

    #[test]
    fn saves_and_reads_back_notes() {
        let database = test_database();
        let agent_id = create_agent(&database);
        let blue = CanvasNote { color: "blue".into(), ..note("b", "Ask Sari about the menu") };

        database.save_canvas_notes(&agent_id, 1, &[note("a", "Check the phone numbers"), blue.clone()]).unwrap();
        let saved = database.get_canvas_notes(&agent_id, 1).unwrap();

        assert_eq!(saved.notes, vec![note("a", "Check the phone numbers"), blue]);
        assert_eq!(serde_json::to_value(&saved.notes[0]).unwrap()["w"], 200.0, "size is sent as w / h");
    }

    #[test]
    fn saving_replaces_the_versions_notes() {
        let database = test_database();
        let agent_id = create_agent(&database);
        database.save_canvas_notes(&agent_id, 1, &[note("a", "one"), note("b", "two")]).unwrap();
        let saved = database.save_canvas_notes(&agent_id, 1, &[note("b", "two, edited")]).unwrap();
        assert_eq!(saved.notes, vec![note("b", "two, edited")]);
    }

    #[test]
    fn every_new_version_copies_the_notes_and_history_stays() {
        let database = test_database();
        let agent_id = create_agent(&database);
        database.save_canvas_notes(&agent_id, 1, &[note("a", "keep me")]).unwrap();

        database.update_agent_flow(&agent_id, TWO_STEPS, "Chat change").unwrap();
        database.save_canvas_notes(&agent_id, 2, &[note("a", "keep me"), note("c", "only from v2")]).unwrap();
        database.restore_agent_version(&agent_id, 1).unwrap();

        assert_eq!(database.get_canvas_notes(&agent_id, 2).unwrap().notes.len(), 2);
        assert_eq!(
            database.get_canvas_notes(&agent_id, 3).unwrap().notes,
            vec![note("a", "keep me"), note("c", "only from v2")],
            "a restore copies the notes of the version before it"
        );
        assert_eq!(database.get_canvas_notes(&agent_id, 1).unwrap().notes, vec![note("a", "keep me")]);
    }

    #[test]
    fn unknown_agents_and_versions_are_not_found() {
        let database = test_database();
        let agent_id = create_agent(&database);
        assert!(matches!(database.get_canvas_notes("ghost", 1), Err(AppError::NotFound(_))));
        assert!(matches!(database.get_canvas_notes(&agent_id, 4), Err(AppError::NotFound(_))));
        assert!(matches!(database.save_canvas_notes(&agent_id, 4, &[]), Err(AppError::NotFound(_))));
    }

    #[test]
    fn invalid_notes_are_rejected() {
        let database = test_database();
        let agent_id = create_agent(&database);
        let invalid_sets = [
            vec![note("a", "x"), note("a", "y")],
            vec![CanvasNote { x: f64::INFINITY, ..note("a", "x") }],
            vec![CanvasNote { height: 0.0, ..note("a", "x") }],
            vec![CanvasNote { color: "purple-ish".into(), ..note("a", "x") }],
            vec![note(" ", "x")],
            vec![note("a", &"x".repeat(MAX_NOTE_TEXT_CHARS + 1))],
            (0..=MAX_NOTES_PER_VERSION).map(|index| note(&index.to_string(), "x")).collect(),
        ];
        for notes in &invalid_sets {
            assert!(matches!(database.save_canvas_notes(&agent_id, 1, notes), Err(AppError::InvalidInput(_))));
        }
        assert!(database.get_canvas_notes(&agent_id, 1).unwrap().notes.is_empty(), "nothing was saved");
    }

    #[test]
    fn notes_go_with_their_agent() {
        let database = test_database();
        let agent_id = create_agent(&database);
        database.save_canvas_notes(&agent_id, 1, &[note("a", "x")]).unwrap();
        database.delete_agent(&agent_id).unwrap();
        let connection = database.lock().unwrap();
        let rows: i64 = connection.query_row("SELECT COUNT(*) FROM canvas_notes", [], |row| row.get(0)).unwrap();
        assert_eq!(rows, 0);
    }
}
