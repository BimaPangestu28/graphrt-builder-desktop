import { sampleSpendingLimit } from './abilities'
import type { UiBlock } from '@/components/visuals/uiBlockTypes'
import type { AgentRunStats, ApprovalCounts, RunCounter, RunSummary, StepCounts, TokenUsage } from '../runSummaryTypes'
import type { GraphrtEvent, Run } from '../types'
import { sampleAgentsBackend } from './agents'
import { sampleRunsBackend } from './runs'

/**
 * Run summaries for the browser preview and tests, derived from the sample runs backend
 * the same way `src-tauri/src/run_summary.rs` derives them from stored runs and events.
 */

const bookkeepingNodeKinds = new Set(['start', 'end', 'iteration-start', 'loop-start', 'loop-end'])
const containerNodeKinds = new Set(['iteration', 'loop'])
const decliningActionIds = ['skip', 'reject', 'cancel', 'decline', 'deny', 'no', 'stop', 'ignore', 'discard']
const statsWindowMs = 7 * 24 * 60 * 60 * 1000

interface EventTally {
  steps: StepCounts
  approvals: ApprovalCounts
  usage: TokenUsage
}

function readText(source: Record<string, unknown>, field: string): string | null {
  const fieldValue = source[field]
  return typeof fieldValue === 'string' ? fieldValue : null
}

function readTokenCount(usage: Record<string, unknown>, field: string): number {
  const tokenCount = usage[field]
  return typeof tokenCount === 'number' && Number.isFinite(tokenCount) ? tokenCount : 0
}

function isDecliningAction(action: string): boolean {
  const normalizedAction = action.trim().toLowerCase()
  return decliningActionIds.some((declining) => normalizedAction === declining || normalizedAction.startsWith(`${declining}_`))
}

function readApprovalAction(event: GraphrtEvent): string | null {
  const outputs = event.outputs
  if (outputs && typeof outputs === 'object') {
    const action = readText(outputs as Record<string, unknown>, 'action')
    if (action) return action
  }
  return readText(event, 'branch')
}

/** Counts steps, approvals and token usage from a run's events, like the Rust `EventTally`. */
function tallyEvents(events: GraphrtEvent[]): EventTally {
  const tally: EventTally = {
    steps: { succeeded: 0, failed: 0, skipped: 0 },
    approvals: { approved: 0, skipped: 0, waiting: 0 },
    usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
  }
  const kindsByExecId = new Map<string, string>()
  const kindsByNodeId = new Map<string, string>()
  const kindOf = (event: GraphrtEvent) => {
    const execId = readText(event, 'exec_id')
    return (execId ? kindsByExecId.get(execId) : undefined) ?? (event.node_id ? kindsByNodeId.get(event.node_id) : undefined) ?? null
  }
  for (const event of events) {
    const kind = event.type === 'node_started' ? null : kindOf(event)
    if (kind && bookkeepingNodeKinds.has(kind)) continue
    if (event.type === 'node_started') {
      const startedKind = readText(event, 'kind')
      const execId = readText(event, 'exec_id')
      if (startedKind && execId) kindsByExecId.set(execId, startedKind)
      if (startedKind && event.node_id) kindsByNodeId.set(event.node_id, startedKind)
    } else if (event.type === 'node_failed') {
      tally.steps.failed += 1
    } else if (event.type === 'node_skipped') {
      tally.steps.skipped += 1
      // The scripted sample marks a skipped approval as skipped instead of answering it.
      if (kind === 'human-input') tally.approvals.skipped += 1
    } else if (event.type === 'node_succeeded') {
      tally.steps.succeeded += 1
      if (kind === 'human-input') {
        const action = readApprovalAction(event)
        if (action) tally.approvals[isDecliningAction(action) ? 'skipped' : 'approved'] += 1
      }
      const usage = event.usage
      if (!(kind && containerNodeKinds.has(kind)) && usage && typeof usage === 'object') {
        const usageFields = usage as Record<string, unknown>
        tally.usage.promptTokens += readTokenCount(usageFields, 'prompt_tokens')
        tally.usage.completionTokens += readTokenCount(usageFields, 'completion_tokens')
        tally.usage.totalTokens += readTokenCount(usageFields, 'total_tokens')
      }
    }
  }
  return tally
}

function readCounters(outputs: Record<string, unknown> | null): RunCounter[] {
  return Object.entries(outputs ?? {}).flatMap(([name, outputValue]) =>
    typeof outputValue === 'number' && Number.isFinite(outputValue) ? [{ name, value: outputValue }] : [],
  )
}

function readItems(outputs: Record<string, unknown> | null): Array<Record<string, unknown>> {
  const rawItems = outputs?.items
  if (!Array.isArray(rawItems)) return []
  return rawItems.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object' && !Array.isArray(item))
}

function readHeadline(outputs: Record<string, unknown> | null): string | null {
  const summary = outputs?.summary
  return typeof summary === 'string' && summary.trim().length > 0 ? summary.trim() : null
}

function countWaitingApprovals(run: Run): number {
  if (run.status !== 'paused') return 0
  return (run.pauseReasons ?? []).filter((reason) => reason.kind === 'human_input').length
}

function measureDurationMs(run: Run): number | null {
  if (!run.finishedAt) return null
  return Math.max(0, new Date(run.finishedAt).getTime() - new Date(run.startedAt).getTime())
}

/**
 * UI blocks among the run's outputs (top-level values, or arrays of them). The browser preview cannot run
 * graphrt-ui, so it trusts its own fixtures; the desktop backend validates every block.
 */
function readSampleVisuals(outputs: Record<string, unknown> | null): Pick<RunSummary, 'visuals' | 'rejectedVisuals'> {
  const values = Object.values(outputs ?? {}).flatMap((value) => (Array.isArray(value) ? value : [value]))
  const blocks = values.filter((value): value is UiBlock => Boolean(value) && typeof value === 'object' && typeof (value as { $ui?: unknown }).$ui === 'string')
  return { visuals: blocks.map((block, index) => ({ id: `output-${index}`, nodeId: null, kind: block.$ui, block })), rejectedVisuals: [] }
}

/**
 * Builds a run summary from a run and its events (pure; mirrors `summarize_run` in Rust).
 *
 * @param run - The stored run (Run)
 * @param events - Its graphrt events, oldest first (GraphrtEvent[])
 * @returns The summary (RunSummary)
 */
export function summarizeSampleRun(run: Run, events: GraphrtEvent[]): RunSummary {
  const tally = tallyEvents(events)
  return {
    runId: run.id,
    agentId: run.agentId,
    status: run.status,
    startedAt: run.startedAt,
    finishedAt: run.finishedAt,
    durationMs: measureDurationMs(run),
    steps: tally.steps,
    approvals: { ...tally.approvals, waiting: countWaitingApprovals(run) },
    usage: tally.usage.totalTokens > 0 || tally.usage.promptTokens > 0 ? tally.usage : null,
    headline: readHeadline(run.outputs),
    items: readItems(run.outputs),
    counters: readCounters(run.outputs),
    ...readSampleVisuals(run.outputs),
    // The browser preview has no files on disk to point at.
    files: [],
    errorMessage: run.errorMessage,
    budget: { tokensUsed: tally.usage.totalTokens, estimatedCostMicros: null, limit: sampleSpendingLimit(run.agentId), limitReached: false },
    budgetUnavailable: false,
  }
}

function addCounters(totals: RunCounter[], counters: RunCounter[]): RunCounter[] {
  return counters.reduce((summed, counter) => {
    const existing = summed.find((total) => total.name === counter.name)
    if (!existing) return [...summed, { ...counter }]
    return summed.map((total) => (total === existing ? { ...total, value: total.value + counter.value } : total))
  }, totals)
}

/**
 * Weekly stats of one agent from its runs (newest first), mirroring `build_agent_stats` in Rust.
 *
 * @param agentId - The agent (string)
 * @param agentRuns - All of its runs, newest first (Run[])
 * @param nowMs - End of the 7-day window (number)
 */
export function buildSampleAgentRunStats(agentId: string, agentRuns: Run[], nowMs: number): AgentRunStats {
  const weekRuns = agentRuns.filter((run) => new Date(run.startedAt).getTime() >= nowMs - statsWindowMs)
  const countStatus = (status: Run['status']) => weekRuns.filter((run) => run.status === status).length
  const latestRun = agentRuns[0] ?? null
  return {
    agentId,
    runsThisWeek: weekRuns.length,
    succeeded: countStatus('succeeded'),
    failed: countStatus('failed'),
    paused: countStatus('paused'),
    lastRunStatus: latestRun?.status ?? null,
    lastRunAt: latestRun?.startedAt ?? null,
    counters: weekRuns.reduce((totals, run) => addCounters(totals, readCounters(run.outputs)), [] as RunCounter[]),
  }
}

export const sampleRunSummaryBackend = {
  getRunSummary: async (runId: string): Promise<RunSummary> => {
    const run = await sampleRunsBackend.getRun(runId)
    const records = await sampleRunsBackend.listRunEvents(runId)
    return summarizeSampleRun(run, records.map((record) => record.event))
  },

  listAgentRunStats: async (agentId?: string): Promise<AgentRunStats[]> => {
    const agentIds = agentId ? [(await sampleAgentsBackend.getAgent(agentId)).id] : (await sampleAgentsBackend.listAgents()).map((agent) => agent.id)
    const runs = await sampleRunsBackend.listRuns({ agentId })
    const nowMs = Date.now()
    return agentIds.map((id) => buildSampleAgentRunStats(id, runs.filter((run) => run.agentId === id), nowMs))
  },
}
