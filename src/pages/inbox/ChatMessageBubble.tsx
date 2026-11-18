import type { ConversationMessage } from '@/api/conversationTypes'
import { joinClassNames } from '@/components/ui'
import { formatClockTime } from './conversationDisplay'

interface BubbleStyle {
  bubbleClassNames: string
  /** Small label above the text, e.g. "Bot". Customers have none. */
  authorLabel?: string
  authorLabelClassNames?: string
}

const sentBubbleBase = 'self-end rounded-[12px_12px_4px_12px]'

const customerStyle: BubbleStyle = { bubbleClassNames: 'self-start rounded-[12px_12px_12px_4px] border border-line bg-surface' }
const outreachStyle: BubbleStyle = {
  bubbleClassNames: joinClassNames(sentBubbleBase, 'bg-ink text-white'),
  authorLabel: 'Outreach agent',
  authorLabelClassNames: 'text-faint',
}
const botStyle: BubbleStyle = { bubbleClassNames: joinClassNames(sentBubbleBase, 'bg-brand-soft'), authorLabel: 'Bot', authorLabelClassNames: 'text-brand-strong' }
const operatorStyle: BubbleStyle = { bubbleClassNames: joinClassNames(sentBubbleBase, 'bg-ink text-white'), authorLabel: 'You', authorLabelClassNames: 'text-faint' }

function getBubbleStyle(message: ConversationMessage): BubbleStyle {
  if (message.author === 'customer') return customerStyle
  if (message.author === 'operator') return operatorStyle
  return message.metadata.sentBy === 'outreach' ? outreachStyle : botStyle
}

/**
 * One message in the chat detail thread. Messages sent from our side (outreach agent, bot, you)
 * sit on the right with a small author and time label; customer messages sit on the left.
 * System messages are centered amber pills, such as "Bot handed this to you". A reply the channel
 * could not deliver says so under its text.
 */
export function ChatMessageBubble({ message }: { message: ConversationMessage }) {
  if (message.author === 'system') {
    return (
      <div lang="en" className="flex items-center gap-2 self-center rounded-full bg-amber-soft px-3 py-1.5 text-[12px] font-medium text-amber-strong">
        {message.text}
      </div>
    )
  }

  const bubbleStyle = getBubbleStyle(message)
  const deliveryError = typeof message.metadata.deliveryError === 'string' ? message.metadata.deliveryError : null
  return (
    <div className={joinClassNames('flex box-content max-w-[72%] flex-col gap-1 px-3 py-2.5 leading-[1.45] whitespace-pre-line', bubbleStyle.bubbleClassNames)}>
      {bubbleStyle.authorLabel && (
        <span lang="en" className={joinClassNames('text-[11px]', bubbleStyle.authorLabelClassNames)}>
          {`${bubbleStyle.authorLabel} · ${formatClockTime(message.createdAt)}`}
        </span>
      )}
      {message.text}
      {deliveryError && (
        <span lang="en" className="text-[11px] font-medium text-amber-strong">
          Not delivered: {deliveryError}
        </span>
      )}
    </div>
  )
}
