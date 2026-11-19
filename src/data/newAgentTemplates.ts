import { routePaths } from '@/routes'
import { mapsLeadsJobDescription } from './mapsLeadsAgent'

/** Kinds of agent offered as pills above the prompt on the New agent screen (02). */
export const agentKindOptions = [
  { value: 'task', label: 'Do a task' },
  { value: 'chatbot', label: 'Answer customers' },
  { value: 'chain', label: 'Chain agents' },
  { value: 'team', label: 'Agent team' },
] as const

export type AgentKind = (typeof agentKindOptions)[number]['value']

/**
 * A starter card on the New agent screen. Picking it fills the prompt with `description`
 * and selects `kind`; nothing is built until the user presses "Build agent".
 */
export interface AgentTemplate {
  id: string
  title: string
  /** Starter text put into the prompt. */
  description: string
  /** Kind pill selected with it. */
  kind: AgentKind
  /** Services it will likely use and its rough size, e.g. "Gmail · Telegram · 4 steps". */
  meta: string
  /** Kind tag shown top-right, only for non-task agents. */
  kindLabel?: string
}

export const agentTemplates: AgentTemplate[] = [
  {
    id: 'morning-digest',
    title: 'Morning email digest',
    description: 'Summarize important emails and send them to Telegram at 07:00',
    kind: 'task',
    meta: 'Gmail · Telegram · 4 steps',
  },
  {
    id: 'invoice-reminders',
    title: 'Invoice reminders',
    description: 'Find unpaid rows in a sheet and email a polite reminder',
    kind: 'task',
    meta: 'Google Sheets · Gmail · 5 steps',
  },
  {
    id: 'customer-chatbot',
    title: 'Customer chatbot',
    description: 'Answer WhatsApp questions from your menu and price list, pass orders to you',
    kind: 'chatbot',
    meta: 'WhatsApp · Knowledge',
    kindLabel: 'Chatbot',
  },
  {
    id: 'form-to-sheet',
    title: 'Form responses to sheet',
    description: 'Clean up new form entries, tag them, and add them to a sheet',
    kind: 'task',
    meta: 'Webhook · Google Sheets · 4 steps',
  },
  {
    id: 'review-replies',
    title: 'Review reply drafts',
    description: 'Draft replies to new Google reviews and ask you before posting',
    kind: 'task',
    meta: 'Google Business · 5 steps',
  },
  {
    id: 'ask-documents',
    title: 'Ask your documents',
    description: 'Answer questions from a folder of PDFs on this computer',
    kind: 'task',
    meta: 'Local files · 3 steps',
  },
]

/** Where "Build agent" goes for each kind: task agents get generated, the rest open their own setup screen. */
export const buildPathByAgentKind: Record<AgentKind, string> = {
  task: routePaths.generating,
  chatbot: routePaths.chatbotSetup,
  chain: routePaths.chain,
  team: routePaths.team,
}

/**
 * Example shown greyed out in the empty prompt (never submitted): the Maps leads job used
 * across screens 02 to 08.
 */
export const jobDescriptionPlaceholder = `For example: ${mapsLeadsJobDescription}`
