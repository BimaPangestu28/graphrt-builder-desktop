import type { AgentGraph, NodeConfig } from '@/api/agentGraphTypes'
import { removeGraphEdges, updateGraphNode } from '../graphEdits'

/**
 * Edits of branch lists whose items are ports (if-else cases, classifier classes,
 * approval buttons): a new item gets a fresh id, and removing an item that has an arrow
 * removes the arrow in the same undo step.
 */

/** Ids of the arrows leaving `nodeId` through the exit `handleId`. */
export function edgesFromExit(graph: AgentGraph, nodeId: string, handleId: string): string[] {
  return graph.edges.filter((edge) => edge.source === nodeId && edge.sourceHandle === handleId).map((edge) => edge.id)
}

/** A graph with the node's new config and the arrows of a removed exit gone. */
export function removeExit(graph: AgentGraph, nodeId: string, nextConfig: NodeConfig, handleId: string): AgentGraph {
  const withConfig = updateGraphNode(graph, nodeId, { config: nextConfig })
  return removeGraphEdges(withConfig, edgesFromExit(graph, nodeId, handleId))
}

/**
 * An id not in `takenIds`, from `base` and a number (`case_2`, `class_3`).
 *
 * @example
 * uniqueBranchId(['case_1'], 'case') // 'case_2'
 */
export function uniqueBranchId(takenIds: string[], base: string): string {
  let index = takenIds.length + 1
  while (takenIds.includes(`${base}_${index}`)) index += 1
  return `${base}_${index}`
}

/** `Send it` → `send_it`, for a button id made from its title. */
export function slugifyBranchId(title: string): string {
  return title.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '')
}
