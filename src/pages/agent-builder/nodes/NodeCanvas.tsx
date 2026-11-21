import '@xyflow/react/dist/style.css'
import './flow/canvas.css'
import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent, type MouseEvent as ReactMouseEvent } from 'react'
import type { AgentGraph, NodeLayout } from '@/api/agentGraphTypes'
import { checkConnection, SOURCE_HANDLE, type ConnectionCheck } from '@/lib/agentGraphRules'
import type { NodeCanvasProps } from './contracts'
import { CanvasNodeActionsContext, ContainerDropHintContext, type CanvasNodeActions } from './flow/canvasActions'
import { EmptyCanvas, SelectionBar, ShortcutsPanel, ZoomControls } from './flow/CanvasOverlays'
import { buildAskBuilderText, copyToClipboards, describeNodeList, editableNodeIds, nudgeLayouts, readClipboardForPaste } from './flow/canvasCommands'
import { copyGraphNodes, pasteGraphNodes, pasteOffset, type GraphClipboard } from './flow/clipboard'
import { findDropContainer } from './flow/containerDrop'
import {
  applyNodeChanges,
  Background,
  BackgroundVariant,
  ConnectionLineType,
  MiniMap,
  ReactFlow,
  ReactFlowProvider,
  SelectionMode,
  useReactFlow,
  useStore,
  type Connection,
  type EdgeChange,
  type NodeChange,
  type OnConnectStartParams,
} from './flow/flowLibrary'
import { listNodeMenuItems, listPaneMenuItems, NodeContextMenu, type NodeMenuAction, type PaneMenuAction } from './flow/NodeContextMenu'
import { isMacPlatform, isTypingTarget, nudgeDistance, resolveShortcut, type CanvasShortcutAction } from './flow/shortcuts'
import { flowEdgeTypes } from './flow/StepEdge'
import { flowNodeTypes } from './flow/StepNode'
import { toFlowEdges, toFlowNodes, type StepFlowEdge, type StepFlowNode } from './flow/toFlowElements'
import { useCanvasLayout, type MeasuredSizes } from './flow/useCanvasLayout'
import { useCanvasViewportFit } from './flow/useCanvasViewportFit'
import { useContainerDrag } from './flow/useContainerDrag'
import { disconnectGraphNodes, reconnectGraphEdge, removeGraphEdges } from './graphEdits'
import { isNoteFlowNodeId, noteIdOf, noteNodeTypes, toNoteFlowNodes } from './notes/NoteNode'

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
 */

interface ConnectingFrom {
  nodeId: string
  handleId: string
  viaKeyboard: boolean
}

type OpenMenu =
  | { kind: 'node'; nodeIds: string[]; position: { x: number; y: number } }
  /** The empty-canvas menu; `flowPoint` is where it was opened, in canvas units. */
  | { kind: 'pane'; position: { x: number; y: number }; flowPoint: { x: number; y: number } }

const menuSize = { width: 236, height: 240 }

/** Menu position inside the canvas box, kept on screen. */
function menuPositionIn(box: DOMRect, screenPoint: { x: number; y: number }): { x: number; y: number } {
  return { x: Math.min(screenPoint.x - box.left, box.width - menuSize.width - 8), y: Math.min(screenPoint.y - box.top, Math.max(8, box.height - menuSize.height - 8)) }
}

function usePrefersReducedMotion(): boolean {
  const [prefersReduced, setPrefersReduced] = useState(() => typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches)
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return
    const query = window.matchMedia('(prefers-reduced-motion: reduce)')
    const update = () => setPrefersReduced(query.matches)
    query.addEventListener?.('change', update)
    return () => query.removeEventListener?.('change', update)
  }, [])
  return prefersReduced
}

/** The exit "Add node after" continues from: the default one, else the first. */
function continuationHandle(graph: AgentGraph, nodeId: string): string | null {
  const outputs = graph.nodes.find((node) => node.id === nodeId)?.ports.outputs ?? []
  return outputs.find((outputPort) => outputPort.id === SOURCE_HANDLE)?.id ?? outputs[0]?.id ?? null
}

/** The shift that puts the copied steps' top-left corner at `point`. */
function pasteShiftTo(clipboard: GraphClipboard, point: { x: number; y: number }): { x: number; y: number } {
  const copiedIds = new Set(clipboard.nodes.map((node) => node.id))
  const topLayouts = clipboard.nodes.filter((node) => !node.parent || !copiedIds.has(node.parent)).flatMap((node) => (clipboard.layouts[node.id] ? [clipboard.layouts[node.id]] : []))
  if (topLayouts.length === 0) return pasteOffset
  return { x: Math.round(point.x - Math.min(...topLayouts.map((layout) => layout.x))), y: Math.round(point.y - Math.min(...topLayouts.map((layout) => layout.y))) }
}

function focusedNodeId(): string | null {
  const element = document.activeElement instanceof HTMLElement ? document.activeElement.closest<HTMLElement>('.react-flow__node') : null
  return element?.dataset.id ?? null
}

export function NodeCanvas(props: NodeCanvasProps) {
  return (
    <ReactFlowProvider>
      <CanvasBody {...props} />
    </ReactFlowProvider>
  )
}

function CanvasBody(props: NodeCanvasProps) {
  const { graph, positions, viewport, kindNames, kindsByKind, pluginStatuses, selectedNodeIds, readOnly, onSelectionChange, onMoveNodes, onViewportChange } = props
  const reactFlow = useReactFlow<StepFlowNode, StepFlowEdge>()
  const zoom = useStore((state) => state.transform[2])
  const containerRef = useRef<HTMLDivElement>(null)
  const measuredRef = useRef<MeasuredSizes>(new Map())
  const isMac = useMemo(isMacPlatform, [])
  const prefersReducedMotion = usePrefersReducedMotion()
  const motion = useMemo(() => ({ duration: prefersReducedMotion ? 0 : 200 }), [prefersReducedMotion])
  const [connectingFrom, setConnectingFrom] = useState<ConnectingFrom | null>(null)
  const [selectedEdgeIds, setSelectedEdgeIds] = useState<string[]>([])
  const [menu, setMenu] = useState<OpenMenu | null>(null)
  const [isShortcutsOpen, setIsShortcutsOpen] = useState(false)
  const [announcement, setAnnouncement] = useState('')
  const pasteCountRef = useRef(0)
  const canEdit = !readOnly && Boolean(props.onApplyEdit)
  const graphRef = useRef(graph)
  graphRef.current = graph

  const getFallbackPoint = useCallback(() => {
    const box = containerRef.current?.getBoundingClientRect()
    if (!box || box.width === 0) return { x: 0, y: 0 }
    const center = reactFlow.screenToFlowPosition({ x: box.left + box.width / 2, y: box.top + box.height / 2 })
    return { x: center.x - 120, y: center.y - 50 }
  }, [reactFlow])
  const { mergedPositions } = useCanvasLayout({ graph, positions, measured: measuredRef.current, getFallbackPoint, onPlaced: onMoveNodes })

  const connectionChecks = useMemo<Record<string, ConnectionCheck> | null>(() => {
    if (!connectingFrom) return null
    const ends = { source: connectingFrom.nodeId, sourceHandle: connectingFrom.handleId }
    return Object.fromEntries(graph.nodes.filter((node) => !node.hidden && node.id !== connectingFrom.nodeId).map((node) => [node.id, checkConnection(graph, { ...ends, target: node.id })]))
  }, [graph, connectingFrom])

  // Sticky notes ride along with the steps (drawn under them); handlers tell them apart by id.
  const noteFlowNodes = useMemo(() => toNoteFlowNodes(props.notes ?? []) as unknown as StepFlowNode[], [props.notes])
  const flowNodesFromGraph = useMemo(
    () =>
      mergedPositions
        ? [...noteFlowNodes, ...toFlowNodes(graph, { positions: mergedPositions, kindNames, kindsByKind, pluginStatuses, selectedNodeIds, connectionChecks, connectSourceId: connectingFrom?.nodeId ?? null, readOnly })]
        : [],
    [noteFlowNodes, graph, mergedPositions, kindNames, kindsByKind, pluginStatuses, selectedNodeIds, connectionChecks, connectingFrom, readOnly],
  )
  const [flowNodes, setFlowNodes] = useState<StepFlowNode[]>(flowNodesFromGraph)
  // Keep React Flow's measured sizes across rebuilds: a node whose size did not change is
  // never measured again, and an unmeasured node stays invisible.
  useEffect(
    () =>
      setFlowNodes((current) => {
        const measuredById = new Map(current.map((flowNode) => [flowNode.id, flowNode.measured]))
        return flowNodesFromGraph.map((flowNode) => (measuredById.get(flowNode.id) ? { ...flowNode, measured: measuredById.get(flowNode.id) } : flowNode))
      }),
    [flowNodesFromGraph],
  )
  // Back to where the graph says (a refused drop into a loop snaps the step back).
  const resetFlowNodes = useCallback(
    () =>
      setFlowNodes((current) => {
        const measuredById = new Map(current.map((flowNode) => [flowNode.id, flowNode.measured]))
        return flowNodesFromGraph.map((flowNode) => (measuredById.get(flowNode.id) ? { ...flowNode, measured: measuredById.get(flowNode.id) } : flowNode))
      }),
    [flowNodesFromGraph],
  )
  const liveEdgeIds = useMemo(() => selectedEdgeIds.filter((edgeId) => graph.edges.some((edge) => edge.id === edgeId)), [graph, selectedEdgeIds])
  const flowEdges = useMemo(() => toFlowEdges(graph, liveEdgeIds), [graph, liveEdgeIds])

  const announce = useCallback((message: string) => setAnnouncement(message), [])
  const { fitViewOptions, fitAll } = useCanvasViewportFit({
    containerRef,
    isReady: mergedPositions !== null,
    insetLeft: props.overlayInsets?.left ?? 0,
    duration: motion.duration,
    focusRequest: props.focusRequest ?? null,
    selectedNodeId: selectedNodeIds.length === 1 ? selectedNodeIds[0] : null,
  })
  const containerDrag = useContainerDrag({ graph, canEdit, mergedPositions, onApplyEdit: props.onApplyEdit, onMoveNodes, announce, resetFlowNodes })
  // React Flow reports the selection again whenever this handler changes; keep it stable.
  const onSelectionChangeRef = useRef(onSelectionChange)
  onSelectionChangeRef.current = onSelectionChange
  const handleSelectionChange = useCallback(({ nodes }: { nodes: StepFlowNode[] }) => {
    onSelectionChangeRef.current(nodes.filter((node) => node.type !== 'marker' && !isNoteFlowNodeId(node.id)).map((node) => node.id))
  }, [])

  // ----- edits -----

  const deleteNodesAndEdges = useCallback(
    (nodeIds: string[], edgeIds: string[]) => {
      if (readOnly || !props.onDelete) return
      const deletableNodeIds = editableNodeIds(graph, nodeIds)
      if (deletableNodeIds.length === 0 && edgeIds.length === 0) return
      props.onDelete({ nodeIds: deletableNodeIds, edgeIds })
      onSelectionChange([])
      setSelectedEdgeIds([])
      announce(deletableNodeIds.length > 0 ? `Deleted ${describeNodeList(graph, deletableNodeIds)}` : 'Deleted the arrow')
    },
    [readOnly, props, graph, onSelectionChange, announce],
  )

  const pasteClipboard = useCallback(
    (clipboard: GraphClipboard, verb: string, at?: { x: number; y: number }) => {
      if (!canEdit || clipboard.nodes.length === 0) return
      // Read the graph at paste time: a system clipboard read finishes after this render.
      const currentGraph = graphRef.current
      pasteCountRef.current += 1
      const shift = at ? pasteShiftTo(clipboard, at) : { x: pasteOffset.x * pasteCountRef.current, y: pasteOffset.y * pasteCountRef.current }
      const result = pasteGraphNodes(currentGraph, clipboard, shift)
      props.onApplyEdit?.(() => result.graph, `${verb} ${describeNodeList(result.graph, result.pastedRootIds)}`)
      if (result.layouts.length > 0) onMoveNodes(result.layouts)
      onSelectionChange(result.pastedRootIds)
      announce(`${verb === 'duplicated' ? 'Duplicated' : 'Pasted'} ${result.pastedRootIds.length === 1 ? '1 step' : `${result.pastedRootIds.length} steps`}`)
    },
    [canEdit, props, onMoveNodes, onSelectionChange, announce],
  )

  const pasteFromClipboards = useCallback(
    (at?: { x: number; y: number }) => {
      if (!canEdit) return
      readClipboardForPaste()
        .then((clipboard) => {
          if (clipboard) pasteClipboard(clipboard, 'pasted', at)
          else announce('Nothing to paste: copy steps first')
        })
        .catch((pasteError: unknown) => console.warn('could not paste the steps', pasteError))
    },
    [canEdit, pasteClipboard, announce],
  )

  const copyNodes = useCallback(
    (nodeIds: string[]) => {
      const clipboard = copyGraphNodes(graph, editableNodeIds(graph, nodeIds), mergedPositions ?? positions)
      if (clipboard.nodes.length === 0) return null
      return clipboard
    },
    [graph, mergedPositions, positions],
  )

  const duplicateNodes = useCallback(
    (nodeIds: string[]) => {
      const clipboard = copyNodes(nodeIds)
      if (!clipboard) return
      pasteCountRef.current = 0
      pasteClipboard(clipboard, 'duplicated')
    },
    [copyNodes, pasteClipboard],
  )

  const disconnectNodes = useCallback(
    (nodeIds: string[]) => {
      if (!canEdit) return
      props.onApplyEdit?.((current) => disconnectGraphNodes(current, nodeIds), `disconnected ${describeNodeList(graph, nodeIds)}`)
    },
    [canEdit, props, graph],
  )

  const connect = useCallback(
    (ends: { source: string; sourceHandle: string | null; target: string }) => {
      if (readOnly || !props.onConnect) return
      const check = checkConnection(graph, ends)
      if (!check.allowed) {
        announce(check.reason)
        return
      }
      props.onConnect({ source: ends.source, sourceHandle: ends.sourceHandle || SOURCE_HANDLE, target: ends.target })
      announce(`Connected ${describeNodeList(graph, [ends.source])} to ${describeNodeList(graph, [ends.target])}`)
    },
    [readOnly, props, graph, announce],
  )

  const nudgeSelection = useCallback(
    (delta: { x: number; y: number }) => {
      if (readOnly || !mergedPositions) return
      const layouts = nudgeLayouts(editableNodeIds(graph, selectedNodeIds), mergedPositions, delta)
      if (layouts.length > 0) onMoveNodes(layouts)
    },
    [readOnly, mergedPositions, graph, selectedNodeIds, onMoveNodes],
  )

  // ----- context menu -----

  const openMenuForNodes = useCallback(
    (nodeIds: string[], screenPoint: { x: number; y: number }) => {
      const box = containerRef.current?.getBoundingClientRect()
      const visibleIds = editableNodeIds(graph, nodeIds)
      if (!box || visibleIds.length === 0) return
      setMenu({ kind: 'node', nodeIds: visibleIds, position: menuPositionIn(box, screenPoint) })
    },
    [graph],
  )

  function openPaneMenu(event: ReactMouseEvent | MouseEvent) {
    event.preventDefault()
    const box = containerRef.current?.getBoundingClientRect()
    if (!box) return
    const screenPoint = { x: event.clientX, y: event.clientY }
    setMenu({ kind: 'pane', position: menuPositionIn(box, screenPoint), flowPoint: reactFlow.screenToFlowPosition(screenPoint) })
  }

  /** The loop (if any) under a canvas point, for "Add node here" inside a loop. */
  function containerAt(flowPoint: { x: number; y: number }): string | null {
    const containers = graph.nodes.flatMap((node) => {
      const internalNode = node.container ? reactFlow.getInternalNode(node.id) : undefined
      if (!internalNode) return []
      return [{ id: node.id, box: { ...internalNode.internals.positionAbsolute, width: internalNode.measured?.width ?? 0, height: internalNode.measured?.height ?? 0 } }]
    })
    return findDropContainer(containers, flowPoint)
  }

  function runPaneMenuAction(action: PaneMenuAction, flowPoint: { x: number; y: number }) {
    switch (action) {
      case 'add-node-here': {
        const parentId = containerAt(flowPoint)
        const parentOrigin = parentId ? reactFlow.getInternalNode(parentId)?.internals.positionAbsolute : null
        const point = parentOrigin ? { x: flowPoint.x - parentOrigin.x, y: flowPoint.y - parentOrigin.y } : flowPoint
        props.onRequestAddNode?.({ type: 'at-position', x: Math.round(point.x), y: Math.round(point.y), parentId })
        return
      }
      case 'add-note-here':
        props.onAddNote?.({ x: Math.round(flowPoint.x), y: Math.round(flowPoint.y) })
        return
      case 'paste':
        pasteFromClipboards(flowPoint)
        return
      case 'fit':
        fitAll()
    }
  }

  const closeMenu = useCallback(() => setMenu(null), [])

  function openMenuForNode(nodeId: string, screenPoint: { x: number; y: number }) {
    const isInSelection = selectedNodeIds.includes(nodeId) && selectedNodeIds.length > 1
    if (!isInSelection) onSelectionChange([nodeId])
    openMenuForNodes(isInSelection ? selectedNodeIds : [nodeId], screenPoint)
  }

  function runMenuAction(action: NodeMenuAction, nodeIds: string[]) {
    const [firstId] = nodeIds
    switch (action) {
      case 'add-after': {
        const sourceHandle = continuationHandle(graph, firstId)
        if (sourceHandle) props.onAddNodeAfter?.({ source: firstId, sourceHandle })
        return
      }
      case 'change-action':
        props.onChangeAction?.(firstId)
        return
      case 'ask-builder':
        props.onAskBuilder?.(buildAskBuilderText(graph, nodeIds))
        return
      case 'duplicate':
        duplicateNodes(nodeIds)
        return
      case 'disconnect':
        disconnectNodes(nodeIds)
        return
      case 'delete':
        deleteNodesAndEdges(nodeIds, [])
    }
  }

  const paneMenuItems = useMemo(
    () => listPaneMenuItems({ isMac, canAddNode: Boolean(props.onRequestAddNode), canAddNote: Boolean(props.onAddNote), canPaste: canEdit }),
    [isMac, props.onRequestAddNode, props.onAddNote, canEdit],
  )

  const menuItems = useMemo(() => {
    if (!menu || menu.kind !== 'node') return []
    const firstNode = graph.nodes.find((node) => node.id === menu.nodeIds[0])
    return listNodeMenuItems({ isPluginNode: Boolean(firstNode?.plugin), isMac, selectionSize: menu.nodeIds.length }).filter((item) => {
      if (item.action === 'add-after') return Boolean(props.onAddNodeAfter) && Boolean(firstNode?.ports.outputs.length)
      if (item.action === 'change-action') return Boolean(props.onChangeAction)
      if (item.action === 'ask-builder') return Boolean(props.onAskBuilder)
      if (item.action === 'delete') return Boolean(props.onDelete)
      return Boolean(props.onApplyEdit)
    })
  }, [menu, graph, isMac, props.onAddNodeAfter, props.onChangeAction, props.onAskBuilder, props.onDelete, props.onApplyEdit])

  // ----- keyboard -----

  const startKeyboardConnect = useCallback(
    (nodeId: string, handleId: string) => {
      if (readOnly || !props.onConnect) return
      setConnectingFrom({ nodeId, handleId, viaKeyboard: true })
      announce('Choose the step to connect to: Tab to it and press Enter. Esc cancels')
    },
    [readOnly, props.onConnect, announce],
  )

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

  function runShortcut(action: CanvasShortcutAction, event: KeyboardEvent): boolean {
    const delta = nudgeDistance(event)
    switch (action) {
      case 'delete':
        deleteNodesAndEdges(selectedNodeIds, liveEdgeIds)
        return true
      case 'undo':
        if (!readOnly) props.onUndo?.()
        return true
      case 'redo':
        if (!readOnly) props.onRedo?.()
        return true
      case 'copy': {
        const clipboard = copyNodes(selectedNodeIds)
        if (clipboard) {
          void copyToClipboards(clipboard)
          pasteCountRef.current = 0
          announce(`Copied ${describeNodeList(graph, editableNodeIds(graph, selectedNodeIds))}`)
        }
        return true
      }
      case 'paste':
        pasteFromClipboards()
        return true
      case 'duplicate':
        duplicateNodes(selectedNodeIds)
        return true
      case 'select-all':
        onSelectionChange(graph.nodes.filter((node) => !node.hidden).map((node) => node.id))
        return true
      case 'deselect':
        if (connectingFrom) {
          setConnectingFrom(null)
          announce('Stopped connecting')
        } else if (isShortcutsOpen) setIsShortcutsOpen(false)
        else {
          onSelectionChange([])
          setSelectedEdgeIds([])
        }
        return true
      case 'nudge-left':
        nudgeSelection({ x: -delta, y: 0 })
        return selectedNodeIds.length > 0
      case 'nudge-right':
        nudgeSelection({ x: delta, y: 0 })
        return selectedNodeIds.length > 0
      case 'nudge-up':
        nudgeSelection({ x: 0, y: -delta })
        return selectedNodeIds.length > 0
      case 'nudge-down':
        nudgeSelection({ x: 0, y: delta })
        return selectedNodeIds.length > 0
      case 'zoom-in':
        void reactFlow.zoomIn(motion)
        return true
      case 'zoom-out':
        void reactFlow.zoomOut(motion)
        return true
      case 'fit':
        fitAll()
        return true
      case 'add-node':
        if (readOnly || !props.onOpenPalette) return false
        props.onOpenPalette()
        return true
      case 'show-shortcuts':
        setIsShortcutsOpen((isOpen) => !isOpen)
        return true
      case 'open-settings': {
        const nodeId = focusedNodeId()
        if (!nodeId) return false
        if (connectingFrom?.viaKeyboard) {
          connect({ source: connectingFrom.nodeId, sourceHandle: connectingFrom.handleId, target: nodeId })
          setConnectingFrom(null)
          return true
        }
        onSelectionChange([nodeId])
        props.onOpenNodeSettings?.(nodeId)
        return true
      }
      case 'context-menu': {
        const nodeId = focusedNodeId() ?? selectedNodeIds[0]
        const element = nodeId ? containerRef.current?.querySelector<HTMLElement>(`.react-flow__node[data-id="${CSS.escape(nodeId)}"]`) : null
        if (!nodeId || !element) return false
        const rect = element.getBoundingClientRect()
        openMenuForNode(nodeId, { x: rect.left + 16, y: rect.top + Math.min(rect.height, 40) })
        return true
      }
    }
  }

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (menu || isTypingTarget(event.target)) return
    if (event.target instanceof HTMLElement && event.target.closest('[role="dialog"]')) return
    const action = resolveShortcut(event, isMac)
    if (action && runShortcut(action, event)) {
      event.preventDefault()
      event.stopPropagation()
    }
  }

  // ----- React Flow events -----

  function handleNodesChange(changes: NodeChange<StepFlowNode>[]) {
    for (const change of changes) {
      if (change.type === 'dimensions' && change.dimensions) measuredRef.current.set(change.id, change.dimensions)
    }
    const allowed = changes.filter((change) => change.type !== 'remove' && (!readOnly || change.type === 'select' || change.type === 'dimensions'))
    setFlowNodes((current) => applyNodeChanges(allowed, current))
  }

  function handleEdgesChange(changes: EdgeChange<StepFlowEdge>[]) {
    const selectChanges = changes.filter((change) => change.type === 'select')
    if (selectChanges.length === 0) return
    setSelectedEdgeIds((current) => {
      const next = new Set(current)
      for (const change of selectChanges) {
        if (change.type !== 'select') continue
        if (change.selected) next.add(change.id)
        else next.delete(change.id)
      }
      return [...next]
    })
  }

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

  function handleConnectStart(_event: unknown, params: OnConnectStartParams) {
    if (params.handleType !== 'source' || !params.nodeId) return
    setConnectingFrom({ nodeId: params.nodeId, handleId: params.handleId ?? SOURCE_HANDLE, viaKeyboard: false })
  }

  function handleReconnect(oldEdge: StepFlowEdge, connection: Connection) {
    if (!canEdit) return
    const ends = { source: connection.source, sourceHandle: connection.sourceHandle || SOURCE_HANDLE, target: connection.target }
    const check = checkConnection(removeGraphEdges(graph, [oldEdge.id]), ends)
    if (!check.allowed) {
      announce(check.reason)
      return
    }
    props.onApplyEdit?.((current) => reconnectGraphEdge(current, oldEdge.id, ends), `moved the arrow from ${describeNodeList(graph, [ends.source])}`)
  }

  function handleNodeContextMenu(event: ReactMouseEvent, node: StepFlowNode) {
    event.preventDefault()
    if (isNoteFlowNodeId(node.id)) {
      openPaneMenu(event)
      return
    }
    if (node.type === 'marker') return
    openMenuForNode(node.id, { x: event.clientX, y: event.clientY })
  }

  function handleSelectionContextMenu(event: ReactMouseEvent, nodes: StepFlowNode[]) {
    event.preventDefault()
    openMenuForNodes(
      nodes.filter((node) => !isNoteFlowNodeId(node.id)).map((node) => node.id),
      { x: event.clientX, y: event.clientY },
    )
  }

  const isEmpty = !graph.nodes.some((node) => !node.hidden && node.kind !== 'start' && node.kind !== 'end')
  const visibleSelection = editableNodeIds(graph, selectedNodeIds)

  if (!mergedPositions) return <p className="m-0 p-6 text-muted">Placing the steps…</p>

  return (
    <CanvasNodeActionsContext.Provider value={nodeActions}>
      <ContainerDropHintContext.Provider value={containerDrag.dropHint}>
      <div
        ref={containerRef}
        role="application"
        aria-roledescription="node editor"
        aria-label="Nodes canvas: drag to select, Space + drag or scroll to pan, ? for shortcuts"
        onKeyDown={handleKeyDown}
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
          onConnect={(connection) => connect({ source: connection.source, sourceHandle: connection.sourceHandle, target: connection.target })}
          onConnectStart={handleConnectStart}
          onConnectEnd={() => setConnectingFrom((current) => (current?.viaKeyboard ? current : null))}
          isValidConnection={(connection) => checkConnection(graph, { source: connection.source, sourceHandle: connection.sourceHandle, target: connection.target }).allowed}
          onReconnect={handleReconnect}
          onNodeContextMenu={handleNodeContextMenu}
          onSelectionContextMenu={handleSelectionContextMenu}
          onPaneContextMenu={openPaneMenu}
          onPaneClick={() => setConnectingFrom(null)}
          defaultViewport={viewport ?? undefined}
          fitView={!viewport}
          fitViewOptions={fitViewOptions}
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
          ariaLabelConfig={{ 'node.a11yDescription.default': 'Press Enter to open its settings, Shift F10 for its menu, arrow keys to move it.' }}
        >
          <Background variant={BackgroundVariant.Dots} gap={16} size={1} color="#D4D4D8" />
          <MiniMap<StepFlowNode>
            pannable
            zoomable
            ariaLabel="Minimap of the whole agent"
            className="node-minimap"
            nodeColor={(flowNode) => (isNoteFlowNodeId(flowNode.id) ? '#FEF9C3' : flowNode.data.node.needsApproval ? '#F5C77E' : flowNode.type === 'container' ? 'rgba(244,244,245,0.6)' : '#D4D4D8')}
            nodeStrokeColor={(flowNode) => (flowNode.type === 'container' ? '#A1A1AA' : 'transparent')}
            nodeBorderRadius={4}
            maskColor="rgba(244, 244, 245, 0.55)"
            style={{ width: 150, height: 112 }}
          />
        </ReactFlow>
        <ZoomControls
          zoom={zoom}
          onZoomIn={() => void reactFlow.zoomIn(motion)}
          onZoomOut={() => void reactFlow.zoomOut(motion)}
          onFit={fitAll}
          insetLeft={props.overlayInsets?.left ?? 0}
          onShowShortcuts={() => setIsShortcutsOpen((isOpen) => !isOpen)}
        />
        {isShortcutsOpen && <ShortcutsPanel isMac={isMac} onClose={() => setIsShortcutsOpen(false)} />}
        {visibleSelection.length > 1 && !menu && (
          <SelectionBar
            count={visibleSelection.length}
            readOnly={!canEdit}
            onDuplicate={() => duplicateNodes(visibleSelection)}
            onAskBuilder={() => props.onAskBuilder?.(buildAskBuilderText(graph, visibleSelection))}
            onDelete={() => deleteNodesAndEdges(visibleSelection, [])}
          />
        )}
        {connectingFrom?.viaKeyboard && (
          <div role="status" className="absolute left-1/2 top-4 z-20 -translate-x-1/2 rounded-lg bg-ink px-3 py-1.5 text-[12px] font-medium text-white shadow-md">
            Connecting from {describeNodeList(graph, [connectingFrom.nodeId])}: Tab to a step and press Enter · Esc cancels
          </div>
        )}
        {menu?.kind === 'node' && (
          <NodeContextMenu
            position={menu.position}
            title={describeNodeList(graph, menu.nodeIds)}
            items={menuItems}
            readOnly={readOnly}
            onAction={(action) => runMenuAction(action, menu.nodeIds)}
            onClose={closeMenu}
          />
        )}
        {menu?.kind === 'pane' && (
          <NodeContextMenu
            position={menu.position}
            title="the canvas"
            items={paneMenuItems}
            readOnly={readOnly}
            onAction={(action) => runPaneMenuAction(action, menu.flowPoint)}
            onClose={closeMenu}
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
