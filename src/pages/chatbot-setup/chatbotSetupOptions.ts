import type { HandoffRules } from '@/api/chatbotSetupTypes'

/**
 * Chatbot setup (screen 14): the static choices the form offers.
 */

export const chatbotToneOptions = ['Friendly, casual Indonesian', 'Formal'] as const

/** The hand-off rules in display order, with their labels. */
export const handoffRuleOptions: ReadonlyArray<{ key: keyof HandoffRules; label: string }> = [
  { key: 'asksForPerson', label: 'The customer asks for a person' },
  { key: 'notInKnowledge', label: 'The answer is not in the knowledge' },
  { key: 'orderReady', label: 'An order is ready to confirm' },
  { key: 'soundsUpset', label: 'The customer sounds upset' },
]
