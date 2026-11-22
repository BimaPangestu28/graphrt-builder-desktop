import type { AgentGraph, GraphNode, NodeLayout } from '@/api/agentGraphTypes'
import { runElkLayout } from './layoutEngine'

/**
 * Auto-layout with ELK (elkjs, layered). The top level runs top to bottom and a
 * loop body (For each, Repeat) left to right inside its container (spec A), which
 * fits the builder's narrow Nodes column. Arrows never cross a container boundary,
 * so each scope is laid out on its own; child positions are relative to their
 * container, the same convention React Flow and the saved positions use.
 * ELK runs in a Web Worker and is loaded on first use (see `layoutEngine.ts`).
 */

/** Size of a step card on the canvas. */
export const stepNodeSize = { width: 240, height: 112 }
/** Smallest container (For each / Repeat) a resize allows, and the size of an empty one. */
export const containerMinimumSize = { width: 300, height: 180 }
/** Size of a hidden body marker (the dot a loop body's arrows start from). */
export const markerNodeSize = { width: 12, height: 12 }
/** Size of the End pill (spec A: a rounded pill, not a card). */
export const endNodeSize = { width: 200, height: 36 }

/** True for the End step, drawn as a pill. */
export function isEndPillNode(node: Pick<GraphNode, 'kind' | 'hidden'>): boolean {
  return node.kind === 'end' && !node.hidden
}
/** Space for a container's header above its body. */
const containerHeaderHeight = 64
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

/** Which way arrows run in a scope: down at the top level, right inside a loop. */
export type FlowDirection = 'down' | 'right'

/** The direction of the scope a node sits in. */
export function flowDirectionOf(node: Pick<GraphNode, 'parent'>): FlowDirection {
  return node.parent ? 'right' : 'down'
}

const rootLayoutOptions: Record<string, string> = {
  'elk.algorithm': 'layered',
  'elk.direction': 'DOWN',
  'elk.layered.spacing.nodeNodeBetweenLayers': '56',
  'elk.spacing.nodeNode': '48',
  'elk.layered.nodePlacement.strategy': 'BRANDES_KOEPF',
}

const containerLayoutOptions: Record<string, string> = {
  'elk.algorithm': 'layered',
  'elk.direction': 'RIGHT',
  'elk.layered.spacing.nodeNodeBetweenLayers': '64',
  'elk.spacing.nodeNode': '32',
  'elk.padding': `[top=${containerHeaderHeight},left=${containerPadding},bottom=${containerPadding},right=${containerPadding + 40}]`,
}

type ElkEdge = { id: string; sources: string[]; targets: string[] }

function sizeOf(node: GraphNode): { width: number; height: number } {
  if (node.hidden) return markerNodeSize
  return isEndPillNode(node) ? endNodeSize : stepNodeSize
}

function toElkNode(node: GraphNode, childrenByParent: Map<string | null, GraphNode[]>, edgesByScope: Map<string | null, ElkEdge[]>): ElkNodeInput {
  const children = childrenByParent.get(node.id) ?? []
  if (!node.container) return { id: node.id, ...sizeOf(node) }
  return {
    id: node.id,
    layoutOptions: containerLayoutOptions,
    children: children.length > 0 ? children.map((child) => toElkNode(child, childrenByParent, edgesByScope)) : undefined,
    edges: children.length > 0 ? (edgesByScope.get(node.id) ?? []) : undefined,
    ...(children.length === 0 ? containerMinimumSize : {}),
  }
}

function collectLayouts(node: ElkNodeOutput, layouts: NodeLayout[]): void {
  for (const child of node.children ?? []) {
    layouts.push({ nodeId: child.id, x: child.x ?? 0, y: child.y ?? 0, width: child.width ?? null, height: child.height ?? null })
    collectLayouts(child, layouts)
  }
}

/** The ELK graph of `graph`: nodes nested in their containers, each arrow in its scope (cross-scope ones are left out). */
export function toElkGraph(graph: AgentGraph): ElkNodeInput {
  const childrenByParent = new Map<string | null, GraphNode[]>()
  for (const node of graph.nodes) {
    const siblings = childrenByParent.get(node.parent) ?? []
    siblings.push(node)
    childrenByParent.set(node.parent, siblings)
  }
  const nodesById = new Map(graph.nodes.map((node) => [node.id, node]))
  const edgesByScope = new Map<string | null, ElkEdge[]>()
  for (const edge of graph.edges) {
    const source = nodesById.get(edge.source)
    const target = nodesById.get(edge.target)
    if (!source || !target || source.parent !== target.parent) continue
    edgesByScope.set(source.parent, [...(edgesByScope.get(source.parent) ?? []), { id: edge.id, sources: [edge.source], targets: [edge.target] }])
  }
  return {
    id: 'root',
    layoutOptions: rootLayoutOptions,
    children: (childrenByParent.get(null) ?? []).map((node) => toElkNode(node, childrenByParent, edgesByScope)),
    edges: edgesByScope.get(null) ?? [],
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
  const laidOut = (await runElkLayout(toElkGraph(graph))) as ElkNodeOutput
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
