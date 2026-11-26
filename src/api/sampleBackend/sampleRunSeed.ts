import type { GraphrtEvent, Run, RunStatus, RunTrigger } from '../types'
import { runRecords } from '@/api/sampleBackend/fixtures/runRecords'
import { sampleMapsLeadsVisuals } from '@/api/sampleBackend/fixtures/sampleVisualOutputs'
import type { RunRecord } from '@/pages/runs/runRecordTypes'

/**
 * Seed history for the sample runs backend, built from the Runs screen (20) mock data.
 *
 * Times are placed relative to "now" so that, opened at 13:41:04, the list reads exactly like the
 * mockup (13:40, 09:00, Yesterday 07:00 …). Each seeded run gets a graphrt-like event log: node events
 * per step (with `title` and `detail` for display) and `log` events for the raw runner log.
 */

/** Agent ids of the agents named in the mock run history. */
export const sampleAgentIdsByName: Record<string, string> = {
  'Lead tracker': 'lead-tracker',
  'Maps leads to WhatsApp': 'maps-leads',
  'Catering assistant': 'catering-assistant',
  'Morning email digest': 'morning-digest',
}

interface RunSeedTiming {
  /** "HH:MM:SS" clock time the run started at. */
  startClock: string
  daysAgo: number
  /** Omitted for runs still running or paused. */
  durationSeconds?: number
  aiCostUsd?: number
  /** Numeric run outputs (the run output convention's counters), e.g. `messages_sent`. */
  counters?: Record<string, number>
  /** UI blocks among the outputs (cards, charts, KPI tiles). */
  visuals?: Record<string, unknown>
  trigger: RunTrigger
}

const seedTimingsByRunId: Record<string, RunSeedTiming> = {
  'lead-tracker-1340': { startClock: '13:40:00', daysAgo: 0, trigger: 'manual' },
  'maps-leads-0900': {
    startClock: '09:00:00',
    daysAgo: 0,
    durationSeconds: 47 * 60 + 12,
    aiCostUsd: 0.05,
    counters: { places_found: 15, messages_sent: 11 },
    visuals: sampleMapsLeadsVisuals,
    trigger: 'schedule',
  },
  'catering-assistant-0852': { startClock: '08:52:10', daysAgo: 0, trigger: 'manual' },
  'morning-digest-0700': { startClock: '07:00:00', daysAgo: 0, durationSeconds: 22, aiCostUsd: 0.01, counters: { emails_summarized: 8 }, trigger: 'schedule' },
  'morning-digest-yesterday': { startClock: '07:00:00', daysAgo: 1, durationSeconds: 3, trigger: 'schedule' },
  'maps-leads-test': {
    startClock: '13:03:00',
    daysAgo: 1,
    durationSeconds: 9,
    aiCostUsd: 0.01,
    counters: { places_found: 18, messages_sent: 1 },
    trigger: 'test',
  },
}

/** Clock time "now" stands for in the mockup. */
const mockupNowClock = '13:41:04'
const secondMs = 1000
const dayMs = 24 * 60 * 60 * secondMs

const runStatusByRecordStatus: Record<RunRecord['status'], RunStatus> = {
  running: 'running',
  done: 'succeeded',
  needsYou: 'paused',
  failed: 'failed',
  stopped: 'aborted',
}

function parseClockSeconds(clock: string): number {
  const [hours, minutes, seconds = 0] = clock.split(':').map(Number)
  return hours * 3600 + minutes * 60 + seconds
}

function toNodeId(stepLabel: string): string {
  return stepLabel
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '')
}

export interface SeededRun {
  run: Run
  /** Events with their time, oldest first. */
  events: Array<{ event: GraphrtEvent; createdAt: string }>
}

function buildStepEvents(record: RunRecord, status: RunStatus, startMs: number, endMs: number) {
  const stepGapMs = (endMs - startMs) / (record.steps.length + 1)
  return record.steps.flatMap((step, stepIndex) => {
    const nodeId = toNodeId(step.label)
    const startedAtMs = startMs + stepGapMs * stepIndex + secondMs
    const finishedAtMs = startMs + stepGapMs * (stepIndex + 1)
    const unfinishedType = status === 'failed' ? 'node_failed' : status === 'paused' ? 'node_paused' : 'node_progress'
    const finishType = step.isDone ? 'node_succeeded' : unfinishedType
    return [
      { atMs: startedAtMs, event: { type: 'node_started', node_id: nodeId, title: step.label } },
      { atMs: finishedAtMs, event: { type: finishType, node_id: nodeId, title: step.label, detail: step.detail } },
    ]
  })
}

function buildLogEvents(record: RunRecord, startMs: number, startClock: string) {
  return record.rawLog.map((logLine) => {
    const [lineClock, ...messageWords] = logLine.split(' ')
    const offsetSeconds = parseClockSeconds(lineClock) - parseClockSeconds(startClock)
    return { atMs: startMs + offsetSeconds * secondMs, event: { type: 'log', message: messageWords.join(' ') } }
  })
}

const terminalEventTypeByStatus: Partial<Record<RunStatus, string>> = {
  succeeded: 'run_succeeded',
  failed: 'run_failed',
  paused: 'run_paused',
}

function buildSeededRun(record: RunRecord, nowMs: number): SeededRun {
  const timing = seedTimingsByRunId[record.id]
  const status = runStatusByRecordStatus[record.status]
  const startMs = nowMs - (parseClockSeconds(mockupNowClock) - parseClockSeconds(timing.startClock)) * secondMs - timing.daysAgo * dayMs
  const finishedMs = timing.durationSeconds === undefined ? null : startMs + timing.durationSeconds * secondMs
  const lastEventMs = finishedMs ?? nowMs - secondMs
  const terminalEventType = terminalEventTypeByStatus[status]
  const timedEvents = [
    { atMs: startMs, event: { type: 'run_started' } },
    ...buildStepEvents(record, status, startMs, lastEventMs),
    ...buildLogEvents(record, startMs, timing.startClock),
    ...(terminalEventType ? [{ atMs: lastEventMs, event: { type: terminalEventType } }] : []),
  ].sort((first, second) => first.atMs - second.atMs)

  const pausedStep = record.steps.find((step) => !step.isDone)
  const run: Run = {
    id: record.id,
    agentId: sampleAgentIdsByName[record.agentName] ?? toNodeId(record.agentName),
    agentVersion: 1,
    trigger: timing.trigger,
    status,
    startedAt: new Date(startMs).toISOString(),
    finishedAt: finishedMs === null ? null : new Date(finishedMs).toISOString(),
    outputs: {
      summary: record.result,
      ...timing.counters,
      ...timing.visuals,
      message: record.output,
      ...(timing.aiCostUsd === undefined ? {} : { aiCostUsd: timing.aiCostUsd }),
    },
    errorMessage: status === 'failed' ? record.output : null,
    pauseReasons:
      status === 'paused' && pausedStep
        ? [{ node_id: toNodeId(pausedStep.label), kind: 'human_input', data: { question: record.output } }]
        : null,
  }
  return { run, events: timedEvents.map(({ atMs, event }) => ({ event, createdAt: new Date(atMs).toISOString() })) }
}

/** The Runs screen history as backend runs with event logs, anchored at `nowMs`. */
export function buildSeededRuns(nowMs: number): SeededRun[] {
  return runRecords.map((record) => buildSeededRun(record, nowMs))
}
