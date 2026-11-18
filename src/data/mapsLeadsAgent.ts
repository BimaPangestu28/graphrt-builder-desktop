/**
 * Mock data for the "Maps leads to WhatsApp" agent as it is generated (03) and edited (04).
 */

export const mapsLeadsAgentName = 'Maps leads to WhatsApp'

export const mapsLeadsJobDescription =
  'Find cafes in Bandar Lampung on Google Maps, get their name and phone number, then send each one a WhatsApp message offering our catering menu'

/** Visual role of a step's number badge: plain, approval (amber), or edited by the last chat change (brand). */
export type BuilderStepTone = 'plain' | 'approval' | 'changed'

export interface BuilderStep {
  number: number
  title: string
  detail: string
  /** Steps inside the "For each place" loop are indented. */
  isInsideLoop: boolean
  isApproval?: boolean
  /** The version before the last chat change, used by Undo. Present only on changed steps. */
  previousVersion?: { title: string; detail: string }
}

export const mapsLeadsSteps: BuilderStep[] = [
  { number: 1, title: 'Ask for keyword, city and offer', detail: 'cafe · Bandar Lampung · catering menu', isInsideLoop: false },
  { number: 2, title: 'Search Google Maps', detail: 'Up to 20 places · only places with a phone number', isInsideLoop: false },
  { number: 3, title: 'For each place', detail: 'Steps 4 to 6 repeat, one place at a time', isInsideLoop: false },
  {
    number: 4,
    title: 'Write a short message',
    detail: 'Uses the place name · max 2 sentences',
    isInsideLoop: true,
    previousVersion: { title: 'Write a message', detail: 'Uses the place name and your offer' },
  },
  { number: 5, title: 'Ask me before sending', detail: 'Approve, edit or skip each message', isInsideLoop: true, isApproval: true },
  {
    number: 6,
    title: 'Send WhatsApp',
    detail: 'From your number on this Mac · 30s gap · max 40 per day',
    isInsideLoop: true,
    previousVersion: { title: 'Send WhatsApp', detail: 'From your number on this Mac · max 40 per day' },
  },
]

/** One line in the "Building your agent" checklist on screen 03. */
export interface BuildProgressItem {
  title: string
  /** Shown under the title once the item is done or running. */
  detail?: string
  /** Shown instead of `detail` while this item is the one running. */
  runningDetail?: string
  /** How many steps on the right are visible once this item is done. */
  revealedStepCount: number
}

export const buildProgressItems: BuildProgressItem[] = [
  { title: 'Understood the job', detail: 'Search places, write a message per place, send on WhatsApp', revealedStepCount: 1 },
  { title: 'Picked 6 steps', detail: 'Added an approval step because it sends messages to other people', revealedStepCount: 2 },
  { title: 'Fixed 1 problem', detail: 'Step 4 read the wrong field for the place name', revealedStepCount: 3 },
  { title: 'Checking it again', detail: 'No problems found', runningDetail: 'Attempt 2 of 3', revealedStepCount: 5 },
  { title: 'Check what it needs to connect', detail: 'WhatsApp needs to be linked on this Mac', runningDetail: 'Google Places, OpenAI, WhatsApp', revealedStepCount: 6 },
]

/** How long each mocked build item takes, and the pause before opening the builder once done. */
export const buildItemDurationMs = 1800
export const openBuilderDelayMs = 1200

/** The design shows the build mid-way: three items done, the fourth running. */
export const initialRunningBuildItemIndex = 3

/** Connections the agent needs before it can run (Needs panel on 04). */
export interface AgentRequirement {
  label: string
  isConnected: boolean
}

export const mapsLeadsRequirements: AgentRequirement[] = [
  { label: 'Google Places API key', isConnected: true },
  { label: 'OpenAI · Keychain', isConnected: true },
  { label: 'WhatsApp on this Mac', isConnected: false },
]
