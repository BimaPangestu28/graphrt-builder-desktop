import { routePaths } from '@/routes'

/** Mock data for screen 23 · Error states (a failed run plus other recoverable problems). */

export type FailedRunStepState = 'done' | 'failed' | 'pending'

export interface FailedRunStep {
  id: string
  name: string
  state: FailedRunStepState
  /** Short note on the right of a failed step. */
  note?: string
}

export const failedRun = {
  agentName: 'Morning email digest',
  startedAt: 'yesterday 07:00',
  title: 'Could not read your email',
  explanation: 'Google signed graphrt out of Gmail, which happens every few months. Nothing was sent and nothing was lost',
  fixSteps: ['Sign in to Gmail again, it takes a few seconds', 'Run the missed digest now, or wait for tomorrow 07:00'],
  steps: [
    { id: 'start', name: 'Start', state: 'done' },
    { id: 'read-emails', name: 'Read new emails', state: 'failed', note: 'Failed after 3 tries' },
    { id: 'summarize', name: 'Summarize', state: 'pending' },
    { id: 'send-telegram', name: 'Send to Telegram', state: 'pending' },
  ] satisfies FailedRunStep[],
  technicalDetails: [
    'node: read_emails (mcp gmail/list_messages)',
    'error: auth_expired · 401 invalid_grant',
    'retries: 3 · backoff 500ms x2',
    'snapshot: kept, resume from read_emails',
  ].join('\n'),
}

/** One action on a problem card: either navigates to another screen or dismisses the card. */
export type ProblemAction =
  | { kind: 'link'; label: string; to: string; style: 'primary' | 'secondary' | 'text' }
  | { kind: 'dismiss'; label: string; style: 'primary' | 'secondary'; resolvedMessage: string }

export interface OtherProblem {
  id: string
  title: string
  description: string
  /** Amber border marks problems still waiting on the user. */
  needsAttention: boolean
  actions: ProblemAction[]
}

export const otherProblems: OtherProblem[] = [
  {
    id: 'whatsapp-logged-out',
    title: 'WhatsApp was logged out',
    description: 'Your phone removed this Mac from linked devices. 4 approved messages are waiting and will send once you reconnect',
    needsAttention: true,
    actions: [{ kind: 'link', label: 'Scan QR again', to: routePaths.connectWhatsApp, style: 'primary' }],
  },
  {
    id: 'openai-credit',
    title: 'OpenAI ran out of credit',
    description: 'Catering assistant switched to Ollama on this Mac, so customers still get answers. Replies may be slower',
    needsAttention: true,
    actions: [
      { kind: 'link', label: 'Add credit', to: routePaths.connections, style: 'primary' },
      { kind: 'dismiss', label: 'Keep using Ollama', style: 'secondary', resolvedMessage: 'Catering assistant will keep using Ollama' },
    ],
  },
  {
    id: 'mac-asleep',
    title: 'The Mac was asleep at 09:00',
    description: 'Maps leads to WhatsApp ran at 09:42 when it woke up, as your schedule rules say',
    needsAttention: false,
    actions: [{ kind: 'link', label: 'Change schedule rules', to: routePaths.scheduleAgent, style: 'text' }],
  },
  {
    id: 'step-timeout',
    title: 'A step kept timing out',
    description: 'Search Google Maps took longer than 10s three times. The agent stopped before sending anything',
    needsAttention: false,
    actions: [{ kind: 'link', label: 'Ask chat to fix this step', to: routePaths.builder, style: 'secondary' }],
  },
]
