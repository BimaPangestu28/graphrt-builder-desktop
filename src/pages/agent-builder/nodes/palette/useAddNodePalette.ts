import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { AgentGraph, NodeKindInfo } from '@/api/agentGraphTypes'
import type { AddNodeAnchor, AddNodePaletteProps, NodePlacement } from '../contracts'
import type { AgentGraphController } from '../useAgentGraph'
import { applyNodePlacement, buildNodePlacement } from './nodePlacement'
import { isOfferedKind } from './paletteCatalog'

/** True when a key press belongs to a text field (shortcuts stay out of typing). */
function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  return target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)
}

/** True for the palette's shortcuts: "A", and ⌘K (Ctrl+K off macOS). */
export function isAddNodeShortcut(event: Pick<KeyboardEvent, 'key' | 'metaKey' | 'ctrlKey' | 'altKey' | 'shiftKey'>): boolean {
  const key = event.key.toLowerCase()
  if (key === 'k' && (event.metaKey || event.ctrlKey) && !event.altKey) return true
  return key === 'a' && !event.metaKey && !event.ctrlKey && !event.altKey && !event.shiftKey
}

interface UseAddNodePaletteOptions {
  graph: AgentGraph | null
  nodeKinds: NodeKindInfo[]
  selectedNodeIds: string[]
  readOnly: boolean
  controller: Pick<AgentGraphController, 'applyEdit' | 'moveNodes' | 'positions'>
  /** After a node was added (e.g. select it). */
  onNodePlaced?: (placement: NodePlacement) => void
}

export interface AddNodePaletteState {
  isOpen: boolean
  /** Opens at an anchor; without one, after the selected node (if exactly one). */
  open: (anchor?: AddNodeAnchor | null) => void
  close: () => void
  toggle: () => void
  /** Props for `AddNodePalette` beyond the phase-1 ones. */
  paletteProps: Required<Pick<AddNodePaletteProps, 'anchor' | 'positions' | 'onPlaceNode' | 'requestedKind' | 'onDragKindChange'>>
  /** Props for `PaletteDropZone` around the canvas. */
  dropZoneProps: { draggedKindName: string | null; onDropKind: (kind: string, anchor: AddNodeAnchor) => void }
}

/**
 * Open / close state of the Add node palette and where it adds (spec C, 47): the toolbar
 * button, "A" or ⌘K, the canvas's "Add node after" and "+" on an arrow open it; drops from
 * the palette add right away, except a not-installed plugin action, which opens the palette
 * on its install approval.
 *
 * @returns Open state, actions and the props for the palette and its drop zone (AddNodePaletteState)
 */
export function useAddNodePalette({ graph, nodeKinds, selectedNodeIds, readOnly, controller, onNodePlaced }: UseAddNodePaletteOptions): AddNodePaletteState {
  const [isOpen, setIsOpen] = useState(false)
  const [anchor, setAnchor] = useState<AddNodeAnchor | null>(null)
  const [requestedKind, setRequestedKind] = useState<NonNullable<AddNodePaletteProps['requestedKind']> | null>(null)
  const [draggedKind, setDraggedKind] = useState<string | null>(null)
  const requestCounter = useRef(0)
  const selectedNodeId = selectedNodeIds.length === 1 ? selectedNodeIds[0] : null

  const open = useCallback(
    (nextAnchor?: AddNodeAnchor | null) => {
      setAnchor(nextAnchor !== undefined ? nextAnchor : selectedNodeId ? { type: 'after-node', nodeId: selectedNodeId } : null)
      setIsOpen(true)
    },
    [selectedNodeId],
  )
  const close = useCallback(() => {
    setIsOpen(false)
    setRequestedKind(null)
  }, [])
  const toggle = useCallback(() => (isOpen ? close() : open()), [isOpen, open, close])

  // Re-anchor on the selection while open from the toolbar (not from a context menu or arrow).
  useEffect(() => {
    if (!isOpen) return
    setAnchor((current) => (current === null || current.type === 'after-node' ? (selectedNodeId ? { type: 'after-node', nodeId: selectedNodeId } : current) : current))
  }, [selectedNodeId, isOpen])

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.defaultPrevented || isTypingTarget(event.target) || !isAddNodeShortcut(event)) return
      event.preventDefault()
      open()
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [open])

  const onPlaceNode = useCallback(
    (placement: NodePlacement) => {
      applyNodePlacement(controller, placement)
      onNodePlaced?.(placement)
    },
    [controller, onNodePlaced],
  )

  const onDropKind = useCallback(
    (kind: string, dropAnchor: AddNodeAnchor) => {
      setDraggedKind(null)
      if (!graph || readOnly) return
      const kindInfo = nodeKinds.find((candidate) => candidate.kind === kind)
      if (kindInfo && !isOfferedKind(kindInfo, graph)) return
      if (kindInfo && (!kindInfo.plugin || kindInfo.plugin.installed)) {
        onPlaceNode(buildNodePlacement(graph, kindInfo, dropAnchor, controller.positions))
        return
      }
      // Not installed (or only in the catalog): the palette asks before anything installs.
      requestCounter.current += 1
      setRequestedKind({ kind, anchor: dropAnchor, requestId: requestCounter.current })
      setAnchor(dropAnchor)
      setIsOpen(true)
    },
    [graph, readOnly, nodeKinds, onPlaceNode, controller.positions],
  )

  const draggedKindName = useMemo(() => (draggedKind ? (nodeKinds.find((candidate) => candidate.kind === draggedKind)?.displayName ?? draggedKind) : null), [draggedKind, nodeKinds])

  return {
    isOpen,
    open,
    close,
    toggle,
    paletteProps: { anchor, positions: controller.positions, onPlaceNode, requestedKind, onDragKindChange: setDraggedKind },
    dropZoneProps: { draggedKindName, onDropKind },
  }
}
