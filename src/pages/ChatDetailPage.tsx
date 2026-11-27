import { Fragment, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { closeConversation, handBack, sendOperatorReply, takeOver } from '@/api/conversations'
import type { Conversation, ConversationDetail } from '@/api/conversationTypes'
import { useFileDropZone } from '@/components/fileDrop'
import { MessageFiles, useChatAttachments } from '@/components/files'
import { AppShell } from '@/components/layout'
import { joinClassNames } from '@/components/ui'
import { useConversationDetail, useConversationList, useReplyDraft } from '@/hooks/useConversations'
import { ChatMessageBubble } from './inbox/ChatMessageBubble'
import { buildConversationPath } from './inbox/ConversationTable'
import { CustomerPanel } from './inbox/CustomerPanel'
import { formatTimeAgo, getChannelLabel, isOwnerReplying, previewLastMessage } from './inbox/conversationDisplay'
import { ReplyComposer } from './inbox/ReplyComposer'
import { messages as currentMessages, useT } from '@/i18n'
import { localizedRecord } from '@/i18n/localized'

const waitingFilter = { status: 'waiting_for_you' } as const

function WaitingConversationList({ conversations, activeConversationId }: { conversations: Conversation[]; activeConversationId: string | null }) {
  return (
    <nav aria-label={currentMessages().inbox.conversations} className="box-border flex max-w-full min-w-0 flex-[1_1_260px] flex-col border-r border-line">
      <div className="box-border flex h-16 items-center justify-between border-b border-line px-4">
        <span className="font-semibold">{currentMessages().inbox.waitingForYou}</span>
        <span className="text-[12px] text-muted">{conversations.length}</span>
      </div>
      {conversations.length === 0 && <span className="px-4 py-3.5 text-muted">{currentMessages().inbox.nothingWaiting}</span>}
      {conversations.map((conversation) => {
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
              <span className="text-[12px] text-muted">{formatTimeAgo(conversation.updatedAt)}</span>
            </span>
            <span className="text-[13px] text-body" lang="id">
              {previewLastMessage(conversation)}
            </span>
          </Link>
        )
      })}
    </nav>
  )
}

const statusPillTexts: Readonly<Record<Conversation['status'], string>> = localizedRecord(() => currentMessages().inbox.statusPill)

function ConversationStatusBadge({ conversation }: { conversation: Conversation }) {
  return (
    <span
      role="status"
      className={joinClassNames(
        'rounded-full px-2.5 py-1 text-[12px] font-semibold',
        isOwnerReplying(conversation) ? 'bg-amber-soft text-amber-strong' : conversation.status === 'closed' ? 'bg-canvas text-ink-2' : 'bg-brand-soft text-brand-strong',
      )}
    >
      {statusPillTexts[conversation.status]}
    </span>
  )
}

/** The bot's suggestion, until you have replied after the hand-off. */
function getSuggestedReply({ conversation, messages }: ConversationDetail): string | null {
  const lastOwnMessage = [...messages].reverse().find((message) => message.author !== 'system')
  return lastOwnMessage?.author === 'operator' ? null : conversation.suggestedReply
}

function useConversationActions(conversationId: string) {
  const [isBusy, setIsBusy] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)

  async function runAction(action: () => Promise<unknown>): Promise<boolean> {
    setIsBusy(true)
    setActionError(null)
    try {
      await action()
      return true
    } catch (rawError) {
      setActionError(rawError instanceof Error ? rawError.message : currentMessages().platform.genericError)
      return false
    } finally {
      setIsBusy(false)
    }
  }

  return {
    isBusy,
    actionError,
    takeOver: () => runAction(() => takeOver(conversationId)),
    handBack: () => runAction(() => handBack(conversationId)),
    close: () => runAction(() => closeConversation(conversationId)),
    reply: (text: string, attachments: string[] = []) => runAction(() => sendOperatorReply(conversationId, text, attachments)),
  }
}

/** Thread, composer and customer panel for one conversation. Keyed by conversation so state resets on switch. */
function ConversationWorkspace({ detail }: { detail: ConversationDetail }) {
  const { conversation, messages } = detail
  const [draft, setDraft] = useState('')
  const [isOrderSaved, setIsOrderSaved] = useState(false)
  const actions = useConversationActions(conversation.id)
  const canReply = isOwnerReplying(conversation)
  const replyDraft = useReplyDraft(conversation.id)

  const attachments = useChatAttachments(conversation.agentId, conversation.id, { asOwner: true })
  const { zoneRef, dragState, browserDropHandlers } = useFileDropZone({
    accept: { files: true, folders: false },
    multiple: true,
    disabled: !canReply,
    onDrop: (droppedItems) => attachments.addDropped(droppedItems.map((item) => item.path)),
  })

  async function sendReply() {
    const sentFiles = attachments.takeForSending()
    const wasSent = await actions.reply(
      draft.trim(),
      sentFiles.map((card) => card.reference),
    )
    if (wasSent) setDraft('')
    else attachments.putBack(sentFiles)
  }

  return (
    <>
      <section aria-label={currentMessages().inbox.chat} className="flex min-w-0 flex-[3_1_420px] flex-col">
        <header className="box-border flex h-16 items-center justify-between gap-3 border-b border-line px-5">
          <span className="flex flex-col">
            <b className="font-semibold">{conversation.customerName}</b>
            <span className="text-[12px] text-muted">
              {getChannelLabel(conversation.channel)} · {conversation.customerHandle}
            </span>
          </span>
          <ConversationStatusBadge conversation={conversation} />
        </header>
        <div
          ref={zoneRef}
          {...browserDropHandlers}
          className={joinClassNames('flex flex-1 flex-col gap-2.5 bg-subtle p-5', dragState === 'accepting' && 'outline-2 -outline-offset-2 outline-brand')}
          lang="id"
          aria-live="polite"
        >
          {dragState === 'accepting' && (
            <span lang="en" className="self-center rounded-full bg-surface px-3 py-1.5 text-[12px] font-medium text-ink-2">
              {currentMessages().files.dropToAttach}
            </span>
          )}
          {messages.map((message) => (
            <Fragment key={message.id}>
              <ChatMessageBubble message={message} />
              <MessageFiles agentId={conversation.agentId} message={message} side={message.author === 'customer' ? 'start' : 'end'} />
            </Fragment>
          ))}
          {replyDraft !== null && (
            <ChatMessageBubble
              message={{ id: 'reply-draft', conversationId: conversation.id, author: 'bot', text: replyDraft, metadata: {}, createdAt: new Date().toISOString() }}
            />
          )}
        </div>
        {actions.actionError && (
          <p role="alert" className="m-0 px-5 pt-3 text-[13px] text-amber-strong">
            {actions.actionError}
          </p>
        )}
        <ReplyComposer
          attachments={attachments}
          draft={draft}
          onDraftChange={setDraft}
          onSend={() => void sendReply()}
          canReply={canReply}
          disabledPlaceholder={conversation.status === 'closed' ? currentMessages().inbox.chatClosedPlaceholder : currentMessages().inbox.takeOverPlaceholder}
          suggestedReply={getSuggestedReply(detail)}
          isSending={actions.isBusy}
        />
      </section>
      <CustomerPanel
        conversation={conversation}
        isOrderSaved={isOrderSaved}
        onSaveOrder={() => setIsOrderSaved(true)}
        onTakeOver={() => void actions.takeOver()}
        onHandBack={() => void actions.handBack()}
        onClose={() => void actions.close()}
        isBusy={actions.isBusy}
      />
    </>
  )
}

function ConversationArea({ conversationId }: { conversationId: string | null }) {
  const { data: detail, error } = useConversationDetail(conversationId)
  const t = useT().inbox
  if (!conversationId) return <p className="m-0 flex-[3_1_420px] p-8 text-muted">{t.pickChat}</p>
  if (error) return <p className="m-0 flex-[3_1_420px] p-8 text-muted">{t.couldNotOpenChat(error.message)}</p>
  if (!detail) return <p className="m-0 flex-[3_1_420px] p-8 text-muted">{t.loadingChat}</p>
  return <ConversationWorkspace key={detail.conversation.id} detail={detail} />
}

/**
 * Screen 16 · Chat detail.
 * One conversation a chatbot handed over to a person. Left: chats waiting for you. Middle: the thread
 * and a reply composer (with the bot's suggested reply). Right: the bot's summary and memory.
 * "Take over from bot" / "Hand back to bot" switch who answers; replying takes the chat over; "Close
 * chat" ends it. Everything stays live through `conversation-event`s. The conversation comes from
 * `?id=` and defaults to the first waiting chat.
 */
export function ChatDetailPage() {
  const [searchParams] = useSearchParams()
  const { data: waitingConversations } = useConversationList(waitingFilter)
  // The default chat stays open after you take it over, even though it leaves the waiting list.
  const [defaultConversationId, setDefaultConversationId] = useState<string | null>(null)
  const firstWaitingId = waitingConversations?.[0]?.id ?? null
  if (defaultConversationId === null && firstWaitingId !== null) setDefaultConversationId(firstWaitingId)
  const conversationId = searchParams.get('id') ?? defaultConversationId ?? firstWaitingId

  return (
    <AppShell activeNav="inbox" agents={{ kind: 'list' }} mainClassName="flex flex-wrap">
      <WaitingConversationList conversations={waitingConversations ?? []} activeConversationId={conversationId} />
      <ConversationArea conversationId={conversationId} />
    </AppShell>
  )
}
