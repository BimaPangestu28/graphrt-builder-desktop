import { joinClassNames } from '@/components/ui'
import { conversationStatusLabels, type ConversationStatus } from '@/data/inbox'

const statusClassNames: Record<ConversationStatus, string> = {
  'order-to-confirm': 'bg-amber-soft text-amber-strong',
  'asked-for-you': 'bg-amber-soft text-amber-strong',
  'bot-not-sure': 'bg-amber-soft text-amber-strong',
  'bot-answering': 'bg-brand-soft text-brand-strong',
  closed: 'bg-canvas text-ink-2',
}

/** Rounded status label on an inbox row: amber when waiting for you, teal while the bot answers, grey when closed. */
export function ConversationStatusPill({ status }: { status: ConversationStatus }) {
  return (
    <span className={joinClassNames('rounded-full px-2 py-[3px] font-medium whitespace-nowrap', statusClassNames[status])}>
      {conversationStatusLabels[status]}
    </span>
  )
}
