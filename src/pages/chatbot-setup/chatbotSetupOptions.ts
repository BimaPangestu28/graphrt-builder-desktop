import type { HandoffRules } from '@/api/chatbotSetupTypes'
import { messages } from '@/i18n'
import { withLocalizedLabels } from '@/i18n/localized'

/**
 * Chatbot setup (screen 14): the static choices the form offers.
 */

export const chatbotToneOptions = ['Friendly, casual Indonesian', 'Formal'] as const

/** The hand-off rules in display order, with their labels. */
export const handoffRuleOptions: ReadonlyArray<{ key: keyof HandoffRules; readonly label: string }> = withLocalizedLabels(
  [{ key: 'asksForPerson' as const }, { key: 'notInKnowledge' as const }, { key: 'orderReady' as const }, { key: 'soundsUpset' as const }],
  (rule) => messages().chatbot.handoffRules[rule.key],
)

/** A tone as the picker shows it; the stored tone stays the English instruction the bot reads. */
export function describeTone(tone: string): string {
  return messages().chatbot.toneLabels[tone] ?? tone
}
