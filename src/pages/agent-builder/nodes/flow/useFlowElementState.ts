import { useCallback, useEffect, useMemo, useState, type MutableRefObject } from 'react'
import type { AgentGraph } from '@/api/agentGraphTypes'
import { applyNodeChanges, type EdgeChange, type NodeChange } from './flowLibrary'
import type { StepFlowEdge, StepFlowNode } from './toFlowElements'
import type { MeasuredSizes } from './useCanvasLayout'

/**
 * The React Flow side of the canvas state: the node list React Flow mutates while
 * dragging and measuring, and which arrows are selected. The graph stays the source of
 * truth; these only hold what React Flow needs between two graph changes.
 */

/** `nextNodes` with the measured sizes of `currentNodes` carried over. */
function keepMeasuredSizes(currentNodes: StepFlowNode[], nextNodes: StepFlowNode[]): StepFlowNode[] {
  const measuredById = new Map(currentNodes.map((flowNode) => [flowNode.id, flowNode.measured]))
  return nextNodes.map((flowNode) => (measuredById.get(flowNode.id) ? { ...flowNode, measured: measuredById.get(flowNode.id) } : flowNode))
}

export interface FlowNodeState {
  flowNodes: StepFlowNode[]
  /** Back to where the graph says (a refused drop into a loop snaps the step back). */
  resetFlowNodes: () => void
  handleNodesChange: (changes: NodeChange<StepFlowNode>[]) => void
}

/**
 * Keeps React Flow's node list in step with the graph. Measured sizes survive rebuilds:
 * React Flow never measures a node whose size did not change again, and an unmeasured
 * node stays invisible. Removals always go through the graph; while read-only only
 * selection and size changes apply.
 *
 * @param flowNodesFromGraph - Nodes built from the graph (StepFlowNode[])
 * @param options.readOnly - Ignore moves while the canvas is read-only (boolean)
 * @param options.measuredRef - Receives every measured size, for auto-layout (MutableRefObject<MeasuredSizes>)
 * @returns The node list and its handlers (FlowNodeState)
 */
export function useFlowNodeState(flowNodesFromGraph: StepFlowNode[], options: { readOnly: boolean; measuredRef: MutableRefObject<MeasuredSizes> }): FlowNodeState {
  const { readOnly, measuredRef } = options
  const [flowNodes, setFlowNodes] = useState<StepFlowNode[]>(flowNodesFromGraph)
  const resetFlowNodes = useCallback(() => setFlowNodes((current) => keepMeasuredSizes(current, flowNodesFromGraph)), [flowNodesFromGraph])
  useEffect(resetFlowNodes, [resetFlowNodes])

  function handleNodesChange(changes: NodeChange<StepFlowNode>[]) {
    for (const change of changes) {
      if (change.type === 'dimensions' && change.dimensions) measuredRef.current.set(change.id, change.dimensions)
    }
    const allowed = changes.filter((change) => change.type !== 'remove' && (!readOnly || change.type === 'select' || change.type === 'dimensions'))
    setFlowNodes((current) => applyNodeChanges(allowed, current))
  }

  return { flowNodes, resetFlowNodes, handleNodesChange }
}

export interface EdgeSelection {
  /** Selected arrows that still exist in the graph. */
  selectedEdgeIds: string[]
  handleEdgesChange: (changes: EdgeChange<StepFlowEdge>[]) => void
  /** Stable. */
  clearEdgeSelection: () => void
}

/**
 * Which arrows are selected. Only selection changes are taken from React Flow; ids of
 * arrows the graph no longer has are dropped.
 *
 * @param graph - The graph on the canvas (AgentGraph)
 * @returns The selected arrows and their handlers (EdgeSelection)
 */
export function useEdgeSelection(graph: AgentGraph): EdgeSelection {
  const [rawSelectedEdgeIds, setRawSelectedEdgeIds] = useState<string[]>([])
  const selectedEdgeIds = useMemo(() => rawSelectedEdgeIds.filter((edgeId) => graph.edges.some((edge) => edge.id === edgeId)), [graph, rawSelectedEdgeIds])
  const clearEdgeSelection = useCallback(() => setRawSelectedEdgeIds([]), [])

  function handleEdgesChange(changes: EdgeChange<StepFlowEdge>[]) {
    const selectChanges = changes.filter((change) => change.type === 'select')
    if (selectChanges.length === 0) return
    setRawSelectedEdgeIds((current) => {
      const next = new Set(current)
      for (const change of selectChanges) {
        if (change.type !== 'select') continue
        if (change.selected) next.add(change.id)
        else next.delete(change.id)
      }
      return [...next]
    })
  }

  return { selectedEdgeIds, handleEdgesChange, clearEdgeSelection }
}
