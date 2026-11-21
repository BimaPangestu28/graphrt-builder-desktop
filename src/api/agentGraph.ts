import type {
  AgentEditState,
  AgentEditStateChange,
  AgentGraph,
  CanvasNote,
  CanvasNoteSet,
  CanvasViewport,
  GraphEdit,
  GraphProblem,
  NodeKindInfo,
  NodeLayout,
  NodeLayoutSet,
  SaveGraphResult,
  ToolInputSchema,
} from './agentGraphTypes'
import { BackendError, callBackend, isDesktopApp, listenToBackend } from './client'
import { sampleAgentGraphBackend } from './sampleBackend/agentGraph'
import { listSampleToolInputSchemas } from './sampleBackend/sampleToolSchemas'

/**
 * The builder's Nodes view: an agent version as a graph, the node library, saving
 * edits as a new version, node positions and the builder's edit lock. Sample data
 * outside the desktop app (`sampleBackend/agentGraph.ts`).
 */

/** Backend event sent when the builder starts or stops changing an agent. */
export const agentEditStateEvent = 'agent-edit-state'

/**
 * The graph of one version (the current one when `version` is omitted).
 *
 * @throws BackendError - `not_found` for an unknown agent or version
 */
export function getAgentGraph(agentId: string, version?: number): Promise<AgentGraph> {
  if (!isDesktopApp()) return sampleAgentGraphBackend.getAgentGraph(agentId, version)
  return callBackend('get_agent_graph', { agentId, version: version ?? null })
}

/** Every node kind the app offers or can read: builtins first, then plugin actions. */
export function getNodeKinds(): Promise<NodeKindInfo[]> {
  if (!isDesktopApp()) return sampleAgentGraphBackend.getNodeKinds()
  return callBackend('get_node_kinds')
}

/**
 * Saves `edit`, made on `baseVersion`, as the agent's next version ("Edited in Nodes: …").
 *
 * @throws BackendError - `builder_busy` while a chat change runs; `version_conflict` when the
 * agent moved on (see {@link conflictLatestVersion}); `invalid_graph` with the blocking problems
 * (see {@link invalidGraphProblems}); `invalid_input` for a malformed edit
 */
export function saveAgentGraph(agentId: string, baseVersion: number, edit: GraphEdit): Promise<SaveGraphResult> {
  if (!isDesktopApp()) return sampleAgentGraphBackend.saveAgentGraph(agentId, baseVersion, edit)
  return callBackend('save_agent_graph', { agentId, baseVersion, edit })
}

/**
 * The problems `edit` would have on `baseVersion`, without saving (Validate). Works while
 * the builder is busy and on an older version too.
 *
 * @throws BackendError - `not_found` for an unknown agent or version; `invalid_input` for a malformed edit
 */
export function validateAgentGraph(agentId: string, baseVersion: number, edit: GraphEdit): Promise<GraphProblem[]> {
  if (!isDesktopApp()) return sampleAgentGraphBackend.validateAgentGraph(agentId, baseVersion, edit)
  return callBackend('validate_agent_graph', { agentId, baseVersion, edit })
}

/** Sticky notes on the canvas of a version (current when omitted). */
export function getCanvasNotes(agentId: string, version?: number): Promise<CanvasNoteSet> {
  if (!isDesktopApp()) return sampleAgentGraphBackend.getCanvasNotes(agentId, version)
  return callBackend('get_canvas_notes', { agentId, version: version ?? null })
}

/**
 * Replaces the notes of a version (adds no version; new versions copy them forward).
 *
 * @throws BackendError - `invalid_input` for a repeated id, a bad size or color, or a text over 4,000 characters
 */
export function saveCanvasNotes(agentId: string, version: number, notes: CanvasNote[]): Promise<CanvasNoteSet> {
  if (!isDesktopApp()) return sampleAgentGraphBackend.saveCanvasNotes(agentId, version, notes)
  return callBackend('save_canvas_notes', { agentId, version, notes })
}

/** Saved positions of a version (current when omitted) and the agent's canvas viewport. */
export function getNodeLayout(agentId: string, version?: number): Promise<NodeLayoutSet> {
  if (!isDesktopApp()) return sampleAgentGraphBackend.getNodeLayout(agentId, version)
  return callBackend('get_node_layout', { agentId, version: version ?? null })
}

/** Replaces a version's positions (adds no version) and saves the viewport when given. */
export function saveNodeLayout(agentId: string, version: number, nodes: NodeLayout[], viewport?: CanvasViewport | null): Promise<NodeLayoutSet> {
  if (!isDesktopApp()) return sampleAgentGraphBackend.saveNodeLayout(agentId, version, nodes, viewport ?? null)
  return callBackend('save_node_layout', { agentId, version, nodes, viewport: viewport ?? null })
}

/**
 * Input schemas of the plugin tools (from their manifests) and MCP server tools (from each
 * server's last connection test), for the "Use a tool" inputs form. Agents used as tools
 * are not listed: their inputs come from `listAgentSteps`.
 */
export function getToolInputSchemas(): Promise<ToolInputSchema[]> {
  if (!isDesktopApp()) return listSampleToolInputSchemas()
  return callBackend('get_tool_input_schemas')
}

/** Whether the builder is changing the agent right now. */
export function getAgentEditState(agentId: string): Promise<AgentEditState> {
  if (!isDesktopApp()) return sampleAgentGraphBackend.getAgentEditState(agentId)
  return callBackend('get_agent_edit_state', { agentId })
}

/**
 * Calls `onChange` whenever the builder starts or stops changing any agent.
 *
 * @returns Unsubscribe function
 */
export function listenToAgentEditState(onChange: (change: AgentEditStateChange) => void): Promise<() => void> {
  if (!isDesktopApp()) return Promise.resolve(sampleAgentGraphBackend.listenToAgentEditState(onChange))
  return listenToBackend<AgentEditStateChange>(agentEditStateEvent, onChange)
}

/** The latest version of a `version_conflict` error, else null. */
export function conflictLatestVersion(error: unknown): number | null {
  if (!(error instanceof BackendError) || error.code !== 'version_conflict') return null
  const details = error.details as { latestVersion?: unknown } | null
  return typeof details?.latestVersion === 'number' ? details.latestVersion : null
}

/** The blocking problems of an `invalid_graph` error, else an empty list. */
export function invalidGraphProblems(error: unknown): GraphProblem[] {
  if (!(error instanceof BackendError) || error.code !== 'invalid_graph') return []
  const details = error.details as { problems?: unknown } | null
  return Array.isArray(details?.problems) ? (details.problems as GraphProblem[]) : []
}
