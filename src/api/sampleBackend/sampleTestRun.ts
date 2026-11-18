/**
 * Sample content of the scripted "Maps leads to WhatsApp" test run (screens 06 and 07 in the
 * browser preview and tests). The desktop app never shows it: there, everything comes from graphrt.
 */

/** Inputs the sample agent's earlier runs started with (they prefill the test form). */
export const sampleMapsLeadsInputs: Record<string, unknown> = {
  keyword: 'cafe',
  city: 'Bandar Lampung',
  offer: 'catering menu',
}

/** The prompt the scripted approval step renders: a title line, then who the message goes to. */
export const sampleApprovalPrompt = 'Send this message?\nTo [PLACE NAME] · [PHONE NUMBER] · 4.6 rating, 312 reviews'

export const sampleDraftMessage =
  'Hi [PLACE NAME] team, we run a catering kitchen in Rajabasa and would love to supply your snacks and lunch boxes. Can I send you our menu?'

/** Label of the scripted approval step's message field. */
export const sampleMessageFieldLabel = 'Message, edit before sending if needed'

export interface SampleTestPlace {
  name: string
  phone: string
}

/** Places the scripted search "finds"; the first one is the one tested. */
export const sampleTestPlaces: SampleTestPlace[] = [
  { name: '[PLACE NAME 1]', phone: '[PHONE]' },
  { name: '[PLACE NAME 2]', phone: '[PHONE]' },
  { name: '[PLACE NAME 3]', phone: '[PHONE]' },
]

/**
 * graphrt `human-input` pause data of the scripted test run's approval step.
 *
 * @returns `{ prompt, fields, actions, timeout_ms }` as graphrt sends it
 */
export function buildSampleApprovalPauseData() {
  return {
    prompt: sampleApprovalPrompt,
    fields: [{ name: 'message', label: sampleMessageFieldLabel, type: 'paragraph', required: true, default: sampleDraftMessage }],
    actions: [
      { id: 'approve', title: 'Approve and send' },
      { id: 'skip', title: 'Skip this place' },
    ],
    timeout_ms: null,
  }
}
