import { useState } from 'react'
import { recordReplyFeedback } from '@/api/learning'
import { Icon } from '@/components/ui'
import { useT } from '@/i18n'
import { FeedbackCard } from '@/pages/learning/RunFeedbackCard'

interface ReplyFeedbackProps {
  /** The chatbot that wrote the reply. */
  agentId: string
  conversationId: string
  /** A reply of the chatbot. */
  messageId: string
}

/**
 * "Rate this reply" under a reply the chatbot gave in a conversation: a small button that
 * opens the same "Was this what you wanted?" card as a run. A comment becomes a note that
 * waits for the owner's approval; the customer never sees any of it.
 */
export function ReplyFeedback({ agentId, conversationId, messageId }: ReplyFeedbackProps) {
  const t = useT().inbox
  const [isOpen, setIsOpen] = useState(false)
  if (!isOpen) {
    return (
      <button
        type="button"
        lang="en"
        onClick={() => setIsOpen(true)}
        className="-mt-1 inline-flex h-7 cursor-pointer items-center gap-1.5 self-end rounded-lg border-0 bg-transparent px-2 text-[12px] font-medium text-muted hover:bg-chip hover:text-ink"
      >
        <Icon name="thumbUp" size={13} />
        {t.rateReply}
      </button>
    )
  }
  return (
    <div lang="en" className="flex w-full max-w-[420px] flex-col self-end">
      <FeedbackCard agentId={agentId} className="bg-surface" onSend={(feedback) => recordReplyFeedback(conversationId, messageId, feedback)} />
    </div>
  )
}
