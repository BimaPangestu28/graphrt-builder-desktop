import type { AgentGraph } from '@/api/agentGraphTypes'
import { resetSampleAgentGraphs, sampleAgentGraphBackend } from '@/api/sampleBackend/agentGraph'
import { resetSampleAgents } from '@/api/sampleBackend/agents'
import { addGraphEdge, addGraphNode, createGraphNode, removeGraphNodes, updateGraphNode } from '../graphEdits'
import { describeQueuedEdits, mergeGraphEdits } from '../sync/graphMerge'

const titleOf = (graph: AgentGraph, nodeId: string) => graph.nodes.find((node) => node.id === nodeId)?.title

describe('mergeGraphEdits', () => {
  let base: AgentGraph
  beforeEach(async () => {
    resetSampleAgents()
    resetSampleAgentGraphs()
    base = await sampleAgentGraphBackend.getAgentGraph('maps-leads')
  })

  it('re-applies my edits of steps the builder did not touch', () => {
    const mine = updateGraphNode(base, 'write_message', { title: 'Mine' })
    const theirs = { ...updateGraphNode(base, 'search_maps', { title: 'Theirs' }), version: 8 }

    const { merged, conflicts, reappliedNodeIds } = mergeGraphEdits(base, mine, theirs)

    expect(conflicts).toEqual([])
    expect(reappliedNodeIds).toEqual(['write_message'])
    expect(merged.version).toBe(8)
    expect(titleOf(merged, 'write_message')).toBe('Mine')
    expect(titleOf(merged, 'search_maps')).toBe('Theirs')
  })

  it('reports a conflict when both changed the same step, and keeps the builder’s until decided', () => {
    const mine = updateGraphNode(base, 'write_message', { title: 'Mine' })
    const theirs = updateGraphNode(base, 'write_message', { title: 'Theirs' })

    const open = mergeGraphEdits(base, mine, theirs)
    expect(open.conflicts.map((conflict) => [conflict.nodeId, conflict.title])).toEqual([['write_message', 'Write a short message']])
    expect(titleOf(open.merged, 'write_message')).toBe('Theirs')

    const keptMine = mergeGraphEdits(base, mine, theirs, { write_message: 'keep-mine' })
    expect(keptMine.conflicts).toEqual([])
    expect(titleOf(keptMine.merged, 'write_message')).toBe('Mine')
  })

  it('treats the same change on both sides as no conflict', () => {
    const mine = updateGraphNode(base, 'write_message', { title: 'Same' })
    const theirs = updateGraphNode(base, 'write_message', { title: 'Same' })
    expect(mergeGraphEdits(base, mine, theirs).conflicts).toEqual([])
  })

  it('flags a step I changed that the builder removed', () => {
    const mine = updateGraphNode(base, 'send_whatsapp', { title: 'Mine' })
    const theirs = removeGraphNodes(base, ['send_whatsapp'])
    const { conflicts, merged } = mergeGraphEdits(base, mine, theirs)
    expect(conflicts).toMatchObject([{ nodeId: 'send_whatsapp', theirs: null }])
    expect(merged.nodes.some((node) => node.id === 'send_whatsapp')).toBe(false)
  })

  it('keeps steps and arrows I added, and drops arrows to steps that are gone', () => {
    const note = createGraphNode({ id: 'notify', kind: 'llm', title: 'Notify me' })
    const mine = addGraphEdge(addGraphEdge(addGraphNode(base, note), { source: 'search_maps', target: 'notify' }), { source: 'notify', target: 'send_whatsapp' })
    const theirs = removeGraphNodes(base, ['send_whatsapp'])

    const { merged, conflicts } = mergeGraphEdits(base, mine, theirs)

    expect(conflicts).toEqual([])
    expect(merged.nodes.at(-1)?.id).toBe('notify')
    expect(merged.edges.some((edge) => edge.source === 'search_maps' && edge.target === 'notify')).toBe(true)
    expect(merged.edges.some((edge) => edge.target === 'send_whatsapp')).toBe(false)
  })

  it('removes arrows I removed even when the builder changed other things', () => {
    const removedEdge = base.edges.find((edge) => edge.source === 'search_maps')
    const mine = { ...base, edges: base.edges.filter((edge) => edge !== removedEdge) }
    const theirs = updateGraphNode(base, 'write_message', { title: 'Theirs' })
    const { merged } = mergeGraphEdits(base, mine, theirs)
    expect(merged.edges.some((edge) => edge.source === 'search_maps')).toBe(false)
    expect(titleOf(merged, 'write_message')).toBe('Theirs')
  })

  it('describes the waiting edits in plain words', () => {
    let mine = updateGraphNode(base, 'write_message', { title: 'Mine' })
    mine = addGraphNode(mine, createGraphNode({ id: 'notify', kind: 'llm', title: 'Notify me' }))
    expect(describeQueuedEdits(base, mine)).toEqual(['title of Write a short message', 'Notify me (new)'])
  })
})
