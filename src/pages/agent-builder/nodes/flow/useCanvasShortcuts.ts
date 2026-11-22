import { useState, type KeyboardEvent, type RefObject } from 'react'
import type { AgentGraph } from '@/api/agentGraphTypes'
import type { NodeCanvasProps } from '../contracts'
import { useReactFlow } from './flowLibrary'
import { isTypingTarget, nudgeDistance, resolveShortcut, type CanvasShortcutAction } from './shortcuts'
import type { StepFlowEdge, StepFlowNode } from './toFlowElements'
import type { CanvasClipboard } from './useCanvasClipboard'
import type { CanvasEditCommands } from './useCanvasEditCommands'
import type { ConnectMode } from './useConnectMode'

/**
 * Keyboard shortcuts of the Nodes canvas (the table is in `shortcuts.ts`) and the "?"
 * panel listing them. Keys are ignored while a menu is open, while typing in a field and
 * inside dialogs. A shortcut that did nothing (say an arrow key with nothing selected)
 * lets the key through, so the page can still scroll.
 */

export interface CanvasShortcutsOptions {
  graph: AgentGraph
  readOnly: boolean
  isMac: boolean
  /** A context menu is open: it handles the keys itself. */
  isMenuOpen: boolean
  containerRef: RefObject<HTMLDivElement>
  selectedNodeIds: string[]
  selectedEdgeIds: string[]
  motion: { duration: number }
  callbacks: Pick<NodeCanvasProps, 'onUndo' | 'onRedo' | 'onOpenPalette' | 'onOpenNodeSettings' | 'onSelectionChange'>
  clipboard: CanvasClipboard
  editCommands: CanvasEditCommands
  connectMode: ConnectMode
  clearEdgeSelection: () => void
  fitAll: () => void
  openMenuForNode: (nodeId: string, screenPoint: { x: number; y: number }) => void
}

export interface CanvasShortcuts {
  handleKeyDown: (event: KeyboardEvent<HTMLDivElement>) => void
  isShortcutsOpen: boolean
  toggleShortcuts: () => void
  closeShortcuts: () => void
}

/** The step card that has keyboard focus, if any. */
function focusedNodeId(): string | null {
  const element = document.activeElement instanceof HTMLElement ? document.activeElement.closest<HTMLElement>('.react-flow__node') : null
  return element?.dataset.id ?? null
}

const nudgeDirections: Partial<Record<CanvasShortcutAction, { x: number; y: number }>> = {
  'nudge-left': { x: -1, y: 0 },
  'nudge-right': { x: 1, y: 0 },
  'nudge-up': { x: 0, y: -1 },
  'nudge-down': { x: 0, y: 1 },
}

/**
 * @param options - Graph, selection, shared canvas commands and callbacks (CanvasShortcutsOptions)
 * @returns The canvas key handler and the shortcuts panel state (CanvasShortcuts)
 */
export function useCanvasShortcuts(options: CanvasShortcutsOptions): CanvasShortcuts {
  const { graph, readOnly, isMac, isMenuOpen, containerRef, selectedNodeIds, selectedEdgeIds, motion, callbacks, clipboard, editCommands, connectMode } = options
  const reactFlow = useReactFlow<StepFlowNode, StepFlowEdge>()
  const [isShortcutsOpen, setIsShortcutsOpen] = useState(false)

  /** Esc: stop connecting, else close the panel, else clear the selection. */
  function deselect() {
    if (connectMode.cancelConnect()) return
    if (isShortcutsOpen) {
      setIsShortcutsOpen(false)
      return
    }
    callbacks.onSelectionChange([])
    options.clearEdgeSelection()
  }

  /** Enter on a step: finish a keyboard connection there, else open its settings. */
  function openFocusedSettings(): boolean {
    const nodeId = focusedNodeId()
    if (!nodeId) return false
    if (connectMode.finishKeyboardConnect(nodeId)) return true
    callbacks.onSelectionChange([nodeId])
    callbacks.onOpenNodeSettings?.(nodeId)
    return true
  }

  /** Shift F10 / the menu key: the step menu next to the focused (or selected) step. */
  function openFocusedMenu(): boolean {
    const nodeId = focusedNodeId() ?? selectedNodeIds[0]
    const element = nodeId ? containerRef.current?.querySelector<HTMLElement>(`.react-flow__node[data-id="${CSS.escape(nodeId)}"]`) : null
    if (!nodeId || !element) return false
    const rect = element.getBoundingClientRect()
    options.openMenuForNode(nodeId, { x: rect.left + 16, y: rect.top + Math.min(rect.height, 40) })
    return true
  }

  function runEditShortcut(action: CanvasShortcutAction): boolean | null {
    if (action === 'delete') editCommands.deleteNodesAndEdges(selectedNodeIds, selectedEdgeIds)
    else if (action === 'undo') {
      if (!readOnly) callbacks.onUndo?.()
    } else if (action === 'redo') {
      if (!readOnly) callbacks.onRedo?.()
    } else if (action === 'copy') clipboard.copyNodes(selectedNodeIds)
    else if (action === 'paste') clipboard.pasteFromClipboards()
    else if (action === 'duplicate') clipboard.duplicateNodes(selectedNodeIds)
    else return null
    return true
  }

  function runViewShortcut(action: CanvasShortcutAction): boolean | null {
    if (action === 'zoom-in') void reactFlow.zoomIn(motion)
    else if (action === 'zoom-out') void reactFlow.zoomOut(motion)
    else if (action === 'fit') options.fitAll()
    else if (action === 'show-shortcuts') setIsShortcutsOpen((isOpen) => !isOpen)
    else return null
    return true
  }

  function runSelectionShortcut(action: CanvasShortcutAction, event: KeyboardEvent): boolean | null {
    const direction = nudgeDirections[action]
    if (direction) {
      const distance = nudgeDistance(event)
      editCommands.nudgeSelection({ x: direction.x * distance, y: direction.y * distance })
      return selectedNodeIds.length > 0
    }
    if (action === 'select-all') callbacks.onSelectionChange(graph.nodes.filter((node) => !node.hidden).map((node) => node.id))
    else if (action === 'deselect') deselect()
    else return null
    return true
  }

  /** Runs `action`; true when it was handled (the key is then not passed on). */
  function runShortcut(action: CanvasShortcutAction, event: KeyboardEvent): boolean {
    const handled = runEditShortcut(action) ?? runViewShortcut(action) ?? runSelectionShortcut(action, event)
    if (handled !== null) return handled
    if (action === 'open-settings') return openFocusedSettings()
    if (action === 'context-menu') return openFocusedMenu()
    if (action === 'add-node' && !readOnly && callbacks.onOpenPalette) {
      callbacks.onOpenPalette()
      return true
    }
    return false
  }

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (isMenuOpen || isTypingTarget(event.target)) return
    if (event.target instanceof HTMLElement && event.target.closest('[role="dialog"]')) return
    const action = resolveShortcut(event, isMac)
    if (action && runShortcut(action, event)) {
      event.preventDefault()
      event.stopPropagation()
    }
  }

  return {
    handleKeyDown,
    isShortcutsOpen,
    toggleShortcuts: () => setIsShortcutsOpen((isOpen) => !isOpen),
    closeShortcuts: () => setIsShortcutsOpen(false),
  }
}
