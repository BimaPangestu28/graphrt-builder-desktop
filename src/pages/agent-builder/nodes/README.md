# Nodes view (builder · Steps | Nodes)

The builder's Nodes tab shows an agent version as a graph and saves edits as new
versions. Spec: the "Builder · Nodes (proposal)" section of the design canvas
(artboards 32–56). `index.ts` exports `NodesView`; the builder page loads it (and with
it `@xyflow/react`) on demand when the Nodes tab opens, so the Steps view never pays for
the canvas.

## Folder

| Path | What |
| --- | --- |
| `NodesView.tsx` | Shell: toolbar, sync banner, palette · canvas · inspector, problems, run bar. Owns the `useAgentGraph` controller and memoizes the provider values it hands down. |
| `NodesToolbar.tsx` | Add node, Auto-layout, Undo / Redo, save state, Save |
| `contracts.ts` | Props of `NodeCanvas`, `NodeInspector`, `AddNodePalette`, `RunOverlay`, `ProblemsPanel`, `SyncBanner` |
| `useAgentGraph.ts` | Load, working copy, undo / redo, save with conflict / busy handling, positions (see below) |
| `useNodeKinds.ts` | The node library (`get_node_kinds`) |
| `graphEdits.ts` | Pure edit functions (`updateGraphNode`, `addGraphEdge`, `insertGraphNodeOnEdge`, `reparentGraphNodes`, `referencedNodeIds`, `toGraphEdit`…). Every action of `useAgentGraph` and every compound edit inside `applyEdit` goes through them. |
| `NodeCanvas.tsx` | The canvas: wires React Flow to the hooks in `flow/` and draws the overlays |
| `NodeInspector.tsx`, `inspector/*` | Step settings (below) |
| `AddNodePalette.tsx`, `palette/*` | Add node palette (below) |
| `RunOverlay.tsx`, `ProblemsPanel.tsx`, `SyncBanner.tsx` | Live run layer (arrow styles, Review card), problems list, builder-busy queue + per-step conflicts |
| `run/*` | Test and live runs on the canvas (below) |
| `problems/*` | Problem labels, Fix with builder text, why Test is off, live validation (`useGraphValidation`) |
| `sync/*` | History, positions, builder lock, merge and autosave (below) |
| `notes/*` | Sticky notes: `useCanvasNotes` (load / save per version), `NoteNode` renderer (type `note`, flow ids `note:<id>`) |

### `flow/`: the canvas

- `flowLibrary.ts`: the only import of `@xyflow/react` 12.12.1.
- `toFlowElements.ts`: graph → React Flow nodes and edges (plugin labels through `lib/pluginDisplayName`, like the rest of the app). `StepNode.tsx`, `StepEdge.tsx`, `NodeKindIcon.tsx` render them.
- `autoLayout.ts` + `layoutEngine.ts`: ELK (`elkjs` 0.12.0) places nodes without a saved position. `layoutEngine` runs ELK in a Web Worker only (`elk-api` + `elk-worker.min.js`, emitted as its own asset) so a large layout never blocks the canvas; there is no in-thread copy of ELK (every Tauri webview has workers). When the worker cannot start, the layout rejects with `LayoutWorkerError` and the canvas places the steps in a row; the next layout tries a fresh worker. One engine is created on first use and reused. Canvas tests replace it with `__tests__/fakeElkLayout.ts`; tests that need real ELK stub `Worker` with `__tests__/elkTestWorker.ts` (elkjs' FakeWorker).
- `useCanvasLayout.ts`: merges saved and auto-laid-out positions (`mergedPositions`), reports placed ones through `onPlaced`.
- Behaviour hooks used by `NodeCanvas`, each with one job:
  - `useConnectMode`: drawing arrows by drag or keyboard (Enter on a port, Enter on the target), per-target `checkConnection` while drawing, reconnecting an arrow's end.
  - `useCanvasClipboard`: copy (app + system clipboard), paste (at a point, or stepping down-right on repeats), duplicate.
  - `useCanvasEditCommands`: delete, disconnect, nudge; shared by keys, menu and selection bar.
  - `useCanvasContextMenu`: the step menu and the empty-canvas menu (`NodeContextMenu.tsx` draws them).
  - `useCanvasShortcuts`: the key table in `shortcuts.ts` and the "?" panel.
  - `useFlowElementState`: React Flow's node list (keeps measured sizes across rebuilds) and the arrow selection.
  - `useContainerDrag`: dragging steps into and out of loops (`containerDrop.ts` finds the loop under a point).
  - `useCanvasViewportFit`, `minimapPreference.ts`, `usePrefersReducedMotion`: fitting, minimap, motion.
- Pure helpers: `canvasCommands.ts` (clipboard I/O, node list wording, nudging), `clipboard.ts` (copy / paste graph parts), `placement.ts`, `nodeGeometry.ts`, `nodePreview.ts`.
- `CanvasOverlays.tsx`: zoom controls, shortcuts panel, selection bar, empty canvas; `canvasActions.ts`: contexts the cards use (open menu, keyboard connect, resize a loop, add on an arrow, drop hint).

### `inspector/`: step settings

`NodeInspector` picks a panel from `panelRegistry.tsx` (`panels/*`: Start inputs editor, Ask a model, AI steps, HTTP request / Run an agent / Use a tool, data and flow steps, plugin actions) and wraps it in `InspectorContext` (node, graph, value groups, edit helpers). Shared parts: `fields.tsx` (inputs, sections), `SchemaForm.tsx` (JSON Schema config, lists of simple objects as rows), `TemplateField.tsx` with `templateEditorDom.ts` (`{{#node.field#}}` chips in a contentEditable box), `ValuePicker`, `SelectorField`, `SecretPicker`, `ModelField`, `ConditionsEditor`, `ErrorHandlingSection` (When this step fails). Pure logic: `availableValues.ts` (what a step can read), `references.ts`, `configPaths.ts`, `startInputs.ts`, `branchEdits.ts`, `toolSources.ts`.

### `palette/`: Add node

`AddNodePalette` (300px, floating) browses built-in steps by group, installed plugins (most used first, `usePaletteUsage`) and catalog plugins; `paletteSearch` searches them, `usePaletteNavigation` handles ↑ ↓ Enter Esc. `nodePlacement` builds the node and where it goes (after a step, on an arrow, at a point); `paletteDrag` / `PaletteDropZone` handle dragging onto the canvas. A catalog action asks for install approval first (`usePaletteInstall`, `PluginInstallPrompt`).

### `run/`: runs on the canvas

- `nodeRunStates.ts`: run events → node and arrow states. `useNodesTestRun` (Test) and `useNodesLiveRun` (a run started elsewhere) pick the shown run.
- `NodeDecorations.tsx`: `NodeDecorationsProvider` + `<NodeDecoration nodeId variant?="container" />` inside each card (status chip, outline, details, loop counters, live browser view). Its value is memoized and holds no clock, so it only changes when the run does.
- `CanvasClock.tsx`: the ticking clock in its own context. Only the elapsed time of a running step, a question's deadline and `RunBar` call `useCanvasNow()`, so a tick re-renders just those leaves, never the canvas or the cards (`__tests__/canvasClockRenders.test.tsx` guards it).
- `RunCanvasStyles.tsx`: arrow states as a scoped stylesheet keyed by edge `data-id`; `NodesRunActions.tsx`: Test / Validate / Add note.

### `sync/`: history, positions and the builder

- `graphHistory.ts`: the working copy and its undo / redo as one pure reducer (`{ savedGraph, graph, past, future, pendingDescriptions }`). Each transition starts from the current state, so edits dispatched in the same tick all apply, in order.
- `useNodePositions.ts`: positions and viewport (saved on their own, not undoable), `isLayoutDirty`.
- `useBuilderLock.ts`: whether the builder chat is changing the agent (`get_agent_edit_state` + event).
- `graphMerge.ts`: 3-way per-step merge when a newer version arrives; `useGraphAutosave.ts`; `NodesEditNotice.tsx` (the chat's "Edited in Nodes" line with Undo).

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
| `getToolInputSchemas()` | `get_tool_input_schemas` | JSON Schema of each plugin tool (manifest) and MCP tool (cached from the server's last Test connection); `inputSchema: null` when unknown |
| `stopAgentRevision(agentId)` (`src/api/builder.ts`) | `stop_agent_revision` | Stop the builder: the running chat revision ends with `stopped`, saves nothing, releases the edit lock, chat notes "Stopped by you" |

Types: `src/api/agentGraphTypes.ts` (mirrors `src-tauri/src/agent_graph/model.rs`).
The sample backend (`src/api/sampleBackend/agentGraph.ts`) behaves the same in the
browser preview and tests; `setSampleBuilderBusy` and `resetSampleAgentGraphs` help tests.

`GraphEdit.declareSecrets`: secret names to add to the document's `env` (`type: secret`) when missing.
`toGraphEdit` sends the working graph's secret `env` names, so adding one to `graph.env` (the HTTP
sign-in picker does, `inspector/SecretPicker.tsx`) declares it on save.

Save errors (`BackendError.code`; `details` is typed per code, read it after `isBackendErrorWithCode`):
- `builder_busy`: a chat change is running. The hook sets `status: 'builder-busy'`.
- `version_conflict`: `details.latestVersion` (`conflictLatestVersion`). The hook sets `conflict`; `resolveConflict('keep-mine' | 'keep-theirs')`.
- `invalid_graph`: `details.problems` (blocking `GraphProblem`s, `invalidGraphProblems`). The hook sets `saveProblems`.

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

`applyEdit`, `undo` and `redo` are stable dispatches into `sync/graphHistory.ts`: two edits in
the same tick both apply, in order. Positions come from `sync/useNodePositions.ts`, the busy flag
from `sync/useBuilderLock.ts`.

When `currentVersion` (from the builder page) moves past the loaded version, the hook
reloads when clean and sets `conflict` when dirty. While `builderBusy`, the canvas is read-only
and `save` does not call the backend.

## Live run, problems and sync (live/sync part)

- **Node decorations**: `NodesView` wraps the canvas in `CanvasClockProvider` and `NodeDecorationsProvider`
  (memoized value, no clock in it); step and container cards render `<NodeDecoration nodeId={…} variant?="container" />`
  inside their `relative` root. Live times read `useCanvasNow()`. Arrow states are a scoped stylesheet keyed by
  React Flow's edge `data-id` (`run/RunCanvasStyles.tsx`), so `toFlowEdges` stays as it is.
- **Notes**: `NodeCanvas` takes `notes` / `onMoveNote` and registers `noteNodeTypes`; note flow ids start
  with `note:` (`isNoteFlowNodeId`) and never reach `onSelectionChange` or `onMoveNodes`.
- **Queue and merge**: while the builder is busy the canvas is read-only but inspector edits stay local;
  when a newer version arrives (page `currentVersion`, or `version_conflict` on save) `useAgentGraph`
  merges them per step (`sync/graphMerge.ts`). Steps both changed → `status: 'conflict'`,
  `conflict.nodes`, `resolveNodeConflict(nodeId, choice)` / `resolveConflict(choice)` (then saves).
- **Autosave** (spec S1): `useGraphAutosave` saves 1.5 s after the last edit; refused edits are not resent
  until they change. `NodesView autosaveDelayMs={null}` turns it off (tests).

## Inspector requests (`requestedSection`)

`NodeInspector` takes `requestedSection: { section, sequence, nodeId? }` (`contracts.ts`). `section` is
`change-action` (opens the action picker), `on-error`, another `InspectorSection` `sectionKey` (`sign-in`,
`inputs`, `tool`, `tools`, `time-limit`) or a field's config path (`url`, `config.timeout.read`,
`authorization.config.api_key`, `tool_parameters.city`). The section opens (closed ones look inside
themselves first), the control scrolls into view and gets focus. Each `sequence` is handled once; a request
with another `nodeId` is ignored. `NodesView.requestInspectorSection(nodeId, section)` selects the node and
sends one. Fields are found by `data-field-path` (`Field` / `TemplateField` `fieldPath`, schema form
properties by name), else by a label matching the last path segment.

## Layout and canvas

- **Chat column**: in Nodes the builder page narrows the chat to 360px (spec A) and it folds to a
  52px rail (`useChatRailPreference`, localStorage, guarded). Windows under 1320px start folded
  until the viewer chooses. A prefill (Fix with builder, plugin setup) opens it again.
- **Docked inspector** resizes the canvas; the palette floats (300px) and the canvas fits clear of it
  (`overlayInsets.left`). `flow/useCanvasViewportFit`: Fit (px padding, max 100%) runs again when the
  canvas resizes, or keeps the selected step centred when the inspector opens; `focusRequest`
  centres a step (Show node, palette adds, `requestInspectorSection`).
- **Toolbar**: one row in a container query; labels fold to icons under 46rem, the save detail under 64rem
  (tooltip keeps the full text).
- **Arrows**: branch / error names are drawn at the arrow's middle (`edgeLabelOf`); an exit without an
  arrow keeps its name beside the port. Hover or select an arrow for "+" (`onRequestAddNode` on-edge).
- **Loops**: steps drag into and out of loops (`flow/useContainerDrag`): the loop highlights, and
  `checkReparentNodes` refuses moves that break references (a step reading the loop item stays in;
  a step whose result is read outside cannot go in). `reparentGraphNodes` drops crossing arrows.
- **Clipboard**: copy writes `{"graphrt":"nodes","version":1,…}` to the system clipboard too; paste
  reads and validates it (`parseGraphClipboard`), else the session copy.
- **Placement**: palette nodes after a step or on an arrow are placed by the canvas; a step inserted
  between two pushes the later steps along (down at the top level, right in a loop).
- **Canvas menu** (right-click on empty canvas or a note): Add node here, Add note here, Paste, Fit.
  Middle-drag or Space + drag pans. Notes resize when selected. End is a pill; cards go compact below 60%.

## Still open

- Change action (B2) lists a plugin's other kinds from `getNodeKinds()` filtered by `plugin.name`.
- Inserting at the top level pushes later steps down but does not re-run ELK; Auto-layout tidies up.
