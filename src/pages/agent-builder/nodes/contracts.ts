import type { AgentGraph, CanvasViewport, EdgeEdit, GraphNode, GraphProblem, NodeKindInfo, NodeLayout } from '@/api/agentGraphTypes'
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
}

/** Live run overlay (live/sync agent): run state per node and edge during a test run. */
export interface RunOverlayProps {
  graph: AgentGraph
  /** The test run being shown, or null when none runs. */
  runId: string | null
}

/** Problems list (live/sync agent): what blocks Test and saving, clickable to the node. */
export interface ProblemsPanelProps {
  /** Problems of the working copy: the last load's plus a refused save's. */
  problems: GraphProblem[]
  graph: AgentGraph
  onSelectNode: (nodeId: string) => void
}

/** Sync banner (live/sync agent): builder busy, conflicts, save state. */
export interface SyncBannerProps {
  controller: AgentGraphController
  /** Stops the running builder change, when the page can. */
  onStopBuilder?: () => void
}
