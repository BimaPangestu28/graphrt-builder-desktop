import { joinClassNames } from '@/components/ui'
import type { ChatMessage, ChatMessageAuthor } from '@/data/inbox'

interface BubbleStyle {
  bubbleClassNames: string
  /** Small label above the text, e.g. "Bot". Customers have none. */
  authorLabel?: string
  authorLabelClassNames?: string
}

const sentBubbleBase = 'self-end rounded-[12px_12px_4px_12px]'

const bubbleStyles: Record<Exclude<ChatMessageAuthor, 'notice'>, BubbleStyle> = {
  customer: { bubbleClassNames: 'self-start rounded-[12px_12px_12px_4px] border border-line bg-surface' },
  'outreach-agent': {
    bubbleClassNames: joinClassNames(sentBubbleBase, 'bg-ink text-white'),
    authorLabel: 'Outreach agent',
    authorLabelClassNames: 'text-faint',
  },
  bot: { bubbleClassNames: joinClassNames(sentBubbleBase, 'bg-brand-soft'), authorLabel: 'Bot', authorLabelClassNames: 'text-brand-strong' },
  you: { bubbleClassNames: joinClassNames(sentBubbleBase, 'bg-ink text-white'), authorLabel: 'You', authorLabelClassNames: 'text-faint' },
}

/**
 * One message in the chat detail thread. Messages sent from our side (outreach agent, bot, you)
 * sit on the right with a small author and time label; customer messages sit on the left.
 * `notice` messages are centered amber pills, such as "Bot handed this to you".
 */
export function ChatMessageBubble({ message }: { message: ChatMessage }) {
  if (message.author === 'notice') {
    return (
      <div lang="en" className="flex items-center gap-2 self-center rounded-full bg-amber-soft px-3 py-1.5 text-[12px] font-medium text-amber-strong">
        {message.text}
      </div>
    )
  }

  const bubbleStyle = bubbleStyles[message.author]
  return (
    <div className={joinClassNames('flex box-content max-w-[72%] flex-col gap-1 px-3 py-2.5 leading-[1.45]', bubbleStyle.bubbleClassNames)}>
      {bubbleStyle.authorLabel && (
        <span lang="en" className={joinClassNames('text-[11px]', bubbleStyle.authorLabelClassNames)}>
          {message.time ? `${bubbleStyle.authorLabel} · ${message.time}` : bubbleStyle.authorLabel}
        </span>
      )}
      {message.text}
    </div>
  )
}
