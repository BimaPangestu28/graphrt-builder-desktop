import { useCallback, useRef, useState } from 'react'
import type { AgentGraph, NodeLayout } from '@/api/agentGraphTypes'
import { checkReparentNodes, reparentGraphNodes } from '../graphEdits'
import { isNoteFlowNodeId } from '../notes/NoteNode'
import type { ContainerDropHint } from './canvasActions'
import { describeNodeList } from './canvasCommands'
import { findDropContainer, grownContainerLayout, placeInsideContainer, type CanvasBox } from './containerDrop'
import { useReactFlow } from './flowLibrary'
import type { StepFlowEdge, StepFlowNode } from './toFlowElements'

/**
 * Dragging steps into and out of loops (spec I1 "a loop moves with its steps"; containers
 * hold their body): while a step is dragged over a loop the loop lights up (or turns red
 * with the reason), and on drop the step joins that loop or leaves it for the top level as
 * one undo step. Arrows that would cross the loop's edge are removed; moves that would
 * break a value reference are refused and the step snaps back.
 */

interface ContainerDragOptions {
  graph: AgentGraph
  /** Moves and edits allowed (not read-only, `onApplyEdit` given). */
  canEdit: boolean
  mergedPositions: Record<string, NodeLayout> | null
  onApplyEdit?: (change: (graph: AgentGraph) => AgentGraph, description?: string) => void
  onMoveNodes: (layouts: NodeLayout[]) => void
  announce: (message: string) => void
  /** Puts the drawn nodes back where the graph says (after a refused drop). */
  resetFlowNodes: () => void
}

export interface ContainerDrag {
  dropHint: ContainerDropHint | null
  handleNodeDrag: (event: unknown, node: StepFlowNode, draggedNodes: StepFlowNode[]) => void
  /** Handles the drop of steps; returns true when it took care of their positions. */
  handleStepsDragStop: (primary: StepFlowNode, draggedSteps: StepFlowNode[]) => boolean
  clearDropHint: () => void
}

/** Steps that can change loops: visible, not loops themselves, all in the same scope. */
function movableSteps(graph: AgentGraph, draggedNodes: StepFlowNode[]): { ids: string[]; parent: string | null } | null {
  const steps = draggedNodes.filter((flowNode) => !isNoteFlowNodeId(flowNode.id) && flowNode.type !== 'marker')
  if (steps.length === 0) return null
  const nodes = steps.map((flowNode) => graph.nodes.find((node) => node.id === flowNode.id))
  if (nodes.some((node) => !node || node.container)) return null
  const parent = nodes[0]?.parent ?? null
  if (nodes.some((node) => node?.parent !== parent)) return null
  return { ids: steps.map((flowNode) => flowNode.id), parent }
}

/**
 * Drop-into-loop handling for the canvas.
 *
 * @returns The current drop hint and the drag handlers (ContainerDrag)
 */
export function useContainerDrag({ graph, canEdit, mergedPositions, onApplyEdit, onMoveNodes, announce, resetFlowNodes }: ContainerDragOptions): ContainerDrag {
  const reactFlow = useReactFlow<StepFlowNode, StepFlowEdge>()
  const [dropHint, setDropHint] = useState<ContainerDropHint | null>(null)
  const checkCacheRef = useRef<{ key: string; hint: ContainerDropHint | null } | null>(null)

  const boxOf = useCallback(
    (nodeId: string): CanvasBox | null => {
      const internalNode = reactFlow.getInternalNode(nodeId)
      if (!internalNode) return null
      const width = internalNode.measured?.width ?? internalNode.width ?? 0
      const height = internalNode.measured?.height ?? internalNode.height ?? 0
      return { ...internalNode.internals.positionAbsolute, width, height }
    },
    [reactFlow],
  )

  /** The loop under the dragged step's centre, ignoring the dragged steps themselves. */
  const targetOf = useCallback(
    (primaryId: string): string | null => {
      const primaryBox = boxOf(primaryId)
      if (!primaryBox) return null
      const containers = graph.nodes.flatMap((node) => {
        const box = node.container && node.id !== primaryId ? boxOf(node.id) : null
        return box ? [{ id: node.id, box }] : []
      })
      return findDropContainer(containers, { x: primaryBox.x + primaryBox.width / 2, y: primaryBox.y + primaryBox.height / 2 })
    },
    [graph, boxOf],
  )

  const handleNodeDrag = useCallback(
    (_event: unknown, node: StepFlowNode, draggedNodes: StepFlowNode[]) => {
      if (!canEdit) return
      const steps = movableSteps(graph, draggedNodes.length > 0 ? draggedNodes : [node])
      const target = steps ? targetOf(node.id) : null
      const key = steps ? `${steps.ids.join(',')}>${target ?? ''}` : ''
      if (checkCacheRef.current?.key === key) return
      let hint: ContainerDropHint | null = null
      if (steps && target !== steps.parent) {
        const check = checkReparentNodes(graph, steps.ids, target)
        // Leaving a loop shows on the loop being left; entering one shows on it.
        const containerId = target ?? steps.parent
        if (containerId && (target !== null || !check.allowed)) hint = { containerId, allowed: check.allowed, reason: check.reason }
      }
      checkCacheRef.current = { key, hint }
      setDropHint(hint)
    },
    [canEdit, graph, targetOf],
  )

  const clearDropHint = useCallback(() => {
    checkCacheRef.current = null
    setDropHint(null)
  }, [])

  /** Positions for steps dropped into `container` (relative), and the loop grown to hold them. */
  const layoutsInside = useCallback(
    (containerId: string, stepIds: string[]): NodeLayout[] => {
      const containerBox = boxOf(containerId)
      if (!containerBox) return []
      let size = { width: containerBox.width, height: containerBox.height }
      const layouts: NodeLayout[] = []
      for (const stepId of stepIds) {
        const stepBox = boxOf(stepId)
        if (!stepBox) continue
        const placed = placeInsideContainer(stepBox, stepBox, { ...containerBox, ...size })
        layouts.push({ nodeId: stepId, x: placed.position.x, y: placed.position.y, width: null, height: null })
        if (placed.grownSize) size = placed.grownSize
      }
      const containerLayout = mergedPositions?.[containerId]
      if (containerLayout && (size.width !== containerBox.width || size.height !== containerBox.height)) layouts.push(grownContainerLayout(containerLayout, size))
      return layouts
    },
    [boxOf, mergedPositions],
  )

  const handleStepsDragStop = useCallback(
    (primary: StepFlowNode, draggedSteps: StepFlowNode[]): boolean => {
      clearDropHint()
      const steps = canEdit ? movableSteps(graph, draggedSteps) : null
      if (!steps) return false
      const target = targetOf(primary.id)
      if (target === steps.parent) {
        if (!steps.parent) return false
        // Moved inside its own loop: keep it clear of the header, grow the loop if needed.
        onMoveNodes(layoutsInside(steps.parent, steps.ids))
        return true
      }
      const check = checkReparentNodes(graph, steps.ids, target)
      if (!check.allowed) {
        announce(`Can't move it there: ${check.reason}`)
        resetFlowNodes()
        return true
      }
      const loopTitle = describeNodeList(graph, [target ?? (steps.parent as string)])
      const description = target ? `moved ${describeNodeList(graph, steps.ids)} into ${loopTitle}` : `moved ${describeNodeList(graph, steps.ids)} out of ${loopTitle}`
      const layouts = target
        ? layoutsInside(target, steps.ids)
        : steps.ids.flatMap((stepId) => {
            const box = boxOf(stepId)
            return box ? [{ nodeId: stepId, x: Math.round(box.x), y: Math.round(box.y), width: null, height: null }] : []
          })
      onApplyEdit?.((current) => reparentGraphNodes(current, steps.ids, target), description)
      onMoveNodes(layouts)
      announce(description.charAt(0).toUpperCase() + description.slice(1))
      return true
    },
    [canEdit, graph, targetOf, layoutsInside, onApplyEdit, onMoveNodes, announce, resetFlowNodes, boxOf, clearDropHint],
  )

  return { dropHint, handleNodeDrag, handleStepsDragStop, clearDropHint }
}
