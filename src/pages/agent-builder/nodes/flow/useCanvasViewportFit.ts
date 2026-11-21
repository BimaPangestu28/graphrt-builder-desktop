import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from 'react'
import { getViewportForBounds, useReactFlow } from './flowLibrary'
import type { StepFlowEdge, StepFlowNode } from './toFlowElements'

/**
 * Keeps the graph in view as the canvas changes size (chat folded, inspector opened or
 * closed, window resized): Fit runs again once the size settles. Floating panels over the
 * canvas (the Add node palette on the left) are kept clear by fitting with a wider left
 * padding, the zoom bar and the minimap at the bottom by a taller bottom padding. A
 * narrow canvas (the chat open beside a small window) fits with tighter padding and
 * hides the minimap unless the person turned it on. When the inspector opens, the whole
 * agent is fitted when it stays readable, else the selected step is centred. A focus
 * request centres one step (Show node, a step added from the palette).
 */

/** Fit never zooms in past 100%: a small graph stays readable, not huge. */
export const fitMaximumZoom = 1
/** How long the size must stay still before Fit runs again. */
export const resizeFitDelayMs = 160
/** A focus this recent wins over a resize Fit (the inspector opening for Show node). */
const focusHoldMs = 1500
/** Zoom a focused step is shown at, at least (readable full cards). */
const focusMinimumZoom = 0.85
/** Zoom kept while following the selected step on a resize: never into compact cards. */
export const selectionMinimumZoom = 0.6
/**
 * When the inspector opens (the canvas narrows), the whole agent is fitted if that zoom
 * is at least this (compact cards, still an overview); below it the selected step is
 * centred at a readable zoom instead.
 */
export const resizeFitMinimumZoom = 0.4
/** Canvases narrower than this get the smallest zoom bar and hints. */
export const tinyCanvasWidth = 380

/** A px padding value as React Flow's fit options take it. */
type PixelPadding = `${number}px`
export type CanvasFitPadding = { top: PixelPadding; right: PixelPadding; bottom: PixelPadding; left: PixelPadding }

/** Canvases narrower than this fit with tight padding (and hide the minimap by default). */
export const compactCanvasWidth = 600
/** The minimap shows by default only on a canvas at least this big. */
export const minimapAutoSize = { width: 760, height: 460 }
/** Height of the minimap plus its margins: the bottom padding while it shows. */
const minimapClearance = 140
/** Height of the zoom bar plus its margins. */
const zoomBarClearance = 64

/** Shown, hidden, or decided by the canvas size. */
export type MinimapPreference = 'auto' | 'shown' | 'hidden'

/** What else covers the canvas edges besides a floating panel on the left. */
export interface CanvasRoom {
  minimapShown?: boolean
  /** Narrow canvas: tighter padding. */
  compact?: boolean
}

type CanvasSize = { width: number; height: number }

/**
 * Whether the minimap shows: the person's choice, else only when the canvas is big
 * enough for it not to cover steps.
 */
export function isMinimapShown(preference: MinimapPreference, size: CanvasSize | null): boolean {
  if (preference !== 'auto') return preference === 'shown'
  return size !== null && size.width >= minimapAutoSize.width && size.height >= minimapAutoSize.height
}

/** True for a canvas with room for little more than one card (the chat and inspector both open). */
export function isTinyCanvas(size: { width: number } | null): boolean {
  return size !== null && size.width < tinyCanvasWidth
}

/** True for a canvas too narrow for the full fit padding. */
export function isCompactCanvas(size: { width: number } | null): boolean {
  return size !== null && size.width < compactCanvasWidth
}

/**
 * Fit padding in px: room for the zoom bar (and the minimap when it shows) at the
 * bottom, and for a floating panel covering `insetLeft` px on the left.
 *
 * @example
 * canvasFitPadding(0) // { top: '28px', right: '28px', bottom: '64px', left: '28px' }
 * canvasFitPadding(0, { minimapShown: true }).bottom // '140px'
 */
export function canvasFitPadding(insetLeft: number, room: CanvasRoom = {}): CanvasFitPadding {
  const edge = room.compact ? 16 : 28
  const bottom = room.minimapShown ? minimapClearance : room.compact ? zoomBarClearance - 8 : zoomBarClearance
  return { top: `${edge}px`, right: `${edge}px`, bottom: `${bottom}px`, left: `${edge + Math.max(0, insetLeft)}px` }
}

/**
 * The size of `ref`'s element, kept current with a ResizeObserver; null until measured.
 *
 * @param ref - The element (RefObject<HTMLElement>)
 * @param isReady - False while the element is not rendered yet (boolean)
 */
export function useElementSize(ref: RefObject<HTMLElement>, isReady = true): CanvasSize | null {
  const [size, setSize] = useState<CanvasSize | null>(null)
  useEffect(() => {
    const element = ref.current
    if (!isReady || !element || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver((entries) => {
      const box = entries[0]?.contentRect
      if (!box || box.width === 0) return
      const next = { width: Math.round(box.width), height: Math.round(box.height) }
      setSize((current) => (current && current.width === next.width && current.height === next.height ? current : next))
    })
    observer.observe(element)
    return () => observer.disconnect()
  }, [ref, isReady])
  return size
}

export interface CanvasFocusRequest {
  nodeId: string
  /** Changes on every request, so showing the same step twice centres it again. */
  sequence: number
}

interface ViewportFitOptions {
  containerRef: RefObject<HTMLDivElement>
  /** False until the canvas is drawn (the container exists). */
  isReady: boolean
  /** Px of the canvas covered on the left by a floating panel. */
  insetLeft: number
  /** The minimap and the canvas size, for the bottom and side padding. */
  room?: CanvasRoom
  /** Animation length (0 with reduced motion). */
  duration: number
  focusRequest: CanvasFocusRequest | null
  /**
   * The one selected step, if any: when the canvas resizes because the inspector opened
   * and fitting everything would be too small to read, this step is kept centred instead.
   */
  selectedNodeId: string | null
}

export interface ViewportFit {
  /** Options for React Flow's initial `fitView`. */
  fitViewOptions: { padding: CanvasFitPadding; maxZoom: number }
  /** Fits the whole agent, clear of floating panels. */
  fitAll: () => void
}

/** The point to centre so `point` shows in the middle of the part no overlay covers. */
export function centreClearOfOverlays(point: { x: number; y: number }, padding: CanvasFitPadding, zoom: number): { x: number; y: number } {
  const shiftX = (parseFloat(padding.left) - parseFloat(padding.right)) / 2 / zoom
  const shiftY = (parseFloat(padding.bottom) - parseFloat(padding.top)) / 2 / zoom
  return { x: point.x - shiftX, y: point.y + shiftY }
}

/**
 * Fit on resize, on inset change and centring on focus requests.
 *
 * @returns Initial fit options and a Fit action (ViewportFit)
 */
export function useCanvasViewportFit({ containerRef, isReady, insetLeft, room = {}, duration, focusRequest, selectedNodeId }: ViewportFitOptions): ViewportFit {
  const reactFlow = useReactFlow<StepFlowNode, StepFlowEdge>()
  const { minimapShown = false, compact = false } = room
  const fitViewOptions = useMemo(() => ({ padding: canvasFitPadding(insetLeft, { minimapShown, compact }), maxZoom: fitMaximumZoom }), [insetLeft, minimapShown, compact])
  const latestRef = useRef({ fitViewOptions, duration, selectedNodeId })
  latestRef.current = { fitViewOptions, duration, selectedNodeId }
  const lastFocusRef = useRef<{ nodeId: string; at: number } | null>(null)

  const fitAll = useCallback(() => {
    void reactFlow.fitView({ ...latestRef.current.fitViewOptions, duration: latestRef.current.duration })
  }, [reactFlow])

  /** Centres a step at `minimumZoom` or more; false while it is not drawn and measured yet. */
  const centerOn = useCallback(
    (nodeId: string, minimumZoom: number): boolean => {
      const internalNode = reactFlow.getInternalNode(nodeId)
      const width = internalNode?.measured?.width ?? internalNode?.width
      if (!internalNode || !width) return false
      const height = internalNode.measured?.height ?? internalNode.height ?? 0
      const { x, y } = internalNode.internals.positionAbsolute
      const zoom = Math.min(fitMaximumZoom, Math.max(reactFlow.getZoom(), minimumZoom))
      const centre = centreClearOfOverlays({ x: x + width / 2, y: y + height / 2 }, latestRef.current.fitViewOptions.padding, zoom)
      void reactFlow.setCenter(centre.x, centre.y, { zoom, duration: latestRef.current.duration })
      return true
    },
    [reactFlow],
  )

  /** The zoom Fit would pick for a canvas of `size`, or null when nothing is drawn. */
  const fitZoomFor = useCallback(
    (size: CanvasSize): number | null => {
      const visible = reactFlow.getNodes().filter((flowNode) => !flowNode.hidden)
      if (visible.length === 0) return null
      const bounds = reactFlow.getNodesBounds(visible)
      if (bounds.width === 0 && bounds.height === 0) return null
      return getViewportForBounds(bounds, size.width, size.height, 0.2, fitMaximumZoom, latestRef.current.fitViewOptions.padding).zoom
    },
    [reactFlow],
  )

  // Fit again once the canvas has a new size (not on the first measurement: a saved view stays).
  useEffect(() => {
    const element = containerRef.current
    if (!isReady || !element || typeof ResizeObserver === 'undefined') return
    let lastSize: CanvasSize | null = null
    let timer: number | undefined
    const observer = new ResizeObserver((entries) => {
      const box = entries[0]?.contentRect
      if (!box || box.width === 0) return
      const size = { width: Math.round(box.width), height: Math.round(box.height) }
      const previous = lastSize
      lastSize = size
      if (!previous || (Math.abs(size.width - previous.width) < 4 && Math.abs(size.height - previous.height) < 4)) return
      window.clearTimeout(timer)
      timer = window.setTimeout(() => {
        const lastFocus = lastFocusRef.current
        if (lastFocus && Date.now() - lastFocus.at < focusHoldMs && centerOn(lastFocus.nodeId, focusMinimumZoom)) return
        const followedNodeId = latestRef.current.selectedNodeId
        // The inspector opened: fit everything while it stays readable, else keep the step centred.
        const fitZoom = fitZoomFor(size)
        const isFitReadable = fitZoom !== null && fitZoom >= resizeFitMinimumZoom
        if (followedNodeId && !isFitReadable && centerOn(followedNodeId, selectionMinimumZoom)) return
        fitAll()
      }, resizeFitDelayMs)
    })
    observer.observe(element)
    return () => {
      observer.disconnect()
      window.clearTimeout(timer)
    }
  }, [containerRef, isReady, fitAll, centerOn, fitZoomFor])

  // A floating panel or the minimap opened or closed over the canvas: fit clear of it.
  const roomKey = `${insetLeft}|${minimapShown}|${compact}`
  const previousRoomRef = useRef(roomKey)
  useEffect(() => {
    if (previousRoomRef.current === roomKey) return
    previousRoomRef.current = roomKey
    fitAll()
  }, [roomKey, fitAll])

  // Centre the requested step; it may need a moment to be drawn and measured.
  const focusSequence = focusRequest?.sequence
  const focusNodeId = focusRequest?.nodeId
  useEffect(() => {
    if (!isReady || focusSequence === undefined || !focusNodeId) return
    lastFocusRef.current = { nodeId: focusNodeId, at: Date.now() }
    let attempts = 0
    let timer: number | undefined
    const tryFocus = () => {
      if (centerOn(focusNodeId, focusMinimumZoom) || attempts >= 30) return
      attempts += 1
      timer = window.setTimeout(tryFocus, 30)
    }
    tryFocus()
    return () => window.clearTimeout(timer)
  }, [isReady, focusSequence, focusNodeId, centerOn])

  return { fitViewOptions, fitAll }
}
