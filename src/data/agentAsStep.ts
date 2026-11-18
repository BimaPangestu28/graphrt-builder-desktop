/**
 * Mock data for screen 12 (Agent as a step): the steps of "Maps leads to WhatsApp"
 * and the catalog of things that can be inserted after "Search Google Maps".
 */

export type StepCatalogCategory = 'builtIn' | 'myAgents' | 'plugins'

export interface StepCatalogItem {
  id: string
  name: string
  category: StepCatalogCategory
  description: string
  /** Inputs and outputs summary, e.g. "In place · Out score, reason". */
  signature: string
  usageNote?: string
  /** Title the step gets once inserted into the agent. */
  stepTitle: string
  sends: string[]
  getsBack: string[]
  version?: number
  /** Agents that need no input cannot run as a step inside a loop. */
  needsNoInput?: boolean
}

export const stepCatalogTabs: Array<{ category: StepCatalogCategory; label: string }> = [
  { category: 'builtIn', label: 'Built-in' },
  { category: 'myAgents', label: 'My agents' },
  { category: 'plugins', label: 'Plugins' },
]

export const stepCatalogItems: StepCatalogItem[] = [
  {
    id: 'lead-qualifier',
    name: 'Lead qualifier',
    category: 'myAgents',
    description: 'Scores a business 1 to 10 from its reviews, rating and website',
    signature: 'In place · Out score, reason',
    usageNote: 'used in 2 agents',
    stepTitle: 'Qualify the lead',
    sends: ['place'],
    getsBack: ['score', 'reason'],
    version: 3,
  },
  {
    id: 'translate-bahasa',
    name: 'Translate to Bahasa',
    category: 'myAgents',
    description: 'Rewrites any text in casual Indonesian',
    signature: 'In text · Out text',
    stepTitle: 'Translate the message',
    sends: ['text'],
    getsBack: ['text'],
    version: 1,
  },
  {
    id: 'morning-digest',
    name: 'Morning email digest',
    category: 'myAgents',
    description: 'Summarizes important emails',
    signature: 'Out summary',
    stepTitle: 'Summarize email',
    sends: [],
    getsBack: ['summary'],
    needsNoInput: true,
  },
  {
    id: 'filter-list',
    name: 'Filter a list',
    category: 'builtIn',
    description: 'Keeps only the items that match a rule you write in plain words',
    signature: 'In items · Out items',
    stepTitle: 'Filter places',
    sends: ['items'],
    getsBack: ['items'],
  },
  {
    id: 'wait',
    name: 'Wait',
    category: 'builtIn',
    description: 'Pauses for a set time before the next step',
    signature: 'In duration',
    stepTitle: 'Wait a moment',
    sends: ['duration'],
    getsBack: [],
  },
  {
    id: 'website-check',
    name: 'Website checker',
    category: 'plugins',
    description: 'Opens a website and reports if it loads and has a contact form',
    signature: 'In url · Out reachable, has_form',
    stepTitle: 'Check the website',
    sends: ['url'],
    getsBack: ['reachable', 'has_form'],
  },
]

export const initialInsertedStepId = 'lead-qualifier'

export const stepsBeforeInsert = ['Ask for keyword, city and offer', 'Search Google Maps', 'For each place']

export interface LoopBodyStep {
  title: string
  tag?: { label: string; tone: 'muted' | 'amber' }
}

export const stepsAfterInsert: LoopBodyStep[] = [
  { title: 'Skip places with score below 6', tag: { label: 'New', tone: 'muted' } },
  { title: 'Write a short message' },
  { title: 'Ask me before sending', tag: { label: 'Approval', tone: 'amber' } },
  { title: 'Send WhatsApp' },
]

/**
 * Catalog items in a tab whose name or description matches the search text (case-insensitive).
 */
export function filterStepCatalog(items: StepCatalogItem[], options: { category: StepCatalogCategory; searchText: string }): StepCatalogItem[] {
  const normalizedSearch = options.searchText.trim().toLowerCase()
  return items.filter(
    (item) =>
      item.category === options.category &&
      (normalizedSearch === '' || `${item.name} ${item.description}`.toLowerCase().includes(normalizedSearch)),
  )
}
