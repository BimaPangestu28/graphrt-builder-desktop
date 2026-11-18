/** Mock data for screen 24 · Version history of the "Maps leads to WhatsApp" agent. */

export interface AgentStepSnapshot {
  /** Stable id so the same step can be matched across versions. */
  id: string
  name: string
  /** The one setting that tends to change between versions, e.g. "max 2 sentences". */
  setting?: string
}

export interface AgentVersion {
  number: number
  savedAt: string
  summary: string
  /** Who made it, or how often it ran. */
  origin: string
  steps: AgentStepSnapshot[]
}

/** Early drafts grouped into one, non-restorable history entry. */
export const draftVersionsGroup = {
  label: 'v1 to v4',
  savedAt: 'Yesterday',
  summary: 'Drafts while building',
}

const askForInput: AgentStepSnapshot = { id: 'ask-input', name: 'Ask for keyword, city and offer' }
const searchMaps: AgentStepSnapshot = { id: 'search-maps', name: 'Search Google Maps' }
const qualifyLead: AgentStepSnapshot = { id: 'qualify-lead', name: 'Qualify the lead' }
const skipLowScores: AgentStepSnapshot = { id: 'skip-low-score', name: 'Skip places with score below 6' }
const askBeforeSending: AgentStepSnapshot = { id: 'ask-before-sending', name: 'Ask me before sending' }

function writeMessage(setting: string): AgentStepSnapshot {
  return { id: 'write-message', name: 'Write a short message', setting }
}

function sendWhatsApp(setting: string): AgentStepSnapshot {
  return { id: 'send-whatsapp', name: 'Send WhatsApp', setting }
}

/** Newest first, as the history list shows them. */
export const agentVersions: AgentVersion[] = [
  {
    number: 7,
    savedAt: 'Today 13:01',
    summary: 'Shorter message, 30s gap',
    origin: 'You, through chat',
    steps: [askForInput, searchMaps, qualifyLead, skipLowScores, writeMessage('max 2 sentences'), askBeforeSending, sendWhatsApp('30s gap')],
  },
  {
    number: 6,
    savedAt: 'Today 12:40',
    summary: 'Added Lead qualifier and score filter',
    origin: 'You, in the step editor',
    steps: [askForInput, searchMaps, qualifyLead, skipLowScores, writeMessage('max 4 sentences'), askBeforeSending, sendWhatsApp('no gap')],
  },
  {
    number: 5,
    savedAt: 'Yesterday 16:12',
    summary: 'First version that ran on a schedule',
    origin: 'Ran 1 time',
    steps: [askForInput, searchMaps, writeMessage('max 4 sentences'), askBeforeSending, sendWhatsApp('no gap')],
  },
]

/** The change announced by the toast when the screen opens (v7 was just saved through chat). */
export const initialChangeNotice = { versionNumber: 7, message: 'Changed 2 steps in v7' }
