import type { AgentGraph, NodeLayout } from '@/api/agentGraphTypes'
import { parseGraphClipboard, serializeGraphClipboard, type GraphClipboard } from './clipboard'

/**
 * Small helpers behind the canvas commands: the words of each edit (they become the
 * version summary), the "Ask the builder" text, arrow-key nudging, and the clipboard:
 * copies go to the system clipboard as graphrt JSON (paste in another window or agent)
 * and to a session copy used when the system clipboard cannot be read.
 */

let canvasClipboard: GraphClipboard | null = null

export function readCanvasClipboard(): GraphClipboard | null {
  return canvasClipboard
}

export function writeCanvasClipboard(clipboard: GraphClipboard | null): void {
  canvasClipboard = clipboard
}

/** The system clipboard, when the webview offers one. */
function systemClipboard(): Clipboard | null {
  return typeof navigator !== 'undefined' && navigator.clipboard ? navigator.clipboard : null
}

/**
 * Copies steps: the session copy always, the system clipboard when it can be written.
 *
 * @param clipboard - Steps to copy (GraphClipboard)
 * @returns True when the system clipboard took it too (Promise<boolean>)
 */
export async function copyToClipboards(clipboard: GraphClipboard): Promise<boolean> {
  writeCanvasClipboard(clipboard)
  const target = systemClipboard()
  if (!target?.writeText) return false
  try {
    await target.writeText(serializeGraphClipboard(clipboard))
    return true
  } catch (clipboardError) {
    console.warn('could not write the steps to the system clipboard; pasting works in this window', clipboardError)
    return false
  }
}

/**
 * Steps to paste: graphrt steps on the system clipboard (validated), else the session copy.
 *
 * @returns What to paste, or null when nothing was copied (Promise<GraphClipboard | null>)
 */
export async function readClipboardForPaste(): Promise<GraphClipboard | null> {
  const source = systemClipboard()
  if (source?.readText) {
    try {
      const fromSystem = parseGraphClipboard(await source.readText())
      if (fromSystem) return fromSystem
    } catch (clipboardError) {
      console.warn('could not read the system clipboard; pasting the steps copied in this window', clipboardError)
    }
  }
  return readCanvasClipboard()
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
