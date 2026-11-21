# Nodes view (builder · Steps | Nodes)

The builder's Nodes tab shows an agent version as a graph and saves edits as new
versions. Spec: the "Builder · Nodes (proposal)" section of the design canvas
(artboards 32–56). This folder is the **phase-2 contract**: four agents build the
canvas, inspector, add-node palette and live-run / sync parts on top of it.

## Folder

| File | What | Phase 2 owner |
| --- | --- | --- |
| `NodesView.tsx` | Shell: toolbar, sync banner, palette · canvas · inspector, problems. Owns the controller. | shared (keep the layout) |
| `NodesToolbar.tsx` | Add node, Auto-layout, Undo / Redo, save state, Save | shared |
| `useAgentGraph.ts` | Load, local edit state, dirty tracking, undo / redo, save with conflict / busy handling, positions | shared (extend, don't break) |
| `useNodeKinds.ts` | The node library (`get_node_kinds`) | palette, inspector |
| `graphEdits.ts` | Pure edit functions (`updateGraphNode`, `addGraphEdge`, `createGraphNode`, `uniqueNodeId`, `toGraphEdit`…) | everyone |
| `contracts.ts` | Props of the phase-2 components | everyone |
| `NodeCanvas.tsx`, `flow/*` | Canvas: React Flow + ELK auto-layout, read-only render, drag to move | **canvas** |
| `NodeInspector.tsx`, `inspector/*` | Step settings: header, per-kind panels, schema form, Change action, When this step fails, variable picker (`{{#node.field#}}` chips) | **inspector** |
| `AddNodePalette.tsx` | STUB: lists offered kinds | **palette** |
| `RunOverlay.tsx`, `ProblemsPanel.tsx`, `SyncBanner.tsx` | Live run layer (arrow styles, Review card), problems list, builder-busy queue + per-step conflicts | **live/sync** |
| `run/*` | Run events → node / arrow states (`nodeRunStates.ts`), the shown run (`useNodesTestRun`, `useNodesLiveRun`), `RunBar`, `NodeDecorations` (badges drawn inside cards), Test / Validate / Add note actions | **live/sync** |
| `problems/*` | Problem labels, Fix with builder text, why Test is off, live validation (`useGraphValidation`) | **live/sync** |
| `sync/*` | 3-way per-node merge (`graphMerge.ts`), autosave, the chat's "Edited in Nodes" line with Undo | **live/sync** |
| `notes/*` | Sticky notes: `useCanvasNotes`, `NoteNode` renderer (type `note`) | **live/sync** |

Libraries: `@xyflow/react` 12.12.1 (import only from `flow/flowLibrary.ts`) and
`elkjs` 0.12.0 (only through `flow/autoLayout.ts`, loaded lazily).
Tests that render the canvas call `installReactFlowTestEnvironment()` from
`src/test/reactFlowTestEnvironment.ts`.

## Backend (Tauri commands, `src/api/agentGraph.ts`)

| Function | Command | Notes |
| --- | --- | --- |
| `getAgentGraph(agentId, version?)` | `get_agent_graph` | `AgentGraph`: nodes (ports, container, hidden markers, config), edges, inputs, env, problems |
| `getNodeKinds()` | `get_node_kinds` | builtins (app names) + installed and catalog plugin actions, config JSON Schema, outputs, port rules |
| `saveAgentGraph(agentId, baseVersion, edit)` | `save_agent_graph` | new version "Edited in Nodes: …", chat entry; errors below |
| `getNodeLayout` / `saveNodeLayout` | `get_node_layout` / `save_node_layout` | positions per version + viewport per agent; moving adds no version |
| `getAgentEditState` / `listenToAgentEditState` | `get_agent_edit_state` / event `agent-edit-state` | builder busy |
| `validateAgentGraph(agentId, baseVersion, edit)` | `validate_agent_graph` | problems of an unsaved edit; saves nothing, works while busy |
| `getCanvasNotes` / `saveCanvasNotes` | `get_canvas_notes` / `save_canvas_notes` | sticky notes per version (`canvas_notes` table), copied forward to every new version |

Types: `src/api/agentGraphTypes.ts` (mirrors `src-tauri/src/agent_graph/model.rs`).
The sample backend (`src/api/sampleBackend/agentGraph.ts`) behaves the same in the
browser preview and tests; `setSampleBuilderBusy` and `resetSampleAgentGraphs` help tests.

Save errors (`BackendError.code`):
- `builder_busy`: a chat change is running. The hook sets `status: 'builder-busy'`.
- `version_conflict`: `details.latestVersion`. The hook sets `conflict`; `resolveConflict('keep-mine' | 'keep-theirs')`.
- `invalid_graph`: `details.problems` (blocking `GraphProblem`s). The hook sets `saveProblems`.

## Data rules

- **Node `config`** is the YAML node minus id/type/title/parent/on_error/retry/timeout_ms,
  snake_case, unknown keys included. Change only what you edit; the backend writes it back
  through graphrt-core types, so unknown keys survive.
- **Node ids are fixed** (`{{#id.field#}}` references point at them). New ids: `uniqueNodeId`.
- **Ports**: output port ids are edge handles (`source`, if-else `case_id`s + `false`,
  human-input action ids or `submit`, classifier class ids, `fail-branch` when
  `onError.strategy === 'fail-branch'`). `graphEdits` recomputes them locally
  (`src/lib/agentGraphRules.ts`); the backend's win on load.
- **Containers** (`iteration`, `loop`): children set `parent`. The hidden marker
  (`iteration-start` / `loop-start`, `hidden: true`) is the body's entry; keep it. The
  backend adds `<container>_start` (wired to body roots) when a container has none, so
  the palette can add a bare container. Arrows never cross a container boundary.
- **Edges**: send `documentId` back unchanged; new arrows omit it. `unused` = the source has
  no such exit (e.g. error path switched off): kept, flagged as a warning.
- **Positions** are React Flow positions, child positions relative to their container.
  Saved per version; copied forward to every new version (chat edits, restores, Nodes saves)
  for node ids that still exist. Nodes without one get ELK auto-layout.

## `useAgentGraph({ agentId, currentVersion, onSaved })`

State: `savedGraph`, `graph` (working copy: render this), `isLoading`, `loadError`,
`isDirty`, `canUndo`, `canRedo`, `pendingDescriptions`, `positions`, `viewport`,
`isLayoutDirty`, `builderBusy`, `status` (`idle | saving | saved | conflict | builder-busy | invalid | failed`),
`conflict`, `saveProblems`, `saveError`, `lastSave`.

Actions (each graph edit is one undo step; pass a plain-words `description`, they become the
version summary, e.g. "set Retry 2× on Send"):
- `applyEdit(graph => graph, description?)` for compound edits with `graphEdits` functions
- `updateNode(id, changes, description?)`, `addNode(node)`, `removeNodes(ids)` (bodies and arrows go too),
  `addEdge(edge)`, `removeEdges(ids)`
- `undo()`, `redo()`, `discardChanges()`, `reload()`
- `save(description?)`: resolves with `SaveGraphResult` or null (nothing to save, busy, refused: see `status`)
- `resolveConflict('keep-mine')` saves the working copy over the latest version (the builder's stays in
  History); `'keep-theirs'` drops local edits and loads the latest
- `moveNodes(layouts)`, `setViewport(viewport)`, `saveLayout()` (NodesView autosaves 800 ms after a move)

When `currentVersion` (from the builder page) moves past the loaded version, the hook
reloads when clean and sets `conflict` when dirty. While `builderBusy`, the canvas is read-only
and `save` does not call the backend.

## Live run, problems and sync (live/sync part)

- **Node decorations**: `NodesView` wraps the canvas in `NodeDecorationsProvider`; step and container
  cards render `<NodeDecoration nodeId={…} variant?="container" />` inside their `relative` root
  (status chip on the top edge, outline, details under the card, loop counters, live browser view).
  Arrow states are a scoped stylesheet keyed by React Flow's edge `data-id` (`run/RunCanvasStyles.tsx`),
  so `toFlowEdges` stays as it is.
- **Notes**: `NodeCanvas` takes `notes` / `onMoveNote` and registers `noteNodeTypes`; note flow ids start
  with `note:` (`isNoteFlowNodeId`) and never reach `onSelectionChange` or `onMoveNodes`.
- **Queue and merge**: while the builder is busy the canvas is read-only but inspector edits stay local;
  when a newer version arrives (page `currentVersion`, or `version_conflict` on save) `useAgentGraph`
  merges them per step (`sync/graphMerge.ts`). Steps both changed → `status: 'conflict'`,
  `conflict.nodes`, `resolveNodeConflict(nodeId, choice)` / `resolveConflict(choice)` (then saves).
- **Autosave** (spec S1): `useGraphAutosave` saves 1.5 s after the last edit; refused edits are not resent
  until they change. `NodesView autosaveDelayMs={null}` turns it off (tests).

## Still open

- Stop the builder: no backend command to cancel a running revision yet (`onStopBuilder` is unwired).
- Show node selects the step; centering the viewport on it needs the canvas's React Flow instance.
- Notes cannot be resized yet; the context menu entry (Add note) belongs to the canvas menu.
- Change action (B2) lists a plugin's other kinds from `getNodeKinds()` filtered by `plugin.name`.
