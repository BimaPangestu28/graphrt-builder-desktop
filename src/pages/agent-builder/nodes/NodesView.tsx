import { useCallback, useEffect, useMemo, useState } from 'react'
import type { SaveGraphResult } from '@/api/agentGraphTypes'
import { stopAgentRevision } from '@/api/builder'
import { BackendError } from '@/api/client'
import type { Agent } from '@/api/types'
import { describeError } from '@/lib/agentDisplay'
import { AddNodePalette } from './AddNodePalette'
import type { InspectorSectionRequest, InspectorSectionTarget, NodeSetupStatus } from './contracts'
import { computeAutoLayout } from './flow/autoLayout'
import { describeNodeList } from './flow/canvasCommands'
import { addGraphEdge, addGraphNode, removeGraphEdges, removeGraphNodes } from './graphEdits'
import { NodeCanvas } from './NodeCanvas'
import { NodeInspector } from './NodeInspector'
import { NodesToolbar } from './NodesToolbar'
import { PaletteDropZone } from './palette/PaletteDropZone'
import { CanvasNotesProvider } from './notes/NoteNode'
import { useCanvasNotes } from './notes/useCanvasNotes'
import { useAddNodePalette } from './palette/useAddNodePalette'
import { describeTestBlock, groupProblemsByNode } from './problems/problemDisplay'
import { useGraphValidation } from './problems/useGraphValidation'
import { ProblemsPanel } from './ProblemsPanel'
import { NodeDecorationsProvider } from './run/NodeDecorations'
import { NodesRunActions } from './run/NodesRunActions'
import { RunBar } from './run/RunBar'
import { runCanvasScopeAttribute } from './run/RunCanvasStyles'
import { useNodesLiveRun } from './run/useNodesLiveRun'
import { RunOverlay } from './RunOverlay'
import { SyncBanner } from './SyncBanner'
import { autosaveDelayMs as defaultAutosaveDelayMs, useGraphAutosave } from './sync/useGraphAutosave'
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
  /** The run to show on the canvas first; otherwise a test still going, or the next one started. */
  runId?: string | null
  /** Plugin setup state, for the "Not linked" / "Not installed" badges on plugin steps. */
  pluginRequirements?: NodesPluginRequirement[]
  /** Pre-fills the builder chat with `text` (never sends); empty text only focuses the chat. */
  onAskBuilder?: (text: string) => void
  /** False while a plugin the agent needs is not ready: Test then asks to set it up. */
  arePluginsReady?: boolean
  /** Brings the chat's plugin setup card up. */
  onShowPluginSetup?: () => void
  /** Delay before an edit is saved as a version; null saves only with Save. */
  autosaveDelayMs?: number | null
}

/** "Stop the builder" in the sync banner: cancels the running chat change (the chat says "Stopped by you"). */
async function stopBuilder(agentId: string): Promise<void> {
  try {
    await stopAgentRevision(agentId)
  } catch (stopError) {
    console.warn('could not stop the builder', stopError)
  }
}

/** Where a new note goes: near the top left of what the canvas shows. */
function notePositionFor(viewport: AgentGraphController['viewport']): { x: number; y: number } {
  if (!viewport) return { x: 40, y: -160 }
  return { x: (-viewport.x + 80) / viewport.zoom, y: (-viewport.y + 60) / viewport.zoom }
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
 * Owns the {@link useAgentGraph} controller and hands it to the phase-2 parts; runs and
 * validation are followed here and drawn on the nodes through {@link NodeDecorationsProvider}.
 */
export function NodesView({
  agent,
  onGraphSaved,
  runId = null,
  pluginRequirements,
  onAskBuilder,
  arePluginsReady = true,
  onShowPluginSetup,
  autosaveDelayMs = defaultAutosaveDelayMs,
}: NodesViewProps) {
  const controller = useAgentGraph({ agentId: agent.id, currentVersion: agent.currentVersion, onSaved: onGraphSaved })
  const { nodeKinds, kindsByKind, kindNames, reload: reloadNodeKinds } = useNodeKinds()
  const [selectedNodeIds, setSelectedNodeIdsState] = useState<string[]>([])
  // React Flow reports the selection after every node update; keep the same array when it did not change.
  const setSelectedNodeIds = useCallback((nodeIds: string[]) => {
    setSelectedNodeIdsState((current) => (current.length === nodeIds.length && current.every((nodeId, index) => nodeId === nodeIds[index]) ? current : nodeIds))
  }, [])
  const [isProblemsPanelHidden, setIsProblemsPanelHidden] = useState(false)
  const [requestedSection, setRequestedSection] = useState<InspectorSectionRequest | null>(null)
  /** Opens part of the inspector for `nodeId` ("Change action", a field with a problem). */
  const requestInspectorSection = useCallback(
    (nodeId: string, section: InspectorSectionTarget) => {
      setSelectedNodeIds([nodeId])
      setRequestedSection((current) => ({ section, nodeId, sequence: (current?.sequence ?? 0) + 1 }))
    },
    [setSelectedNodeIds],
  )
  useLayoutAutosave(controller)
  useGraphAutosave(controller, autosaveDelayMs)
  const { graph, moveNodes, applyEdit } = controller
  const live = useNodesLiveRun({ agentId: agent.id, graph, initialRunId: runId })
  const validation = useGraphValidation(controller, agent.id)
  const canvasNotes = useCanvasNotes(agent.id, controller.savedGraph?.version ?? null)
  const isSaving = controller.status === 'saving'
  // The canvas is read-only while the builder works; the inspector's edits wait in the queue.
  const readOnly = controller.builderBusy || isSaving
  const palette = useAddNodePalette({
    graph,
    nodeKinds,
    selectedNodeIds,
    readOnly,
    controller,
  })
  const selectedNode = selectedNodeIds.length === 1 ? (graph?.nodes.find((node) => node.id === selectedNodeIds[0]) ?? null) : null
  const { problems } = validation
  const problemsByNode = useMemo(() => (graph ? groupProblemsByNode(problems, graph) : {}), [graph, problems])
  const testBlock = graph ? describeTestBlock({ problems, graph, builderBusy: controller.builderBusy, isSaving, arePluginsReady }) : null
  const pluginStatuses = useMemo(() => toPluginStatuses(pluginRequirements ?? []), [pluginRequirements])

  async function placeAllNodes() {
    if (!graph) return
    moveNodes(await computeAutoLayout(graph))
  }

  async function startTest() {
    if (!arePluginsReady) {
      onShowPluginSetup?.()
      return
    }
    if (controller.isDirty && !(await controller.save())) return
    const { error } = await live.testRun.startTest()
    if (error instanceof BackendError && error.code === 'missing_plugins') onShowPluginSetup?.()
  }

  async function validateNow() {
    setIsProblemsPanelHidden(false)
    await validation.validate()
  }

  if (controller.loadError) return <p className="m-0 p-6 text-muted">Could not read the steps: {describeError(controller.loadError)}</p>
  if (!graph) return <p className="m-0 p-6 text-muted">Loading the steps…</p>

  return (
    <div className="flex min-h-0 flex-1 flex-col" data-testid="nodes-view">
      <NodesToolbar
        controller={controller}
        isPaletteOpen={palette.isOpen}
        onTogglePalette={palette.toggle}
        onAutoLayout={() => void placeAllNodes()}
        extraActions={
          <NodesRunActions
            problems={problems}
            isValidating={validation.isValidating}
            onValidate={() => void validateNow()}
            onAddNote={() => canvasNotes.addNote(notePositionFor(controller.viewport))}
            canAddNote={!readOnly}
            testBlock={testBlock}
            isStarting={live.testRun.isStarting}
            isRunActive={live.isActive}
            onTest={() => void startTest()}
          />
        }
      />
      <SyncBanner controller={controller} onStopBuilder={() => void stopBuilder(agent.id)} />
      <RunBar agentId={agent.id} graph={graph} live={live} />
      <div className="flex min-h-0 flex-1">
        <div className="relative min-w-0 flex-1" {...{ [runCanvasScopeAttribute]: '' }}>
          <NodeDecorationsProvider value={{ run: live.runState, problemsByNode, liveViews: live.liveViews, now: live.now, onReviewApproval: live.setReviewNodeId }}>
            <CanvasNotesProvider value={{ updateNote: canvasNotes.updateNote, removeNote: canvasNotes.removeNote, readOnly }}>
              <PaletteDropZone graph={graph} readOnly={readOnly} {...palette.dropZoneProps}>
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
                  onOpenPalette={() => palette.open()}
                  onAddNodeAfter={(from) => palette.open({ type: 'after-exit', source: from.source, sourceHandle: from.sourceHandle })}
                  onRequestAddNode={palette.open}
                  onChangeAction={(nodeId) => requestInspectorSection(nodeId, 'change-action')}
                  onOpenNodeSettings={(nodeId) => setSelectedNodeIds([nodeId])}
                  onAskBuilder={onAskBuilder}
                  notes={canvasNotes.notes}
                  onMoveNote={(noteId, position) => canvasNotes.updateNote(noteId, { x: Math.round(position.x), y: Math.round(position.y) })}
                />
              </PaletteDropZone>
            </CanvasNotesProvider>
          </NodeDecorationsProvider>
          <RunOverlay graph={graph} runId={live.testRun.runId} live={live} problems={problems} />
          <AddNodePalette
            isOpen={palette.isOpen}
            nodeKinds={nodeKinds}
            graph={graph}
            readOnly={readOnly}
            onAddNode={(node, options) => {
              // One applyEdit: two actions in one handler would each start from this render's graph.
              controller.applyEdit((current) => {
                const withNode = addGraphNode(current, node)
                return options.connectFrom ? addGraphEdge(withNode, options.connectFrom) : withNode
              }, `added ${node.displayTitle}`)
              if (options.position) moveNodes([options.position])
            }}
            onClose={palette.close}
            onPluginInstalled={() => reloadNodeKinds()}
            {...palette.paletteProps}
          />
        </div>
        <NodeInspector
          node={selectedNode}
          graph={graph}
          kindInfo={selectedNode ? (kindsByKind[selectedNode.kind] ?? null) : null}
          nodeKinds={nodeKinds}
          problems={selectedNode ? (problemsByNode[selectedNode.id] ?? []) : []}
          readOnly={isSaving}
          controller={controller}
          onClose={() => setSelectedNodeIds([])}
          requestedSection={requestedSection}
          onAskBuilder={onAskBuilder}
        />
      </div>
      {!isProblemsPanelHidden && (
        <ProblemsPanel
          problems={problems}
          graph={graph}
          onSelectNode={(nodeId) => setSelectedNodeIds([nodeId])}
          onFixWithBuilder={onAskBuilder}
          testBlockReason={testBlock?.reason ?? null}
          wasValidated={validation.wasValidated}
          onClose={() => setIsProblemsPanelHidden(true)}
        />
      )}
    </div>
  )
}
