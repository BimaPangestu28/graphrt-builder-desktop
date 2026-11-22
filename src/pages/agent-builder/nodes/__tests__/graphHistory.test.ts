import type { AgentGraph } from '@/api/agentGraphTypes'
import { emptyGraphHistory, graphHistoryReducer, type GraphHistoryAction, type GraphHistoryState } from '../sync/graphHistory'

function graphAtVersion(version: number, label = 'start'): AgentGraph {
  return { agentId: 'agent', version, nodes: [], edges: [], inputs: [], env: [], label } as unknown as AgentGraph
}

function labelOf(state: GraphHistoryState): unknown {
  return (state.graph as unknown as { label: string } | null)?.label
}

function relabel(label: string): GraphHistoryAction {
  return { type: 'edit', change: (graph) => ({ ...graph, label }) as AgentGraph, description: `set ${label}` }
}

function reduceAll(state: GraphHistoryState, actions: GraphHistoryAction[]): GraphHistoryState {
  return actions.reduce(graphHistoryReducer, state)
}

describe('graphHistoryReducer', () => {
  const loaded = graphHistoryReducer(emptyGraphHistory, { type: 'show-saved', graph: graphAtVersion(3) })

  it('ignores edits before a graph is loaded', () => {
    expect(graphHistoryReducer(emptyGraphHistory, relabel('a'))).toBe(emptyGraphHistory)
  })

  it('applies edits back to back, each on the result of the one before', () => {
    const edited = reduceAll(loaded, [relabel('a'), relabel('b')])
    expect(labelOf(edited)).toBe('b')
    expect(edited.past.map((entry) => (entry.graph as unknown as { label: string }).label)).toEqual(['start', 'a'])
    expect(edited.pendingDescriptions).toEqual(['set a', 'set b'])
  })

  it('records nothing for a change that returns the same graph', () => {
    expect(graphHistoryReducer(loaded, { type: 'edit', change: (graph) => graph })).toBe(loaded)
  })

  it('undoes newest first and redoes in the same order', () => {
    const edited = reduceAll(loaded, [relabel('a'), relabel('b'), relabel('c')])
    const undoneTwice = reduceAll(edited, [{ type: 'undo' }, { type: 'undo' }])
    expect(labelOf(undoneTwice)).toBe('a')
    expect(undoneTwice.pendingDescriptions).toEqual(['set a'])
    const redone = graphHistoryReducer(undoneTwice, { type: 'redo' })
    expect(labelOf(redone)).toBe('b')
    expect(redone.future).toHaveLength(1)
  })

  it('clears redo on a new edit and stops at the ends of the history', () => {
    const branched = reduceAll(loaded, [relabel('a'), { type: 'undo' }, relabel('x')])
    expect(branched.future).toEqual([])
    expect(graphHistoryReducer(branched, { type: 'redo' })).toBe(branched)
    const fullyUndone = reduceAll(branched, [{ type: 'undo' }, { type: 'undo' }])
    expect(labelOf(fullyUndone)).toBe('start')
    expect(fullyUndone.pendingDescriptions).toEqual([])
  })

  it('a merge replaces the graphs and clears the history but keeps the descriptions', () => {
    const edited = graphHistoryReducer(loaded, relabel('a'))
    const merged = graphHistoryReducer(edited, { type: 'show-merge', savedGraph: graphAtVersion(4), graph: graphAtVersion(4, 'merged') })
    expect(merged.savedGraph?.version).toBe(4)
    expect(labelOf(merged)).toBe('merged')
    expect(merged.past).toEqual([])
    expect(merged.pendingDescriptions).toEqual(['set a'])
  })

  it('a saved graph resets everything', () => {
    const saved = graphHistoryReducer(reduceAll(loaded, [relabel('a')]), { type: 'show-saved', graph: graphAtVersion(5) })
    expect(saved).toMatchObject({ past: [], future: [], pendingDescriptions: [] })
    expect(saved.graph).toBe(saved.savedGraph)
  })
})
