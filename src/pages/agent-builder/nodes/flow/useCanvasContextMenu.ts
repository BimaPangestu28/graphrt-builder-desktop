import { useCallback, useMemo, useState, type MouseEvent as ReactMouseEvent, type RefObject } from 'react'
import type { AgentGraph } from '@/api/agentGraphTypes'
import { SOURCE_HANDLE } from '@/lib/agentGraphRules'
import type { NodeCanvasProps } from '../contracts'
import { isNoteFlowNodeId } from '../notes/NoteNode'
import { buildAskBuilderText, editableNodeIds } from './canvasCommands'
import { findDropContainer } from './containerDrop'
import { useReactFlow } from './flowLibrary'
import { listNodeMenuItems, listPaneMenuItems, type CanvasMenuItem, type NodeMenuAction, type PaneMenuAction } from './NodeContextMenu'
import type { StepFlowEdge, StepFlowNode } from './toFlowElements'

/**
 * The right-click (and Shift F10) menus of the Nodes canvas: one for steps (a single
 * step or the selection) and one for the empty canvas. Opening the step menu on a step
 * outside a multi-selection selects that step first, like a file manager does.
 */

type ScreenPoint = { x: number; y: number }
type NodeMenuItem = CanvasMenuItem<NodeMenuAction>
type PaneMenuItem = CanvasMenuItem<PaneMenuAction>

export type OpenCanvasMenu =
  | { kind: 'node'; nodeIds: string[]; position: ScreenPoint }
  /** The empty-canvas menu; `flowPoint` is where it was opened, in canvas units. */
  | { kind: 'pane'; position: ScreenPoint; flowPoint: ScreenPoint }

const menuSize = { width: 236, height: 240 }

/** Menu position inside the canvas box, kept on screen. */
function menuPositionIn(box: DOMRect, screenPoint: ScreenPoint): ScreenPoint {
  return { x: Math.min(screenPoint.x - box.left, box.width - menuSize.width - 8), y: Math.min(screenPoint.y - box.top, Math.max(8, box.height - menuSize.height - 8)) }
}

/** The exit "Add node after" continues from: the default one, else the first. */
function continuationHandle(graph: AgentGraph, nodeId: string): string | null {
  const outputs = graph.nodes.find((node) => node.id === nodeId)?.ports.outputs ?? []
  return outputs.find((outputPort) => outputPort.id === SOURCE_HANDLE)?.id ?? outputs[0]?.id ?? null
}

/** The canvas callbacks the menu items lead to; an item whose callback is missing is hidden. */
export type CanvasMenuCallbacks = Pick<NodeCanvasProps, 'onAddNodeAfter' | 'onChangeAction' | 'onAskBuilder' | 'onDelete' | 'onApplyEdit' | 'onRequestAddNode' | 'onAddNote'>

/** Canvas commands shared with the shortcuts and the selection bar. */
export interface CanvasMenuCommands {
  duplicateNodes: (nodeIds: string[]) => void
  disconnectNodes: (nodeIds: string[]) => void
  deleteNodes: (nodeIds: string[]) => void
  pasteAt: (flowPoint: ScreenPoint) => void
  fitAll: () => void
}

export interface CanvasContextMenuOptions {
  graph: AgentGraph
  containerRef: RefObject<HTMLDivElement>
  selectedNodeIds: string[]
  onSelectionChange: (nodeIds: string[]) => void
  isMac: boolean
  canEdit: boolean
  callbacks: CanvasMenuCallbacks
  commands: CanvasMenuCommands
}

export interface CanvasContextMenu {
  menu: OpenCanvasMenu | null
  nodeMenuItems: NodeMenuItem[]
  paneMenuItems: PaneMenuItem[]
  closeMenu: () => void
  /** Opens the step menu for `nodeIds` (hidden and locked steps are left out). Stable. */
  openMenuForNodes: (nodeIds: string[], screenPoint: ScreenPoint) => void
  /** Opens the step menu for one step, or for the selection when the step is part of it. */
  openMenuForNode: (nodeId: string, screenPoint: ScreenPoint) => void
  runNodeMenuAction: (action: NodeMenuAction, nodeIds: string[]) => void
  runPaneMenuAction: (action: PaneMenuAction, flowPoint: ScreenPoint) => void
  handlePaneContextMenu: (event: ReactMouseEvent | MouseEvent) => void
  handleNodeContextMenu: (event: ReactMouseEvent, node: StepFlowNode) => void
  handleSelectionContextMenu: (event: ReactMouseEvent, nodes: StepFlowNode[]) => void
}

/** Whether a step-menu item has what it needs (its callback, or an output port to continue from). */
function isNodeMenuItemAvailable(item: NodeMenuItem, firstNode: AgentGraph['nodes'][number] | undefined, callbacks: CanvasMenuCallbacks): boolean {
  if (item.action === 'add-after') return Boolean(callbacks.onAddNodeAfter) && Boolean(firstNode?.ports.outputs.length)
  if (item.action === 'change-action') return Boolean(callbacks.onChangeAction)
  if (item.action === 'ask-builder') return Boolean(callbacks.onAskBuilder)
  if (item.action === 'delete') return Boolean(callbacks.onDelete)
  return Boolean(callbacks.onApplyEdit)
}

/**
 * @param options - Graph, the canvas element, selection, edit rights, callbacks and shared commands (CanvasContextMenuOptions)
 * @returns The open menu, its items and the handlers for React Flow and the keyboard (CanvasContextMenu)
 */
export function useCanvasContextMenu({ graph, containerRef, selectedNodeIds, onSelectionChange, isMac, canEdit, callbacks, commands }: CanvasContextMenuOptions): CanvasContextMenu {
  const reactFlow = useReactFlow<StepFlowNode, StepFlowEdge>()
  const [menu, setMenu] = useState<OpenCanvasMenu | null>(null)
  const closeMenu = useCallback(() => setMenu(null), [])

  const openMenuForNodes = useCallback(
    (nodeIds: string[], screenPoint: ScreenPoint) => {
      const box = containerRef.current?.getBoundingClientRect()
      const visibleIds = editableNodeIds(graph, nodeIds)
      if (!box || visibleIds.length === 0) return
      setMenu({ kind: 'node', nodeIds: visibleIds, position: menuPositionIn(box, screenPoint) })
    },
    [graph, containerRef],
  )

  function openMenuForNode(nodeId: string, screenPoint: ScreenPoint) {
    const isInSelection = selectedNodeIds.includes(nodeId) && selectedNodeIds.length > 1
    if (!isInSelection) onSelectionChange([nodeId])
    openMenuForNodes(isInSelection ? selectedNodeIds : [nodeId], screenPoint)
  }

  function handlePaneContextMenu(event: ReactMouseEvent | MouseEvent) {
    event.preventDefault()
    const box = containerRef.current?.getBoundingClientRect()
    if (!box) return
    const screenPoint = { x: event.clientX, y: event.clientY }
    setMenu({ kind: 'pane', position: menuPositionIn(box, screenPoint), flowPoint: reactFlow.screenToFlowPosition(screenPoint) })
  }

  function handleNodeContextMenu(event: ReactMouseEvent, node: StepFlowNode) {
    event.preventDefault()
    if (isNoteFlowNodeId(node.id)) {
      handlePaneContextMenu(event)
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

  /** The loop (if any) under a canvas point, for "Add node here" inside a loop. */
  function containerAt(flowPoint: ScreenPoint): string | null {
    const containers = graph.nodes.flatMap((node) => {
      const internalNode = node.container ? reactFlow.getInternalNode(node.id) : undefined
      if (!internalNode) return []
      return [{ id: node.id, box: { ...internalNode.internals.positionAbsolute, width: internalNode.measured?.width ?? 0, height: internalNode.measured?.height ?? 0 } }]
    })
    return findDropContainer(containers, flowPoint)
  }

  /** Asks for a new step at `flowPoint`, relative to the loop it lands in (if any). */
  function requestNodeAt(flowPoint: ScreenPoint) {
    const parentId = containerAt(flowPoint)
    const parentOrigin = parentId ? reactFlow.getInternalNode(parentId)?.internals.positionAbsolute : null
    const point = parentOrigin ? { x: flowPoint.x - parentOrigin.x, y: flowPoint.y - parentOrigin.y } : flowPoint
    callbacks.onRequestAddNode?.({ type: 'at-position', x: Math.round(point.x), y: Math.round(point.y), parentId })
  }

  function runPaneMenuAction(action: PaneMenuAction, flowPoint: ScreenPoint) {
    if (action === 'add-node-here') requestNodeAt(flowPoint)
    else if (action === 'add-note-here') callbacks.onAddNote?.({ x: Math.round(flowPoint.x), y: Math.round(flowPoint.y) })
    else if (action === 'paste') commands.pasteAt(flowPoint)
    else if (action === 'fit') commands.fitAll()
  }

  function runNodeMenuAction(action: NodeMenuAction, nodeIds: string[]) {
    const [firstId] = nodeIds
    if (action === 'add-after') {
      const sourceHandle = continuationHandle(graph, firstId)
      if (sourceHandle) callbacks.onAddNodeAfter?.({ source: firstId, sourceHandle })
    } else if (action === 'change-action') callbacks.onChangeAction?.(firstId)
    else if (action === 'ask-builder') callbacks.onAskBuilder?.(buildAskBuilderText(graph, nodeIds))
    else if (action === 'duplicate') commands.duplicateNodes(nodeIds)
    else if (action === 'disconnect') commands.disconnectNodes(nodeIds)
    else if (action === 'delete') commands.deleteNodes(nodeIds)
  }

  const { onRequestAddNode, onAddNote } = callbacks
  const paneMenuItems = useMemo(
    () => listPaneMenuItems({ isMac, canAddNode: Boolean(onRequestAddNode), canAddNote: Boolean(onAddNote), canPaste: canEdit }),
    [isMac, onRequestAddNode, onAddNote, canEdit],
  )

  const { onAddNodeAfter, onChangeAction, onAskBuilder, onDelete, onApplyEdit } = callbacks
  const nodeMenuItems = useMemo(() => {
    if (!menu || menu.kind !== 'node') return []
    const firstNode = graph.nodes.find((node) => node.id === menu.nodeIds[0])
    const availability = { onAddNodeAfter, onChangeAction, onAskBuilder, onDelete, onApplyEdit }
    return listNodeMenuItems({ isPluginNode: Boolean(firstNode?.plugin), isMac, selectionSize: menu.nodeIds.length }).filter((item) => isNodeMenuItemAvailable(item, firstNode, availability))
  }, [menu, graph, isMac, onAddNodeAfter, onChangeAction, onAskBuilder, onDelete, onApplyEdit])

  return {
    menu,
    nodeMenuItems,
    paneMenuItems,
    closeMenu,
    openMenuForNodes,
    openMenuForNode,
    runNodeMenuAction,
    runPaneMenuAction,
    handlePaneContextMenu,
    handleNodeContextMenu,
    handleSelectionContextMenu,
  }
}
