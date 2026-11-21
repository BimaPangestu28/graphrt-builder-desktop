import { useCallback, useEffect, useMemo, useState } from 'react'
import type { GraphNode, SaveGraphResult } from '@/api/agentGraphTypes'
import type { Agent } from '@/api/types'
import { describeError } from '@/lib/agentDisplay'
import { AddNodePalette } from './AddNodePalette'
import type { NodeSetupStatus } from './contracts'
import { computeAutoLayout } from './flow/autoLayout'
import { describeNodeList } from './flow/canvasCommands'
import { addGraphEdge, addGraphNode, insertGraphNodeAfter, removeGraphEdges, removeGraphNodes } from './graphEdits'
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

/** What the page knows about a plugin the agent needs (the builder's "Needs" list). */
export interface NodesPluginRequirement {
  pluginName?: string
  pluginState?: 'not_installed' | 'needs_setup' | 'not_linked' | 'ready'
  detail?: string
}

export interface NodesViewProps {
  agent: Agent
  /** After a save added a version: reload the agent, its steps and the chat. */
  onGraphSaved?: (result: SaveGraphResult) => void
  /** The test run to show on the canvas (phase 2, RunOverlay). */
  runId?: string | null
  /** Plugin setup state, for the "Not linked" / "Not installed" badges on plugin steps. */
  pluginRequirements?: NodesPluginRequirement[]
  /** Pre-fills the builder chat with `text` (never sends); empty text only focuses the chat. */
  onAskBuilder?: (text: string) => void
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
 * Card badges by plugin name from the page's plugin requirements.
 *
 * @param requirements - The builder's plugin requirements (NodesPluginRequirement[])
 * @returns Setup gaps by plugin name; ready plugins are absent (Record<string, NodeSetupStatus>)
 */
export function toPluginStatuses(requirements: NodesPluginRequirement[]): Record<string, NodeSetupStatus> {
  const statuses: Record<string, NodeSetupStatus> = {}
  for (const requirement of requirements) {
    if (!requirement.pluginName || !requirement.pluginState || requirement.pluginState === 'ready') continue
    const label = requirement.pluginState === 'not_linked' ? 'Not linked' : requirement.pluginState === 'not_installed' ? 'Not installed' : (requirement.detail ?? 'Needs setup')
    statuses[requirement.pluginName] = { label, tone: 'amber' }
  }
  return statuses
}

/**
 * The builder's Nodes view (spec "Builder · Nodes"): toolbar, sync banner, the canvas
 * with the Add node palette and the step inspector beside it, and the problems list.
 * Owns the {@link useAgentGraph} controller and hands it to the phase-2 parts.
 */
export function NodesView({ agent, onGraphSaved, runId = null, pluginRequirements, onAskBuilder }: NodesViewProps) {
  const controller = useAgentGraph({ agentId: agent.id, currentVersion: agent.currentVersion, onSaved: onGraphSaved })
  const { nodeKinds, kindsByKind, kindNames } = useNodeKinds()
  const [selectedNodeIds, setSelectedNodeIdsState] = useState<string[]>([])
  // React Flow reports the selection after every node update; keep the same array when it did not change.
  const setSelectedNodeIds = useCallback((nodeIds: string[]) => {
    setSelectedNodeIdsState((current) => (current.length === nodeIds.length && current.every((nodeId, index) => nodeId === nodeIds[index]) ? current : nodeIds))
  }, [])
  const [isPaletteOpen, setIsPaletteOpen] = useState(false)
  const [insertAfter, setInsertAfter] = useState<{ source: string; sourceHandle: string } | null>(null)
  const [validationMessage, setValidationMessage] = useState<string | null>(null)
  const [requestedSection, setRequestedSection] = useState<{ section: 'change-action'; sequence: number } | null>(null)
  useLayoutAutosave(controller)
  const { graph, moveNodes, applyEdit } = controller
  const readOnly = controller.builderBusy || controller.status === 'saving'
  const selectedNode = selectedNodeIds.length === 1 ? (graph?.nodes.find((node) => node.id === selectedNodeIds[0]) ?? null) : null
  const problems = useMemo(() => [...(graph?.problems ?? []), ...controller.saveProblems], [graph, controller.saveProblems])
  const pluginStatuses = useMemo(() => toPluginStatuses(pluginRequirements ?? []), [pluginRequirements])

  useEffect(() => setValidationMessage(null), [graph])

  async function placeAllNodes() {
    if (!graph) return
    moveNodes(await computeAutoLayout(graph))
  }

  function openPalette(after: { source: string; sourceHandle: string } | null) {
    setInsertAfter(after)
    setIsPaletteOpen(true)
  }

  function addNodeFromPalette(node: GraphNode, options: { connectFrom?: { source: string; sourceHandle?: string | null; target: string }; position?: { nodeId: string; x: number; y: number } }) {
    const description = `added ${node.displayTitle}`
    // One edit, so the node and its arrows are one undo step (and the arrow sees the new node).
    applyEdit((current) => {
      if (insertAfter && current.nodes.some((existing) => existing.id === insertAfter.source)) {
        const sourceParent = current.nodes.find((existing) => existing.id === insertAfter.source)?.parent ?? null
        return insertGraphNodeAfter(current, { ...node, parent: node.parent ?? sourceParent }, insertAfter)
      }
      const withNode = addGraphNode(current, node)
      return options.connectFrom ? addGraphEdge(withNode, options.connectFrom) : withNode
    }, description)
    if (options.position) moveNodes([options.position])
    setSelectedNodeIds([node.id])
    setInsertAfter(null)
  }

  function validate() {
    if (problems.length === 0) {
      setValidationMessage('No problems found')
      return
    }
    const firstWithNode = problems.find((problem) => problem.nodeId)
    if (firstWithNode?.nodeId) setSelectedNodeIds([firstWithNode.nodeId])
    setValidationMessage(problems.length === 1 ? '1 problem: see below' : `${problems.length} problems: see below`)
  }

  if (controller.loadError) return <p className="m-0 p-6 text-muted">Could not read the steps: {describeError(controller.loadError)}</p>
  if (!graph) return <p className="m-0 p-6 text-muted">Loading the steps…</p>

  return (
    <div className="flex min-h-0 flex-1 flex-col" data-testid="nodes-view">
      <NodesToolbar
        controller={controller}
        isPaletteOpen={isPaletteOpen}
        onTogglePalette={() => (isPaletteOpen ? setIsPaletteOpen(false) : openPalette(null))}
        onAutoLayout={() => void placeAllNodes()}
        onValidate={validate}
        validationMessage={validationMessage}
      />
      <SyncBanner controller={controller} />
      <div className="flex min-h-0 flex-1">
        <AddNodePalette
          isOpen={isPaletteOpen}
          nodeKinds={nodeKinds}
          graph={graph}
          readOnly={readOnly}
          insertAfter={insertAfter}
          onAddNode={addNodeFromPalette}
          onClose={() => {
            setIsPaletteOpen(false)
            setInsertAfter(null)
          }}
        />
        <div className="relative min-w-0 flex-1">
          <NodeCanvas
            graph={graph}
            positions={controller.positions}
            viewport={controller.viewport}
            kindNames={kindNames}
            kindsByKind={kindsByKind}
            pluginStatuses={pluginStatuses}
            selectedNodeIds={selectedNodeIds}
            readOnly={readOnly}
            onSelectionChange={setSelectedNodeIds}
            onMoveNodes={moveNodes}
            onViewportChange={controller.setViewport}
            onConnect={(edge) => controller.addEdge(edge, `connected ${describeNodeList(graph, [edge.source])} to ${describeNodeList(graph, [edge.target])}`)}
            onDelete={({ nodeIds, edgeIds }) =>
              applyEdit((current) => removeGraphEdges(removeGraphNodes(current, nodeIds), edgeIds), nodeIds.length > 0 ? `deleted ${describeNodeList(graph, nodeIds)}` : 'deleted an arrow')
            }
            onApplyEdit={applyEdit}
            onUndo={controller.undo}
            onRedo={controller.redo}
            onOpenPalette={() => openPalette(null)}
            onAddNodeAfter={(from) => openPalette(from)}
            onChangeAction={(nodeId) => {
              setSelectedNodeIds([nodeId])
              setRequestedSection((current) => ({ section: 'change-action', sequence: (current?.sequence ?? 0) + 1 }))
              // Until the inspector reads `requestedSection`: open its action picker once it shows this node.
              window.setTimeout(() => {
                const changeActionButton = document.querySelector<HTMLButtonElement>('[data-testid="node-inspector"] button[aria-haspopup="listbox"][aria-label$="Change action"]')
                if (changeActionButton && changeActionButton.getAttribute('aria-expanded') !== 'true') changeActionButton.click()
                changeActionButton?.focus()
              }, 50)
            }}
            onOpenNodeSettings={(nodeId) => setSelectedNodeIds([nodeId])}
            onAskBuilder={onAskBuilder}
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
          requestedSection={requestedSection}
          onAskBuilder={onAskBuilder}
        />
      </div>
      <ProblemsPanel problems={problems} graph={graph} onSelectNode={(nodeId) => setSelectedNodeIds([nodeId])} />
    </div>
  )
}
