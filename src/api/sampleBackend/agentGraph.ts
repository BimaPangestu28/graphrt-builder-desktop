import type {
  AgentEditState,
  AgentEditStateChange,
  AgentGraph,
  CanvasNote,
  CanvasNoteSet,
  CanvasViewport,
  GraphEdge,
  GraphEdit,
  GraphNode,
  GraphProblem,
  NodeConfig,
  NodeKindInfo,
  NodeLayout,
  NodeLayoutSet,
  SaveGraphResult,
} from '../agentGraphTypes'
import { BackendError } from '../client'
import type { FlowInput, FlowStep } from '../types'
import { bodyMarkerKinds, deriveNodePorts, isEdgeUnused, nodeKindTitle, pluginOfKind, SOURCE_HANDLE } from '@/lib/agentGraphRules'
import { appendStoredBuilderMessages, readStoredAgent, saveNewVersion, summarizeStoredVersion } from './sampleAgentStore'
import { respondWith } from './sampleResponse'
import { sampleNodeKinds } from './sampleNodeKinds'

/**
 * Sample Nodes view backend for the browser preview and tests. Every sample agent
 * gets a graph derived from its steps (start → steps → end, loop bodies inside their
 * "For each" step); the "maps-leads" agent (the spec's "Find Business Promotions")
 * also gets real-looking configs, Send / Skip approval buttons and plugin steps.
 * Saving behaves like the desktop: builder lock, stale-version conflicts, a new
 * version with "Edited in Nodes: …", a chat entry, and positions copied forward.
 */

const storedGraphs = new Map<string, AgentGraph>()
const storedLayouts = new Map<string, NodeLayout[]>()
const storedViewports = new Map<string, CanvasViewport>()
const storedNotes = new Map<string, CanvasNote[]>()
const busyAgentIds = new Set<string>()
const editStateListeners = new Set<(change: AgentEditStateChange) => void>()

function graphKey(agentId: string, version: number): string {
  return `${agentId}@${version}`
}

function cloneGraph(graph: AgentGraph): AgentGraph {
  return structuredClone(graph)
}

/** Extra settings of the maps-leads steps, so the inspector has something to show. */
const mapsLeadsDetails: Record<string, { kind?: string; config: NodeConfig }> = {
  search_maps: { kind: 'google-maps-scraper.search', config: { query: '{{#ask_input.keyword#}} in {{#ask_input.city#}}', max_results: 20 } },
  for_each_place: { config: { iterator_selector: ['search_maps', 'results'], output_selector: ['send_whatsapp', 'data'], is_parallel: false, error_handle_mode: 'continue-on-error' } },
  write_message: {
    config: {
      model: { provider: 'openai', name: 'gpt-4o-mini' },
      prompt_template: [{ role: 'user', text: 'Write a short message to {{#for_each_place.item.name#}} about {{#ask_input.offer#}}' }],
    },
  },
  approve_message: {
    config: { prompt: 'Send this message to {{#for_each_place.item.name#}}?\n\n{{#write_message.text#}}', actions: [{ id: 'send', title: 'Send' }, { id: 'skip', title: 'Skip' }] },
  },
  send_whatsapp: { kind: 'whatsapp-web.send_message', config: { phone: '{{#for_each_place.item.phone#}}', text: '{{#write_message.text#}}' } },
}

function buildNode(fields: { id: string; kind: string; title: string | null; detail?: string; parent: string | null; config?: NodeConfig; needsApproval?: boolean }): GraphNode {
  const config = fields.config ?? {}
  const kindInfo = sampleNodeKinds.find((info) => info.kind === fields.kind)
  return {
    id: fields.id,
    kind: fields.kind,
    title: fields.title,
    displayTitle: fields.title?.trim() || kindInfo?.displayName || nodeKindTitle(fields.kind),
    detail: fields.detail ?? '',
    parent: fields.parent,
    config,
    onError: { strategy: 'fail', values: {} },
    retry: { maxRetries: 0, intervalMs: 0, backoff: 1 },
    timeoutMs: null,
    ports: deriveNodePorts(fields.kind, config, 'fail'),
    container: fields.kind === 'iteration' || fields.kind === 'loop',
    hidden: fields.kind === 'iteration-start' || fields.kind === 'loop-start',
    needsApproval: fields.needsApproval ?? fields.kind === 'human-input',
    sendsData: kindInfo?.sendsData ?? false,
    plugin: pluginOfKind(fields.kind),
  }
}

function startConfig(inputs: FlowInput[]): NodeConfig {
  return { variables: inputs.map((input) => ({ variable: input.name, label: input.label, required: input.required, type: input.inputType ?? 'text-input' })) }
}

function stepNode(agentId: string, flowStep: FlowStep, parent: string | null): GraphNode {
  const details = agentId === 'maps-leads' ? mapsLeadsDetails[flowStep.id] : undefined
  return buildNode({ id: flowStep.id, kind: details?.kind ?? flowStep.nodeType, title: flowStep.title, detail: flowStep.detail, parent, config: details?.config, needsApproval: flowStep.needsApproval })
}

/** The first exit of a node: where its "next step" arrow leaves from. */
function firstExit(node: GraphNode): string {
  return node.ports.outputs.find((outputPort) => outputPort.role !== 'else' && outputPort.role !== 'fail-branch')?.id ?? SOURCE_HANDLE
}

function chainEdges(chain: GraphNode[]): GraphEdge[] {
  return chain.slice(1).map((target, index) => {
    const source = chain[index]
    return { id: `${source.id}-${target.id}-${index}`, documentId: null, source: source.id, sourceHandle: firstExit(source), target: target.id, unused: false }
  })
}

/** Nodes and edges for a step list: root steps in a chain, `depth > 0` steps in the body of the "For each" before them. */
function deriveGraphParts(agentId: string, steps: FlowStep[], inputs: FlowInput[]): Pick<AgentGraph, 'nodes' | 'edges'> {
  const firstIsStart = steps[0]?.nodeType === 'start'
  const startNode = firstIsStart
    ? buildNode({ id: steps[0].id, kind: 'start', title: steps[0].title, parent: null, config: startConfig(inputs) })
    : buildNode({ id: 'start', kind: 'start', title: null, parent: null, config: startConfig(inputs) })
  const nodes: GraphNode[] = [startNode]
  const rootChain: GraphNode[] = [startNode]
  const bodies = new Map<string, GraphNode[]>()
  let currentContainer: GraphNode | null = null
  for (const flowStep of firstIsStart ? steps.slice(1) : steps) {
    const parent = flowStep.depth > 0 && currentContainer ? currentContainer.id : null
    const node = stepNode(agentId, flowStep, parent)
    nodes.push(node)
    if (parent) {
      bodies.get(parent)?.push(node)
      continue
    }
    rootChain.push(node)
    currentContainer = null
    if (bodyMarkerKinds[node.kind]) {
      currentContainer = node
      const marker = buildNode({ id: `${node.id}_start`, kind: bodyMarkerKinds[node.kind], title: null, parent: node.id })
      nodes.push(marker)
      bodies.set(node.id, [marker])
    }
  }
  const endNode = buildNode({ id: 'end', kind: 'end', title: null, parent: null })
  nodes.push(endNode)
  rootChain.push(endNode)
  const edges = [...chainEdges(rootChain), ...[...bodies.values()].flatMap(chainEdges)]
  return { nodes, edges }
}

/** Visible steps (not Start, not a body marker) no arrow leads to, like graphrt's "not reachable" warning. */
function unreachableProblems(nodes: GraphNode[], edges: GraphEdge[]): GraphProblem[] {
  const targets = new Set(edges.map((edge) => edge.target))
  return nodes
    .filter((node) => !node.hidden && node.kind !== 'start' && !targets.has(node.id) && !isBodyRootOfMarker(node, nodes, edges))
    .map((node) => ({ severity: 'warning' as const, code: 'unreachable', message: `${node.displayTitle} is not reachable from the start, so it never runs`, nodeId: node.id, edgeId: null }))
}

/** A body step with no marker arrow yet is still reached through its container (the backend wires it). */
function isBodyRootOfMarker(node: GraphNode, nodes: GraphNode[], edges: GraphEdge[]): boolean {
  if (!node.parent) return false
  const marker = nodes.find((candidate) => candidate.parent === node.parent && candidate.hidden)
  return !marker || !edges.some((edge) => edge.source === marker.id)
}

function sampleProblems(nodes: GraphNode[], edges: GraphEdge[]): GraphProblem[] {
  return [...unreachableProblems(nodes, edges), ...unusedEdgeProblems(nodes, edges)]
}

function unusedEdgeProblems(nodes: GraphNode[], edges: GraphEdge[]): GraphProblem[] {
  return edges
    .filter((edge) => edge.unused)
    .map((edge) => ({
      severity: 'warning' as const,
      code: 'unused_edge',
      message: `${nodes.find((node) => node.id === edge.source)?.displayTitle ?? edge.source} has no \`${edge.sourceHandle}\` exit, so this arrow is never taken`,
      nodeId: edge.source,
      edgeId: edge.id,
    }))
}

function readGraph(agentId: string, requestedVersion?: number): AgentGraph {
  const agent = readStoredAgent(agentId)
  const version = requestedVersion ?? agent.currentVersion
  const stored = storedGraphs.get(graphKey(agentId, version))
  if (stored) return { ...cloneGraph(stored), latestVersion: agent.currentVersion }
  const summary = summarizeStoredVersion(agentId, version)
  const parts = deriveGraphParts(agentId, summary.steps, summary.inputs)
  const graph: AgentGraph = { agentId, version, latestVersion: agent.currentVersion, name: agent.name, ...parts, inputs: summary.inputs, env: [], problems: sampleProblems(parts.nodes, parts.edges) }
  storedGraphs.set(graphKey(agentId, version), cloneGraph(graph))
  return graph
}

/** The edit as graph nodes and edges, with ports and names recomputed like the backend does. */
function graphFromEdit(base: AgentGraph, edit: GraphEdit): Pick<AgentGraph, 'nodes' | 'edges'> {
  const nodes = edit.nodes.map((nodeEdit) => {
    const baseNode = base.nodes.find((node) => node.id === nodeEdit.id)
    const onError = nodeEdit.onError ?? { strategy: 'fail' as const, values: {} }
    const config = nodeEdit.config ?? {}
    const built = buildNode({ id: nodeEdit.id, kind: nodeEdit.kind, title: nodeEdit.title ?? null, detail: baseNode?.detail, parent: nodeEdit.parent ?? null, config })
    return { ...built, onError, retry: nodeEdit.retry ?? built.retry, timeoutMs: nodeEdit.timeoutMs ?? null, ports: deriveNodePorts(nodeEdit.kind, config, onError.strategy) }
  })
  const edges = edit.edges.map((edgeEdit, index) => {
    const sourceHandle = edgeEdit.sourceHandle || SOURCE_HANDLE
    const edge: GraphEdge = { id: edgeEdit.documentId ?? `${edgeEdit.source}-${edgeEdit.target}-${index}`, documentId: edgeEdit.documentId ?? null, source: edgeEdit.source, sourceHandle, target: edgeEdit.target, unused: false }
    return { ...edge, unused: isEdgeUnused(edge, nodes.find((node) => node.id === edge.source)) }
  })
  return { nodes, edges }
}

function blockingProblems(nodes: GraphNode[], edges: GraphEdge[]): GraphProblem[] {
  const nodeIds = new Set(nodes.map((node) => node.id))
  const duplicate = nodes.find((node, index) => nodes.findIndex((other) => other.id === node.id) !== index)
  const problems: GraphProblem[] = edges
    .filter((edge) => !nodeIds.has(edge.source) || !nodeIds.has(edge.target))
    .map((edge) => ({ severity: 'error', code: 'compile', message: `edge \`${edge.id}\` references an unknown node`, nodeId: null, edgeId: edge.id }))
  if (duplicate) problems.push({ severity: 'error', code: 'compile', message: `duplicate node id \`${duplicate.id}\``, nodeId: duplicate.id, edgeId: null })
  return problems
}

function describeEdit(base: AgentGraph, nodes: GraphNode[]): { summary: string; changedStepIds: string[] } {
  const visibleNodes = nodes.filter((node) => !node.hidden)
  const added = visibleNodes.filter((node) => !base.nodes.some((old) => old.id === node.id))
  const changed = visibleNodes.filter((node) => {
    const old = base.nodes.find((candidate) => candidate.id === node.id)
    if (!old) return false
    const editable = (graphNode: GraphNode) => JSON.stringify([graphNode.kind, graphNode.title, graphNode.parent, graphNode.config, graphNode.onError, graphNode.retry, graphNode.timeoutMs])
    return editable(old) !== editable(node)
  })
  const removed = base.nodes.filter((old) => !old.hidden && !nodes.some((node) => node.id === old.id))
  const sentences = [
    ['Added', added],
    ['Changed', changed],
    ['Removed', removed],
  ]
    .filter(([, list]) => (list as GraphNode[]).length > 0)
    .map(([verb, list]) => `${verb as string} ${(list as GraphNode[]).map((node) => node.displayTitle).join(', ')}`)
  return { summary: sentences.join('. ') || 'Changed the arrows', changedStepIds: [...added, ...changed].map((node) => node.id) }
}

function toFlowSteps(nodes: GraphNode[]): FlowStep[] {
  return nodes
    .filter((node) => !node.hidden && node.kind !== 'end' && node.kind !== 'start')
    .map((node) => ({ id: node.id, nodeType: node.kind, title: node.displayTitle, detail: node.detail, needsApproval: node.needsApproval, depth: node.parent ? 1 : 0 }))
}

function sameGraph(base: AgentGraph, parts: Pick<AgentGraph, 'nodes' | 'edges'>): boolean {
  const editable = (graph: Pick<AgentGraph, 'nodes' | 'edges'>) =>
    JSON.stringify([
      graph.nodes.map((node) => [node.id, node.kind, node.title, node.parent, node.config, node.onError, node.retry, node.timeoutMs]),
      graph.edges.map((edge) => [edge.source, edge.sourceHandle, edge.target]),
    ])
  return editable(base) === editable(parts)
}

/** The base env plus the secrets the edit declares (like the desktop backend: `{ name, type: secret }`, once). */
function withDeclaredSecrets(env: AgentGraph['env'], declareSecrets: string[] | undefined): AgentGraph['env'] {
  const added = (declareSecrets ?? []).filter((name, index, names) => names.indexOf(name) === index && !env.some((variable) => variable.name === name))
  return [...env, ...added.map((name) => ({ name, description: null, isSecret: true, hasDefault: false }))]
}

function saveGraph(agentId: string, baseVersion: number, edit: GraphEdit): SaveGraphResult {
  if (busyAgentIds.has(agentId)) throw new BackendError('builder_busy', 'the builder is changing this agent; try again when it is done')
  const agent = readStoredAgent(agentId)
  if (agent.currentVersion !== baseVersion) {
    throw new BackendError('version_conflict', `this agent changed while you were editing (you edited version ${baseVersion}, the latest is version ${agent.currentVersion})`, {
      baseVersion,
      latestVersion: agent.currentVersion,
    })
  }
  const base = readGraph(agentId, baseVersion)
  const parts = graphFromEdit(base, edit)
  const problems = blockingProblems(parts.nodes, parts.edges)
  if (problems.length > 0) throw new BackendError('invalid_graph', `the edited steps have ${problems.length} problem(s): ${problems[0].message}`, { problems })
  const env = withDeclaredSecrets(base.env, edit.declareSecrets)
  if (sameGraph(base, parts) && env.length === base.env.length) return { agent, graph: base, saved: false, summary: '', changedStepIds: [], versionBefore: baseVersion, versionAfter: baseVersion }

  const changes = sameGraph(base, parts) ? { summary: `Declared secret ${env.slice(base.env.length).map((variable) => variable.name).join(', ')}`, changedStepIds: [] } : describeEdit(base, parts.nodes)
  const summary = `Edited in Nodes: ${edit.description?.trim() || changes.summary}`
  const savedAgent = saveNewVersion(agentId, toFlowSteps(parts.nodes), summary)
  const versionAfter = savedAgent.currentVersion
  const graph: AgentGraph = { ...base, version: versionAfter, latestVersion: versionAfter, ...parts, env, problems: sampleProblems(parts.nodes, parts.edges) }
  storedGraphs.set(graphKey(agentId, versionAfter), cloneGraph(graph))
  copyLayoutForward(agentId, baseVersion, versionAfter, parts.nodes)
  if (edit.layout) storedLayouts.set(graphKey(agentId, versionAfter), edit.layout.map((layout) => ({ ...layout })))
  appendStoredBuilderMessages(agentId, [
    { role: 'builder', text: summary, explanation: null, status: 'done', versionBefore: baseVersion, versionAfter, changedStepIds: changes.changedStepIds },
  ])
  return { agent: savedAgent, graph, saved: true, summary, changedStepIds: changes.changedStepIds, versionBefore: baseVersion, versionAfter }
}

function validateGraph(agentId: string, baseVersion: number, edit: GraphEdit): GraphProblem[] {
  const base = readGraph(agentId, baseVersion)
  const parts = graphFromEdit(base, edit)
  return [...blockingProblems(parts.nodes, parts.edges), ...sampleProblems(parts.nodes, parts.edges)]
}

function readNotes(agentId: string, requestedVersion?: number): CanvasNoteSet {
  const version = requestedVersion ?? readStoredAgent(agentId).currentVersion
  const notes = (storedNotes.get(graphKey(agentId, version)) ?? []).map((note) => ({ ...note }))
  return { agentId, version, notes }
}

function writeNotes(agentId: string, version: number, notes: CanvasNote[]): CanvasNoteSet {
  readStoredAgent(agentId)
  const noteIds = notes.map((note) => note.noteId)
  if (new Set(noteIds).size !== noteIds.length) throw new BackendError('invalid_input', 'a note is listed more than once')
  if (notes.some((note) => note.text.length > 4000)) throw new BackendError('invalid_input', 'a note is longer than 4000 characters')
  storedNotes.set(graphKey(agentId, version), notes.map((note) => ({ ...note })))
  return readNotes(agentId, version)
}

function copyLayoutForward(agentId: string, fromVersion: number, toVersion: number, nodes: GraphNode[]): void {
  const fromNotes = storedNotes.get(graphKey(agentId, fromVersion))
  if (fromNotes) storedNotes.set(graphKey(agentId, toVersion), fromNotes.map((note) => ({ ...note })))
  const nodeIds = new Set(nodes.map((node) => node.id))
  const copied = (storedLayouts.get(graphKey(agentId, fromVersion)) ?? []).filter((layout) => nodeIds.has(layout.nodeId))
  storedLayouts.set(graphKey(agentId, toVersion), copied.map((layout) => ({ ...layout })))
}

function readLayout(agentId: string, requestedVersion?: number): NodeLayoutSet {
  const version = requestedVersion ?? readStoredAgent(agentId).currentVersion
  const nodes = (storedLayouts.get(graphKey(agentId, version)) ?? []).map((layout) => ({ ...layout }))
  return { agentId, version, nodes, viewport: storedViewports.get(agentId) ?? null }
}

function writeLayout(agentId: string, version: number, nodes: NodeLayout[], viewport: CanvasViewport | null): NodeLayoutSet {
  readStoredAgent(agentId)
  const nodeIds = nodes.map((layout) => layout.nodeId)
  if (new Set(nodeIds).size !== nodeIds.length) throw new BackendError('invalid_input', 'a node has more than one position')
  storedLayouts.set(graphKey(agentId, version), nodes.map((layout) => ({ ...layout })))
  if (viewport) storedViewports.set(agentId, { ...viewport })
  return readLayout(agentId, version)
}

export const sampleAgentGraphBackend = {
  getAgentGraph: (agentId: string, version?: number): Promise<AgentGraph> => respondWith(() => readGraph(agentId, version)),
  getNodeKinds: (): Promise<NodeKindInfo[]> => respondWith(() => structuredClone(sampleNodeKinds)),
  saveAgentGraph: (agentId: string, baseVersion: number, edit: GraphEdit): Promise<SaveGraphResult> => respondWith(() => saveGraph(agentId, baseVersion, edit)),
  getNodeLayout: (agentId: string, version?: number): Promise<NodeLayoutSet> => respondWith(() => readLayout(agentId, version)),
  saveNodeLayout: (agentId: string, version: number, nodes: NodeLayout[], viewport: CanvasViewport | null): Promise<NodeLayoutSet> =>
    respondWith(() => writeLayout(agentId, version, nodes, viewport)),
  validateAgentGraph: (agentId: string, baseVersion: number, edit: GraphEdit): Promise<GraphProblem[]> => respondWith(() => validateGraph(agentId, baseVersion, edit)),
  getCanvasNotes: (agentId: string, version?: number): Promise<CanvasNoteSet> => respondWith(() => readNotes(agentId, version)),
  saveCanvasNotes: (agentId: string, version: number, notes: CanvasNote[]): Promise<CanvasNoteSet> => respondWith(() => writeNotes(agentId, version, notes)),
  getAgentEditState: (agentId: string): Promise<AgentEditState> =>
    respondWith(() => ({ agentId, builderBusy: busyAgentIds.has(agentId), currentVersion: readStoredAgent(agentId).currentVersion })),
  listenToAgentEditState: (onChange: (change: AgentEditStateChange) => void): (() => void) => {
    editStateListeners.add(onChange)
    return () => editStateListeners.delete(onChange)
  },
}

/**
 * Marks a sample agent as being changed by the builder (tests, preview), like a chat
 * revision in flight on the desktop, and tells the edit state listeners.
 */
export function setSampleBuilderBusy(agentId: string, builderBusy: boolean): void {
  if (builderBusy) busyAgentIds.add(agentId)
  else busyAgentIds.delete(agentId)
  for (const listener of editStateListeners) listener({ agentId, builderBusy })
}

/** True while a sample agent is marked as being changed by the builder. */
export function isSampleBuilderBusy(agentId: string): boolean {
  return busyAgentIds.has(agentId)
}

/** Forgets saved graphs, positions and busy flags (use in test `beforeEach`, with `resetSampleAgents`). */
export function resetSampleAgentGraphs(): void {
  storedGraphs.clear()
  storedLayouts.clear()
  storedViewports.clear()
  storedNotes.clear()
  busyAgentIds.clear()
}
