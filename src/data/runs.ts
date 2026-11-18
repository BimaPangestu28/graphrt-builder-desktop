import { routePaths } from '@/routes'

/**
 * Mock run history for screen 20 (Runs). Newest first, as the runner keeps them for 30 days.
 */
export type RunStatus = 'running' | 'done' | 'needsYou' | 'failed'

export interface RunStep {
  label: string
  detail: string
  isDone: boolean
}

export interface RunRecord {
  id: string
  /** Backend agent id, when the record comes from the runs API. */
  agentId?: string
  agentName: string
  startedBy: string
  when: string
  result: string
  status: RunStatus
  /** Subtitle of the detail panel: date, duration and AI cost. */
  timing: string
  steps: RunStep[]
  output: string
  rawLog: string[]
  /** Optional screen to jump to for a run that needs attention. */
  followUp?: { label: string; path: string }
}

export const runStatusLabels: Record<RunStatus, string> = {
  running: 'Running',
  done: 'Done',
  needsYou: 'Needs you',
  failed: 'Failed',
}

export const runRecords: RunRecord[] = [
  {
    id: 'lead-tracker-1340',
    agentName: 'Lead tracker',
    startedBy: 'Chain',
    when: '13:40',
    result: 'Adding row 6 of 15',
    status: 'running',
    timing: 'Today 13:40 · 1m 04s so far',
    steps: [
      { label: 'Read new leads', detail: '15 rows', isDone: true },
      { label: 'Add rows to Google Sheets', detail: '6 of 15', isDone: false },
    ],
    output: 'Still running. Rows appear in the Lead tracker sheet as they are added',
    rawLog: ['13:40:02 chain started by Leads to sales recap', '13:40:05 read 15 leads', '13:41:06 appended row 6'],
  },
  {
    id: 'maps-leads-0900',
    agentName: 'Maps leads to WhatsApp',
    startedBy: 'Schedule',
    when: '09:00',
    result: '11 sent · 1 skipped',
    status: 'done',
    timing: 'Today 09:00 · 47m 12s · $0.05 AI cost',
    steps: [
      { label: 'Search Google Maps', detail: '15 places · 1.4s', isDone: true },
      { label: 'Skip places already messaged', detail: '3 removed', isDone: true },
      { label: 'Write messages', detail: '12 · 18s', isDone: true },
      { label: 'You approved 11 of 12', detail: 'waited 31m', isDone: true },
      { label: 'Send WhatsApp', detail: '11 sent · 5m 30s', isDone: true },
    ],
    output: '11 messages sent · 2 replies so far · started chain Leads to sales recap',
    rawLog: [
      '09:00:00 schedule fired (weekdays 09:00)',
      '09:00:01 google_maps.search "kantor Rajabasa" -> 15 places',
      '09:00:02 dedupe -> 3 removed',
      '09:00:20 openai.write x12',
      '09:31:40 approval received: 11 of 12',
      '09:47:12 whatsapp.send done: 11 sent',
    ],
  },
  {
    id: 'catering-assistant-0852',
    agentName: 'Catering assistant',
    startedBy: 'WhatsApp message',
    when: '08:52',
    result: 'Order to confirm',
    status: 'needsYou',
    timing: 'Today 08:52 · waiting for you',
    steps: [
      { label: 'Read customer message', detail: '1 message', isDone: true },
      { label: 'Draft order from menu', detail: '40 nasi box', isDone: true },
      { label: 'You confirm the order', detail: 'waiting', isDone: false },
    ],
    output: 'An order for 40 nasi box is waiting for your confirmation',
    rawLog: ['08:52:10 whatsapp.message received', '08:52:14 knowledge.lookup Menu and prices', '08:52:16 approval requested'],
    followUp: { label: 'Open in Inbox', path: routePaths.chatDetail },
  },
  {
    id: 'morning-digest-0700',
    agentName: 'Morning email digest',
    startedBy: 'Schedule',
    when: '07:00',
    result: '8 emails summarized',
    status: 'done',
    timing: 'Today 07:00 · 22s · $0.01 AI cost',
    steps: [
      { label: 'Read new Gmail', detail: '8 emails', isDone: true },
      { label: 'Summarize', detail: '6s', isDone: true },
      { label: 'Send digest to WhatsApp', detail: '1 sent', isDone: true },
    ],
    output: 'Digest of 8 emails sent to your WhatsApp',
    rawLog: ['07:00:00 schedule fired (daily 07:00)', '07:00:04 gmail.list -> 8', '07:00:22 whatsapp.send done'],
  },
  {
    id: 'morning-digest-yesterday',
    agentName: 'Morning email digest',
    startedBy: 'Schedule',
    when: 'Yesterday 07:00',
    result: 'Gmail sign-in expired',
    status: 'failed',
    timing: 'Yesterday 07:00 · 3s',
    steps: [{ label: 'Read new Gmail', detail: 'sign-in expired', isDone: false }],
    output: 'Gmail needs you to sign in again. The digest is paused until then',
    rawLog: ['07:00:00 schedule fired (daily 07:00)', '07:00:03 gmail.list error: invalid_grant (token expired)'],
    followUp: { label: 'See what went wrong', path: `${routePaths.errorStates}?runId=morning-digest-yesterday` },
  },
  {
    id: 'maps-leads-test',
    agentName: 'Maps leads to WhatsApp',
    startedBy: 'You',
    when: 'Yesterday 13:03',
    result: 'Test · 1 sent',
    status: 'done',
    timing: 'Yesterday 13:03 · 9s · $0.01 AI cost',
    steps: [
      { label: 'Search Google Maps', detail: '1 place', isDone: true },
      { label: 'Write messages', detail: '1', isDone: true },
      { label: 'Send WhatsApp', detail: '1 sent to you', isDone: true },
    ],
    output: 'Test message sent to your own number',
    rawLog: ['13:03:00 test run started', '13:03:09 whatsapp.send done: 1 sent'],
    followUp: { label: 'Open test result', path: routePaths.runResult },
  },
]

/** Run shown in the detail panel when the screen opens, as in the mockup. */
export const defaultSelectedRunId = 'maps-leads-0900'
