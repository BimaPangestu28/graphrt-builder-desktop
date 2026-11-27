import { routePaths } from '@/routes'
import { messages } from '@/i18n'
import { localizedArray, withLocalizedLabels } from '@/i18n/localized'
import mapsWhatsAppTemplate from './mapsWhatsAppTemplate.json'

/** The design's example job (the "Maps leads to WhatsApp" agent), also the description box's placeholder. */
export function mapsLeadsJobDescription(): string {
  return messages().newAgent.mapsLeadsJob
}

/** Kinds of agent offered as pills above the prompt on the New agent screen (02). */
export const agentKindOptions = withLocalizedLabels([{ value: 'task' }, { value: 'chatbot' }, { value: 'chain' }, { value: 'team' }] as const, (option) => messages().newAgent.kinds[option.value])

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
  /** Tag shown top-right: the kind of a non-task agent, or "Ready to use". */
  kindLabel?: string
  /** A plugin ships this agent finished: picking the card makes it at once, without a model. */
  readyAgent?: { plugin: string; templateId: string }
}

/** Id of the flagship template (Google Maps → WhatsApp), linked from Home. */
export const mapsWhatsAppTemplateId = 'maps-whatsapp'

interface TemplateShape {
  id: string
  kind: AgentKind
  prompt?: string
  kindLabel?: boolean
}

const templateShapes: readonly TemplateShape[] = [
  { id: mapsWhatsAppTemplateId, kind: 'task', prompt: mapsWhatsAppTemplate.prompt },
  { id: 'morning-digest', kind: 'task' },
  { id: 'invoice-reminders', kind: 'task' },
  { id: 'customer-chatbot', kind: 'chatbot', kindLabel: true },
  { id: 'form-to-sheet', kind: 'task' },
  { id: 'review-replies', kind: 'task' },
  { id: 'ask-documents', kind: 'task' },
]

function buildTemplate(shape: TemplateShape): AgentTemplate {
  const t = messages().newAgent
  const texts = t.templateTexts[shape.id as keyof typeof t.templateTexts]
  return {
    id: shape.id,
    kind: shape.kind,
    ...(shape.prompt ? { prompt: shape.prompt } : {}),
    title: texts.title,
    description: texts.description,
    meta: texts.meta,
    needs: [...texts.needs],
    setupNote: texts.setupNote,
    ...(shape.kindLabel ? { kindLabel: t.chatbotKindLabel } : {}),
  }
}

/** The templates in the current language. */
export const agentTemplates: readonly AgentTemplate[] = localizedArray(() => templateShapes.map(buildTemplate))

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
export function jobDescriptionPlaceholder(): string {
  return messages().newAgent.forExample(mapsLeadsJobDescription())
}
