import '@xyflow/react/dist/style.css'
import './flow/canvas.css'
import { useCallback, useMemo, useRef, useState, type RefObject } from 'react'
import type { NodeLayout } from '@/api/agentGraphTypes'
import { checkConnection } from '@/lib/agentGraphRules'
import type { NodeCanvasProps } from './contracts'
import { CanvasNodeActionsContext, ContainerDropHintContext, type CanvasNodeActions } from './flow/canvasActions'
import { EmptyCanvas, SelectionBar, ShortcutsPanel, ZoomControls } from './flow/CanvasOverlays'
import { buildAskBuilderText, describeNodeList, editableNodeIds } from './flow/canvasCommands'
import { Background, BackgroundVariant, ConnectionLineType, MiniMap, ReactFlow, ReactFlowProvider, SelectionMode, useReactFlow, useViewportStore } from './flow/flowLibrary'
import { NodeContextMenu } from './flow/NodeContextMenu'
import { isMacPlatform } from './flow/shortcuts'
import { flowEdgeTypes } from './flow/StepEdge'
import { flowNodeTypes } from './flow/StepNode'
import { toFlowEdges, toFlowNodes, type StepFlowEdge, type StepFlowNode } from './flow/toFlowElements'
import { useCanvasClipboard } from './flow/useCanvasClipboard'
import { useCanvasContextMenu } from './flow/useCanvasContextMenu'
import { useCanvasEditCommands } from './flow/useCanvasEditCommands'
import { useCanvasLayout, type MeasuredSizes } from './flow/useCanvasLayout'
import { useCanvasShortcuts } from './flow/useCanvasShortcuts'
import { useConnectMode } from './flow/useConnectMode'
import { useEdgeSelection, useFlowNodeState } from './flow/useFlowElementState'
import { useMinimapPreference } from './flow/minimapPreference'
import { isCompactCanvas, isMinimapShown, isTinyCanvas, useCanvasViewportFit, useElementSize } from './flow/useCanvasViewportFit'
import { useContainerDrag } from './flow/useContainerDrag'
import { usePrefersReducedMotion } from './flow/usePrefersReducedMotion'
import { isNoteFlowNodeId, noteIdOf, noteNodeTypes, toNoteFlowNodes } from './notes/NoteNode'
import { messages } from '@/i18n'

/** Step renderers plus the sticky notes (`notes/NoteNode.tsx`). */
const canvasNodeTypes = { ...flowNodeTypes, ...noteNodeTypes }

/**
 * The Nodes canvas (spec A, I1, N1): step cards with their ports, arrows, loop
 * containers, and the editing around them: connect by dragging from a port (or Enter
 * on a port, then Enter on the target), reconnect an arrow's end, rubber-band and
 * Shift-click selection, copy / paste / duplicate, delete, the right-click menu,
 * keyboard shortcuts with a "?" panel, zoom controls, minimap and compact cards when
 * zoomed far out. Every graph change goes through the callbacks (`useAgentGraph`),
 * positions through `onMoveNodes`.
 *
 * The behaviour lives in hooks under `flow/`: `useConnectMode` (drawing arrows),
 * `useCanvasClipboard` (copy / paste / duplicate), `useCanvasEditCommands` (delete,
 * disconnect, nudge), `useCanvasContextMenu` (both menus), `useCanvasShortcuts` (keys)
 * and `useFlowElementState` (React Flow's node list and the arrow selection).
 */

function minimapNodeColor(flowNode: StepFlowNode): string {
  if (isNoteFlowNodeId(flowNode.id)) return '#FEF9C3'
  if (flowNode.data.node.needsApproval) return '#F5C77E'
  return flowNode.type === 'container' ? 'rgba(244,244,245,0.6)' : '#D4D4D8'
}

function CanvasMiniMap() {
  return (
    <MiniMap<StepFlowNode>
      pannable
      zoomable
      ariaLabel={messages().nodes.minimapOfTheWholeAgent}
      className="node-minimap"
      nodeColor={minimapNodeColor}
      nodeStrokeColor={(flowNode) => (flowNode.type === 'container' ? '#A1A1AA' : 'transparent')}
      nodeBorderRadius={4}
      maskColor="rgba(244, 244, 245, 0.55)"
      style={{ width: 150, height: 112 }}
    />
  )
}

export function NodeCanvas(props: NodeCanvasProps) {
  return (
    <ReactFlowProvider>
      <CanvasBody {...props} />
    </ReactFlowProvider>
  )
}

/** Where a step lands when no position is known: a little up-left of the canvas centre. */
function useFallbackPoint(containerRef: RefObject<HTMLDivElement>) {
  const reactFlow = useReactFlow<StepFlowNode, StepFlowEdge>()
  return useCallback(() => {
    const box = containerRef.current?.getBoundingClientRect()
    if (!box || box.width === 0) return { x: 0, y: 0 }
    const center = reactFlow.screenToFlowPosition({ x: box.left + box.width / 2, y: box.top + box.height / 2 })
    return { x: center.x - 120, y: center.y - 50 }
  }, [reactFlow, containerRef])
}

/** Reports the selected steps (not markers or notes) through a handler React Flow sees as stable. */
function useStableSelectionHandler(onSelectionChange: (nodeIds: string[]) => void) {
  // React Flow reports the selection again whenever this handler changes; keep it stable.
  const onSelectionChangeRef = useRef(onSelectionChange)
  onSelectionChangeRef.current = onSelectionChange
  return useCallback(({ nodes }: { nodes: StepFlowNode[] }) => {
    onSelectionChangeRef.current(nodes.filter((node) => node.type !== 'marker' && !isNoteFlowNodeId(node.id)).map((node) => node.id))
  }, [])
}

function CanvasBody(props: NodeCanvasProps) {
  const { graph, positions, viewport, kindNames, kindsByKind, pluginStatuses, selectedNodeIds, readOnly, onSelectionChange, onMoveNodes, onViewportChange } = props
  const reactFlow = useReactFlow<StepFlowNode, StepFlowEdge>()
  const zoom = useViewportStore((state) => state.transform[2])
  const containerRef = useRef<HTMLDivElement>(null)
  const measuredRef = useRef<MeasuredSizes>(new Map())
  const isMac = useMemo(isMacPlatform, [])
  const prefersReducedMotion = usePrefersReducedMotion()
  const motion = useMemo(() => ({ duration: prefersReducedMotion ? 0 : 200 }), [prefersReducedMotion])
  const [announcement, setAnnouncement] = useState('')
  const announce = useCallback((message: string) => setAnnouncement(message), [])
  const canEdit = !readOnly && Boolean(props.onApplyEdit)

  const getFallbackPoint = useFallbackPoint(containerRef)
  const { mergedPositions } = useCanvasLayout({ graph, positions, measured: measuredRef.current, getFallbackPoint, onPlaced: onMoveNodes })
  const connectMode = useConnectMode({ graph, readOnly, canEdit, onConnect: props.onConnect, onApplyEdit: props.onApplyEdit, announce })
  const { connectingFrom } = connectMode

  // Sticky notes ride along with the steps (drawn under them); handlers tell them apart by id.
  const noteFlowNodes = useMemo(() => toNoteFlowNodes(props.notes ?? []) as unknown as StepFlowNode[], [props.notes])
  const flowNodesFromGraph = useMemo(
    () =>
      mergedPositions
        ? [...noteFlowNodes, ...toFlowNodes(graph, { positions: mergedPositions, kindNames, kindsByKind, pluginStatuses, selectedNodeIds, connectionChecks: connectMode.connectionChecks, connectSourceId: connectingFrom?.nodeId ?? null, readOnly })]
        : [],
    [noteFlowNodes, graph, mergedPositions, kindNames, kindsByKind, pluginStatuses, selectedNodeIds, connectMode.connectionChecks, connectingFrom, readOnly],
  )
  const { flowNodes, resetFlowNodes, handleNodesChange } = useFlowNodeState(flowNodesFromGraph, { readOnly, measuredRef })
  const { selectedEdgeIds, handleEdgesChange, clearEdgeSelection } = useEdgeSelection(graph)
  const flowEdges = useMemo(() => toFlowEdges(graph, selectedEdgeIds), [graph, selectedEdgeIds])

  const canvasSize = useElementSize(containerRef, mergedPositions !== null)
  const [minimapPreference, setMinimapPreference] = useMinimapPreference()
  const showMinimap = isMinimapShown(minimapPreference, canvasSize)
  const { fitViewOptions, fitAll } = useCanvasViewportFit({
    containerRef,
    isReady: mergedPositions !== null,
    insetLeft: props.overlayInsets?.left ?? 0,
    room: { minimapShown: showMinimap, compact: isCompactCanvas(canvasSize) },
    duration: motion.duration,
    focusRequest: props.focusRequest ?? null,
    selectedNodeId: selectedNodeIds.length === 1 ? selectedNodeIds[0] : null,
  })
  const containerDrag = useContainerDrag({ graph, canEdit, mergedPositions, onApplyEdit: props.onApplyEdit, onMoveNodes, announce, resetFlowNodes })
  const handleSelectionChange = useStableSelectionHandler(onSelectionChange)

  const clipboard = useCanvasClipboard({ graph, positions: mergedPositions ?? positions, canEdit, onApplyEdit: props.onApplyEdit, onMoveNodes, onSelectionChange, announce })
  const editCommands = useCanvasEditCommands({ graph, readOnly, canEdit, positions: mergedPositions, selectedNodeIds, callbacks: props, clearEdgeSelection, announce })
  const contextMenu = useCanvasContextMenu({
    graph,
    containerRef,
    selectedNodeIds,
    onSelectionChange,
    isMac,
    canEdit,
    callbacks: props,
    commands: {
      duplicateNodes: clipboard.duplicateNodes,
      disconnectNodes: editCommands.disconnectNodes,
      deleteNodes: (nodeIds) => editCommands.deleteNodesAndEdges(nodeIds, []),
      pasteAt: clipboard.pasteFromClipboards,
      fitAll,
    },
  })
  const { menu } = contextMenu
  const shortcuts = useCanvasShortcuts({
    graph,
    readOnly,
    isMac,
    isMenuOpen: menu !== null,
    containerRef,
    selectedNodeIds,
    selectedEdgeIds,
    motion,
    callbacks: props,
    clipboard,
    editCommands,
    connectMode,
    clearEdgeSelection,
    fitAll,
    openMenuForNode: contextMenu.openMenuForNode,
  })

  const { openMenuForNodes } = contextMenu
  const { startKeyboardConnect } = connectMode
  const onRequestAddNode = props.onRequestAddNode
  const nodeActions = useMemo<CanvasNodeActions>(
    () => ({
      openNodeMenu: (nodeId, screenPoint) => openMenuForNodes([nodeId], screenPoint),
      startKeyboardConnect,
      resizeContainer: (layout: NodeLayout) => onMoveNodes([{ ...layout, x: Math.round(layout.x), y: Math.round(layout.y), width: Math.round(layout.width ?? 0), height: Math.round(layout.height ?? 0) }]),
      addNodeOnEdge: !readOnly && onRequestAddNode ? (edgeId: string) => onRequestAddNode({ type: 'on-edge', edgeId }) : undefined,
    }),
    [openMenuForNodes, startKeyboardConnect, onMoveNodes, readOnly, onRequestAddNode],
  )

  function handleDragStop(_event: unknown, primaryNode: StepFlowNode, draggedFlowNodes: StepFlowNode[]) {
    for (const dragged of draggedFlowNodes) if (isNoteFlowNodeId(dragged.id)) props.onMoveNote?.(noteIdOf(dragged.id), dragged.position)
    const draggedNodes = draggedFlowNodes.filter((dragged) => !isNoteFlowNodeId(dragged.id))
    if (draggedNodes.length === 0) return
    // Into or out of a loop (or kept inside its own): positions are handled there.
    if (containerDrag.handleStepsDragStop(isNoteFlowNodeId(primaryNode.id) ? draggedNodes[0] : primaryNode, draggedNodes)) return
    onMoveNodes(
      draggedNodes.map((dragged) => ({
        nodeId: dragged.id,
        x: Math.round(dragged.position.x),
        y: Math.round(dragged.position.y),
        width: mergedPositions?.[dragged.id]?.width ?? null,
        height: mergedPositions?.[dragged.id]?.height ?? null,
      })),
    )
  }

  const isEmpty = !graph.nodes.some((node) => !node.hidden && node.kind !== 'start' && node.kind !== 'end')
  const visibleSelection = editableNodeIds(graph, selectedNodeIds)

  if (!mergedPositions) return <p className="m-0 p-6 text-muted">{messages().nodes.placingTheSteps}</p>

  return (
    <CanvasNodeActionsContext.Provider value={nodeActions}>
      <ContainerDropHintContext.Provider value={containerDrag.dropHint}>
        <div
          ref={containerRef}
          role="application"
          aria-roledescription={messages().nodes.nodeEditor}
          aria-label={messages().nodes.nodesCanvasDragToSelectSpace}
          onKeyDown={shortcuts.handleKeyDown}
          tabIndex={0}
          className={`node-canvas relative h-full min-h-[360px] w-full outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand ${connectingFrom ? 'is-connecting' : ''}`}
          data-testid="node-canvas"
        >
          <ReactFlow<StepFlowNode, StepFlowEdge>
            nodes={flowNodes}
            edges={flowEdges}
            nodeTypes={canvasNodeTypes}
            edgeTypes={flowEdgeTypes}
            onNodesChange={handleNodesChange}
            onEdgesChange={handleEdgesChange}
            onNodeDrag={containerDrag.handleNodeDrag}
            onNodeDragStop={handleDragStop}
            onSelectionChange={handleSelectionChange}
            onMoveEnd={(_event, nextViewport) => onViewportChange(nextViewport)}
            onConnect={(connection) => connectMode.connect({ source: connection.source, sourceHandle: connection.sourceHandle, target: connection.target })}
            onConnectStart={connectMode.handleConnectStart}
            onConnectEnd={connectMode.handleConnectEnd}
            isValidConnection={(connection) => checkConnection(graph, { source: connection.source, sourceHandle: connection.sourceHandle, target: connection.target }).allowed}
            onReconnect={connectMode.handleReconnect}
            onNodeContextMenu={contextMenu.handleNodeContextMenu}
            onSelectionContextMenu={contextMenu.handleSelectionContextMenu}
            onPaneContextMenu={contextMenu.handlePaneContextMenu}
            onPaneClick={connectMode.stopConnecting}
            defaultViewport={viewport ?? undefined}
            fitView={!viewport}
            fitViewOptions={fitViewOptions}
            // React Flow 13 follows the system color scheme by default; the app is light only.
            forceColorMode="light"
            nodesDraggable={!readOnly}
            nodesConnectable={!readOnly && Boolean(props.onConnect)}
            edgesReconnectable={canEdit}
            edgesFocusable
            elementsSelectable
            selectionOnDrag
            selectionMode={SelectionMode.Full}
            // Middle-drag pans (and Space + drag); the right button opens the canvas menu.
            panOnDrag={[1]}
            panOnScroll
            zoomActivationKeyCode={isMac ? 'Meta' : 'Control'}
            selectionKeyCode={null}
            multiSelectionKeyCode={['Shift', 'Meta', 'Control']}
            deleteKeyCode={null}
            disableKeyboardA11y
            connectionLineType={ConnectionLineType.SmoothStep}
            connectionLineStyle={{ stroke: '#0E7C66', strokeWidth: 2 }}
            connectionRadius={28}
            proOptions={{ hideAttribution: true }}
            minZoom={0.2}
            maxZoom={2}
            ariaLabelConfig={{ 'node.a11yDescription.default': messages().nodes.pressEnterToOpenItsSettings }}
          >
            <Background variant={BackgroundVariant.Dots} gap={16} size={1} color="#D4D4D8" />
            {showMinimap && <CanvasMiniMap />}
          </ReactFlow>
          <ZoomControls
            zoom={zoom}
            onZoomIn={() => void reactFlow.zoomIn(motion)}
            onZoomOut={() => void reactFlow.zoomOut(motion)}
            onFit={fitAll}
            insetLeft={props.overlayInsets?.left ?? 0}
            isMinimapShown={showMinimap}
            isTight={isTinyCanvas(canvasSize)}
            onToggleMinimap={() => setMinimapPreference(showMinimap ? 'hidden' : 'shown')}
            onShowShortcuts={shortcuts.toggleShortcuts}
          />
          {shortcuts.isShortcutsOpen && <ShortcutsPanel isMac={isMac} onClose={shortcuts.closeShortcuts} />}
          {visibleSelection.length > 1 && !menu && (
            <SelectionBar
              count={visibleSelection.length}
              readOnly={!canEdit}
              onDuplicate={() => clipboard.duplicateNodes(visibleSelection)}
              onAskBuilder={() => props.onAskBuilder?.(buildAskBuilderText(graph, visibleSelection))}
              onDelete={() => editCommands.deleteNodesAndEdges(visibleSelection, [])}
            />
          )}
          {connectingFrom?.viaKeyboard && (
            <div role="status" className="absolute left-1/2 top-4 z-20 -translate-x-1/2 rounded-lg bg-ink px-3 py-1.5 text-[12px] font-medium text-white shadow-md">
              {messages().nodes.connectingFrom}{' '}{describeNodeList(graph, [connectingFrom.nodeId])}{messages().nodes.tabToAStepAndPress}
            </div>
          )}
          {menu?.kind === 'node' && (
            <NodeContextMenu
              position={menu.position}
              title={describeNodeList(graph, menu.nodeIds)}
              items={contextMenu.nodeMenuItems}
              readOnly={readOnly}
              onAction={(action) => contextMenu.runNodeMenuAction(action, menu.nodeIds)}
              onClose={contextMenu.closeMenu}
            />
          )}
          {menu?.kind === 'pane' && (
            <NodeContextMenu
              position={menu.position}
              title={messages().nodes.theCanvas}
              items={contextMenu.paneMenuItems}
              readOnly={readOnly}
              onAction={(action) => contextMenu.runPaneMenuAction(action, menu.flowPoint)}
              onClose={contextMenu.closeMenu}
            />
          )}
          {isEmpty && <EmptyCanvas readOnly={readOnly} onAddNode={props.onOpenPalette} onWriteInChat={props.onAskBuilder ? () => props.onAskBuilder?.('') : undefined} />}
          <span aria-live="polite" className="sr-only">
            {announcement}
          </span>
        </div>
      </ContainerDropHintContext.Provider>
    </CanvasNodeActionsContext.Provider>
  )
}
