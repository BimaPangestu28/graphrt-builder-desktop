import type { FlowSummary, Run, RunEventRecord } from '@/api/types'
import { humanizeRunError } from '@/pages/agent-run/runErrorText'
import { buildRunNarration } from '@/pages/agent-run/runNarration'
import { formatDurationMs, formatElapsedClock, toRunStepTemplate } from '@/pages/agent-run/runProgress'
import { buildRunStepViews } from '@/pages/agent-run/runSteps'
import { describeIterationMeta } from '@/pages/agent-run/StepProgressList'
import { describeValue } from '@/pages/agent-run/stepValueSummary'
import { buildRunHeaderMeta, buildSidebarRunStatus } from '@/pages/agent-run/testRunHeader'

const businessNames = ['Kopi Tuku', 'Janji Jiwa', 'Kopi Kenangan', 'Fore', 'Point Coffee', 'Excelso', 'Anomali', 'Tanamera', 'Kopi Soe', 'Lain Hati']

/** The real flow summary of a "promote to businesses" agent, bookkeeping nodes included. */
const flowSummary: FlowSummary = {
  steps: [
    { id: 'start', nodeType: 'start', title: 'Start', detail: '', needsApproval: false, depth: 0 },
    { id: 'find_businesses', nodeType: 'http-request', title: 'Find businesses on Google Maps', detail: 'GET maps.example.com', needsApproval: false, depth: 0 },
    { id: 'each_business', nodeType: 'iteration', title: 'For each business', detail: 'over find_businesses.body.places', needsApproval: false, depth: 0 },
    { id: 'each_business_start', nodeType: 'iteration-start', title: 'Iteration Start', detail: '', needsApproval: false, depth: 1 },
    { id: 'write_message', nodeType: 'llm', title: 'Write the message', detail: '', needsApproval: false, depth: 1 },
    { id: 'approve', nodeType: 'human-input', title: 'Ask me before sending', detail: '', needsApproval: true, depth: 1 },
    { id: 'send_promotion', nodeType: 'http-request', title: 'Send the promotion message', detail: 'POST promo.example.invalid', needsApproval: false, depth: 1 },
    { id: 'end', nodeType: 'end', title: 'End', detail: '', needsApproval: false, depth: 0 },
  ],
  inputs: [],
  modelProviders: [],
  env: [],
}

const template = toRunStepTemplate(flowSummary)
const startMs = Date.parse('2026-11-18T06:00:00Z')

/** Builds graphrt events one second apart. */
function buildEventLog(eventBodies: Array<Record<string, unknown>>): RunEventRecord[] {
  return eventBodies.map((event, index) => ({
    runId: 'run-1',
    seq: index + 1,
    event: { type: String(event.type), ...event },
    createdAt: new Date(startMs + index * 1000).toISOString(),
  }))
}

const node = (type: string, nodeId: string, frame = '', fields: Record<string, unknown> = {}) => ({ type, node_id: nodeId, frame, exec_id: `${nodeId}-${frame}`, ...fields })

/** One business done (send succeeded) in `each_business[index]`. */
function completedItem(index: number) {
  const frame = `each_business[${index}]`
  return [
    node('node_progress', 'each_business', '', { name: 'iteration_next', data: { index, total: 10 } }),
    node('node_started', 'each_business_start', frame, { kind: 'iteration-start', title: 'Iteration Start', attempt: 1 }),
    node('node_succeeded', 'each_business_start', frame, { outputs: {}, elapsed_ms: 0 }),
    node('node_started', 'write_message', frame, { kind: 'llm', title: 'Write the message', attempt: 1 }),
    node('node_succeeded', 'write_message', frame, { outputs: { text: `Hi ${businessNames[index]}` }, elapsed_ms: 1500 }),
    node('node_started', 'send_promotion', frame, { kind: 'http-request', title: 'Send the promotion message', attempt: 1 }),
    node('node_succeeded', 'send_promotion', frame, { outputs: { status_code: 200 }, elapsed_ms: 300 }),
  ]
}

/** Found 10 businesses, finished two, now writing the third one's message. */
function buildRunWritingThirdMessage() {
  return buildEventLog([
    { type: 'run_started', run_id: 'run-1', resumed: false },
    node('node_started', 'start', '', { kind: 'start', title: 'Start', attempt: 1 }),
    node('node_succeeded', 'start', '', { outputs: {}, elapsed_ms: 0 }),
    node('node_started', 'find_businesses', '', { kind: 'http-request', title: 'Find businesses on Google Maps', attempt: 1 }),
    node('node_succeeded', 'find_businesses', '', { outputs: { status_code: 200, body: { places: businessNames.map((name) => ({ name, phone: '+62' })) } }, elapsed_ms: 2100 }),
    node('node_started', 'each_business', '', { kind: 'iteration', title: 'For each business', attempt: 1 }),
    ...completedItem(0),
    ...completedItem(1),
    node('node_progress', 'each_business', '', { name: 'iteration_next', data: { index: 2, total: 10 } }),
    node('node_started', 'write_message', 'each_business[2]', { kind: 'llm', title: 'Write the message', attempt: 1 }),
    node('node_chunk', 'write_message', 'each_business[2]', { field: 'text', chunk: 'Halo Kopi ' }),
    node('node_chunk', 'write_message', 'each_business[2]', { field: 'text', chunk: 'Kenangan!' }),
  ])
}

describe('run step list', () => {
  it('shows only summary steps in flow order, never bookkeeping nodes', () => {
    const events = buildRunWritingThirdMessage()
    const steps = buildRunStepViews(template, events)
    expect(steps.map((step) => [step.id, step.depth])).toEqual([
      ['find_businesses', 0],
      ['each_business', 0],
      ['write_message', 1],
      ['approve', 1],
      ['send_promotion', 1],
    ])
  })

  it('shows "3 of 10" with the current business and the body steps for that business', () => {
    const steps = buildRunStepViews(template, buildRunWritingThirdMessage())
    const [findStep, iterationStep, writeStep, approveStep, sendStep] = steps
    expect(findStep).toMatchObject({ state: 'done', durationMs: 2100 })
    expect(iterationStep.iteration).toEqual({ currentNumber: 3, total: 10, doneCount: 2, currentItemLabel: 'Kopi Kenangan', isLoop: false })
    expect(describeIterationMeta(iterationStep)).toBe('3 of 10 · Kopi Kenangan')
    expect(writeStep).toMatchObject({ state: 'running', streamedText: 'Halo Kopi Kenangan!', itemsDoneCount: 2, isModelStep: true, itemDescription: 'Business 3 of 10: Kopi Kenangan' })
    expect(approveStep.state).toBe('pending')
    expect(sendStep).toMatchObject({ state: 'pending', itemsDoneCount: 2 })
  })

  it('shows "3 done" for a loop, which does not know its total', () => {
    const loopTemplate = [
      { id: 'retry_loop', label: 'Keep asking', depth: 0, nodeType: 'loop' },
      { id: 'ask', label: 'Ask', depth: 1, nodeType: 'llm' },
    ]
    const events = buildEventLog([
      node('node_started', 'retry_loop', '', { kind: 'loop', attempt: 1 }),
      ...[0, 1, 2, 3].flatMap((round) => [
        node('node_progress', 'retry_loop', '', { name: 'loop_next', data: { round } }),
        node('node_started', 'ask', `retry_loop[${round}]`, { kind: 'llm', attempt: 1 }),
        ...(round < 3 ? [node('node_succeeded', 'ask', `retry_loop[${round}]`, { outputs: { text: 'no' }, elapsed_ms: 10 })] : []),
      ]),
    ])
    const [loopStep] = buildRunStepViews(loopTemplate, events)
    expect(loopStep.iteration).toMatchObject({ currentNumber: 4, total: null, doneCount: 3, isLoop: true })
    expect(describeIterationMeta(loopStep)).toBe('3 done')
  })

  it('counts retries and keeps the failed body step marked failed', () => {
    const events = buildEventLog([
      node('node_started', 'each_business', '', { kind: 'iteration', attempt: 1 }),
      node('node_progress', 'each_business', '', { name: 'iteration_next', data: { index: 0, total: 10 } }),
      node('node_started', 'send_promotion', 'each_business[0]', { kind: 'http-request', attempt: 1 }),
      node('node_retry', 'send_promotion', 'each_business[0]', { attempt: 1, error: 'timed out', delay_ms: 500 }),
      node('node_started', 'send_promotion', 'each_business[0]', { kind: 'http-request', attempt: 2 }),
      node('node_failed', 'send_promotion', 'each_business[0]', { error: 'connection: dns error', error_type: 'connection', handled: false, elapsed_ms: 40 }),
      node('node_failed', 'each_business', '', { error: 'connection: iteration item 0 failed: dns error', error_type: 'connection', handled: false, elapsed_ms: 900 }),
      { type: 'run_failed', error: 'connection: iteration item 0 failed: dns error', error_type: 'connection', elapsed_ms: 1000 },
    ])
    const steps = buildRunStepViews(template, events)
    const sendStep = steps.find((step) => step.id === 'send_promotion')
    expect(sendStep).toMatchObject({ state: 'failed', retryCount: 1, errorMessage: 'connection: dns error', durationMs: 40 })
    expect(steps.find((step) => step.id === 'each_business')?.state).toBe('failed')
  })

  it('reads steps from the events when the summary is from another version', () => {
    const events = buildEventLog([node('node_started', 'old_step', '', { kind: 'llm', title: 'Old step' }), node('node_started', 'start', '', { kind: 'start' })])
    expect(buildRunStepViews([{ id: 'new_step', label: 'New step' }], events).map((step) => step.label)).toEqual(['Old step'])
  })
})

describe('run narration', () => {
  it('reports an approval that timed out and the answer it gave', () => {
    const frame = 'each_business[0]'
    const events = buildEventLog([
      { type: 'run_started' },
      node('node_started', 'each_business', '', { kind: 'iteration' }),
      node('node_progress', 'each_business', '', { name: 'iteration_next', data: { index: 0, total: 1 } }),
      node('node_paused', 'approve', frame, { reason: { kind: 'human_input' } }),
      { type: 'run_paused', reasons: [] },
      { type: 'approval_timed_out', node_id: 'approve', frame, outcome: 'answer', action: 'skip', action_title: 'Skip' },
    ])
    const lines = buildRunNarration(template, events)
    expect(lines.some((line) => line.isApprovalLink)).toBe(false)
    expect(lines.at(-1)?.text).toMatch(/imed out → Skip$/)

    const stopped = buildEventLog([{ type: 'run_started' }, { type: 'approval_timed_out', node_id: 'approve', frame: '', outcome: 'stop' }])
    expect(buildRunNarration(template, stopped).at(-1)?.text).toBe('Ask me before sending: timed out → stopped the run')
  })

  it('says when an agent waits for a tool approval', () => {
    const events = buildEventLog([{ type: 'run_started' }, node('node_paused', 'write_message', '', { reason: { kind: 'tool_approval' } })])
    expect(buildRunNarration(template, events).find((line) => line.isApprovalLink)?.text).toBe('Waiting for your OK to use a tool')
  })

  it('says what was found and one line per business', () => {
    const lines = buildRunNarration(template, buildRunWritingThirdMessage()).map((line) => line.text)
    expect(lines).toEqual([
      'Find businesses on Google Maps: found 10 places',
      'Business 1 of 10: Kopi Tuku — done',
      'Business 2 of 10: Janji Jiwa — done',
      'Business 3 of 10: Kopi Kenangan — write the message…',
    ])
  })

  it('links to the approval while waiting, then reports the answer and the finish', () => {
    const frame = 'each_business[0]'
    const pausedEvents = buildEventLog([
      { type: 'run_started' },
      node('node_started', 'each_business', '', { kind: 'iteration' }),
      node('node_progress', 'each_business', '', { name: 'iteration_next', data: { index: 0, total: 1 } }),
      node('node_started', 'approve', frame, { kind: 'human-input' }),
      node('node_paused', 'approve', frame, { reason: { kind: 'human_input' } }),
      { type: 'run_paused', reasons: [] },
    ])
    const waitingLine = buildRunNarration(template, pausedEvents).find((line) => line.isApprovalLink)
    expect(waitingLine).toMatchObject({ text: 'Waiting for your approval', tone: 'amber' })

    const finishedEvents = buildEventLog([
      ...pausedEvents.map(({ event }) => event),
      { type: 'run_started', resumed: true },
      node('node_succeeded', 'approve', frame, { outputs: { action: 'approve' }, branch: 'approve', elapsed_ms: 0 }),
      node('node_succeeded', 'each_business', '', { outputs: { output: [null] }, elapsed_ms: 5000 }),
      { type: 'run_succeeded', outputs: {}, elapsed_ms: 72_000 },
    ])
    const lines = buildRunNarration(template, finishedEvents)
    expect(lines.map((line) => line.text)).toEqual(['Business 1 of 1 — done', 'You answered: approve', 'For each business: all 1 done', 'Finished in 1m 12s'])
    expect(lines.some((line) => line.isApprovalLink)).toBe(false)
  })

  it('names the failed step and item in plain words, raw error kept', () => {
    const rawError = 'connection: error sending request: client error (Connect): dns error: failed to lookup address information: nodename nor servname provided, or not known'
    const events = buildEventLog([
      node('node_succeeded', 'find_businesses', '', { outputs: { body: { places: businessNames.map((name) => ({ name })) } } }),
      node('node_started', 'each_business', '', { kind: 'iteration' }),
      node('node_progress', 'each_business', '', { name: 'iteration_next', data: { index: 0, total: 10 } }),
      node('node_started', 'send_promotion', 'each_business[0]', { kind: 'http-request' }),
      node('node_failed', 'send_promotion', 'each_business[0]', { error: rawError, handled: false }),
      node('node_failed', 'each_business', '', { error: `connection: iteration item 0 failed: ${rawError}`, handled: false }),
      { type: 'run_failed', error: `connection: iteration item 0 failed: ${rawError}` },
    ])
    const lastLine = buildRunNarration(template, events).at(-1)
    expect(lastLine).toMatchObject({
      text: "Failed at Send the promotion message (Business 1 of 10: Kopi Tuku): Could not reach promo.example.invalid: that address doesn't exist",
      tone: 'danger',
      rawError,
    })
  })
})

describe('run error text', () => {
  it('explains DNS, refused, timeout and HTTP status errors', () => {
    const dnsError = humanizeRunError('connection: iteration item 3 failed: error sending request for url (https://api.example.invalid/send): dns error: failed to lookup address information')
    expect(dnsError).toMatchObject({ summary: "Could not reach api.example.invalid: that address doesn't exist", itemIndex: 3 })
    expect(humanizeRunError('connection: tcp connect error: Connection refused (os error 61)', 'POST localhost:8080').summary).toBe(
      'The server refused the connection. Is the service running?',
    )
    expect(humanizeRunError('timeout: operation timed out', 'GET slow.example.com').summary).toBe('slow.example.com took too long to answer')
    expect(humanizeRunError('http: server returned status 401 Unauthorized').summary).toMatch(/rejected the sign-in \(401\)/)
    expect(humanizeRunError('http: server returned status 429').summary).toMatch(/too many requests/)
    expect(humanizeRunError('http: server returned status 503', 'POST api.example.com').summary).toBe('api.example.com had a problem on its side (503). Try again later')
    expect(humanizeRunError('model: the prompt is too long').summary).toBe('The prompt is too long')
  })
})

describe('run header and value summaries', () => {
  const run: Run = {
    id: 'run-1',
    agentId: 'promo',
    agentVersion: 1,
    trigger: 'test',
    status: 'running',
    startedAt: new Date(startMs).toISOString(),
    finishedAt: null,
    outputs: null,
    errorMessage: null,
    pauseReasons: null,
  }

  it('ticks elapsed time and counts top-level steps', () => {
    const steps = buildRunStepViews(template, buildRunWritingThirdMessage())
    expect(buildRunHeaderMeta(run, steps, startMs + 42_000)).toBe('Running · 0:42 · 1 of 2 steps done')
    expect(buildRunHeaderMeta({ ...run, status: 'failed', finishedAt: new Date(startMs + 72_000).toISOString() }, steps, startMs + 99_000)).toBe(
      'Failed after 1m 12s · 1 of 2 steps done',
    )
    expect(buildSidebarRunStatus({ ...run, status: 'failed' })).toEqual({ status: 'Test failed', statusTone: 'danger' })
  })

  it('formats durations and summarizes lists', () => {
    expect(formatDurationMs(2400)).toBe('2.4s')
    expect(formatElapsedClock(3_723_000)).toBe('1:02:03')
    expect(describeValue(businessNames.map((name) => ({ name })))).toBe('10 items\n• Kopi Tuku\n• Janji Jiwa\n• Kopi Kenangan\n… and 7 more')
  })
})
