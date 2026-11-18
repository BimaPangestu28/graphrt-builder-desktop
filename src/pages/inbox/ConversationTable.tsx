import { Link, useNavigate } from 'react-router-dom'
import { joinClassNames } from '@/components/ui'
import { isWaitingForYou, type InboxConversation } from '@/data/inbox'
import { routePaths } from '@/routes'
import { ConversationStatusPill } from './ConversationStatusPill'

/**
 * Builds the chat detail path for one conversation.
 *
 * @param conversationId - id from `inboxConversations`
 * @returns e.g. "/inbox/conversation?id=cafe-4410"
 */
export function buildConversationPath(conversationId: string): string {
  return `${routePaths.chatDetail}?id=${encodeURIComponent(conversationId)}`
}

const headerCellClassNames = 'border-b border-line px-4 py-3 font-medium'

function ConversationRow({ conversation, isLast }: { conversation: InboxConversation; isLast: boolean }) {
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
          <span className="text-muted">{conversation.contactDetail}</span>
        </span>
      </td>
      <td className={joinClassNames(cellClassNames, 'text-ink-2')} lang="id">
        {conversation.lastMessage}
      </td>
      <td className={cellClassNames}>
        <ConversationStatusPill status={conversation.status} />
      </td>
      <td className={joinClassNames(cellClassNames, 'text-muted')}>{conversation.timeAgo}</td>
    </tr>
  )
}

/** Table of chats on the inbox. Clicking a row (or the customer name) opens the chat detail. */
export function ConversationTable({ conversations }: { conversations: InboxConversation[] }) {
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
                No chats here right now
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  )
}
