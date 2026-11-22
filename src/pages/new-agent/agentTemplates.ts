import { routePaths } from '@/routes'
import mapsWhatsAppTemplate from './mapsWhatsAppTemplate.json'

/** The design's example job (the "Maps leads to WhatsApp" agent), also the description box's placeholder. */
export const mapsLeadsJobDescription =
  'Find cafes in Bandar Lampung on Google Maps, get their name and phone number, then send each one a WhatsApp message offering our catering menu'

/** Kinds of agent offered as pills above the prompt on the New agent screen (02). */
export const agentKindOptions = [
  { value: 'task', label: 'Do a task' },
  { value: 'chatbot', label: 'Answer customers' },
  { value: 'chain', label: 'Chain agents' },
  { value: 'team', label: 'Agent team' },
] as const

export type AgentKind = (typeof agentKindOptions)[number]['value']

/**
 * A starter card on the New agent screen. Picking it fills the prompt with `prompt`
 * (or `description` when it has none) and selects `kind`; nothing is built until the
 * user presses "Build agent".
 */
export interface AgentTemplate {
  id: string
  title: string
  /** One plain sentence shown on the card; also the starter text when there is no `prompt`. */
  description: string
  /** Fuller starter text put into the (editable) prompt, when the card text is too short to build from. */
  prompt?: string
  /** Kind pill selected with it. */
  kind: AgentKind
  /** Services it will likely use and its rough size, e.g. "Gmail · Telegram · 4 steps". */
  meta: string
  /** Plugins and connections it needs, shown as chips, e.g. ["Gmail", "Telegram"]. */
  needs: string[]
  /** Short "what you'll need" note, e.g. "WhatsApp linked by QR". */
  setupNote: string
  /** Kind tag shown top-right, only for non-task agents. */
  kindLabel?: string
}

/** Id of the flagship template (Google Maps → WhatsApp), linked from Home. */
export const mapsWhatsAppTemplateId = 'maps-whatsapp'

export const agentTemplates: AgentTemplate[] = [
  {
    id: mapsWhatsAppTemplateId,
    title: 'Find businesses on Maps and message them on WhatsApp',
    description: 'Search Google Maps for an area and type of business, write each one a short personal message, and ask you before sending',
    prompt: mapsWhatsAppTemplate.prompt,
    kind: 'task',
    meta: 'Google Maps · WhatsApp · Approval',
    needs: ['Google Maps scraper', 'WhatsApp (personal)'],
    setupNote: 'WhatsApp linked by QR. No Maps API key needed',
  },
  {
    id: 'morning-digest',
    title: 'Morning email digest',
    description: 'Summarize important emails and send them to Telegram at 07:00',
    kind: 'task',
    meta: 'Gmail · Telegram · 4 steps',
    needs: ['Gmail', 'Telegram'],
    setupNote: 'Gmail account and a Telegram bot',
  },
  {
    id: 'invoice-reminders',
    title: 'Invoice reminders',
    description: 'Find unpaid rows in a sheet and email a polite reminder',
    kind: 'task',
    meta: 'Google Sheets · Gmail · 5 steps',
    needs: ['Google Sheets', 'Gmail'],
    setupNote: 'A sheet with a paid / unpaid column',
  },
  {
    id: 'customer-chatbot',
    title: 'Customer chatbot',
    description: 'Answer WhatsApp questions from your menu and price list, pass orders to you',
    kind: 'chatbot',
    meta: 'WhatsApp · Knowledge',
    needs: ['WhatsApp', 'Knowledge'],
    setupNote: 'Your menu or price list as a file',
    kindLabel: 'Chatbot',
  },
  {
    id: 'form-to-sheet',
    title: 'Form responses to sheet',
    description: 'Clean up new form entries, tag them, and add them to a sheet',
    kind: 'task',
    meta: 'Webhook · Google Sheets · 4 steps',
    needs: ['Webhook', 'Google Sheets'],
    setupNote: 'A form that can call a webhook',
  },
  {
    id: 'review-replies',
    title: 'Review reply drafts',
    description: 'Draft replies to new Google reviews and ask you before posting',
    kind: 'task',
    meta: 'Google Business · 5 steps',
    needs: ['Google Business Profile'],
    setupNote: 'Owner access to your Google listing',
  },
  {
    id: 'ask-documents',
    title: 'Ask your documents',
    description: 'Answer questions from a folder of PDFs on this computer',
    kind: 'task',
    meta: 'Local files · 3 steps',
    needs: ['Local files'],
    setupNote: 'A folder of PDFs on this computer',
  },
]

/**
 * The text a template puts into the prompt.
 *
 * @param template - The picked template (AgentTemplate)
 * @returns Its `prompt`, or its card `description` when it has none (string)
 */
export function templatePromptText(template: AgentTemplate): string {
  return template.prompt ?? template.description
}

/**
 * The template with this id, if any (e.g. from `?template=` on the New agent screen).
 *
 * @param templateId - Template id, or null when none was given (string | null)
 * @returns The template, or undefined (AgentTemplate | undefined)
 */
export function findAgentTemplate(templateId: string | null): AgentTemplate | undefined {
  return agentTemplates.find((template) => template.id === templateId)
}

/**
 * New agent screen with a template already picked.
 *
 * @example
 * newAgentTemplatePath('maps-whatsapp') // "/new?template=maps-whatsapp"
 */
export function newAgentTemplatePath(templateId: string): string {
  return `${routePaths.newAgent}?${new URLSearchParams({ template: templateId })}`
}

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
