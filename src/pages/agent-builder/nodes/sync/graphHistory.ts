import type { AgentGraph } from '@/api/agentGraphTypes'

/**
 * The working copy of the Nodes view and its undo / redo history, as one reducer.
 *
 * The graph, the history stacks and the edit descriptions change together. Kept in
 * separate `useState`s, an edit had to read them from the last render, so two edits in the
 * same tick (a drop that adds a step and an arrow, an inspector change and a delete) both
 * started from the same graph and the first one was lost. Every transition here starts
 * from the current state instead, so edits dispatched back to back all apply, in order.
 */

/** One undoable step: the graph before it and the words describing the edits up to it. */
export interface GraphHistoryEntry {
  graph: AgentGraph
  descriptions: string[]
}

export interface GraphHistoryState {
  /** The graph as last loaded or saved (null before the first load). */
  savedGraph: AgentGraph | null
  /** The working copy with local edits. */
  graph: AgentGraph | null
  past: GraphHistoryEntry[]
  future: GraphHistoryEntry[]
  /** Words for each edit since the last save ("moved Write the run report"). */
  pendingDescriptions: string[]
}

export type GraphHistoryAction =
  /** A version was loaded or saved: it becomes both the saved graph and the working copy. */
  | { type: 'show-saved'; graph: AgentGraph }
  /** Edits were merged onto a newer version: `graph` over `savedGraph`, history cleared. */
  | { type: 'show-merge'; savedGraph: AgentGraph; graph: AgentGraph }
  /** One undoable edit; a change that returns the same graph records nothing. */
  | { type: 'edit'; change: (graph: AgentGraph) => AgentGraph; description?: string }
  | { type: 'undo' }
  | { type: 'redo' }

export const emptyGraphHistory: GraphHistoryState = { savedGraph: null, graph: null, past: [], future: [], pendingDescriptions: [] }

function applyEdit(state: GraphHistoryState, change: (graph: AgentGraph) => AgentGraph, description?: string): GraphHistoryState {
  if (!state.graph) return state
  const nextGraph = change(state.graph)
  if (nextGraph === state.graph) return state
  return {
    ...state,
    graph: nextGraph,
    past: [...state.past, { graph: state.graph, descriptions: state.pendingDescriptions }],
    future: [],
    pendingDescriptions: description ? [...state.pendingDescriptions, description] : state.pendingDescriptions,
  }
}

function undo(state: GraphHistoryState): GraphHistoryState {
  const previous = state.past.at(-1)
  if (!previous || !state.graph) return state
  return {
    ...state,
    graph: previous.graph,
    past: state.past.slice(0, -1),
    future: [{ graph: state.graph, descriptions: state.pendingDescriptions }, ...state.future],
    pendingDescriptions: previous.descriptions,
  }
}

function redo(state: GraphHistoryState): GraphHistoryState {
  const [next, ...laterEntries] = state.future
  if (!next || !state.graph) return state
  return {
    ...state,
    graph: next.graph,
    past: [...state.past, { graph: state.graph, descriptions: state.pendingDescriptions }],
    future: laterEntries,
    pendingDescriptions: next.descriptions,
  }
}

/**
 * @param state - Current working copy and history (GraphHistoryState)
 * @param action - What happened (GraphHistoryAction)
 * @returns The next state; the same object when nothing changed (GraphHistoryState)
 *
 * @example
 * const [history, dispatch] = useReducer(graphHistoryReducer, emptyGraphHistory)
 * dispatch({ type: 'edit', change: (graph) => addGraphNode(graph, node), description: 'added Send' })
 */
export function graphHistoryReducer(state: GraphHistoryState, action: GraphHistoryAction): GraphHistoryState {
  switch (action.type) {
    case 'show-saved':
      return { savedGraph: action.graph, graph: action.graph, past: [], future: [], pendingDescriptions: [] }
    case 'show-merge':
      return { ...state, savedGraph: action.savedGraph, graph: action.graph, past: [], future: [] }
    case 'edit':
      return applyEdit(state, action.change, action.description)
    case 'undo':
      return undo(state)
    case 'redo':
      return redo(state)
  }
}
