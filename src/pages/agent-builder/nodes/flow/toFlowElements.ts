import type { AgentGraph, GraphEdge, GraphNode, GraphProblem, NodeKindInfo, NodeLayout } from '@/api/agentGraphTypes'
import { FAIL_BRANCH_HANDLE, type ConnectionCheck } from '@/lib/agentGraphRules'
import type { NodeSetupStatus } from '../contracts'
import { MarkerType, type Edge, type Node } from './flowLibrary'
import { containerMinimumSize, flowDirectionOf, stepNodeSize, type FlowDirection } from './autoLayout'
import { describeNodeBadges, describeNodePreview, type NodeBadge, type PreviewSegment } from './nodePreview'

/**
 * Turns an {@link AgentGraph} and positions into React Flow nodes and edges.
 * Node types: `step` (a step card), `container` (For each / Repeat with its body
 * inside), `marker` (the hidden body entry: only its exit port shows). Parents come
 * before their children, as React Flow requires.
 */

/** React Flow node types the canvas registers. */
export type FlowNodeType = 'step' | 'container' | 'marker'

export type { NodeSetupStatus }

/** Data every canvas node carries. */
export interface StepNodeData extends Record<string, unknown> {
  node: GraphNode
  /** The kind's name in the library ("Ask a model"), when known. */
  kindName: string | null
  /** "WhatsApp Web · Send WhatsApp message" for plugin steps, else null. */
  pluginLine: string | null
  /** Line under the title: the kind's name and detail ("Ask a model · gpt-4o-mini"), or the plugin kind. */
  subtitle: string
  preview: PreviewSegment[]
  badges: NodeBadge[]
  setupStatus: NodeSetupStatus | null
  problems: GraphProblem[]
  isSelected: boolean
  /** Exits that have an arrow (an unconnected branch shows "No arrow"). */
  connectedHandles: string[]
  /** While an arrow is being drawn: may it end here, and why not. Null otherwise. */
  connectionCheck: ConnectionCheck | null
  /** This step is where the arrow being drawn starts. */
  isConnectSource: boolean
  readOnly: boolean
  /** Which way arrows run in its scope: ports on top / bottom ('down') or left / right ('right'). */
  flowDirection: FlowDirection
}

export type StepFlowNode = Node<StepNodeData, FlowNodeType>

export type EdgeKind = 'default' | 'branch' | 'error' | 'unused'

export interface EdgeData extends Record<string, unknown> {
  edge: GraphEdge
  kind: EdgeKind
  /** Shown on the arrow ("not used"); branch names show on their port. */
  label: string | null
}

export type StepFlowEdge = Edge<EdgeData>

function depthOf(node: GraphNode, nodesById: Map<string, GraphNode>): number {
  let depth = 0
  let parentId = node.parent
  while (parentId && depth < 16) {
    depth += 1
    parentId = nodesById.get(parentId)?.parent ?? null
  }
  return depth
}

function flowNodeType(node: GraphNode): FlowNodeType {
  if (node.hidden) return 'marker'
  return node.container ? 'container' : 'step'
}

export interface FlowElementOptions {
  positions: Record<string, NodeLayout>
  kindNames?: Record<string, string>
  /** Library entries by kind: plugin names and whether a catalog plugin is installed. */
  kindsByKind?: Record<string, NodeKindInfo>
  /** Setup gaps by plugin name ("Not linked"). */
  pluginStatuses?: Record<string, NodeSetupStatus>
  selectedNodeIds?: string[]
  /** While an arrow is drawn: the check for each possible target. */
  connectionChecks?: Record<string, ConnectionCheck> | null
  connectSourceId?: string | null
  readOnly?: boolean
}

function humanizePluginName(pluginName: string): string {
  return pluginName.replace(/[-_]/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase())
}

function setupStatusOf(node: GraphNode, options: FlowElementOptions): NodeSetupStatus | null {
  if (!node.plugin) return null
  const known = options.pluginStatuses?.[node.plugin]
  if (known) return known
  const kindInfo = options.kindsByKind?.[node.kind]
  if (kindInfo?.plugin && !kindInfo.plugin.installed) return { label: 'Not installed', tone: 'amber' }
  return null
}

function linesOf(node: GraphNode, options: FlowElementOptions): Pick<StepNodeData, 'kindName' | 'pluginLine' | 'subtitle'> {
  const kindInfo = options.kindsByKind?.[node.kind]
  const kindName = options.kindNames?.[node.kind] ?? kindInfo?.displayName ?? null
  if (node.plugin) {
    const pluginName = kindInfo?.plugin?.displayName ?? humanizePluginName(node.plugin)
    return { kindName, pluginLine: `${pluginName} · ${kindName ?? node.kind.slice(node.plugin.length + 1)}`, subtitle: node.kind }
  }
  const subtitle = [kindName ?? node.kind, node.detail].filter(Boolean).join(' · ')
  return { kindName, pluginLine: null, subtitle }
}

/** Measured-free size of a node for React Flow's first paint and the minimap. */
function initialSizeOf(type: FlowNodeType, layout: NodeLayout | undefined) {
  if (type === 'container') return { width: layout?.width ?? containerMinimumSize.width, height: layout?.height ?? containerMinimumSize.height }
  if (type === 'marker') return undefined
  return { width: stepNodeSize.width }
}

/** React Flow nodes for every node of `graph` (positions default to the origin). */
export function toFlowNodes(graph: AgentGraph, options: FlowElementOptions): StepFlowNode[] {
  const nodesById = new Map(graph.nodes.map((node) => [node.id, node]))
  const selected = new Set(options.selectedNodeIds ?? [])
  const connectedHandlesBySource = new Map<string, string[]>()
  for (const edge of graph.edges) connectedHandlesBySource.set(edge.source, [...(connectedHandlesBySource.get(edge.source) ?? []), edge.sourceHandle])
  return [...graph.nodes]
    .sort((first, second) => depthOf(first, nodesById) - depthOf(second, nodesById))
    .map((node) => {
      const layout = options.positions[node.id]
      const type = flowNodeType(node)
      const isMarker = type === 'marker'
      return {
        id: node.id,
        type,
        position: { x: layout?.x ?? 0, y: layout?.y ?? 0 },
        ...(node.parent && nodesById.has(node.parent) ? { parentId: node.parent, extent: 'parent' as const } : {}),
        style: type === 'container' ? initialSizeOf(type, layout) : undefined,
        width: initialSizeOf(type, layout)?.width,
        height: type === 'container' ? initialSizeOf(type, layout)?.height : undefined,
        selected: selected.has(node.id),
        selectable: !isMarker,
        draggable: !isMarker && !options.readOnly,
        focusable: !isMarker,
        deletable: !isMarker,
        ariaLabel: isMarker ? undefined : `${node.displayTitle}, ${linesOf(node, options).subtitle}`,
        data: {
          node,
          ...linesOf(node, options),
          preview: describeNodePreview(node, nodesById),
          badges: describeNodeBadges(node),
          setupStatus: setupStatusOf(node, options),
          problems: graph.problems.filter((problem) => problem.nodeId === node.id),
          isSelected: selected.has(node.id),
          connectedHandles: connectedHandlesBySource.get(node.id) ?? [],
          connectionCheck: options.connectionChecks?.[node.id] ?? null,
          isConnectSource: options.connectSourceId === node.id,
          readOnly: Boolean(options.readOnly),
          flowDirection: flowDirectionOf(node),
        },
      }
    })
}

/** Colours of the arrows (hex: SVG markers do not read CSS variables everywhere). */
export const edgeColors: Record<EdgeKind | 'selected', string> = {
  default: '#A1A1AA',
  branch: '#A1A1AA',
  error: '#991B1B',
  unused: '#D4D4D8',
  selected: '#0E7C66',
}

/** The exit's name for branch and error arrows ("Send", "Else", "On error"); drawn on the port. */
function branchLabelOf(edge: GraphEdge, nodesById: Map<string, GraphNode>): string | undefined {
  if (edge.sourceHandle === 'source') return undefined
  if (edge.sourceHandle === FAIL_BRANCH_HANDLE) return 'On error'
  const sourcePort = nodesById.get(edge.source)?.ports.outputs.find((outputPort) => outputPort.id === edge.sourceHandle)
  return sourcePort?.label || edge.sourceHandle
}

function edgeKindOf(edge: GraphEdge): EdgeKind {
  if (edge.unused) return 'unused'
  if (edge.sourceHandle === FAIL_BRANCH_HANDLE) return 'error'
  return edge.sourceHandle === 'source' ? 'default' : 'branch'
}

/**
 * React Flow edges with arrowheads: error-path arrows dashed red, unused ones dashed
 * faint with "not used", branch arrows named on their port.
 */
export function toFlowEdges(graph: AgentGraph, selectedEdgeIds: string[] = []): StepFlowEdge[] {
  const nodesById = new Map(graph.nodes.map((node) => [node.id, node]))
  const selected = new Set(selectedEdgeIds)
  return graph.edges
    
    .filter((edge) => nodesById.has(edge.source) && nodesById.has(edge.target))
    .map((edge) => {
      const branchLabel = branchLabelOf(edge, nodesById)
      const kind = edgeKindOf(edge)
      const isSelected = selected.has(edge.id)
      const color = isSelected ? edgeColors.selected : edgeColors[kind]
      return {
        id: edge.id,
        source: edge.source,
        sourceHandle: edge.sourceHandle,
        target: edge.target,
        targetHandle: 'target',
        type: 'step-edge',
        label: branchLabel,
        selected: isSelected,
        markerEnd: { type: MarkerType.ArrowClosed, color, width: 16, height: 16 },
        className: `is-${kind}`,
        ariaLabel: `Arrow from ${nodesById.get(edge.source)?.displayTitle}${branchLabel ? ` (${branchLabel})` : ''} to ${nodesById.get(edge.target)?.displayTitle}${kind === 'unused' ? ', not used' : ''}`,
        data: { edge, kind, label: kind === 'unused' ? 'not used' : null },
      }
    })
}
