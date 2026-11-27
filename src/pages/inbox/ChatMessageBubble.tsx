import type { ConversationMessage } from '@/api/conversationTypes'
import { readMessageFiles } from '@/components/files'
import { joinClassNames } from '@/components/ui'
import { isTextOnlyFallback, MessageVisuals, readMessageVisuals } from '@/components/visuals/MessageVisuals'
import { formatClockTime, readCitations } from './conversationDisplay'
import { messages } from '@/i18n'

interface BubbleStyle {
  bubbleClassNames: string
  /** Small label above the text, e.g. "Bot". Customers have none. */
  authorLabel?: string
  authorLabelClassNames?: string
}

const sentBubbleBase = 'self-end rounded-[12px_12px_4px_12px]'

const customerStyle: BubbleStyle = { bubbleClassNames: 'self-start rounded-[12px_12px_12px_4px] border border-line bg-surface' }
const outreachStyle: BubbleStyle = {
  bubbleClassNames: joinClassNames(sentBubbleBase, 'bg-ink text-inverse'),
  get authorLabel() {
    return messages().inbox.outreachAgent
  },
  authorLabelClassNames: 'text-faint',
}
const botStyle: BubbleStyle = {
  bubbleClassNames: joinClassNames(sentBubbleBase, 'bg-brand-soft'),
  get authorLabel() {
    return messages().inbox.bot
  },
  authorLabelClassNames: 'text-brand-strong',
}
const operatorStyle: BubbleStyle = {
  bubbleClassNames: joinClassNames(sentBubbleBase, 'bg-ink text-inverse'),
  get authorLabel() {
    return messages().inbox.you
  },
  authorLabelClassNames: 'text-faint',
}

function getBubbleStyle(message: ConversationMessage): BubbleStyle {
  if (message.author === 'customer') return customerStyle
  if (message.author === 'operator') return operatorStyle
  return message.metadata.sentBy === 'outreach' ? outreachStyle : botStyle
}

/**
 * One message in the chat detail thread. Messages sent from our side (outreach agent, bot, you)
 * sit on the right with a small author and time label; customer messages sit on the left.
 * System messages are centered amber pills, such as "Bot handed this to you". A reply the channel
 * could not deliver says so under its text. A bot reply's cards, charts, tables, KPI tiles and diagrams are
 * drawn under its text at the full width of the thread; their buttons are the customer's, so here they are
 * shown disabled.
 */
export function ChatMessageBubble({ message }: { message: ConversationMessage }) {
  if (message.author === 'system') {
    return (
      <div lang="en" className="flex items-center gap-2 self-center rounded-full bg-amber-soft px-3 py-1.5 text-[12px] font-medium text-amber-strong">
        {message.text}
      </div>
    )
  }

  // A message that is only files shows its cards (MessageFiles, next to this bubble), not their names again.
  const isFilesOnly = readMessageFiles(message).isFilesOnly
  const visuals = readMessageVisuals(message.metadata)
  if (isFilesOnly && visuals.length === 0) return null
  const bubbleStyle = getBubbleStyle(message)
  const deliveryError = typeof message.metadata.deliveryError === 'string' ? message.metadata.deliveryError : null
  const citations = readCitations(message)
  const showsText = !isTextOnlyFallback(message.metadata) && !isFilesOnly
  const bubble = (showsText || deliveryError || citations.length > 0) && (
    <div className={joinClassNames('flex box-content max-w-[72%] flex-col gap-1 px-3 py-2.5 leading-[1.45] whitespace-pre-line', bubbleStyle.bubbleClassNames)}>
      {bubbleStyle.authorLabel && (
        <span lang="en" className={joinClassNames('text-[11px]', bubbleStyle.authorLabelClassNames)}>
          {`${bubbleStyle.authorLabel} · ${formatClockTime(message.createdAt)}`}
        </span>
      )}
      {showsText && message.text}
      {citations.length > 0 && (
        <span lang="en" aria-label={messages().inbox.sources} className="flex flex-wrap gap-1.5 whitespace-normal">
          {citations.map((citation) => (
            <span key={citation} className="rounded-md bg-surface px-2 py-0.5 text-[11px] text-ink-2">
              {citation}
            </span>
          ))}
        </span>
      )}
      {deliveryError && (
        <span lang="en" className="text-[11px] font-medium text-amber-strong">
          {messages().inbox.notDelivered}{' '}{deliveryError}
        </span>
      )}
    </div>
  )
  if (visuals.length === 0) return bubble || null
  return (
    <>
      {bubble}
      <MessageVisuals blocks={visuals} />
    </>
  )
}
