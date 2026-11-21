import type { AgentGraph, CanvasNote, CanvasViewport, EdgeEdit, GraphNode, GraphProblem, NodeKindInfo, NodeLayout } from '@/api/agentGraphTypes'
import type { NodesLiveRun } from './run/useNodesLiveRun'
import type { AgentGraphController } from './useAgentGraph'

/**
 * Props contracts of the Nodes view components that phase 2 builds out. `NodesView`
 * already renders every one of them with these props; keep the names and shapes
 * (adding optional props is fine) so the shell and the other agents' parts keep
 * working. See `README.md` in this folder for who owns what.
 */

/**
 * Canvas (canvas agent). Today: read-only render with ELK auto-layout for nodes without a
 * position, drag to move. The toolbar's Auto-layout writes fresh positions through
 * `onMoveNodes`, so the canvas only places nodes that have none.
 */
export interface NodeCanvasProps {
  /** The working copy to draw (`useAgentGraph().graph`). */
  graph: AgentGraph
  /** Saved and moved positions by node id; nodes without one are auto-laid out. */
  positions: Record<string, NodeLayout>
  viewport: CanvasViewport | null
  /** Library names by kind ("Ask a model"), for the card subtitles. */
  kindNames: Record<string, string>
  selectedNodeIds: string[]
  /** True while the builder works or nothing can be edited: no drag, no connect, no delete. */
  readOnly: boolean
  onSelectionChange: (nodeIds: string[]) => void
  /** Nodes dragged to new positions (relative to their container). */
  onMoveNodes: (layouts: NodeLayout[]) => void
  onViewportChange: (viewport: CanvasViewport) => void
  /** Phase 2: an arrow drawn between two ports. */
  onConnect?: (edge: EdgeEdit) => void
  /** Phase 2: nodes or arrows deleted with the keyboard. */
  onDelete?: (selection: { nodeIds: string[]; edgeIds: string[] }) => void
  /** Library entries by kind: plugin names on cards, "Not installed" for catalog plugins. */
  kindsByKind?: Record<string, NodeKindInfo>
  /** Setup gaps of the plugins the steps use, by plugin name ("Not linked"). */
  pluginStatuses?: Record<string, NodeSetupStatus>
  /**
   * Compound edits (paste, duplicate, disconnect, reconnect) as one undo step:
   * `useAgentGraph().applyEdit`. Without it those actions are off.
   */
  onApplyEdit?: (change: (graph: AgentGraph) => AgentGraph, description?: string) => void
  onUndo?: () => void
  onRedo?: () => void
  /** "Add node" (toolbar key A, empty state): opens the palette. */
  onOpenPalette?: () => void
  /** Context menu "Add node after": opens the palette to add a step after this exit. */
  onAddNodeAfter?: (from: { source: string; sourceHandle: string }) => void
  /** Context menu "Change action" (plugin steps): opens the inspector's action picker. */
  onChangeAction?: (nodeId: string) => void
  /** Enter on a node: open its settings in the inspector. */
  onOpenNodeSettings?: (nodeId: string) => void
  /** "Ask the builder about this": pre-fills the chat with `text` (never sends). Empty text only focuses the chat. */
  onAskBuilder?: (text: string) => void
  /**
   * Phase 2: opens the Add node palette at an anchor: context menu "Add node after"
   * (`{ type: 'after-node', nodeId }`) and the "+" on an arrow (`{ type: 'on-edge', edgeId }`).
   * Drops from the palette are handled around the canvas (`palette/PaletteDropZone`).
   */
  onRequestAddNode?: (anchor: AddNodeAnchor) => void
  /** Sticky notes drawn under the steps (`notes/NoteNode.tsx`); their edits go through `CanvasNotesProvider`. */
  notes?: CanvasNote[]
  /** A note dragged to a new position. */
  onMoveNote?: (noteId: string, position: { x: number; y: number }) => void
}

/** A setup gap shown on a plugin step's card ("Not linked", "Not installed"). */
export interface NodeSetupStatus {
  label: string
  tone: 'amber' | 'danger'
}

/** Inspector (inspector agent): edits the selected node through `controller` actions. */
export interface NodeInspectorProps {
  /** The selected node, or null when nothing (or several nodes) is selected. */
  node: GraphNode | null
  graph: AgentGraph
  /** The node's kind in the library (config schema, outputs), when known. */
  kindInfo: NodeKindInfo | null
  nodeKinds: NodeKindInfo[]
  /** This node's problems from the last load or refused save. */
  problems: GraphProblem[]
  readOnly: boolean
  /** `updateNode`, `removeNodes`, `addEdge`… with a description per edit ("set Retry 2× on Send"). */
  controller: AgentGraphController
  onClose: () => void
  /**
   * Prefills the builder chat with a question about the node (never sends it). Optional:
   * without it the inspector sets the builder page's `ask` search param, which the chat reads.
   */
  onAskBuilder?: (text: string) => void
  /**
   * Opens part of the settings, scrolls to it and focuses its control: the canvas menu's
   * "Change action" (`change-action`), the problems list's "Show node" or a field error
   * (`on-error`, a section key, or a config path such as `url`). `sequence` changes on every
   * request, so asking twice opens it again. See {@link InspectorSectionRequest}.
   */
  requestedSection?: InspectorSectionRequest | null
}

/**
 * What `requestedSection` can name:
 * - `change-action`: the plugin action picker opens (B2);
 * - `on-error`: "When this step fails";
 * - another section key: `sign-in`, `inputs`, `tool`, `tools`, `time-limit`;
 * - a field's config path (`url`, `authorization.config.api_key`, `config.query`,
 *   `tool_parameters.city`): its section opens and its input gets focus.
 */
export type InspectorSectionTarget = 'change-action' | 'on-error' | (string & {})

export interface InspectorSectionRequest {
  section: InspectorSectionTarget
  /** Increase it for every request. */
  sequence: number
  /** The node the request is for; without it, the node shown when the request arrived. */
  nodeId?: string
}

/**
 * Where the Add node palette puts the node it adds:
 * - `after-node`: on the node's outgoing default arrow (the selected node)
 * - `after-exit`: after one exit of a node, before what it led to (canvas context menu "Add node after")
 * - `on-edge`: between the arrow's two steps (the "+" on an arrow, a drop on an arrow)
 * - `at-position`: unconnected at a canvas position (a drop on empty canvas; relative to `parentId` when set)
 */
export type AddNodeAnchor =
  | { type: 'after-node'; nodeId: string }
  | { type: 'after-exit'; source: string; sourceHandle: string }
  | { type: 'on-edge'; edgeId: string }
  | { type: 'at-position'; x: number; y: number; parentId?: string | null }

/**
 * A node the palette adds, with where it goes. Apply it as ONE undo step:
 * `applyNodePlacement(controller, placement)` from `palette/nodePlacement.ts`.
 */
export interface NodePlacement {
  node: GraphNode
  anchor: AddNodeAnchor | null
  /** Its canvas position when one can be worked out; null lets auto-layout place it. */
  layout: NodeLayout | null
  /** Plain-words edit description ("added Format text after Ask a model"). */
  description: string
}

/** Add node palette (palette agent): adds a node from the library. */
export interface AddNodePaletteProps {
  isOpen: boolean
  nodeKinds: NodeKindInfo[]
  graph: AgentGraph
  readOnly: boolean
  /** Adds `node` (build it with `createGraphNode` and `uniqueNodeId` from `graphEdits.ts`). */
  onAddNode: (node: GraphNode, options: { connectFrom?: EdgeEdit; position?: NodeLayout }) => void
  onClose: () => void
  /**
   * Set when the palette was opened from a node's "Add node after" (canvas). NodesView
   * wires the added node in after this exit (and before what it led to); the palette may
   * show "Adding after …" and should put new nodes in the same container as `source`.
   */
  insertAfter?: { source: string; sourceHandle: string } | null
  /** Where a click / Enter adds (selected node, context node, arrow); null: unconnected. */
  anchor?: AddNodeAnchor | null
  /** Saved positions, to place the new node beside its anchor. */
  positions?: Record<string, NodeLayout>
  /** Adds the node with its arrows as one edit; preferred over `onAddNode` when given. */
  onPlaceNode?: (placement: NodePlacement) => void
  /** After a catalog plugin was installed (with approval): reload the node library. */
  onPluginInstalled?: (pluginName: string) => void | Promise<void>
  /** A kind dropped on the canvas that needs an install approval first (opens the palette on it). */
  requestedKind?: { kind: string; anchor: AddNodeAnchor | null; requestId: number } | null
  /** A palette row started (kind) or ended (null) a drag, for the drop ghost's name. */
  onDragKindChange?: (kind: string | null) => void
}

/** Live run overlay (live/sync agent): run state per node and edge during a test run. */
export interface RunOverlayProps {
  graph: AgentGraph
  /** The test run being shown, or null when none runs. */
  runId: string | null
  /** The shown run mapped onto the graph (`useNodesLiveRun`); nothing is drawn without it. */
  live?: NodesLiveRun
  /** Problems to mark on arrows (`edgeId`). */
  problems?: GraphProblem[]
}

/** Problems list (live/sync agent): what blocks Test and saving, clickable to the node. */
export interface ProblemsPanelProps {
  /** Problems of the working copy: the last load's plus a refused save's. */
  problems: GraphProblem[]
  graph: AgentGraph
  onSelectNode: (nodeId: string) => void
  /** "Fix with builder": puts a change request in the chat box for the user to send. */
  onFixWithBuilder?: (request: string) => void
  /** Why Test is off, shown under the list; null when it can start. */
  testBlockReason?: string | null
  /** True right after Validate ran (the panel then also says when nothing was found). */
  wasValidated?: boolean
  onClose?: () => void
}

/** Sync banner (live/sync agent): builder busy, conflicts, save state. */
export interface SyncBannerProps {
  controller: AgentGraphController
  /** Stops the running builder change, when the page can. */
  onStopBuilder?: () => void
}
