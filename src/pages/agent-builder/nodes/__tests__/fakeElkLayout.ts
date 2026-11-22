import type { ElkNode } from 'elkjs/lib/elk-api.js'

/**
 * Stand-in for `flow/layoutEngine` in canvas tests: loading and running real ELK in jsdom
 * costs seconds per file and the canvas tests only need non-overlapping positions. Nodes
 * are stacked like ELK would (down at the top level, right inside a loop), each container
 * sized to fit its body. Layout itself is covered by `graphEdits.test.ts` (real ELK).
 *
 * @example
 * vi.mock('../flow/layoutEngine', () => import('./fakeElkLayout'))
 */

const nodeGap = 48
const containerHeaderHeight = 64
const containerPadding = 24

function placeChildren(scope: ElkNode, direction: 'down' | 'right'): ElkNode {
  let offset = direction === 'down' ? 0 : containerPadding
  const children = (scope.children ?? []).map((child) => {
    const laidOutChild = layOutNode(child)
    const position = direction === 'down' ? { x: 0, y: offset } : { x: offset, y: containerHeaderHeight }
    offset += (direction === 'down' ? (laidOutChild.height ?? 0) : (laidOutChild.width ?? 0)) + nodeGap
    return { ...laidOutChild, ...position }
  })
  return { ...scope, children }
}

function layOutNode(node: ElkNode): ElkNode {
  if (!node.children?.length) return { ...node, width: node.width ?? 0, height: node.height ?? 0 }
  const laidOut = placeChildren(node, 'right')
  const right = Math.max(...(laidOut.children ?? []).map((child) => (child.x ?? 0) + (child.width ?? 0)))
  const bottom = Math.max(...(laidOut.children ?? []).map((child) => (child.y ?? 0) + (child.height ?? 0)))
  return { ...laidOut, width: right + containerPadding, height: bottom + containerPadding }
}

/** Same contract as the real `runElkLayout`, without ELK. */
export async function runElkLayout(graph: ElkNode): Promise<ElkNode> {
  return placeChildren(graph, 'down')
}
