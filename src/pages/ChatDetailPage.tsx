import { useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { AppShell } from '@/components/layout'
import { joinClassNames } from '@/components/ui'
import { findConversation, inboxConversations, isWaitingForYou, type ChatMessage, type InboxConversation } from '@/data/inbox'
import { ChatMessageBubble } from './inbox/ChatMessageBubble'
import { buildConversationPath } from './inbox/ConversationTable'
import { CustomerPanel } from './inbox/CustomerPanel'
import { ReplyComposer } from './inbox/ReplyComposer'

const waitingConversations = inboxConversations.filter(isWaitingForYou)

function formatClockTime(date: Date): string {
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
}

function WaitingConversationList({ activeConversationId }: { activeConversationId: string }) {
  return (
    <nav aria-label="Conversations" className="box-border flex max-w-full min-w-0 flex-[1_1_260px] flex-col border-r border-line">
      <div className="box-border flex h-16 items-center justify-between border-b border-line px-4">
        <span className="font-semibold">Waiting for you</span>
        <span className="text-[12px] text-muted">{waitingConversations.length}</span>
      </div>
      {waitingConversations.map((conversation) => {
        const isActive = conversation.id === activeConversationId
        return (
          <Link
            key={conversation.id}
            to={buildConversationPath(conversation.id)}
            aria-current={isActive ? 'true' : undefined}
            className={joinClassNames(
              'flex flex-col gap-1 py-3.5 pr-4 no-underline !text-ink',
              isActive ? 'border-l-[3px] border-ink bg-canvas pl-4' : 'border-b border-chip pl-[19px] hover:bg-subtle',
            )}
          >
            <span className="flex justify-between">
              <b className="font-semibold">{conversation.customerName}</b>
              <span className="text-[12px] text-muted">{conversation.timeAgo}</span>
            </span>
            <span className="text-[13px] text-body" lang="id">
              {conversation.lastMessage}
            </span>
          </Link>
        )
      })}
    </nav>
  )
}

function TakeOverStatusPill({ isHumanReplying }: { isHumanReplying: boolean }) {
  return (
    <span
      role="status"
      className={joinClassNames(
        'rounded-full px-2.5 py-1 text-[12px] font-semibold',
        isHumanReplying ? 'bg-amber-soft text-amber-strong' : 'bg-brand-soft text-brand-strong',
      )}
    >
      {isHumanReplying ? 'Bot paused · you are replying' : 'Bot is answering'}
    </span>
  )
}

function buildNotice(text: string): ChatMessage {
  return { id: `notice-${Date.now()}-${Math.random()}`, author: 'notice', text }
}

/** Thread, composer and customer panel for one conversation. Keyed by conversation so state resets on switch. */
function ConversationWorkspace({ conversation }: { conversation: InboxConversation }) {
  const [messages, setMessages] = useState<ChatMessage[]>(conversation.messages)
  const [isHumanReplying, setIsHumanReplying] = useState(isWaitingForYou(conversation))
  const [draft, setDraft] = useState('')
  const [isOrderSaved, setIsOrderSaved] = useState(false)
  const hasSentReply = messages.some((message) => message.author === 'you')

  function sendReply() {
    const sentReply: ChatMessage = { id: `you-${Date.now()}`, author: 'you', text: draft.trim(), time: formatClockTime(new Date()) }
    setMessages((previousMessages) => [...previousMessages, sentReply])
    setDraft('')
  }

  function toggleTakeOver() {
    const notice = isHumanReplying ? 'You handed this back to the bot' : 'You took over · bot paused'
    setMessages((previousMessages) => [...previousMessages, buildNotice(notice)])
    setIsHumanReplying(!isHumanReplying)
  }

  return (
    <>
      <section aria-label="Chat" className="flex min-w-0 flex-[3_1_420px] flex-col">
        <header className="box-border flex h-16 items-center justify-between gap-3 border-b border-line px-5">
          <span className="flex flex-col">
            <b className="font-semibold">{conversation.customerName}</b>
            <span className="text-[12px] text-muted">WhatsApp · {conversation.phoneNumber}</span>
          </span>
          <TakeOverStatusPill isHumanReplying={isHumanReplying} />
        </header>
        <div className="flex flex-1 flex-col gap-2.5 bg-subtle p-5" lang="id" aria-live="polite">
          <span className="self-center text-[12px] text-muted" lang="en">
            Today
          </span>
          {messages.map((message) => (
            <ChatMessageBubble key={message.id} message={message} />
          ))}
        </div>
        <ReplyComposer
          draft={draft}
          onDraftChange={setDraft}
          onSend={sendReply}
          isHumanReplying={isHumanReplying}
          suggestedReply={hasSentReply ? undefined : conversation.suggestedReply}
        />
      </section>
      <CustomerPanel
        summary={conversation.summary}
        isHumanReplying={isHumanReplying}
        onToggleTakeOver={toggleTakeOver}
        isOrderSaved={isOrderSaved}
        onSaveOrder={() => setIsOrderSaved(true)}
      />
    </>
  )
}

/**
 * Screen 16 · Chat detail.
 * One WhatsApp conversation the chatbot handed over to a person. Left: chats waiting for you.
 * Middle: the thread and a reply composer (with the bot's suggested reply). Right: the bot's
 * summary of the order. "Hand back to bot" / "Take over from bot" toggles who answers; while the
 * bot answers, the composer is disabled. The conversation comes from `?id=` and defaults to the first waiting chat.
 */
export function ChatDetailPage() {
  const [searchParams] = useSearchParams()
  const conversation = findConversation(searchParams.get('id')) ?? waitingConversations[0]

  return (
    <AppShell activeNav="inbox" agents={{ kind: 'list' }} mainClassName="flex flex-wrap">
      <WaitingConversationList activeConversationId={conversation.id} />
      <ConversationWorkspace key={conversation.id} conversation={conversation} />
    </AppShell>
  )
}
