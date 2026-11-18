import type { Conversation } from '@/api/conversationTypes'
import { joinClassNames } from '@/components/ui'
import { getConversationStatusLabel, getConversationTone, type ConversationTone } from './conversationDisplay'

const toneClassNames: Record<ConversationTone, string> = {
  amber: 'bg-amber-soft text-amber-strong',
  brand: 'bg-brand-soft text-brand-strong',
  grey: 'bg-canvas text-ink-2',
}

/** Rounded status label on an inbox row: amber when a person has the chat, teal while the bot answers, grey when closed. */
export function ConversationStatusPill({ conversation }: { conversation: Pick<Conversation, 'status' | 'handoffReason'> }) {
  return (
    <span className={joinClassNames('rounded-full px-2 py-[3px] font-medium whitespace-nowrap', toneClassNames[getConversationTone(conversation)])}>
      {getConversationStatusLabel(conversation)}
    </span>
  )
}
