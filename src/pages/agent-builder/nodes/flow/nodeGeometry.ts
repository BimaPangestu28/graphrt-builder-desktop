/** Geometry of a step card, shared by the renderer and placement. */

const portSpacing = 30
const cardMinimumHeight = 96

/** Where an exit sits along the right edge (px from the top). */
export function portOffset(portIndex: number, portCount: number, nodeHeight: number): number {
  if (portCount === 1) return nodeHeight / 2
  const span = portSpacing * (portCount - 1)
  return nodeHeight / 2 - span / 2 + portIndex * portSpacing
}

/** Card height that fits every exit with room between them. */
export function cardHeightFor(portCount: number): number {
  return Math.max(cardMinimumHeight, portCount * portSpacing + 24)
}
