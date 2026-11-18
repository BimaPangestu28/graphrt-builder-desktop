import type { AgentKind, AgentStatus, FlowInput, FlowStep } from '../types'

/**
 * Seed data for the sample agents backend: the agents the screens show in the browser
 * preview and tests, each with its version history as structured steps. The sample
 * store renders every version to a graphrt workflow document (`flowYaml`).
 */

/** One saved version of a sample agent, kept as steps so it can be summarized and rendered. */
export interface SampleVersionSeed {
  version: number
  changeSummary: string
  createdAt: string
  steps: FlowStep[]
}

export interface SampleAgentSeed {
  id: string
  name: string
  kind: AgentKind
  description: string
  status: AgentStatus
  inputs: FlowInput[]
  createdAt: string
  /** Oldest first; the last one is current. */
  versions: SampleVersionSeed[]
}

/** RFC 3339 timestamp `daysAgo` days before today at the given local time. */
export function sampleTimestamp(daysAgo: number, hours: number, minutes: number): string {
  const timestamp = new Date()
  timestamp.setDate(timestamp.getDate() - daysAgo)
  timestamp.setHours(hours, minutes, 0, 0)
  return timestamp.toISOString()
}

function step(id: string, nodeType: string, title: string, detail: string, options: { depth?: number; needsApproval?: boolean } = {}): FlowStep {
  return { id, nodeType, title, detail, needsApproval: options.needsApproval ?? false, depth: options.depth ?? 0 }
}

const askForInput = step('ask_input', 'start', 'Ask for keyword, city and offer', 'cafe · Bandar Lampung · catering menu')
const searchMaps = step('search_maps', 'http-request', 'Search Google Maps', 'Up to 20 places · only places with a phone number')
const forEachPlace = step('for_each_place', 'iteration', 'For each place', 'Steps 4 to 6 repeat, one place at a time')
const approveMessage = step('approve_message', 'human-input', 'Ask me before sending', 'Approve, edit or skip each message', { depth: 1, needsApproval: true })
const qualifyLead = step('qualify_lead', 'llm', 'Qualify the lead', 'Score 1 to 10 from rating and reviews', { depth: 1 })
const skipLowScores = step('skip_low_score', 'if-else', 'Skip places with score below 6', 'Places below 6 are skipped', { depth: 1 })

function writeMessage(title: string, detail: string): FlowStep {
  return step('write_message', 'llm', title, detail, { depth: 1 })
}

function sendWhatsApp(detail: string): FlowStep {
  return step('send_whatsapp', 'http-request', 'Send WhatsApp', detail, { depth: 1 })
}

const firstMapsLeadsSteps = [askForInput, searchMaps, forEachPlace, writeMessage('Write a message', 'Uses the place name and your offer'), sendWhatsApp('From your number on this Mac')]

const mapsLeadsAgent: SampleAgentSeed = {
  id: 'maps-leads',
  name: 'Maps leads to WhatsApp',
  kind: 'task',
  description:
    'Find cafes in Bandar Lampung on Google Maps, get their name and phone number, then send each one a WhatsApp message offering our catering menu',
  status: 'active',
  inputs: [
    { name: 'keyword', label: 'Keyword', required: true },
    { name: 'city', label: 'City', required: true },
    { name: 'offer', label: 'Offer', required: true },
  ],
  createdAt: sampleTimestamp(1, 10, 2),
  versions: [
    { version: 1, changeSummary: 'First draft', createdAt: sampleTimestamp(1, 10, 2), steps: firstMapsLeadsSteps },
    {
      version: 2,
      changeSummary: 'Added an approval step',
      createdAt: sampleTimestamp(1, 10, 9),
      steps: [askForInput, searchMaps, forEachPlace, writeMessage('Write a message', 'Uses the place name and your offer'), approveMessage, sendWhatsApp('From your number on this Mac')],
    },
    {
      version: 3,
      changeSummary: 'Fixed the place name field',
      createdAt: sampleTimestamp(1, 10, 15),
      steps: [askForInput, searchMaps, forEachPlace, writeMessage('Write a message', 'Uses the place name and your offer'), approveMessage, sendWhatsApp('From your number on this Mac')],
    },
    {
      version: 4,
      changeSummary: 'Limited to 40 messages a day',
      createdAt: sampleTimestamp(1, 10, 21),
      steps: [
        askForInput,
        searchMaps,
        forEachPlace,
        writeMessage('Write a message', 'Uses the place name and your offer'),
        approveMessage,
        sendWhatsApp('From your number on this Mac · max 40 per day'),
      ],
    },
    {
      version: 5,
      changeSummary: 'First version that ran on a schedule',
      createdAt: sampleTimestamp(1, 16, 12),
      steps: [
        askForInput,
        searchMaps,
        forEachPlace,
        qualifyLead,
        skipLowScores,
        writeMessage('Write a short message', 'Uses the place name · max 4 sentences'),
        approveMessage,
        sendWhatsApp('From your number on this Mac · max 40 per day'),
      ],
    },
    {
      version: 6,
      changeSummary: 'Took out the lead qualifier and score filter',
      createdAt: sampleTimestamp(0, 12, 40),
      steps: [
        askForInput,
        searchMaps,
        forEachPlace,
        writeMessage('Write a short message', 'Uses the place name · max 4 sentences'),
        approveMessage,
        sendWhatsApp('From your number on this Mac · max 40 per day'),
      ],
    },
    {
      version: 7,
      changeSummary: 'Shorter message, 30s gap',
      createdAt: sampleTimestamp(0, 13, 1),
      steps: [
        askForInput,
        searchMaps,
        forEachPlace,
        writeMessage('Write a short message', 'Uses the place name · max 2 sentences'),
        approveMessage,
        sendWhatsApp('From your number on this Mac · 30s gap · max 40 per day'),
      ],
    },
  ],
}

function singleVersionAgent(seed: Omit<SampleAgentSeed, 'versions' | 'inputs'> & { steps: FlowStep[]; inputs?: FlowInput[] }): SampleAgentSeed {
  const { steps, inputs, ...agentFields } = seed
  return {
    ...agentFields,
    inputs: inputs ?? [],
    versions: [{ version: 1, changeSummary: 'First draft', createdAt: seed.createdAt, steps }],
  }
}

/** Every sample agent, most recently updated first (the order the sidebar lists them). */
export const sampleAgentSeeds: SampleAgentSeed[] = [
  mapsLeadsAgent,
  singleVersionAgent({
    id: 'catering-assistant',
    name: 'Catering assistant',
    kind: 'chatbot',
    description: 'Answer WhatsApp questions from our menu and price list, and pass orders to me',
    status: 'active',
    createdAt: sampleTimestamp(2, 9, 30),
    inputs: [{ name: 'message', label: 'Customer message', required: true }],
    steps: [
      step('customer_message', 'start', 'Customer message', 'Arrives on WhatsApp'),
      step('look_up_menu', 'knowledge-retrieval', 'Look up the menu and prices', 'Menu and prices · top 3 passages'),
      step('write_reply', 'llm', 'Write a reply', 'Friendly · answers only from the menu'),
      step('reply_on_whatsapp', 'answer', 'Reply on WhatsApp', 'Hands orders over to you'),
    ],
  }),
  singleVersionAgent({
    id: 'morning-digest',
    name: 'Morning email digest',
    kind: 'task',
    description: 'Summarize important emails and send them to Telegram at 07:00',
    status: 'active',
    createdAt: sampleTimestamp(3, 7, 0),
    steps: [
      step('read_emails', 'http-request', 'Read new emails', 'Gmail · since yesterday 07:00'),
      step('pick_important', 'llm', 'Pick the important ones', 'Skips newsletters and receipts'),
      step('summarize', 'llm', 'Summarize them', 'One line per email'),
      step('send_telegram', 'http-request', 'Send to Telegram', 'To your saved chat'),
    ],
  }),
  singleVersionAgent({
    id: 'leads-recap',
    name: 'Leads to sales recap',
    kind: 'chain',
    description: 'After Maps leads to WhatsApp runs, summarize the replies and email a recap to the sales team',
    status: 'paused',
    createdAt: sampleTimestamp(4, 11, 15),
    steps: [
      step('run_maps_leads', 'agent', 'Run Maps leads to WhatsApp', 'Waits for it to finish'),
      step('summarize_replies', 'llm', 'Summarize the replies', 'Groups interested and not interested'),
      step('email_recap', 'http-request', 'Email the sales recap', 'To sales@ · every Friday'),
    ],
  }),
  singleVersionAgent({
    id: 'sales-team',
    name: 'Catering sales team',
    kind: 'team',
    description: 'A coordinator that splits lead finding and message writing between two agents',
    status: 'active',
    createdAt: sampleTimestamp(5, 14, 0),
    steps: [
      step('coordinator', 'llm', 'Coordinator', 'Splits the work and checks the result'),
      step('lead_finder', 'agent', 'Lead finder', 'Searches Google Maps'),
      step('message_writer', 'agent', 'Message writer', 'Writes one message per lead'),
      step('approve_messages', 'human-input', 'Ask me before sending', 'Approve the whole batch', { needsApproval: true }),
    ],
  }),
  singleVersionAgent({
    id: 'invoice-reminders',
    name: 'Invoice reminders',
    kind: 'task',
    description: 'Find unpaid rows in a sheet and email a polite reminder',
    status: 'paused',
    createdAt: sampleTimestamp(8, 10, 0),
    steps: [
      step('read_sheet', 'http-request', 'Read the invoice sheet', 'Google Sheets · Invoices tab'),
      step('for_each_unpaid', 'iteration', 'For each unpaid row', 'Steps 3 to 5 repeat, one invoice at a time'),
      step('write_reminder', 'llm', 'Write a polite reminder', 'Mentions the amount and due date', { depth: 1 }),
      step('approve_reminder', 'human-input', 'Ask me before sending', 'Approve, edit or skip each email', { depth: 1, needsApproval: true }),
      step('send_email', 'http-request', 'Send email', 'From your Gmail', { depth: 1 }),
    ],
  }),
]
