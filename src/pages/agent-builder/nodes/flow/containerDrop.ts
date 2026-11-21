import type { NodeLayout } from '@/api/agentGraphTypes'

/**
 * Geometry for dragging a step into or out of a loop (For each / Repeat): which loop a
 * drop point falls in, the step's position relative to its new container, and how much a
 * loop grows so a step dropped near its edge stays inside. Pure, canvas units.
 */

export interface CanvasBox {
  x: number
  y: number
  width: number
  height: number
}

/** Top-left room a step keeps inside a loop: clear of the border and the loop's header. */
export const containerInset = { left: 16, top: 64, right: 24, bottom: 24 }

function contains(box: CanvasBox, point: { x: number; y: number }): boolean {
  return point.x >= box.x && point.x <= box.x + box.width && point.y >= box.y && point.y <= box.y + box.height
}

/**
 * The innermost loop whose box holds `point`, or null (top level).
 *
 * @param containers - Loops with their absolute boxes (Array<{ id: string; box: CanvasBox }>)
 * @param point - Absolute canvas point, usually the dragged step's centre ({ x, y })
 * @returns The loop id, or null when the point is on the open canvas (string | null)
 */
export function findDropContainer(containers: Array<{ id: string; box: CanvasBox }>, point: { x: number; y: number }): string | null {
  let best: { id: string; area: number } | null = null
  for (const container of containers) {
    if (!contains(container.box, point)) continue
    const area = container.box.width * container.box.height
    if (!best || area < best.area) best = { id: container.id, area }
  }
  return best?.id ?? null
}

/**
 * Where a step lands inside its container: relative to the container, kept clear of the
 * header and the left / top border, and the container's new size when the step reaches
 * past its right or bottom edge.
 *
 * @param absolute - The step's absolute top-left ({ x, y })
 * @param stepSize - The step's size ({ width, height })
 * @param container - The container's absolute box (CanvasBox)
 * @returns The relative position and the grown container size, or null when it fits ({ position, grownSize })
 */
export function placeInsideContainer(
  absolute: { x: number; y: number },
  stepSize: { width: number; height: number },
  container: CanvasBox,
): { position: { x: number; y: number }; grownSize: { width: number; height: number } | null } {
  const position = {
    x: Math.round(Math.max(containerInset.left, absolute.x - container.x)),
    y: Math.round(Math.max(containerInset.top, absolute.y - container.y)),
  }
  const neededWidth = position.x + stepSize.width + containerInset.right
  const neededHeight = position.y + stepSize.height + containerInset.bottom
  const grows = neededWidth > container.width || neededHeight > container.height
  return { position, grownSize: grows ? { width: Math.round(Math.max(container.width, neededWidth)), height: Math.round(Math.max(container.height, neededHeight)) } : null }
}

/** A container's layout with a new size, its position unchanged. */
export function grownContainerLayout(layout: NodeLayout, size: { width: number; height: number }): NodeLayout {
  return { ...layout, width: size.width, height: size.height }
}
