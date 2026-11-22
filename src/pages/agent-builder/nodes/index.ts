/**
 * The builder's Nodes view; modules and contracts: `README.md` in this folder.
 * The builder page imports `./NodesView` lazily, not this barrel, so importing
 * from here pulls the canvas (and React Flow) into the importer's chunk.
 */
export { NodesView, type NodesViewProps } from './NodesView'
export { useAgentGraph, type AgentGraphController, type AgentGraphState, type AgentGraphActions, type GraphSaveStatus, type UseAgentGraphOptions } from './useAgentGraph'
export { useNodeKinds, type NodeKindsState } from './useNodeKinds'
export type { AddNodePaletteProps, NodeCanvasProps, NodeInspectorProps, ProblemsPanelProps, RunOverlayProps, SyncBannerProps } from './contracts'
export * from './graphEdits'
