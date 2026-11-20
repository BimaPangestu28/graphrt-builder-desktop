import { useCallback, useEffect, useMemo, useState } from 'react'
import type { SaveGraphResult } from '@/api/agentGraphTypes'
import type { Agent } from '@/api/types'
import { describeError } from '@/lib/agentDisplay'
import { AddNodePalette } from './AddNodePalette'
import { computeAutoLayout } from './flow/autoLayout'
import { NodeCanvas } from './NodeCanvas'
import { NodeInspector } from './NodeInspector'
import { NodesToolbar } from './NodesToolbar'
import { ProblemsPanel } from './ProblemsPanel'
import { RunOverlay } from './RunOverlay'
import { SyncBanner } from './SyncBanner'
import { useAgentGraph, type AgentGraphController } from './useAgentGraph'
import { useNodeKinds } from './useNodeKinds'

/** Positions are saved this long after the last move or zoom. */
export const layoutSaveDelayMs = 800

export interface NodesViewProps {
  agent: Agent
  /** After a save added a version: reload the agent, its steps and the chat. */
  onGraphSaved?: (result: SaveGraphResult) => void
  /** The test run to show on the canvas (phase 2, RunOverlay). */
  runId?: string | null
}

/** Saves moved positions a moment after the last move, so dragging adds no version. */
function useLayoutAutosave(controller: AgentGraphController) {
  const { isLayoutDirty, saveLayout } = controller
  useEffect(() => {
    if (!isLayoutDirty) return
    const timer = window.setTimeout(() => {
      saveLayout().catch((layoutError: unknown) => console.warn('could not save the node positions', layoutError))
    }, layoutSaveDelayMs)
    return () => window.clearTimeout(timer)
  }, [isLayoutDirty, saveLayout])
}

/**
 * The builder's Nodes view (spec "Builder · Nodes"): toolbar, sync banner, the canvas
 * with the Add node palette and the step inspector beside it, and the problems list.
 * Owns the {@link useAgentGraph} controller and hands it to the phase-2 parts.
 */
export function NodesView({ agent, onGraphSaved, runId = null }: NodesViewProps) {
  const controller = useAgentGraph({ agentId: agent.id, currentVersion: agent.currentVersion, onSaved: onGraphSaved })
  const { nodeKinds, kindsByKind, kindNames } = useNodeKinds()
  const [selectedNodeIds, setSelectedNodeIdsState] = useState<string[]>([])
  // React Flow reports the selection after every node update; keep the same array when it did not change.
  const setSelectedNodeIds = useCallback((nodeIds: string[]) => {
    setSelectedNodeIdsState((current) => (current.length === nodeIds.length && current.every((nodeId, index) => nodeId === nodeIds[index]) ? current : nodeIds))
  }, [])
  const [isPaletteOpen, setIsPaletteOpen] = useState(false)
  useLayoutAutosave(controller)
  const { graph, moveNodes } = controller
  const readOnly = controller.builderBusy || controller.status === 'saving'
  const selectedNode = selectedNodeIds.length === 1 ? (graph?.nodes.find((node) => node.id === selectedNodeIds[0]) ?? null) : null
  const problems = useMemo(() => [...(graph?.problems ?? []), ...controller.saveProblems], [graph, controller.saveProblems])

  async function placeAllNodes() {
    if (!graph) return
    moveNodes(await computeAutoLayout(graph))
  }

  if (controller.loadError) return <p className="m-0 p-6 text-muted">Could not read the steps: {describeError(controller.loadError)}</p>
  if (!graph) return <p className="m-0 p-6 text-muted">Loading the steps…</p>

  return (
    <div className="flex min-h-0 flex-1 flex-col" data-testid="nodes-view">
      <NodesToolbar
        controller={controller}
        isPaletteOpen={isPaletteOpen}
        onTogglePalette={() => setIsPaletteOpen((isOpen) => !isOpen)}
        onAutoLayout={() => void placeAllNodes()}
      />
      <SyncBanner controller={controller} />
      <div className="flex min-h-0 flex-1">
        <AddNodePalette
          isOpen={isPaletteOpen}
          nodeKinds={nodeKinds}
          graph={graph}
          readOnly={readOnly}
          onAddNode={(node, options) => {
            controller.addNode(node, `added ${node.displayTitle}`)
            if (options.connectFrom) controller.addEdge(options.connectFrom)
            if (options.position) moveNodes([options.position])
          }}
          onClose={() => setIsPaletteOpen(false)}
        />
        <div className="relative min-w-0 flex-1">
          <NodeCanvas
            graph={graph}
            positions={controller.positions}
            viewport={controller.viewport}
            kindNames={kindNames}
            selectedNodeIds={selectedNodeIds}
            readOnly={readOnly}
            onSelectionChange={setSelectedNodeIds}
            onMoveNodes={moveNodes}
            onViewportChange={controller.setViewport}
          />
          <RunOverlay graph={graph} runId={runId} />
        </div>
        <NodeInspector
          node={selectedNode}
          graph={graph}
          kindInfo={selectedNode ? (kindsByKind[selectedNode.kind] ?? null) : null}
          nodeKinds={nodeKinds}
          problems={selectedNode ? problems.filter((problem) => problem.nodeId === selectedNode.id) : []}
          readOnly={readOnly}
          controller={controller}
          onClose={() => setSelectedNodeIds([])}
        />
      </div>
      <ProblemsPanel problems={problems} graph={graph} onSelectNode={(nodeId) => setSelectedNodeIds([nodeId])} />
    </div>
  )
}
