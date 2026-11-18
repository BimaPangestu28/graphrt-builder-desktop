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

/** A starter template card on the New agent screen. */
export interface AgentTemplate {
  id: string
  title: string
  description: string
  /** Connected services and step count, e.g. "Gmail · Telegram · 4 steps". */
  meta: string
  /** Kind tag shown top-right, only for non-task agents. */
  kindLabel?: string
  path: string
}

export const agentTemplates: AgentTemplate[] = [
  {
    id: 'morning-digest',
    title: 'Morning email digest',
    description: 'Summarize important emails and send them to Telegram at 07:00',
    meta: 'Gmail · Telegram · 4 steps',
    path: routePaths.scheduler,
  },
  {
    id: 'invoice-reminders',
    title: 'Invoice reminders',
    description: 'Find unpaid rows in a sheet and email a polite reminder',
    meta: 'Google Sheets · Gmail · 5 steps',
    path: routePaths.generating,
  },
  {
    id: 'customer-chatbot',
    title: 'Customer chatbot',
    description: 'Answer WhatsApp questions from your menu and price list, pass orders to you',
    meta: 'WhatsApp · Knowledge',
    kindLabel: 'Chatbot',
    path: routePaths.chatbotSetup,
  },
  {
    id: 'form-to-sheet',
    title: 'Form responses to sheet',
    description: 'Clean up new form entries, tag them, and add them to a sheet',
    meta: 'Webhook · Google Sheets · 4 steps',
    path: routePaths.generating,
  },
  {
    id: 'review-replies',
    title: 'Review reply drafts',
    description: 'Draft replies to new Google reviews and ask you before posting',
    meta: 'Google Business · 5 steps',
    path: routePaths.generating,
  },
  {
    id: 'ask-documents',
    title: 'Ask your documents',
    description: 'Answer questions from a folder of PDFs on this Mac',
    meta: 'Local files · 3 steps',
    path: routePaths.knowledge,
  },
]

/** Where "Build agent" goes for each kind: task agents get generated, the rest open their own setup screen. */
export const buildPathByAgentKind: Record<AgentKind, string> = {
  task: routePaths.generating,
  chatbot: routePaths.chatbotSetup,
  chain: routePaths.chain,
  team: routePaths.team,
}

/** Prefilled job so the first-run flow matches the Maps leads example used across screens 02 to 08. */
export const defaultJobDescription = mapsLeadsJobDescription
