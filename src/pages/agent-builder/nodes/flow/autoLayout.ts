import type { AgentGraph, GraphNode, NodeLayout } from '@/api/agentGraphTypes'

/**
 * Auto-layout with ELK (elkjs, layered, left to right). Containers (For each,
 * Repeat) are laid out with their body inside them; child positions are relative
 * to their container, the same convention React Flow and the saved positions use.
 * ELK is loaded on first use so it stays out of the main bundle.
 */

/** Size of a step card on the canvas. */
export const stepNodeSize = { width: 240, height: 76 }
/** Size of a hidden body marker (the dot a loop body's arrows start from). */
export const markerNodeSize = { width: 12, height: 12 }
/** Space for a container's header above its body. */
const containerHeaderHeight = 56
const containerPadding = 24

interface ElkNodeInput {
  id: string
  width?: number
  height?: number
  layoutOptions?: Record<string, string>
  children?: ElkNodeInput[]
  edges?: Array<{ id: string; sources: string[]; targets: string[] }>
}

interface ElkNodeOutput {
  id: string
  x?: number
  y?: number
  width?: number
  height?: number
  children?: ElkNodeOutput[]
}

const rootLayoutOptions: Record<string, string> = {
  'elk.algorithm': 'layered',
  'elk.direction': 'RIGHT',
  'elk.hierarchyHandling': 'INCLUDE_CHILDREN',
  'elk.layered.spacing.nodeNodeBetweenLayers': '72',
  'elk.spacing.nodeNode': '40',
}

const containerLayoutOptions: Record<string, string> = {
  'elk.padding': `[top=${containerHeaderHeight},left=${containerPadding},bottom=${containerPadding},right=${containerPadding}]`,
}

function sizeOf(node: GraphNode): { width: number; height: number } {
  return node.hidden ? markerNodeSize : stepNodeSize
}

function toElkNode(node: GraphNode, childrenByParent: Map<string | null, GraphNode[]>): ElkNodeInput {
  const children = childrenByParent.get(node.id) ?? []
  if (!node.container) return { id: node.id, ...sizeOf(node) }
  return {
    id: node.id,
    layoutOptions: containerLayoutOptions,
    children: children.length > 0 ? children.map((child) => toElkNode(child, childrenByParent)) : undefined,
    ...(children.length === 0 ? stepNodeSize : {}),
  }
}

function collectLayouts(node: ElkNodeOutput, layouts: NodeLayout[]): void {
  for (const child of node.children ?? []) {
    layouts.push({ nodeId: child.id, x: child.x ?? 0, y: child.y ?? 0, width: child.width ?? null, height: child.height ?? null })
    collectLayouts(child, layouts)
  }
}

/** The ELK graph of `graph`: nodes nested in their containers, every arrow at the root. */
export function toElkGraph(graph: AgentGraph): ElkNodeInput {
  const childrenByParent = new Map<string | null, GraphNode[]>()
  for (const node of graph.nodes) {
    const siblings = childrenByParent.get(node.parent) ?? []
    siblings.push(node)
    childrenByParent.set(node.parent, siblings)
  }
  const nodeIds = new Set(graph.nodes.map((node) => node.id))
  return {
    id: 'root',
    layoutOptions: rootLayoutOptions,
    children: (childrenByParent.get(null) ?? []).map((node) => toElkNode(node, childrenByParent)),
    edges: graph.edges
      .filter((edge) => nodeIds.has(edge.source) && nodeIds.has(edge.target))
      .map((edge) => ({ id: edge.id, sources: [edge.source], targets: [edge.target] })),
  }
}

/**
 * Positions for every node of `graph` (containers get a width and height).
 *
 * @param graph - Graph to place (AgentGraph)
 * @returns One layout per node, child positions relative to their container (Promise<NodeLayout[]>)
 * @throws Error - when ELK cannot lay the graph out (malformed nesting)
 */
export async function computeAutoLayout(graph: AgentGraph): Promise<NodeLayout[]> {
  const { default: Elk } = await import('elkjs/lib/elk.bundled.js')
  const elk = new Elk()
  const laidOut = (await elk.layout(toElkGraph(graph) as Parameters<typeof elk.layout>[0])) as ElkNodeOutput
  const layouts: NodeLayout[] = []
  collectLayouts(laidOut, layouts)
  return layouts
}

/**
 * Saved positions where there are some, auto-layout for the rest. A container keeps
 * the auto size its body needs unless a size was saved.
 */
export function mergeLayouts(autoLayouts: NodeLayout[], saved: Record<string, NodeLayout>): Record<string, NodeLayout> {
  const merged: Record<string, NodeLayout> = {}
  for (const layout of autoLayouts) {
    const savedLayout = saved[layout.nodeId]
    merged[layout.nodeId] = savedLayout
      ? { ...layout, ...savedLayout, width: savedLayout.width ?? layout.width, height: savedLayout.height ?? layout.height }
      : layout
  }
  return merged
}
