import { Link, useNavigate } from 'react-router-dom'
import type { Conversation } from '@/api/conversationTypes'
import { joinClassNames } from '@/components/ui'
import { routePaths } from '@/routes'
import { ConversationStatusPill } from './ConversationStatusPill'
import { describeContact, formatTimeAgo, isWaitingForYou, previewLastMessage } from './conversationDisplay'

/**
 * Builds the chat detail path for one conversation.
 *
 * @param conversationId - Conversation id
 * @returns e.g. "/inbox/conversation?id=cafe-4410"
 */
export function buildConversationPath(conversationId: string): string {
  return `${routePaths.chatDetail}?id=${encodeURIComponent(conversationId)}`
}

const headerCellClassNames = 'border-b border-line px-4 py-3 font-medium'

function ConversationRow({ conversation, isLast }: { conversation: Conversation; isLast: boolean }) {
  const navigate = useNavigate()
  const conversationPath = buildConversationPath(conversation.id)
  const cellClassNames = joinClassNames('px-4 py-3.5', !isLast && 'border-b border-chip')

  return (
    <tr
      onClick={() => navigate(conversationPath)}
      className={joinClassNames('cursor-pointer hover:bg-subtle', isWaitingForYou(conversation) && 'bg-amber-tint hover:bg-amber-soft/60')}
    >
      <td className={cellClassNames}>
        <span className="flex flex-col gap-0.5">
          <Link to={conversationPath} onClick={(event) => event.stopPropagation()} className="font-semibold no-underline !text-ink">
            {conversation.customerName}
          </Link>
          <span className="text-muted">{describeContact(conversation)}</span>
        </span>
      </td>
      <td className={joinClassNames(cellClassNames, 'text-ink-2')} lang="id">
        {previewLastMessage(conversation)}
      </td>
      <td className={cellClassNames}>
        <ConversationStatusPill conversation={conversation} />
      </td>
      <td className={joinClassNames(cellClassNames, 'text-muted')}>{formatTimeAgo(conversation.updatedAt)}</td>
    </tr>
  )
}

/** Table of chats on the inbox. Clicking a row (or the customer name) opens the chat detail. */
export function ConversationTable({ conversations, emptyMessage = 'No chats here right now' }: { conversations: Conversation[]; emptyMessage?: string }) {
  return (
    <div className="overflow-x-auto rounded-[14px] border border-line">
      <table className="w-full border-collapse text-[13px]">
        <thead>
          <tr className="text-left text-muted">
            <th className={headerCellClassNames}>Customer</th>
            <th className={headerCellClassNames}>Last message</th>
            <th className={headerCellClassNames}>Status</th>
            <th className={headerCellClassNames}>Time</th>
          </tr>
        </thead>
        <tbody>
          {conversations.map((conversation, index) => (
            <ConversationRow key={conversation.id} conversation={conversation} isLast={index === conversations.length - 1} />
          ))}
          {conversations.length === 0 && (
            <tr>
              <td colSpan={4} className="px-4 py-8 text-center text-muted">
                {emptyMessage}
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  )
}
