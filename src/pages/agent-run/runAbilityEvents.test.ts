import type { GraphrtEvent, RunEventRecord } from '@/api/types'
import { buildRunNarration } from './runNarration'
import { collectNodeTracks } from './runNodeTracks'
import { buildHelperTree, isHelperFrame, readAbilityNotes, readRunEnd, settleHelperStatuses } from './runAbilityEvents'
import type { RunStepTemplate } from './runProgress'

let seq = 0
function record(event: GraphrtEvent): RunEventRecord {
  seq += 1
  return { runId: 'run-1', seq, event, createdAt: new Date(Date.UTC(2026, 10, 28, 9, 0, seq)).toISOString() }
}

const helperId = '3f2a9c1e-77aa-4b1e-9d1f-0c3b2a1d4e5f'
const helperFrame = `assistant.${helperId}[0]`
const progress = (name: string, data: unknown, frame = '', nodeId = 'assistant') => record({ type: 'node_progress', frame, node_id: nodeId, exec_id: 'e1', name, data })

describe('helper frames', () => {
  it('tells a helper agent frame from a loop frame', () => {
    expect(isHelperFrame('')).toBe(false)
    expect(isHelperFrame('each_place[3]')).toBe(false)
    expect(isHelperFrame(helperFrame)).toBe(true)
    expect(isHelperFrame(`each_place[1]/${helperFrame}/inner[0]`)).toBe(true)
  })
})

describe('ability notes of a step', () => {
  it('sums each kind into one plain line and flags what needs the owner', () => {
    const events = [
      record({ type: 'node_started', frame: '', node_id: 'assistant', exec_id: 'e1', kind: 'agent' }),
      progress('context_trimmed', { reason: 'provider_limit', removed_messages: 9, summarized: true, fits: true }),
      progress('context_trimmed', { reason: 'budget', removed_messages: 5, summarized: false, fits: true }),
      progress('memory_recalled', { count: 2, auto: true }),
      progress('memory_saved', { id: 'm1', status: 'active', trust: 'user_stated' }),
      progress('memory_saved', { id: 'm2', status: 'pending', trust: 'tool_derived' }),
      progress('budget', { iteration: 4, final_turn: true }),
      progress('budget', { price_missing: 'openai/gpt-9' }),
      progress('checkpoint_restored', { iteration: 3 }),
      progress('tool_interrupted', { id: 'c2', name: 'crm/create_order' }),
    ]
    const execution = collectNodeTracks(events).get('assistant')?.executionsByFrame.get('')
    expect(execution).toBeDefined()
    const notes = readAbilityNotes(execution!)
    expect(notes.map((note) => [note.kind, note.text, note.isWarning])).toEqual([
      ['context', 'Left out 14 older messages to fit the AI model and summarized them', false],
      ['memory', 'Remembered 2 things · 1 waits for your approval · Recalled 2 notes', true],
      ['budget', 'The spending limit was close, so it gave its answer without using more tools.', true],
      ['budget', 'The app has no price for openai/gpt-9, so the money limit did not count it.', true],
      ['checkpoint', 'Picked up where it stopped instead of starting over', false],
      ['interrupted', 'crm/create_order was cut off before it finished and was not repeated', true],
    ])
  })

  it('says when the conversation still did not fit', () => {
    const events = [record({ type: 'node_started', frame: '', node_id: 'assistant', exec_id: 'e1', kind: 'agent' }), progress('context_trimmed', { removed_messages: 0, fits: false })]
    const notes = readAbilityNotes(collectNodeTracks(events).get('assistant')!.executionsByFrame.get('')!)
    expect(notes[0]).toMatchObject({ isWarning: true, text: 'Shortened older tool results to fit the AI model. The conversation was still too long after shortening.' })
  })
})

describe('helper runs', () => {
  const events = () => [
    record({ type: 'run_started' }),
    record({ type: 'node_started', frame: '', node_id: 'assistant', exec_id: 'e1', kind: 'agent' }),
    record({ type: 'node_started', frame: helperFrame, node_id: 'start', exec_id: 'c1', kind: 'start' }),
    record({ type: 'node_succeeded', frame: helperFrame, node_id: 'start', exec_id: 'c1' }),
    record({ type: 'node_started', frame: helperFrame, node_id: 'assistant', exec_id: 'c2', kind: 'agent' }),
    progress('subagent_finished', { workflow: 'nested', index: 0 }, helperFrame),
    record({ type: 'node_succeeded', frame: helperFrame, node_id: 'assistant', exec_id: 'c2', outputs: { text: 'In stock' } }),
    progress('subagent_finished', { workflow: helperId, index: 0 }),
    progress('subagent_failed', { workflow: helperId, index: 1, kind: 'no_answer' }),
    record({ type: 'node_succeeded', frame: '', node_id: 'assistant', exec_id: 'e1', outputs: { text: 'Done' } }),
    record({ type: 'run_succeeded' }),
  ]

  it('builds the tree with each helper status and its own steps', () => {
    const tree = buildHelperTree(events())
    expect(tree.map((helper) => [helper.agentId, helper.index, helper.status, helper.stepCount])).toEqual([
      [helperId, 0, 'finished', 1],
      [helperId, 1, 'failed', 0],
    ])
    expect(tree[0].children.map((child) => [child.agentId, child.status])).toEqual([['nested', 'finished']])
  })

  it("keeps a helper's steps out of the run's own steps and names it in the narration", () => {
    const tracks = collectNodeTracks(events())
    // The helper's `start` and its own `assistant` never become (or overwrite) the run's steps.
    expect([...tracks.keys()]).toEqual(['assistant'])
    expect(tracks.get('assistant')?.executionsByFrame.size).toBe(1)

    const template: RunStepTemplate[] = [{ id: 'assistant', label: 'Answer the customer', detail: null, nodeType: 'agent', depth: 0 }]
    const lines = buildRunNarration(template, events(), (agentId) => (agentId === helperId ? 'Stock checker' : null)).map((line) => line.text)
    expect(lines).toContain('Stock checker helped')
    expect(lines).toContain('Stock checker could not help')
    expect(lines.some((line) => line.startsWith('Start'))).toBe(false)
  })

  it('settles helpers that never reported back by how the run ended', () => {
    const unfinished = [record({ type: 'node_started', frame: helperFrame, node_id: 'start', exec_id: 'c1', kind: 'start' })]
    const running = buildHelperTree(unfinished)
    expect(settleHelperStatuses(running, readRunEnd(unfinished))[0].status).toBe('running')
    expect(settleHelperStatuses(running, 'stopped')[0].status).toBe('stopped')
    expect(settleHelperStatuses(running, 'succeeded')[0].status).toBe('finished')
    expect(readRunEnd([record({ type: 'run_aborted' })])).toBe('stopped')
  })
})

describe('ability lines of the narration', () => {
  const template: RunStepTemplate[] = [{ id: 'assistant', label: 'Answer the customer', detail: null, nodeType: 'agent', depth: 0 }]
  const nestedFrame = `each[1]/assistant.${helperId}[0]`

  it('says when it asked for help, a helper waits, the limit was close, and it picked up again', () => {
    const events = [
      record({ type: 'run_started' }),
      record({ type: 'node_started', frame: '', node_id: 'assistant', exec_id: 'e1', kind: 'agent' }),
      record({ type: 'node_started', frame: helperFrame, node_id: 'start', exec_id: 'c1', kind: 'start' }),
      progress('subagent_paused', { workflow: helperId, index: 0 }),
      progress('checkpoint_restored', { iteration: 2 }),
      progress('context_trimmed', { removed_messages: 3, fits: true }),
      progress('memory_saved', { id: 'm1', status: 'active' }),
      progress('budget', { iteration: 4, final_turn: true }),
    ]
    const lines = buildRunNarration(template, events, () => 'Stock checker').map((line) => [line.text, line.tone])
    expect(lines).toEqual(
      expect.arrayContaining([
        ['Stock checker waits for your approval', 'amber'],
        ['Picked up where it stopped', 'neutral'],
        ['Made room in a long conversation', 'neutral'],
        ['Remembered something for next time', 'neutral'],
        ['Close to the spending limit, so it answers with what it has', 'amber'],
      ]),
    )
  })

  it('names a helper asked inside a loop item once', () => {
    const events = [
      record({ type: 'node_started', frame: nestedFrame, node_id: 'start', exec_id: 'c1', kind: 'start' }),
      record({ type: 'node_succeeded', frame: nestedFrame, node_id: 'start', exec_id: 'c1' }),
      record({ type: 'node_started', frame: nestedFrame, node_id: 'checker', exec_id: 'c2', kind: 'agent' }),
    ]
    const lines = buildRunNarration(template, events, () => null).map((line) => line.text)
    expect(lines.filter((line) => line === 'Asked Another agent for help…')).toHaveLength(1)
  })
})
