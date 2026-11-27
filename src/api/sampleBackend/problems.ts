import { BackendError } from '../client'
import type { FailedRunReport, Problem, ProblemAction } from '../problemTypes'
import type { Run } from '../types'
import { respondWith } from './sampleResponse'

/**
 * Sample problems for the browser preview and tests (screen 23 of the design): the failed
 * Morning email digest run plus four other recoverable problems.
 */

export const sampleFailedRunId = 'morning-digest-yesterday'
const sampleFailedAgentId = 'morning-digest'

function action(kind: ProblemAction['kind'], label: string, ids: Partial<Pick<ProblemAction, 'agentId' | 'runId'>> = {}): ProblemAction {
  return { kind, label, agentId: ids.agentId ?? null, runId: ids.runId ?? null }
}

const sampleFailedRunReport: FailedRunReport = {
  runId: sampleFailedRunId,
  agentId: sampleFailedAgentId,
  agentName: 'Morning email digest',
  status: 'failed',
  startedAt: '2026-11-17T00:00:00Z',
  title: 'Could not read your email',
  explanation: 'Google signed graphrt out of Gmail, which happens every few months. Nothing was sent and nothing was lost',
  fixSteps: ['Sign in to Gmail again, it takes a few seconds', 'Run the missed digest now, or wait for tomorrow 07:00'],
  fixAction: action('open_connections', 'Reconnect Gmail'),
  steps: [
    { id: 'start', name: 'Start', state: 'done', note: null },
    { id: 'read_emails', name: 'Read new emails', state: 'failed', note: 'Failed after 3 tries' },
    { id: 'summarize', name: 'Summarize', state: 'pending', note: null },
    { id: 'send_telegram', name: 'Send to Telegram', state: 'pending', note: null },
  ],
  failedStepId: 'read_emails',
  technicalDetails: [
    'node: read_emails (mcp gmail/list_messages)',
    'error: auth_expired · 401 invalid_grant',
    'retries: 2',
    'resume: not possible, graphrt keeps no snapshot of a failed run; a retry starts a new run',
  ].join('\n'),
  retry: { canRetry: true, reason: null },
}

const sampleProblems: Problem[] = [
  {
    id: `failed_run:${sampleFailedRunId}`,
    kind: 'failed_run',
    title: sampleFailedRunReport.title,
    detail: sampleFailedRunReport.explanation,
    needsAttention: false,
    agentId: sampleFailedAgentId,
    agentName: sampleFailedRunReport.agentName,
    runId: sampleFailedRunId,
    occurredAt: sampleFailedRunReport.startedAt,
    actions: [
      action('open_run', 'See what happened', { agentId: sampleFailedAgentId, runId: sampleFailedRunId }),
      action('retry_run', 'Retry from the start', { agentId: sampleFailedAgentId, runId: sampleFailedRunId }),
    ],
  },
  {
    id: 'missing_credentials:maps-leads',
    kind: 'missing_credentials',
    title: 'WhatsApp was logged out',
    detail: 'Your phone removed this computer from linked devices. 4 approved messages are waiting and will send once you reconnect',
    needsAttention: true,
    agentId: 'maps-leads',
    agentName: 'Maps leads to WhatsApp',
    runId: null,
    occurredAt: null,
    actions: [action('open_plugins', 'Scan QR again')],
  },
  {
    id: 'missing_credentials:catering-assistant',
    kind: 'missing_credentials',
    title: 'OpenAI ran out of credit',
    detail: 'Catering assistant switched to Ollama on this computer, so customers still get answers. Replies may be slower',
    needsAttention: true,
    agentId: 'catering-assistant',
    agentName: 'Catering assistant',
    runId: null,
    occurredAt: null,
    actions: [action('open_connections', 'Add credit')],
  },
  {
    id: 'schedule_failing:maps-leads',
    kind: 'schedule_failing',
    title: 'The computer was asleep at 09:00',
    detail: 'Maps leads to WhatsApp ran at 09:42 when it woke up, as your schedule rules say',
    needsAttention: false,
    agentId: 'maps-leads',
    agentName: 'Maps leads to WhatsApp',
    runId: null,
    occurredAt: null,
    actions: [action('open_schedule', 'Change schedule rules', { agentId: 'maps-leads' })],
  },
  {
    id: 'failed_run:maps-leads-timeout',
    kind: 'failed_run',
    title: 'A step kept timing out',
    detail: 'Search Google Maps took longer than 10s three times. The agent stopped before sending anything',
    needsAttention: false,
    agentId: 'maps-leads',
    agentName: 'Maps leads to WhatsApp',
    runId: null,
    occurredAt: null,
    actions: [action('open_builder', 'Ask chat to fix this step', { agentId: 'maps-leads' })],
  },
]

let retryCount = 0

/** Starts the sample over (tests). */
export function resetSampleProblems(): void {
  retryCount = 0
}

function buildRetriedRun(runId: string): Run {
  if (runId !== sampleFailedRunId) throw new BackendError('not_found', `run ${runId} not found`)
  retryCount += 1
  return {
    id: `sample-retry-${retryCount}`,
    agentId: sampleFailedAgentId,
    agentVersion: 1,
    trigger: 'manual',
    status: 'running',
    startedAt: new Date().toISOString(),
    finishedAt: null,
    outputs: null,
    errorMessage: null,
    errorType: null,
    pauseReasons: null,
  }
}

export const sampleProblemsBackend = {
  listProblems: (): Promise<Problem[]> => respondWith(() => sampleProblems.map((problem) => ({ ...problem }))),
  getFailedRunReport: (runId: string): Promise<FailedRunReport> =>
    respondWith(() => {
      if (runId !== sampleFailedRunId) throw new BackendError('not_found', `run ${runId} not found`)
      return { ...sampleFailedRunReport }
    }),
  retryRun: (runId: string): Promise<Run> => respondWith(() => buildRetriedRun(runId)),
}
