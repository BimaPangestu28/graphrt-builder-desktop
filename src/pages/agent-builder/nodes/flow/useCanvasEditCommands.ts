import { useCallback } from 'react'
import type { AgentGraph, NodeLayout } from '@/api/agentGraphTypes'
import type { NodeCanvasProps } from '../contracts'
import { disconnectGraphNodes } from '../graphEdits'
import { describeNodeList, editableNodeIds, nudgeLayouts } from './canvasCommands'

/**
 * Delete, disconnect and nudge on the Nodes canvas. Shared by the keyboard shortcuts,
 * the step menu and the selection bar so all three behave (and announce) the same.
 * Hidden and locked steps are always left out.
 */

export interface CanvasEditCommandsOptions {
  graph: AgentGraph
  readOnly: boolean
  canEdit: boolean
  /** Positions on the canvas, auto-laid out ones included; null until the steps are placed. */
  positions: Record<string, NodeLayout> | null
  selectedNodeIds: string[]
  callbacks: Pick<NodeCanvasProps, 'onDelete' | 'onApplyEdit' | 'onSelectionChange' | 'onMoveNodes'>
  clearEdgeSelection: () => void
  announce: (message: string) => void
}

export interface CanvasEditCommands {
  deleteNodesAndEdges: (nodeIds: string[], edgeIds: string[]) => void
  disconnectNodes: (nodeIds: string[]) => void
  /** Moves the selected steps by `delta` canvas units. */
  nudgeSelection: (delta: { x: number; y: number }) => void
}

/**
 * @param options - Graph, edit rights, positions, selection and canvas callbacks (CanvasEditCommandsOptions)
 * @returns The three edit commands (CanvasEditCommands)
 */
export function useCanvasEditCommands(options: CanvasEditCommandsOptions): CanvasEditCommands {
  const { graph, readOnly, canEdit, positions, selectedNodeIds, clearEdgeSelection, announce } = options
  const { onDelete, onApplyEdit, onSelectionChange, onMoveNodes } = options.callbacks

  const deleteNodesAndEdges = useCallback(
    (nodeIds: string[], edgeIds: string[]) => {
      if (readOnly || !onDelete) return
      const deletableNodeIds = editableNodeIds(graph, nodeIds)
      if (deletableNodeIds.length === 0 && edgeIds.length === 0) return
      onDelete({ nodeIds: deletableNodeIds, edgeIds })
      onSelectionChange([])
      clearEdgeSelection()
      announce(deletableNodeIds.length > 0 ? `Deleted ${describeNodeList(graph, deletableNodeIds)}` : 'Deleted the arrow')
    },
    [readOnly, onDelete, graph, onSelectionChange, clearEdgeSelection, announce],
  )

  const disconnectNodes = useCallback(
    (nodeIds: string[]) => {
      if (!canEdit) return
      onApplyEdit?.((current) => disconnectGraphNodes(current, nodeIds), `disconnected ${describeNodeList(graph, nodeIds)}`)
    },
    [canEdit, onApplyEdit, graph],
  )

  const nudgeSelection = useCallback(
    (delta: { x: number; y: number }) => {
      if (readOnly || !positions) return
      const layouts = nudgeLayouts(editableNodeIds(graph, selectedNodeIds), positions, delta)
      if (layouts.length > 0) onMoveNodes(layouts)
    },
    [readOnly, positions, graph, selectedNodeIds, onMoveNodes],
  )

  return { deleteNodesAndEdges, disconnectNodes, nudgeSelection }
}
