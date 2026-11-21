import type { AgentGraph, NodeLayout } from '@/api/agentGraphTypes'
import type { GraphClipboard } from './clipboard'

/**
 * Small pure helpers behind the canvas commands: the words of each edit (they become
 * the version summary), the "Ask the builder" text, arrow-key nudging, and the
 * session-wide clipboard (copy in one agent, paste in another).
 */

let canvasClipboard: GraphClipboard | null = null

export function readCanvasClipboard(): GraphClipboard | null {
  return canvasClipboard
}

export function writeCanvasClipboard(clipboard: GraphClipboard | null): void {
  canvasClipboard = clipboard
}

/** "Write a short message", "Write a short message and Send", "3 steps". */
export function describeNodeList(graph: AgentGraph, nodeIds: string[]): string {
  const titles = nodeIds.map((nodeId) => graph.nodes.find((node) => node.id === nodeId)?.displayTitle ?? nodeId)
  if (titles.length <= 2) return titles.join(' and ')
  return `${titles.length} steps`
}

/** The chat draft for "Ask the builder about this" (the person finishes the sentence). */
export function buildAskBuilderText(graph: AgentGraph, nodeIds: string[]): string {
  const titles = nodeIds.map((nodeId) => graph.nodes.find((node) => node.id === nodeId)?.displayTitle ?? nodeId)
  if (titles.length === 1) return `About the "${titles[0]}" step: `
  return `About the steps ${titles.map((title) => `"${title}"`).join(', ')}: `
}

/** Steps a delete or copy applies to: visible steps only (body markers go with their loop). */
export function editableNodeIds(graph: AgentGraph, nodeIds: string[]): string[] {
  const visible = new Set(graph.nodes.filter((node) => !node.hidden).map((node) => node.id))
  return nodeIds.filter((nodeId) => visible.has(nodeId))
}

/** New positions after moving `nodeIds` by (dx, dy); steps inside a moved loop stay relative to it. */
export function nudgeLayouts(nodeIds: string[], positions: Record<string, NodeLayout>, delta: { x: number; y: number }): NodeLayout[] {
  return nodeIds.flatMap((nodeId) => {
    const layout = positions[nodeId]
    return layout ? [{ ...layout, x: layout.x + delta.x, y: layout.y + delta.y }] : []
  })
}
