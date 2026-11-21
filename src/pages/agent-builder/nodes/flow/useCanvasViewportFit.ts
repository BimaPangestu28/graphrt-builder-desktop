import { useCallback, useEffect, useMemo, useRef, type RefObject } from 'react'
import { useReactFlow } from './flowLibrary'
import type { StepFlowEdge, StepFlowNode } from './toFlowElements'

/**
 * Keeps the graph in view as the canvas changes size (chat folded, inspector opened or
 * closed, window resized): Fit runs again once the size settles. Floating panels over the
 * canvas (the Add node palette on the left) are kept clear by fitting with a wider left
 * padding. A focus request centres one step (Show node, a step added from the palette).
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
const selectionMinimumZoom = 0.6

/**
 * Fit padding in px: room for the zoom controls and minimap at the bottom, and for a
 * floating panel covering `insetLeft` px on the left.
 */
/** A px padding value as React Flow's fit options take it. */
type PixelPadding = `${number}px`

export function canvasFitPadding(insetLeft: number): { top: PixelPadding; right: PixelPadding; bottom: PixelPadding; left: PixelPadding } {
  return { top: '28px', right: '28px', bottom: '64px', left: `${28 + Math.max(0, insetLeft)}px` }
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
  /** Animation length (0 with reduced motion). */
  duration: number
  focusRequest: CanvasFocusRequest | null
  /**
   * The one selected step, if any: when the canvas resizes because the inspector opened,
   * this step is kept centred at the current zoom instead of fitting everything smaller.
   */
  selectedNodeId: string | null
}

export interface ViewportFit {
  /** Options for React Flow's initial `fitView`. */
  fitViewOptions: { padding: ReturnType<typeof canvasFitPadding>; maxZoom: number }
  /** Fits the whole agent, clear of floating panels. */
  fitAll: () => void
}

/**
 * Fit on resize, on inset change and centring on focus requests.
 *
 * @returns Initial fit options and a Fit action (ViewportFit)
 */
export function useCanvasViewportFit({ containerRef, isReady, insetLeft, duration, focusRequest, selectedNodeId }: ViewportFitOptions): ViewportFit {
  const reactFlow = useReactFlow<StepFlowNode, StepFlowEdge>()
  const fitViewOptions = useMemo(() => ({ padding: canvasFitPadding(insetLeft), maxZoom: fitMaximumZoom }), [insetLeft])
  const latestRef = useRef({ fitViewOptions, duration, insetLeft, selectedNodeId })
  latestRef.current = { fitViewOptions, duration, insetLeft, selectedNodeId }
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
      const insetShift = latestRef.current.insetLeft / 2 / zoom
      void reactFlow.setCenter(x + width / 2 - insetShift, y + height / 2, { zoom, duration: latestRef.current.duration })
      return true
    },
    [reactFlow],
  )

  // Fit again once the canvas has a new size (not on the first measurement: a saved view stays).
  useEffect(() => {
    const element = containerRef.current
    if (!isReady || !element || typeof ResizeObserver === 'undefined') return
    let lastSize: { width: number; height: number } | null = null
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
        if (followedNodeId && centerOn(followedNodeId, selectionMinimumZoom)) return
        fitAll()
      }, resizeFitDelayMs)
    })
    observer.observe(element)
    return () => {
      observer.disconnect()
      window.clearTimeout(timer)
    }
  }, [containerRef, isReady, fitAll, centerOn])

  // A floating panel opened or closed over the canvas: fit clear of it.
  const previousInsetRef = useRef(insetLeft)
  useEffect(() => {
    if (previousInsetRef.current === insetLeft) return
    previousInsetRef.current = insetLeft
    fitAll()
  }, [insetLeft, fitAll])

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
