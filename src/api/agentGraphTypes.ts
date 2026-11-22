import type { Agent, FlowEnvVar, FlowInput } from './types'

/**
 * Types of the builder's Nodes view, mirroring `src-tauri/src/agent_graph/model.rs`,
 * `agent_graph/library.rs` and `storage/node_layouts.rs` (camelCase on the wire).
 *
 * Node `config` is the workflow document's own node object minus the fields that
 * have their own property here (id, type, title, parent, on_error, retry,
 * timeout_ms): snake_case YAML keys, unknown keys included. Edit it and send it
 * back as is; the backend writes it into the YAML unchanged.
 */

/** JSON value as stored in a node's config. */
export type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue }
export type NodeConfig = Record<string, JsonValue>

export type PortRole = 'input' | 'default' | 'branch' | 'else' | 'fail-branch'

/** One place an arrow attaches. Output `id`s are edge handles. */
export interface NodePort {
  /** `source`, a case / action / class id, `false`, `fail-branch`; `target` for the input. */
  id: string
  /** "Else", "Send", "On error"; empty for the default ports. */
  label: string
  role: PortRole
}

export interface NodePorts {
  /** Empty for `start` and hidden body markers. */
  inputs: NodePort[]
  outputs: NodePort[]
}

export type OnErrorStrategy = 'fail' | 'fail-branch' | 'default-value'

/** `on_error`: Stop the run / Go to the error path / Continue with values. */
export interface OnErrorSettings {
  strategy: OnErrorStrategy
  /** Outputs used with `default-value`. */
  values: Record<string, JsonValue>
}

/** `retry`: Try again `maxRetries` times, waiting `intervalMs` × `backoff`^(n-1). */
export interface RetrySettings {
  maxRetries: number
  intervalMs: number
  /** At least 1.0. */
  backoff: number
}

export interface GraphNode {
  id: string
  /** graphrt node `type`: `llm`, `if-else`, `whatsapp-web.send_message`… */
  kind: string
  /** The document's `title` (null when it has none). */
  title: string | null
  /** What the canvas shows: title, or the kind's app name ("Ask a model"). */
  displayTitle: string
  /** One-line detail: model name, URL host, prompt excerpt. */
  detail: string
  /** Container (iteration / loop) the node sits in. */
  parent: string | null
  config: NodeConfig
  onError: OnErrorSettings
  retry: RetrySettings
  /** Per-attempt timeout; null = app default (2 minutes). */
  timeoutMs: number | null
  ports: NodePorts
  /** Owns a body (iteration, loop). */
  container: boolean
  /** Body marker (`iteration-start` / `loop-start`): keep it, do not draw it as a step. */
  hidden: boolean
  needsApproval: boolean
  /** Sends data out: must sit behind an approval step. */
  sendsData: boolean
  /** Plugin name of plugin kinds (`whatsapp-web`). */
  plugin: string | null
}

export interface GraphEdge {
  /** Stable id for the UI (document id, else `<source>-<target>-<index>`). */
  id: string
  /** The id written in the document; send it back unchanged. */
  documentId: string | null
  source: string
  /** Exit of the source node; `source` for the default exit. */
  sourceHandle: string
  target: string
  /** The source has no such exit (e.g. error path switched off): kept, never taken. */
  unused: boolean
}

export type ProblemSeverity = 'error' | 'warning'

/** Stable problem codes (see `agent_graph::problem_codes`). */
export type GraphProblemCode =
  | 'unreadable_document'
  | 'unknown_reference'
  | 'cross_scope_edge'
  | 'cycle'
  | 'entry'
  | 'node_config'
  | 'compile'
  | 'unreachable'
  | 'compile_warning'
  | 'send_without_approval'
  | 'placeholder_address'
  | 'model_provider_not_set_up'
  /** A step needs something its model can't do, e.g. tools through a local CLI. */
  | 'model_capability'
  | 'unused_edge'
  | 'plugin_not_installed'

export interface GraphProblem {
  severity: ProblemSeverity
  code: GraphProblemCode | string
  message: string
  nodeId: string | null
  edgeId: string | null
}

/** An agent version as a graph. */
export interface AgentGraph {
  agentId: string
  version: number
  /** The agent's current version; edits are saved against it. */
  latestVersion: number
  name: string | null
  /** Document order, hidden markers included. */
  nodes: GraphNode[]
  edges: GraphEdge[]
  inputs: FlowInput[]
  env: FlowEnvVar[]
  /** Any `error` blocks Test and saving. */
  problems: GraphProblem[]
}

/** Where one node is drawn (canvas units). */
export interface NodeLayout {
  nodeId: string
  x: number
  y: number
  width?: number | null
  height?: number | null
  collapsed?: boolean
}

export interface CanvasViewport {
  x: number
  y: number
  zoom: number
}

/** Saved positions of one version; nodes not listed get auto-layout. */
export interface NodeLayoutSet {
  agentId: string
  version: number
  nodes: NodeLayout[]
  viewport: CanvasViewport | null
}

/** One node to save: the editable fields of {@link GraphNode}. */
export interface NodeEdit {
  id: string
  kind: string
  title?: string | null
  parent?: string | null
  config?: NodeConfig
  onError?: OnErrorSettings
  retry?: RetrySettings
  timeoutMs?: number | null
}

export interface EdgeEdit {
  /** {@link GraphEdge.documentId} for an existing arrow; omit for new ones. */
  documentId?: string | null
  source: string
  /** Omit or `source` for the default exit. */
  sourceHandle?: string | null
  target: string
}

/**
 * The whole edited graph. Nodes and edges replace the document's; everything else
 * (name, env, unknown keys) is kept. A container without its hidden marker gets one.
 */
export interface GraphEdit {
  nodes: NodeEdit[]
  edges: EdgeEdit[]
  /** What changed in plain words ("set Retry 2× on Send"); the backend writes one when absent. */
  description?: string | null
  /** Positions to save for the new version. */
  layout?: NodeLayout[] | null
  /** Saved secrets a step now uses: each one the document does not declare yet is added to `env` (`type: secret`). */
  declareSecrets?: string[]
}

export interface SaveGraphResult {
  agent: Agent
  /** The saved version as a graph. */
  graph: AgentGraph
  /** False when the edit changed nothing (no version added). */
  saved: boolean
  /** "Edited in Nodes: …" (version history and chat). */
  summary: string
  changedStepIds: string[]
  versionBefore: number
  versionAfter: number
}

export interface AgentEditState {
  agentId: string
  /** A builder chat change is running: read-only canvas, saves fail with `builder_busy`. */
  builderBusy: boolean
  currentVersion: number
}

/** Payload of the `agent-edit-state` backend event. */
export interface AgentEditStateChange {
  agentId: string
  builderBusy: boolean
}

export type NodeKindGroup = 'start-and-finish' | 'ai' | 'connect' | 'decide-and-wait' | 'repeat' | 'data' | 'plugin' | 'hidden' | 'other'

export interface NodeKindOutput {
  name: string
  /** graphrt value type: `string`, `number`, `array[object]`, `any`… */
  valueType: string
  description: string
  streaming: boolean
}

export type ExitRule = 'none' | 'single' | 'fixed' | 'dynamic'

export interface NodeKindPorts {
  hasInput: boolean
  exits: ExitRule
  fixedHandles: string[]
  /** For `dynamic` kinds: the config field listing the exits. */
  configPath: string | null
}

export interface NodeKindPlugin {
  name: string
  displayName: string
  /** False for catalog plugins: adding the step installs (and approves) it first. */
  installed: boolean
}

/** One kind of the node library (palette and inspector). */
export interface NodeKindInfo {
  kind: string
  displayName: string
  group: NodeKindGroup
  description: string
  icon: string | null
  /** JSON Schema of the node's config. */
  configSchema: Record<string, unknown>
  outputs: NodeKindOutput[]
  dynamicOutputs: boolean
  ports: NodeKindPorts
  container: boolean
  /** Listed in the Add node palette. */
  offered: boolean
  sendsData: boolean
  source: string
  plugin: NodeKindPlugin | null
}

/** Colors a canvas note can have (`storage::canvas_notes::NOTE_COLORS`). */
export type CanvasNoteColor = 'yellow' | 'blue' | 'green' | 'pink' | 'gray'

/** A sticky note on the Nodes canvas; graphrt drops note nodes, so the app keeps them per version. */
export interface CanvasNote {
  noteId: string
  x: number
  y: number
  /** Width in canvas units. */
  w: number
  /** Height in canvas units. */
  h: number
  text: string
  color: CanvasNoteColor
}

/** The notes of one version; copied forward to every new version. */
export interface CanvasNoteSet {
  agentId: string
  version: number
  notes: CanvasNote[]
}

/**
 * A plugin or MCP server tool and the JSON Schema of its arguments (`get_tool_input_schemas`,
 * mirrors `agent_graph::tool_schemas::ToolInputSchema`), for "Use a tool" inputs as a form.
 */
export interface ToolInputSchema {
  /** `provider_id`: the plugin or MCP server name. */
  provider: string
  name: string
  description: string
  source: 'plugin' | 'mcp'
  /** Null when unknown (a server tested before schemas were kept): inputs are typed by name. */
  inputSchema: Record<string, unknown> | null
}
