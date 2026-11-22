/**
 * Mock data for screen 12 (Agent as a step): the catalog of things that can be inserted into another agent. The sample backend
 * (`api/sampleBackend/sampleChainSeeds.ts`) turns the "My agents" items into agents.
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
