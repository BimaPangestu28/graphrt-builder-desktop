import '@xyflow/react/dist/style.css'
import { useEffect, useMemo, useState } from 'react'
import type { NodeLayout } from '@/api/agentGraphTypes'
import type { NodeCanvasProps } from './contracts'
import { computeAutoLayout, mergeLayouts } from './flow/autoLayout'
import { applyNodeChanges, Background, BackgroundVariant, Controls, ReactFlow, type NodeChange } from './flow/flowLibrary'
import { flowNodeTypes } from './flow/StepNode'
import { toFlowEdges, toFlowNodes, type StepFlowNode } from './flow/toFlowElements'

/**
 * The Nodes canvas. Phase 1: draws the working graph read-only with ELK auto-layout
 * for nodes without a saved position, lets nodes be dragged (reported through
 * `onMoveNodes`) unless `readOnly`, and reports selection and viewport. Phase 2
 * (canvas agent) adds connecting, deleting, drop targets and the context menu,
 * keeping {@link NodeCanvasProps}.
 */

/** Positions from the last ELK run, recomputed when the graph's shape changes. */
function useAutoLayout(graph: NodeCanvasProps['graph']): NodeLayout[] | null {
  const [autoLayouts, setAutoLayouts] = useState<NodeLayout[] | null>(null)
  // Only the shape matters for placement, not titles or config.
  const shapeKey = useMemo(
    () => JSON.stringify([graph.nodes.map((node) => [node.id, node.parent, node.container, node.hidden]), graph.edges.map((edge) => [edge.source, edge.target])]),
    [graph],
  )
  useEffect(() => {
    let isCurrent = true
    computeAutoLayout(graph)
      .then((layouts) => isCurrent && setAutoLayouts(layouts))
      .catch((layoutError: unknown) => {
        console.warn('auto-layout failed, placing nodes in a row', layoutError)
        if (isCurrent) setAutoLayouts(graph.nodes.map((node, nodeIndex) => ({ nodeId: node.id, x: nodeIndex * 280, y: 0 })))
      })
    return () => {
      isCurrent = false
    }
    // `shapeKey` stands for `graph` here: a title edit must not re-run the layout.
  }, [shapeKey])
  return autoLayouts
}

export function NodeCanvas({
  graph,
  positions,
  viewport,
  kindNames,
  selectedNodeIds,
  readOnly,
  onSelectionChange,
  onMoveNodes,
  onViewportChange,
}: NodeCanvasProps) {
  const autoLayouts = useAutoLayout(graph)
  const mergedPositions = useMemo(() => (autoLayouts ? mergeLayouts(autoLayouts, positions) : null), [autoLayouts, positions])
  const flowNodesFromGraph = useMemo(
    () => (mergedPositions ? toFlowNodes(graph, { positions: mergedPositions, kindNames, selectedNodeIds }) : []),
    [graph, mergedPositions, kindNames, selectedNodeIds],
  )
  const flowEdges = useMemo(() => toFlowEdges(graph), [graph])
  const [flowNodes, setFlowNodes] = useState<StepFlowNode[]>(flowNodesFromGraph)
  useEffect(() => setFlowNodes(flowNodesFromGraph), [flowNodesFromGraph])

  function handleNodesChange(changes: NodeChange<StepFlowNode>[]) {
    const allowed = readOnly ? changes.filter((change) => change.type === 'select' || change.type === 'dimensions') : changes
    setFlowNodes((current) => applyNodeChanges(allowed, current))
  }

  function handleDragStop(_event: unknown, _node: StepFlowNode, draggedNodes: StepFlowNode[]) {
    onMoveNodes(draggedNodes.map((dragged) => ({ nodeId: dragged.id, x: dragged.position.x, y: dragged.position.y, width: positions[dragged.id]?.width ?? null, height: positions[dragged.id]?.height ?? null })))
  }

  if (!mergedPositions) return <p className="m-0 p-6 text-muted">Placing the steps…</p>

  return (
    <div className="h-full min-h-[360px] w-full" data-testid="node-canvas">
      <ReactFlow<StepFlowNode>
        nodes={flowNodes}
        edges={flowEdges}
        nodeTypes={flowNodeTypes}
        onNodesChange={handleNodesChange}
        onNodeDragStop={handleDragStop}
        onSelectionChange={({ nodes }) => onSelectionChange(nodes.map((node) => node.id))}
        onMoveEnd={(_event, nextViewport) => onViewportChange(nextViewport)}
        defaultViewport={viewport ?? undefined}
        fitView={!viewport}
        nodesDraggable={!readOnly}
        nodesConnectable={false}
        edgesFocusable={false}
        deleteKeyCode={null}
        proOptions={{ hideAttribution: true }}
        minZoom={0.2}
      >
        <Background variant={BackgroundVariant.Dots} gap={18} size={1} />
        <Controls showInteractive={false} />
      </ReactFlow>
    </div>
  )
}
