import type { AgentGraph, GraphEdge, GraphNode, GraphProblem, NodeLayout } from '@/api/agentGraphTypes'
import { FAIL_BRANCH_HANDLE, SOURCE_HANDLE } from '@/lib/agentGraphRules'
import type { Edge, Node } from './flowLibrary'
import { stepNodeSize } from './autoLayout'

/**
 * Turns an {@link AgentGraph} and positions into React Flow nodes and edges.
 * Node types: `step` (a step card), `container` (For each / Repeat with its body
 * inside), `marker` (the hidden body entry, drawn as a small dot). Parents come
 * before their children, as React Flow requires.
 */

/** React Flow node types the canvas registers. */
export type FlowNodeType = 'step' | 'container' | 'marker'

/** Data every canvas node carries. */
export interface StepNodeData extends Record<string, unknown> {
  node: GraphNode
  /** The kind's name in the library ("Ask a model"), when known. */
  kindName: string | null
  problems: GraphProblem[]
  isSelected: boolean
}

export type StepFlowNode = Node<StepNodeData, FlowNodeType>

export interface EdgeData extends Record<string, unknown> {
  edge: GraphEdge
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
  selectedNodeIds?: string[]
}

/** React Flow nodes for every node of `graph` (positions default to the origin). */
export function toFlowNodes(graph: AgentGraph, options: FlowElementOptions): StepFlowNode[] {
  const nodesById = new Map(graph.nodes.map((node) => [node.id, node]))
  const selected = new Set(options.selectedNodeIds ?? [])
  return [...graph.nodes]
    .sort((first, second) => depthOf(first, nodesById) - depthOf(second, nodesById))
    .map((node) => {
      const layout = options.positions[node.id]
      const type = flowNodeType(node)
      const size = type === 'container' ? { width: layout?.width ?? stepNodeSize.width, height: layout?.height ?? stepNodeSize.height * 2 } : {}
      return {
        id: node.id,
        type,
        position: { x: layout?.x ?? 0, y: layout?.y ?? 0 },
        ...(node.parent && nodesById.has(node.parent) ? { parentId: node.parent, extent: 'parent' as const } : {}),
        style: type === 'container' ? size : undefined,
        selected: selected.has(node.id),
        data: {
          node,
          kindName: options.kindNames?.[node.kind] ?? null,
          problems: graph.problems.filter((problem) => problem.nodeId === node.id),
          isSelected: selected.has(node.id),
        },
      }
    })
}

function edgeLabel(edge: GraphEdge, nodesById: Map<string, GraphNode>): string | undefined {
  if (edge.sourceHandle === SOURCE_HANDLE) return undefined
  if (edge.sourceHandle === FAIL_BRANCH_HANDLE) return 'On error'
  const sourcePort = nodesById.get(edge.source)?.ports.outputs.find((outputPort) => outputPort.id === edge.sourceHandle)
  return sourcePort?.label || edge.sourceHandle
}

/** React Flow edges; error-path arrows are red, unused ones dashed. */
export function toFlowEdges(graph: AgentGraph): StepFlowEdge[] {
  const nodesById = new Map(graph.nodes.map((node) => [node.id, node]))
  return graph.edges
    .filter((edge) => nodesById.has(edge.source) && nodesById.has(edge.target))
    .map((edge) => ({
      id: edge.id,
      source: edge.source,
      sourceHandle: edge.sourceHandle,
      target: edge.target,
      targetHandle: 'target',
      type: 'smoothstep',
      label: edgeLabel(edge, nodesById),
      className: [edge.sourceHandle === FAIL_BRANCH_HANDLE ? 'is-error-path' : '', edge.unused ? 'is-unused' : ''].filter(Boolean).join(' ') || undefined,
      style: {
        stroke: edge.sourceHandle === FAIL_BRANCH_HANDLE ? 'var(--color-danger)' : 'var(--color-line-heavy)',
        strokeDasharray: edge.unused ? '6 4' : undefined,
      },
      data: { edge },
    }))
}
