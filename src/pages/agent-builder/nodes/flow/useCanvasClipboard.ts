import { useCallback, useRef } from 'react'
import type { AgentGraph, NodeLayout } from '@/api/agentGraphTypes'
import { copyToClipboards, describeNodeList, editableNodeIds, readClipboardForPaste } from './canvasCommands'
import { copyGraphNodes, pasteGraphNodes, pasteOffset, type GraphClipboard } from './clipboard'
import { messages } from '@/i18n'

/**
 * Copy, paste and duplicate on the Nodes canvas (shortcuts, the context menus and the
 * selection bar share them). Repeated pastes of one copy step down and right, so the copies
 * do not land on top of each other; a paste at a point (the canvas menu) puts the copied
 * steps' top-left corner there.
 */

/** The shift that puts the copied steps' top-left corner at `point`. */
export function pasteShiftTo(clipboard: GraphClipboard, point: { x: number; y: number }): { x: number; y: number } {
  const copiedIds = new Set(clipboard.nodes.map((node) => node.id))
  const topLayouts = clipboard.nodes.filter((node) => !node.parent || !copiedIds.has(node.parent)).flatMap((node) => (clipboard.layouts[node.id] ? [clipboard.layouts[node.id]] : []))
  if (topLayouts.length === 0) return pasteOffset
  return { x: Math.round(point.x - Math.min(...topLayouts.map((layout) => layout.x))), y: Math.round(point.y - Math.min(...topLayouts.map((layout) => layout.y))) }
}

export interface CanvasClipboardOptions {
  graph: AgentGraph
  /** Positions on the canvas (auto-laid out ones included); copies keep their arrangement. */
  positions: Record<string, NodeLayout>
  canEdit: boolean
  onApplyEdit?: (change: (graph: AgentGraph) => AgentGraph, description?: string) => void
  onMoveNodes: (layouts: NodeLayout[]) => void
  onSelectionChange: (nodeIds: string[]) => void
  announce: (message: string) => void
}

export interface CanvasClipboard {
  /** Copies the steps to the app and system clipboards; false when none can be copied. */
  copyNodes: (nodeIds: string[]) => boolean
  /** Pastes what the clipboards hold, at `at` (canvas units) or next to the last paste. */
  pasteFromClipboards: (at?: { x: number; y: number }) => void
  duplicateNodes: (nodeIds: string[]) => void
}

/**
 * @param options - Graph, positions and the canvas callbacks (CanvasClipboardOptions)
 * @returns Copy, paste and duplicate (CanvasClipboard)
 *
 * @example
 * const clipboard = useCanvasClipboard({ graph, positions, canEdit, onApplyEdit, onMoveNodes, onSelectionChange, announce })
 * clipboard.duplicateNodes(selectedNodeIds)
 */
export function useCanvasClipboard({ graph, positions, canEdit, onApplyEdit, onMoveNodes, onSelectionChange, announce }: CanvasClipboardOptions): CanvasClipboard {
  const pasteCountRef = useRef(0)
  const graphRef = useRef(graph)
  graphRef.current = graph

  const pasteClipboard = useCallback(
    (clipboard: GraphClipboard, verb: string, at?: { x: number; y: number }) => {
      if (!canEdit || clipboard.nodes.length === 0) return
      // Read the graph at paste time: a system clipboard read finishes after this render.
      const currentGraph = graphRef.current
      pasteCountRef.current += 1
      const shift = at ? pasteShiftTo(clipboard, at) : { x: pasteOffset.x * pasteCountRef.current, y: pasteOffset.y * pasteCountRef.current }
      const result = pasteGraphNodes(currentGraph, clipboard, shift)
      onApplyEdit?.(() => result.graph, `${verb} ${describeNodeList(result.graph, result.pastedRootIds)}`)
      if (result.layouts.length > 0) onMoveNodes(result.layouts)
      onSelectionChange(result.pastedRootIds)
      announce(`${verb === 'duplicated' ? 'Duplicated' : 'Pasted'} ${result.pastedRootIds.length === 1 ? '1 step' : `${result.pastedRootIds.length} steps`}`)
    },
    [canEdit, onApplyEdit, onMoveNodes, onSelectionChange, announce],
  )

  const pasteFromClipboards = useCallback(
    (at?: { x: number; y: number }) => {
      if (!canEdit) return
      readClipboardForPaste()
        .then((clipboard) => {
          if (clipboard) pasteClipboard(clipboard, 'pasted', at)
          else announce(messages().nodes.nothingToPasteCopyStepsFirst)
        })
        .catch((pasteError: unknown) => console.warn('could not paste the steps', pasteError))
    },
    [canEdit, pasteClipboard, announce],
  )

  const readCopy = useCallback(
    (nodeIds: string[]): GraphClipboard | null => {
      const clipboard = copyGraphNodes(graph, editableNodeIds(graph, nodeIds), positions)
      return clipboard.nodes.length === 0 ? null : clipboard
    },
    [graph, positions],
  )

  const copyNodes = useCallback(
    (nodeIds: string[]) => {
      const clipboard = readCopy(nodeIds)
      if (!clipboard) return false
      void copyToClipboards(clipboard)
      pasteCountRef.current = 0
      announce(messages().nodes.copiedNodelist(describeNodeList(graph, editableNodeIds(graph, nodeIds))))
      return true
    },
    [readCopy, graph, announce],
  )

  const duplicateNodes = useCallback(
    (nodeIds: string[]) => {
      const clipboard = readCopy(nodeIds)
      if (!clipboard) return
      pasteCountRef.current = 0
      pasteClipboard(clipboard, 'duplicated')
    },
    [readCopy, pasteClipboard],
  )

  return { copyNodes, pasteFromClipboards, duplicateNodes }
}
