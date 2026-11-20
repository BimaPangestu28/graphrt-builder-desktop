//! Where the Nodes view draws each step: positions per agent version and node id,
//! and the canvas zoom and pan per agent.
//!
//! graphrt drops `position` / `width` / `height` from workflow documents, so the
//! layout lives here instead of in the YAML (the builder model never sees it).
//! When a new version is saved (chat change, Nodes edit or restore), the rows of
//! the previous version are copied forward for every node id the new document
//! still has ([`copy_layout_forward`]); new nodes have no row and the UI places
//! them with auto-layout. Rows go with their agent (`ON DELETE CASCADE`).

use std::collections::HashSet;

use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};

use super::agents::ensure_agent_exists;
use super::{now_rfc3339, Database};
use crate::error::{AppError, AppResult};

/// Where one node is drawn. Coordinates are canvas units (React Flow positions).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NodeLayout {
    pub node_id: String,
    pub x: f64,
    pub y: f64,
    /// Size set by the user (containers); `None` lets the UI size the node.
    #[serde(default)]
    pub width: Option<f64>,
    #[serde(default)]
    pub height: Option<f64>,
    #[serde(default)]
    pub collapsed: bool,
}

/// Canvas zoom and pan of one agent (shared by all its versions).
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CanvasViewport {
    pub x: f64,
    pub y: f64,
    pub zoom: f64,
}

/// The saved layout of one agent version.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NodeLayoutSet {
    pub agent_id: String,
    pub version: i64,
    /// Nodes with a saved position, by node id; nodes not listed get auto-layout.
    pub nodes: Vec<NodeLayout>,
    pub viewport: Option<CanvasViewport>,
}

const LAYOUT_COLUMNS: &str = "node_id, x, y, width, height, collapsed";

impl Database {
    /// The saved layout of `version` (empty when nothing was saved for it).
    ///
    /// # Errors
    /// `NotFound` when the agent or the version does not exist.
    pub fn get_node_layout(&self, agent_id: &str, version: i64) -> AppResult<NodeLayoutSet> {
        let connection = self.lock()?;
        ensure_version_exists(&connection, agent_id, version)?;
        let nodes = read_layout_rows(&connection, agent_id, version)?;
        let viewport = read_viewport(&connection, agent_id)?;
        Ok(NodeLayoutSet { agent_id: agent_id.to_owned(), version, nodes, viewport })
    }

    /// Replaces the layout of `version` with `nodes`, and saves the viewport when given.
    ///
    /// # Errors
    /// - `NotFound` when the agent or the version does not exist.
    /// - `InvalidInput` for an empty or repeated node id, a coordinate that is not a
    ///   finite number, a size that is not positive, or a zoom that is not positive.
    pub fn save_node_layout(
        &self,
        agent_id: &str,
        version: i64,
        nodes: &[NodeLayout],
        viewport: Option<CanvasViewport>,
    ) -> AppResult<NodeLayoutSet> {
        validate_layouts(nodes)?;
        if let Some(viewport) = &viewport {
            validate_viewport(viewport)?;
        }
        let mut connection = self.lock()?;
        let transaction = connection.transaction()?;
        ensure_version_exists(&transaction, agent_id, version)?;
        transaction
            .execute("DELETE FROM node_layouts WHERE agent_id = ?1 AND version = ?2", params![agent_id, version])?;
        for layout in nodes {
            transaction.execute(
                &format!(
                    "INSERT INTO node_layouts (agent_id, version, {LAYOUT_COLUMNS}) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)"
                ),
                params![
                    agent_id,
                    version,
                    layout.node_id,
                    layout.x,
                    layout.y,
                    layout.width,
                    layout.height,
                    layout.collapsed
                ],
            )?;
        }
        if let Some(viewport) = viewport {
            transaction.execute(
                "INSERT INTO canvas_viewports (agent_id, x, y, zoom, updated_at) VALUES (?1, ?2, ?3, ?4, ?5)
                 ON CONFLICT (agent_id) DO UPDATE SET x = excluded.x, y = excluded.y, zoom = excluded.zoom,
                 updated_at = excluded.updated_at",
                params![agent_id, viewport.x, viewport.y, viewport.zoom, now_rfc3339()],
            )?;
        }
        let saved_nodes = read_layout_rows(&transaction, agent_id, version)?;
        let saved_viewport = read_viewport(&transaction, agent_id)?;
        transaction.commit()?;
        Ok(NodeLayoutSet { agent_id: agent_id.to_owned(), version, nodes: saved_nodes, viewport: saved_viewport })
    }
}

/// Copies the layout rows of `from_version` to `to_version` for the node ids that
/// `flow_yaml` (the new version's document) still has. A document graphrt cannot
/// read keeps no positions. Must run inside the caller's transaction.
pub(super) fn copy_layout_forward(
    connection: &Connection,
    agent_id: &str,
    from_version: i64,
    to_version: i64,
    flow_yaml: &str,
) -> AppResult<()> {
    let Ok(workflow) = graphrt_core::Workflow::parse(flow_yaml) else { return Ok(()) };
    let node_ids: Vec<&str> = workflow.graph.nodes.iter().map(|node| node.id.as_str()).collect();
    if node_ids.is_empty() {
        return Ok(());
    }
    connection.execute(
        &format!(
            "INSERT OR REPLACE INTO node_layouts (agent_id, version, {LAYOUT_COLUMNS})
             SELECT agent_id, ?3, {LAYOUT_COLUMNS} FROM node_layouts
             WHERE agent_id = ?1 AND version = ?2 AND node_id IN (SELECT value FROM json_each(?4))"
        ),
        params![agent_id, from_version, to_version, serde_json::to_string(&node_ids)?],
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

fn read_layout_rows(connection: &Connection, agent_id: &str, version: i64) -> AppResult<Vec<NodeLayout>> {
    let mut statement = connection.prepare(&format!(
        "SELECT {LAYOUT_COLUMNS} FROM node_layouts WHERE agent_id = ?1 AND version = ?2 ORDER BY node_id"
    ))?;
    let rows = statement
        .query_map(params![agent_id, version], |row| {
            Ok(NodeLayout {
                node_id: row.get("node_id")?,
                x: row.get("x")?,
                y: row.get("y")?,
                width: row.get("width")?,
                height: row.get("height")?,
                collapsed: row.get("collapsed")?,
            })
        })?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(rows)
}

fn read_viewport(connection: &Connection, agent_id: &str) -> AppResult<Option<CanvasViewport>> {
    let viewport = connection
        .query_row("SELECT x, y, zoom FROM canvas_viewports WHERE agent_id = ?1", [agent_id], |row| {
            Ok(CanvasViewport { x: row.get(0)?, y: row.get(1)?, zoom: row.get(2)? })
        })
        .optional()?;
    Ok(viewport)
}

fn validate_layouts(nodes: &[NodeLayout]) -> AppResult<()> {
    let mut seen_ids = HashSet::new();
    for layout in nodes {
        if layout.node_id.trim().is_empty() {
            return Err(AppError::InvalidInput("a node position needs a node id".into()));
        }
        if !seen_ids.insert(layout.node_id.as_str()) {
            return Err(AppError::InvalidInput(format!("node `{}` has more than one position", layout.node_id)));
        }
        if !layout.x.is_finite() || !layout.y.is_finite() {
            return Err(AppError::InvalidInput(format!("the position of node `{}` is not a number", layout.node_id)));
        }
        let has_bad_size =
            [layout.width, layout.height].into_iter().flatten().any(|size| !size.is_finite() || size <= 0.0);
        if has_bad_size {
            return Err(AppError::InvalidInput(format!("the size of node `{}` must be positive", layout.node_id)));
        }
    }
    Ok(())
}

fn validate_viewport(viewport: &CanvasViewport) -> AppResult<()> {
    let is_valid = viewport.x.is_finite() && viewport.y.is_finite() && viewport.zoom.is_finite() && viewport.zoom > 0.0;
    if is_valid {
        Ok(())
    } else {
        Err(AppError::InvalidInput("the canvas zoom and pan must be finite numbers, with a positive zoom".into()))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::storage::models::{AgentKind, NewAgent};
    use crate::storage::test_support::test_database;

    const TWO_STEPS: &str = "graph:\n  nodes:\n    - { id: start, type: start }\n    - { id: write, type: llm }\n";
    const WRITE_REMOVED: &str = "graph:\n  nodes:\n    - { id: start, type: start }\n    - { id: send, type: llm }\n";

    fn layout(node_id: &str, x: f64, y: f64) -> NodeLayout {
        NodeLayout { node_id: node_id.into(), x, y, width: None, height: None, collapsed: false }
    }

    fn create_agent(database: &Database) -> String {
        let new_agent = NewAgent {
            name: "Layout".into(),
            kind: AgentKind::Task,
            description: "Positions".into(),
            flow_yaml: TWO_STEPS.into(),
        };
        database.create_agent(new_agent).unwrap().id
    }

    #[test]
    fn saves_and_reads_back_positions_and_viewport() {
        let database = test_database();
        let agent_id = create_agent(&database);
        let sized =
            NodeLayout { width: Some(320.0), height: Some(200.0), collapsed: true, ..layout("write", 10.0, 20.5) };
        let viewport = CanvasViewport { x: -40.0, y: 12.0, zoom: 0.8 };

        database.save_node_layout(&agent_id, 1, &[layout("start", 0.0, 0.0), sized.clone()], Some(viewport)).unwrap();
        let saved = database.get_node_layout(&agent_id, 1).unwrap();

        assert_eq!(saved.nodes, vec![layout("start", 0.0, 0.0), sized]);
        assert_eq!(saved.viewport, Some(viewport));
    }

    #[test]
    fn saving_replaces_the_versions_rows() {
        let database = test_database();
        let agent_id = create_agent(&database);
        database.save_node_layout(&agent_id, 1, &[layout("start", 0.0, 0.0), layout("write", 1.0, 1.0)], None).unwrap();
        let saved = database.save_node_layout(&agent_id, 1, &[layout("write", 5.0, 5.0)], None).unwrap();
        assert_eq!(saved.nodes, vec![layout("write", 5.0, 5.0)]);
        assert_eq!(saved.viewport, None);
    }

    #[test]
    fn a_new_version_copies_positions_of_nodes_it_still_has() {
        let database = test_database();
        let agent_id = create_agent(&database);
        database
            .save_node_layout(&agent_id, 1, &[layout("start", 0.0, 0.0), layout("write", 100.0, 50.0)], None)
            .unwrap();

        database.update_agent_flow(&agent_id, WRITE_REMOVED, "Swapped a step").unwrap();
        let second = database.get_node_layout(&agent_id, 2).unwrap();
        database.restore_agent_version(&agent_id, 1).unwrap();
        let third = database.get_node_layout(&agent_id, 3).unwrap();

        assert_eq!(second.nodes, vec![layout("start", 0.0, 0.0)], "`send` is new, `write` is gone");
        assert_eq!(third.nodes, vec![layout("start", 0.0, 0.0)], "restoring copies from the version before it");
        assert_eq!(database.get_node_layout(&agent_id, 1).unwrap().nodes.len(), 2, "history is never rewritten");
    }

    #[test]
    fn unknown_agents_and_versions_are_not_found() {
        let database = test_database();
        let agent_id = create_agent(&database);
        assert!(matches!(database.get_node_layout("ghost", 1), Err(AppError::NotFound(_))));
        assert!(matches!(database.get_node_layout(&agent_id, 9), Err(AppError::NotFound(_))));
        assert!(matches!(database.save_node_layout(&agent_id, 9, &[], None), Err(AppError::NotFound(_))));
    }

    #[test]
    fn invalid_positions_are_rejected() {
        let database = test_database();
        let agent_id = create_agent(&database);
        let repeated = [layout("start", 0.0, 0.0), layout("start", 1.0, 1.0)];
        let not_a_number = [layout("start", f64::NAN, 0.0)];
        let empty_size = [NodeLayout { width: Some(0.0), ..layout("start", 0.0, 0.0) }];
        let flat_zoom = CanvasViewport { x: 0.0, y: 0.0, zoom: 0.0 };

        for nodes in [&repeated[..], &not_a_number[..], &empty_size[..], &[layout(" ", 0.0, 0.0)][..]] {
            assert!(matches!(database.save_node_layout(&agent_id, 1, nodes, None), Err(AppError::InvalidInput(_))));
        }
        assert!(matches!(
            database.save_node_layout(&agent_id, 1, &[], Some(flat_zoom)),
            Err(AppError::InvalidInput(_))
        ));
    }

    #[test]
    fn layouts_go_with_their_agent() {
        let database = test_database();
        let agent_id = create_agent(&database);
        let viewport = CanvasViewport { x: 0.0, y: 0.0, zoom: 1.0 };
        database.save_node_layout(&agent_id, 1, &[layout("start", 0.0, 0.0)], Some(viewport)).unwrap();
        database.delete_agent(&agent_id).unwrap();
        let connection = database.lock().unwrap();
        let rows: i64 = connection
            .query_row(
                "SELECT (SELECT COUNT(*) FROM node_layouts) + (SELECT COUNT(*) FROM canvas_viewports)",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(rows, 0);
    }
}
