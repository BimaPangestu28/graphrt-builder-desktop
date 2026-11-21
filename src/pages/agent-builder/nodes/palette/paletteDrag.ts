import type { AddNodeAnchor } from '../contracts'

/**
 * Drag and drop from the palette onto the canvas. The palette puts the node kind on the
 * drag under {@link nodeKindDragType}; the drop zone around the canvas works out what is
 * under the pointer from React Flow's DOM (`data-id` on nodes and arrows, the viewport
 * transform), so the canvas itself needs no drop code.
 */

/** Drag data type carrying a node kind (`whatsapp-web.send_message`). */
export const nodeKindDragType = 'application/x-graphrt-node-kind'

/** True while the drag carries a palette node kind (readable during dragover). */
export function isNodeKindDrag(dataTransfer: Pick<DataTransfer, 'types'> | null): boolean {
  return Boolean(dataTransfer && Array.from(dataTransfer.types).includes(nodeKindDragType))
}

/** Starts a palette drag: the kind for the drop, plain text as a fallback. */
export function startNodeKindDrag(dataTransfer: DataTransfer, kind: string): void {
  dataTransfer.setData(nodeKindDragType, kind)
  dataTransfer.setData('text/plain', kind)
  dataTransfer.effectAllowed = 'copy'
}

/** What a drop at a point would do, for the ghost and the drop itself. */
export interface DropTarget {
  anchor: AddNodeAnchor
  /** Pointer position inside the drop zone, for the ghost (CSS pixels). */
  ghostX: number
  ghostY: number
}

interface ViewportTransform {
  x: number
  y: number
  zoom: number
}

/** React Flow's pan and zoom from `.react-flow__viewport`'s transform. */
function readViewportTransform(zoneElement: HTMLElement): ViewportTransform {
  const viewportElement = zoneElement.querySelector<HTMLElement>('.react-flow__viewport')
  if (!viewportElement) return { x: 0, y: 0, zoom: 1 }
  const transform = getComputedStyle(viewportElement).transform || viewportElement.style.transform
  const matrixMatch = /matrix\(([^)]+)\)/.exec(transform)
  if (matrixMatch) {
    const [scale, , , , translateX, translateY] = matrixMatch[1].split(',').map(Number)
    return { x: translateX || 0, y: translateY || 0, zoom: scale || 1 }
  }
  const translateMatch = /translate\(\s*(-?[\d.]+)px,\s*(-?[\d.]+)px\)\s*scale\(\s*([\d.]+)\)/.exec(transform)
  if (translateMatch) return { x: Number(translateMatch[1]), y: Number(translateMatch[2]), zoom: Number(translateMatch[3]) || 1 }
  return { x: 0, y: 0, zoom: 1 }
}

function findDataId(elements: Element[], selector: string): { id: string; element: Element } | null {
  for (const element of elements) {
    const match = element.closest(selector)
    const id = match?.getAttribute('data-id')
    if (match && id) return { id, element: match }
  }
  return null
}

/** The arrow under the point, also when its hit area ignores the pointer (hit-tests the wide interaction path). */
function findEdgeAt(zoneElement: HTMLElement, elements: Element[], clientX: number, clientY: number): string | null {
  const direct = findDataId(elements, '.react-flow__edge')
  if (direct) return direct.id
  for (const edgeElement of Array.from(zoneElement.querySelectorAll('.react-flow__edge[data-id]'))) {
    const hitPath = edgeElement.querySelector<SVGPathElement>('.react-flow__edge-interaction') ?? edgeElement.querySelector<SVGPathElement>('path')
    const matrix = hitPath?.getScreenCTM?.()
    if (!hitPath || !matrix || typeof hitPath.isPointInStroke !== 'function') continue
    const point = new DOMPoint(clientX, clientY).matrixTransform(matrix.inverse())
    if (hitPath.isPointInStroke(point)) return edgeElement.getAttribute('data-id')
  }
  return null
}

/**
 * What lies under a drop point: an arrow (insert on it), a step (add after it), a container
 * body (add inside it) or empty canvas (add there, unconnected).
 *
 * @param zoneElement - The drop zone wrapping the canvas (HTMLElement)
 * @param point - Pointer position (clientX / clientY)
 * @param containerIds - Ids of container nodes (For each, Repeat)
 * @returns The drop target, with canvas coordinates for an empty-canvas drop (DropTarget)
 */
export function findDropTarget(zoneElement: HTMLElement, point: { clientX: number; clientY: number }, containerIds: ReadonlySet<string>): DropTarget {
  const zoneRect = zoneElement.getBoundingClientRect()
  const ghostX = point.clientX - zoneRect.left
  const ghostY = point.clientY - zoneRect.top
  const elements = typeof document.elementsFromPoint === 'function' ? document.elementsFromPoint(point.clientX, point.clientY) : []
  const edgeId = findEdgeAt(zoneElement, elements, point.clientX, point.clientY)
  if (edgeId) return { anchor: { type: 'on-edge', edgeId }, ghostX, ghostY }

  const flowElement = zoneElement.querySelector<HTMLElement>('.react-flow') ?? zoneElement
  const flowRect = flowElement.getBoundingClientRect()
  const viewport = readViewportTransform(zoneElement)
  const nodeHit = findDataId(elements, '.react-flow__node')
  if (nodeHit && !containerIds.has(nodeHit.id)) return { anchor: { type: 'after-node', nodeId: nodeHit.id }, ghostX, ghostY }
  if (nodeHit) {
    const containerRect = nodeHit.element.getBoundingClientRect()
    return {
      anchor: { type: 'at-position', x: (point.clientX - containerRect.left) / viewport.zoom, y: (point.clientY - containerRect.top) / viewport.zoom, parentId: nodeHit.id },
      ghostX,
      ghostY,
    }
  }
  return {
    anchor: { type: 'at-position', x: (point.clientX - flowRect.left - viewport.x) / viewport.zoom, y: (point.clientY - flowRect.top - viewport.y) / viewport.zoom, parentId: null },
    ghostX,
    ghostY,
  }
}
