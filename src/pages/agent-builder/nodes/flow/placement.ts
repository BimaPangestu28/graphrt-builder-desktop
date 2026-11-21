/**
 * Where a new step lands on the canvas: after the step it follows (the anchor), in
 * the direction arrows run in its scope (below at the top level, to the right
 * inside a loop), then nudged sideways (and one row or column further when a whole
 * row is taken) until it overlaps nothing. Pure geometry in canvas units; child
 * positions are relative to their container, so callers pass siblings only.
 */

export interface CanvasRect {
  x: number
  y: number
  width: number
  height: number
}

export interface CanvasPoint {
  x: number
  y: number
}

/** Space kept between a new step and its neighbours. */
export const placementGap = 32
/** Distance from an anchor to the step placed after it. */
export const placementColumnGap = 72
export const placementRowGap = 56

/** Which way arrows run: down at the top level, right inside a loop. */
export type PlacementDirection = 'down' | 'right'
/** Tries per column before moving one column right. */
const triesPerColumn = 12

/** True when the two rects (grown by `gap`) overlap. */
export function rectsOverlap(first: CanvasRect, second: CanvasRect, gap = 0): boolean {
  return first.x < second.x + second.width + gap && second.x < first.x + first.width + gap && first.y < second.y + second.height + gap && second.y < first.y + first.height + gap
}

/**
 * The nearest free spot at or below `desired` (then in the next columns), so a step
 * of `size` overlaps none of `occupied`.
 *
 * @param desired - Preferred top-left corner (CanvasPoint)
 * @param size - Width and height of the step to place
 * @param occupied - Rects of the steps already there (CanvasRect[])
 * @returns A top-left corner that overlaps nothing (CanvasPoint)
 */
export function findFreePosition(desired: CanvasPoint, size: { width: number; height: number }, occupied: CanvasRect[], direction: PlacementDirection = 'right'): CanvasPoint {
  const stepAlong = direction === 'right' ? { x: size.width + placementGap, y: 0 } : { x: 0, y: size.height + placementGap }
  const stepAcross = direction === 'right' ? { x: 0, y: size.height + placementGap } : { x: size.width + placementGap, y: 0 }
  for (let column = 0; column < 20; column += 1) {
    for (let attempt = 0; attempt < triesPerColumn; attempt += 1) {
      const candidate = { x: desired.x + column * stepAlong.x + attempt * stepAcross.x, y: desired.y + column * stepAlong.y + attempt * stepAcross.y }
      if (!occupied.some((rect) => rectsOverlap({ ...candidate, ...size }, rect, placementGap - 1))) return candidate
    }
  }
  // Everything nearby is full: below the lowest step.
  const lowest = Math.max(desired.y, ...occupied.map((rect) => rect.y + rect.height))
  return { x: desired.x, y: lowest + placementGap }
}

/**
 * Where a new step goes: after `anchor` (below, or right with `direction` 'right') when it follows one, else at `fallback`
 * (e.g. the middle of the view), nudged into free space.
 *
 * @param anchor - Rect of the step it follows, or null (CanvasRect | null)
 * @param size - Size of the new step
 * @param occupied - Rects of its siblings (CanvasRect[])
 * @param fallback - Spot to use without an anchor (CanvasPoint)
 * @returns Top-left corner for the new step (CanvasPoint)
 *
 * @example
 * placeNewNode({ x: 0, y: 0, width: 240, height: 110 }, { width: 240, height: 110 }, [], { x: 0, y: 0 }, 'right') // { x: 312, y: 0 }
 */
export function placeNewNode(anchor: CanvasRect | null, size: { width: number; height: number }, occupied: CanvasRect[], fallback: CanvasPoint, direction: PlacementDirection = 'right'): CanvasPoint {
  if (!anchor) return findFreePosition(fallback, size, occupied, direction)
  return findFreePosition(spotAfter(anchor, size, direction), size, occupied, direction)
}

/** The spot right after `anchor`: below it (centred) at the top level, right of it inside a loop. */
export function spotAfter(anchor: CanvasRect, size: { width: number; height: number }, direction: PlacementDirection): CanvasPoint {
  if (direction === 'right') return { x: anchor.x + anchor.width + placementColumnGap, y: anchor.y }
  return { x: anchor.x + (anchor.width - size.width) / 2, y: anchor.y + anchor.height + placementRowGap }
}

/**
 * How far the steps after an inserted one move so it slots in (spec "Add node after inserts
 * on the outgoing arrow"): one step plus a gap, down at the top level, right inside a loop.
 */
export function insertionShift(size: { width: number; height: number }, direction: PlacementDirection): CanvasPoint {
  return direction === 'right' ? { x: size.width + placementColumnGap, y: 0 } : { x: 0, y: size.height + placementRowGap }
}

/** True when `rect` reaches past `spot` along the flow (so it moves to make room). */
export function isPastSpot(rect: CanvasRect, spot: CanvasPoint, direction: PlacementDirection): boolean {
  return direction === 'right' ? rect.x + rect.width > spot.x : rect.y + rect.height > spot.y
}
