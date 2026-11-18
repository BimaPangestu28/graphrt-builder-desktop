/** Mock data for screen 06 (test run waiting for approval) and 07 (test run result). */

export type TestRunStepState = 'done' | 'waiting' | 'pending'

export interface TestRunStep {
  id: string
  label: string
  state: TestRunStepState
  /** Right-aligned detail for finished steps, e.g. "18 places · 1.2s". */
  detail?: string
}

export const testRunSteps: TestRunStep[] = [
  { id: 'ask-input', label: 'Ask for keyword, city and offer', state: 'done', detail: '0.0s' },
  { id: 'search-maps', label: 'Search Google Maps', state: 'done', detail: '18 places · 1.2s' },
  { id: 'write-message', label: 'Write a short message', state: 'done', detail: '212 tokens · 2.4s' },
  { id: 'approval', label: 'Ask me before sending', state: 'waiting' },
  { id: 'send-whatsapp', label: 'Send WhatsApp', state: 'pending' },
]

export const pendingApproval = {
  recipientSummary: 'To [PLACE NAME] · [PHONE NUMBER] · 4.6 rating, 312 reviews',
  draftMessage:
    'Hi [PLACE NAME] team, we run a catering kitchen in Rajabasa and would love to supply your snacks and lunch boxes. Can I send you our menu?',
}

export interface RunResultStat {
  label: string
  value: string
}

export const testRunStats: RunResultStat[] = [
  { label: 'Places found', value: '18' },
  { label: 'Messages sent', value: '1' },
  { label: 'Time', value: '41s' },
  { label: 'AI cost', value: '$0.004' },
]

export type PlaceOutcome = 'Sent' | 'Not in test'

export interface TestRunPlace {
  id: string
  name: string
  phone: string
  outcome: PlaceOutcome
}

export const testRunPlaces: TestRunPlace[] = [
  { id: 'place-1', name: '[PLACE NAME 1]', phone: '[PHONE]', outcome: 'Sent' },
  { id: 'place-2', name: '[PLACE NAME 2]', phone: '[PHONE]', outcome: 'Not in test' },
  { id: 'place-3', name: '[PLACE NAME 3]', phone: '[PHONE]', outcome: 'Not in test' },
]

/** Places found but not listed in the result table. */
export const hiddenPlaceCount = 15
