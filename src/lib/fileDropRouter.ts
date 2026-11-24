/**
 * Routes window-level drag and drop of files to the drop zone under the pointer.
 *
 * Tauri reports file drags for the whole webview (with real filesystem paths and a pointer
 * position) instead of per element. Every mounted {@link FileDropZone} registers here; the
 * router hit-tests each zone's bounding rectangle so only the zone under the pointer
 * highlights and receives the drop. Drops elsewhere on the window are ignored. When zones
 * overlap (a zone inside a panel that is also a zone), the smallest one wins.
 *
 * The router subscribes to its source while at least one zone is registered.
 */

/** A point in CSS pixels relative to the webview's top-left corner. */
export interface DropPoint {
  x: number
  y: number
}

/** A window drag and drop event with the position already in CSS pixels. */
export type WindowDragDropEvent =
  | { type: 'enter'; paths: string[]; position: DropPoint }
  | { type: 'over'; position: DropPoint }
  | { type: 'drop'; paths: string[]; position: DropPoint }
  | { type: 'leave' }

/** Subscribes to window drag and drop events; resolves to an unsubscribe function. */
export type WindowDragDropSource = (onEvent: (event: WindowDragDropEvent) => void) => Promise<() => void>

/** One mounted drop zone. */
export interface DropZoneRegistration {
  /** The zone's element, hit-tested on every event (null while unmounted). */
  getElement: () => HTMLElement | null
  /** Called with the dragged paths when the pointer enters the zone, and null when it leaves. */
  onHoverChange: (draggedPaths: string[] | null) => void
  /** Called with the dropped paths when they are dropped on the zone. */
  onDrop: (paths: string[]) => void
}

export interface FileDropRouter {
  /** Adds a zone; returns a function that removes it. */
  register: (zone: DropZoneRegistration) => () => void
}

function containsPoint(rect: DOMRect, point: DropPoint): boolean {
  return rect.width > 0 && rect.height > 0 && point.x >= rect.left && point.x <= rect.right && point.y >= rect.top && point.y <= rect.bottom
}

/**
 * The zone under `point`; the smallest when several overlap, null when none.
 *
 * @param zones - Registered zones (Iterable<DropZoneRegistration>)
 * @param point - Pointer position in CSS pixels (DropPoint)
 */
export function findZoneAt(zones: Iterable<DropZoneRegistration>, point: DropPoint): DropZoneRegistration | null {
  let bestZone: DropZoneRegistration | null = null
  let bestArea = Number.POSITIVE_INFINITY
  for (const zone of zones) {
    const element = zone.getElement()
    if (!element || !element.isConnected) continue
    const rect = element.getBoundingClientRect()
    const area = rect.width * rect.height
    if (containsPoint(rect, point) && area < bestArea) {
      bestZone = zone
      bestArea = area
    }
  }
  return bestZone
}

/**
 * Creates a router listening to `source`.
 *
 * @param source - Window drag and drop events (WindowDragDropSource)
 * @returns The router (FileDropRouter)
 *
 * @example
 * const router = createFileDropRouter(subscribeToWindowDragDrop)
 * const unregister = router.register({ getElement: () => zoneElement, onHoverChange, onDrop })
 */
export function createFileDropRouter(source: WindowDragDropSource): FileDropRouter {
  const zones = new Set<DropZoneRegistration>()
  let hoveredZone: DropZoneRegistration | null = null
  let draggedPaths: string[] = []
  let unsubscribe: (() => void) | null = null
  let subscription: Promise<void> | null = null

  const setHoveredZone = (nextZone: DropZoneRegistration | null) => {
    if (nextZone === hoveredZone) return
    hoveredZone?.onHoverChange(null)
    hoveredZone = nextZone
    nextZone?.onHoverChange(draggedPaths)
  }

  const handleEvent = (event: WindowDragDropEvent) => {
    switch (event.type) {
      case 'enter':
        draggedPaths = event.paths
        setHoveredZone(findZoneAt(zones, event.position))
        return
      case 'over':
        setHoveredZone(findZoneAt(zones, event.position))
        return
      case 'drop': {
        const targetZone = findZoneAt(zones, event.position)
        setHoveredZone(null)
        draggedPaths = []
        if (targetZone && event.paths.length > 0) targetZone.onDrop(event.paths)
        return
      }
      case 'leave':
        setHoveredZone(null)
        draggedPaths = []
    }
  }

  const startListening = () => {
    subscription = source(handleEvent)
      .then((stop) => {
        if (zones.size === 0) stop()
        else unsubscribe = stop
      })
      .catch((subscribeError: unknown) => {
        console.error('Could not listen to dropped files', subscribeError)
      })
      .finally(() => {
        subscription = null
      })
  }

  const stopListening = () => {
    unsubscribe?.()
    unsubscribe = null
    hoveredZone = null
  }

  return {
    register(zone) {
      zones.add(zone)
      if (!unsubscribe && !subscription) startListening()
      return () => {
        if (hoveredZone === zone) hoveredZone = null
        zones.delete(zone)
        if (zones.size === 0) stopListening()
      }
    },
  }
}
