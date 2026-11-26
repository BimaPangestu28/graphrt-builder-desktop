import type { AgentGraph } from '@/api/agentGraphTypes'
import type { PendingApproval } from '@/api/runReviewTypes'
import { resetSampleAgentGraphs, sampleAgentGraphBackend } from '@/api/sampleBackend/agentGraph'
import { resetSampleAgents } from '@/api/sampleBackend/agents'
import type { GraphrtEvent, RunEventRecord } from '@/api/types'
import { updateGraphNode } from '../graphEdits'
import { buildGraphStepTemplate, buildRunCanvasState, describeCurrentItem } from '../run/nodeRunStates'

const startedAt = Date.parse('2026-11-21T10:00:00Z')

function records(events: GraphrtEvent[]): RunEventRecord[] {
  return events.map((event, index) => ({ runId: 'run-1', seq: index + 1, event, createdAt: new Date(startedAt + index * 1000).toISOString() }))
}

function node(type: string, nodeId: string, fields: Record<string, unknown> = {}): GraphrtEvent {
  return { type, node_id: nodeId, frame: '', ...fields }
}

function inItem(index: number) {
  return { frame: `for_each_place[${index}]` }
}

/** One business through the loop body; `branch` is the approval's answer. */
function itemEvents(index: number, outcome: 'sent' | 'skipped' | 'failed'): GraphrtEvent[] {
  const frame = inItem(index)
  const events = [
    node('node_progress', 'for_each_place', { name: 'iteration_next', data: { index, total: 10 } }),
    node('node_started', 'write_message', frame),
    node('node_succeeded', 'write_message', { ...frame, outputs: { text: 'Hi' }, elapsed_ms: 1000 }),
  ]
  if (outcome === 'failed') return [...events, node('node_failed', 'approve_message', { ...frame, error: 'broken', handled: false })]
  const branch = outcome === 'sent' ? 'send' : 'skip'
  return [
    ...events,
    node('node_succeeded', 'approve_message', { ...frame, branch, outputs: { action: branch } }),
    outcome === 'sent' ? node('node_succeeded', 'send_whatsapp', { ...frame, outputs: {}, elapsed_ms: 500 }) : node('node_skipped', 'send_whatsapp', frame),
  ]
}

const beforeLoop: GraphrtEvent[] = [
  { type: 'run_started', resumed: false },
  node('node_started', 'ask_input'),
  node('node_succeeded', 'ask_input', { outputs: {}, elapsed_ms: 0 }),
  node('node_started', 'search_maps'),
  node('node_succeeded', 'search_maps', { outputs: { places_found: 10 }, elapsed_ms: 1200 }),
  node('node_started', 'for_each_place'),
]

function approvalFor(nodeId: string, overrides: Partial<PendingApproval> = {}): PendingApproval {
  return {
    id: nodeId,
    kind: 'form',
    nodeId,
    frame: '',
    resumeKey: nodeId,
    stepTitle: null,
    prompt: 'Send this message?',
    fields: [],
    actions: [{ id: 'send', title: 'Send' }],
    timeoutMs: null,
    expiresAt: null,
    onTimeout: null,
    toolCall: null,
    container: null,
    card: null,
    ...overrides,
  }
}

describe('buildRunCanvasState', () => {
  let graph: AgentGraph
  beforeEach(async () => {
    resetSampleAgents()
    resetSampleAgentGraphs()
    graph = await sampleAgentGraphBackend.getAgentGraph('maps-leads')
  })

  it('lists the visible nodes with loop bodies after their container', () => {
    expect(buildGraphStepTemplate(graph).map((step) => [step.id, step.depth])).toEqual([
      ['ask_input', 0],
      ['search_maps', 0],
      ['for_each_place', 0],
      ['write_message', 1],
      ['approve_message', 1],
      ['send_whatsapp', 1],
      ['end', 0],
    ])
  })

  it('shows running, done with its duration, and not started', () => {
    const runState = buildRunCanvasState(graph, records([...beforeLoop.slice(0, 4)]))
    expect(runState.nodes.ask_input).toMatchObject({ status: 'done', durationMs: 0 })
    expect(runState.nodes.search_maps).toMatchObject({ status: 'running', attempt: 1 })
    expect(runState.nodes.write_message.status).toBe('pending')
    expect(runState.edges['ask_input-search_maps-0']).toBe('taken')
    expect(runState).toMatchObject({ doneCount: 1, totalCount: 4 })
  })

  it('counts loop items: position, done, skipped and failed, and the item in progress', () => {
    const events = [...beforeLoop, ...itemEvents(0, 'sent'), ...itemEvents(1, 'failed'), ...itemEvents(2, 'skipped'), node('node_progress', 'for_each_place', { name: 'iteration_next', data: { index: 3, total: 10 } }), node('node_started', 'write_message', inItem(3))]
    const runState = buildRunCanvasState(graph, records(events))

    expect(runState.nodes.for_each_place.loop).toEqual({ currentNumber: 4, total: 10, doneCount: 1, skippedCount: 1, failedCount: 1, isLoop: false })
    expect(runState.nodes.write_message).toMatchObject({ status: 'running', itemsDoneCount: 3 })
    expect(describeCurrentItem(graph, runState)).toBe('place 4 of 10')
  })

  it('follows the branch an approval took: the other exit is skipped', () => {
    const runState = buildRunCanvasState(graph, records([...beforeLoop, ...itemEvents(0, 'skipped')]))
    const sendEdge = graph.edges.find((edge) => edge.source === 'approve_message' && edge.target === 'send_whatsapp')
    expect(runState.nodes.send_whatsapp.status).toBe('skipped')
    expect(sendEdge && runState.edges[sendEdge.id]).toBe('skipped')
  })

  it('marks a waiting node with its question and deadline, tool approvals too', () => {
    const events = [...beforeLoop, node('node_progress', 'for_each_place', { name: 'iteration_next', data: { index: 0, total: 1 } }), node('node_started', 'approve_message', inItem(0)), node('node_paused', 'approve_message', inItem(0)), { type: 'run_paused' }]
    const expiring = approvalFor('approve_message', { expiresAt: '2026-11-21T12:00:00Z' })
    const runState = buildRunCanvasState(graph, records(events), [expiring])
    expect(runState.nodes.approve_message).toMatchObject({ status: 'waiting', approval: expiring })
    expect(runState.nodes.for_each_place.status).toBe('waiting')

    const toolApproval = approvalFor('write_message', { kind: 'toolCall', toolCall: { callId: 'call-1', name: 'search', provider: 'mcp', tool: 'search', arguments: {}, reason: null } })
    const toolEvents = [...beforeLoop, node('node_started', 'write_message', inItem(0)), node('node_paused', 'write_message', inItem(0))]
    expect(buildRunCanvasState(graph, records(toolEvents), [toolApproval]).nodes.write_message.approval).toBe(toolApproval)
  })

  it('shows the attempts of a failed step with retries', () => {
    const retried = updateGraphNode(graph, 'search_maps', { retry: { maxRetries: 2, intervalMs: 1000, backoff: 2 } })
    const events = [
      ...beforeLoop.slice(0, 3),
      node('node_started', 'search_maps', { attempt: 1 }),
      node('node_retry', 'search_maps', { attempt: 1, error: 'timeout' }),
      node('node_started', 'search_maps', { attempt: 2 }),
      node('node_retry', 'search_maps', { attempt: 2, error: 'timeout' }),
      node('node_started', 'search_maps', { attempt: 3 }),
      node('node_failed', 'search_maps', { error: 'The service took too long to answer', handled: false }),
      { type: 'run_failed', error: 'timeout' },
    ]
    const runState = buildRunCanvasState(retried, records(events))
    expect(runState.nodes.search_maps).toMatchObject({ status: 'failed', attempt: 3, maxAttempts: 3, errorMessage: 'The service took too long to answer' })
  })

  it('lights the error path of a handled failure and skips the success path', () => {
    let withErrorPath = updateGraphNode(graph, 'search_maps', { onError: { strategy: 'fail-branch', values: {} } })
    withErrorPath = { ...withErrorPath, edges: [...withErrorPath.edges, { id: 'search-error', documentId: null, source: 'search_maps', sourceHandle: 'fail-branch', target: 'end', unused: false }] }
    const events = [...beforeLoop.slice(0, 4), node('node_failed', 'search_maps', { error: 'blocked', handled: true, outputs: { error_message: 'blocked', error_type: 'http' } }), node('node_skipped', 'for_each_place'), node('node_started', 'end')]
    const runState = buildRunCanvasState(withErrorPath, records(events))

    expect(runState.nodes.search_maps.status).toBe('error-path')
    expect(runState.edges['search-error']).toBe('error-taken')
    expect(runState.edges['search_maps-for_each_place-1']).toBe('skipped')
    expect(runState.handledErrorCount).toBe(1)
  })

  it('says a step continued with its fallback values', () => {
    const withFallback = updateGraphNode(graph, 'search_maps', { onError: { strategy: 'default-value', values: { places_found: 0 } } })
    const events = [...beforeLoop.slice(0, 4), node('node_failed', 'search_maps', { error: 'no credit', handled: true, outputs: { places_found: 0, error_message: 'no credit' } }), node('node_started', 'for_each_place')]
    const runState = buildRunCanvasState(withFallback, records(events))
    expect(runState.nodes.search_maps.status).toBe('fallback')
    expect(runState.edges['search_maps-for_each_place-1']).toBe('taken')
    // A run of an older version: the event's fallback outputs tell, whatever the node says now.
    expect(buildRunCanvasState(graph, records(events)).nodes.search_maps.status).toBe('fallback')
  })
})
