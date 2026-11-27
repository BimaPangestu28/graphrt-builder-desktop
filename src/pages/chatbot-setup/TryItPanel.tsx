import { Fragment, useCallback, useEffect, useRef, useState, type FormEvent } from 'react'
import { sendCustomerCardAnswer, sendCustomerMessage, startTestConversation } from '@/api/conversations'
import type { ConversationMessage } from '@/api/conversationTypes'
import { useFileDropZone } from '@/components/fileDrop'
import { AttachmentTray, MessageFiles, readMessageFiles, useChatAttachments } from '@/components/files'
import { Icon, joinClassNames } from '@/components/ui'
import type { CardSubmission } from '@/components/visuals/adaptive-card/AdaptiveCardView'
import { isTextOnlyFallback, MessageVisuals, readMessageVisuals } from '@/components/visuals/MessageVisuals'
import { useConversationDetail, useReplyDraft } from '@/hooks/useConversations'
import { readCitations } from '@/pages/inbox/conversationDisplay'
import { toErrorMessage } from '@/lib/errors'
import { messages } from '@/i18n'

interface TryItBubbleProps {
  message: ConversationMessage
  /** Answers this message's card as the customer; only the bot's latest message can be answered. */
  onCardSubmit?: (submission: CardSubmission) => void
  isSubmitting: boolean
}

function TryItBubble({ message, onCardSubmit, isSubmitting }: TryItBubbleProps) {
  // A message that is only files shows its cards (MessageFiles), not their names again.
  const isFilesOnly = readMessageFiles(message).isFilesOnly
  if (isFilesOnly && message.author !== 'bot') return null
  if (message.author === 'customer') {
    return <div className="box-content max-w-[80%] self-end rounded-[12px_12px_4px_12px] bg-[#D9FDD3] px-3 py-2.5 leading-[1.45]">{message.text}</div>
  }
  if (message.author === 'system') {
    return (
      <div lang="en" className="self-center rounded-full bg-amber-soft px-3 py-1.5 text-[12px] font-medium text-amber-strong">
        {message.text}
      </div>
    )
  }
  const citations = readCitations(message)
  const visuals = readMessageVisuals(message.metadata)
  const showsText = !isTextOnlyFallback(message.metadata) && !isFilesOnly
  const bubble = (showsText || citations.length > 0) && (
    <div className="flex box-content max-w-[86%] flex-col gap-2 self-start rounded-[12px_12px_12px_4px] bg-surface px-3 py-2.5 leading-[1.45]">
      {message.author === 'operator' && (
        <span lang="en" className="text-[11px] text-muted">
          {messages().chatbot.you}
        </span>
      )}
      {showsText && message.text.split('\n\n').map((paragraph, index) => <span key={index}>{paragraph}</span>)}
      {citations.length > 0 && (
        <span lang="en" className="flex flex-wrap gap-1.5">
          {citations.map((citation) => (
            <span key={citation} className="rounded-md bg-canvas px-2 py-0.5 text-[11px] text-ink-2">
              {citation}
            </span>
          ))}
        </span>
      )}
    </div>
  )
  return (
    <>
      {bubble}
      <MessageVisuals blocks={visuals} onCardSubmit={onCardSubmit} isSubmitting={isSubmitting} disabledHint={messages().visuals.buttonsAnswered} />
    </>
  )
}

/** Opens a test conversation for `agentId` on mount and again on `startNew` (Reset). */
function useTestConversation(agentId: string) {
  const [conversationId, setConversationId] = useState<string | null>(null)
  const [startError, setStartError] = useState<string | null>(null)
  const latestStartRef = useRef(0)

  const startNew = useCallback(() => {
    latestStartRef.current += 1
    const startNumber = latestStartRef.current
    setStartError(null)
    startTestConversation(agentId)
      .then((detail) => {
        if (latestStartRef.current === startNumber) setConversationId(detail.conversation.id)
      })
      .catch((rawError: unknown) => {
        if (latestStartRef.current === startNumber) setStartError(toErrorMessage(rawError))
      })
  }, [agentId])

  useEffect(() => {
    startNew()
    return () => {
      latestStartRef.current += 1
    }
  }, [startNew])

  return { conversationId, startError, startNew }
}

/**
 * "Try it" panel on the chatbot setup: a WhatsApp-styled chat on the in-app test channel. You write as
 * a customer and the chatbot's real workflow answers (sample answers in the browser preview); hand-offs
 * show as notices. Cards, charts, tables, KPI tiles and diagrams the bot returns are drawn in the chat, and
 * the buttons of its latest card answer as the customer. Reset starts a new test conversation, so the bot's memory starts empty again.
 * When the chatbot reads files or looks at pictures, the paperclip (or a drop on the chat)
 * attaches them to the next message, and files the bot hands back appear as cards under its reply.
 */
export function TryItPanel({ agentId }: { agentId: string }) {
  const { conversationId, startError, startNew } = useTestConversation(agentId)
  const { data: detail } = useConversationDetail(conversationId)
  const replyDraft = useReplyDraft(conversationId)
  const [testMessage, setTestMessage] = useState('')
  const [isWaitingForBot, setIsWaitingForBot] = useState(false)
  const [sendError, setSendError] = useState<string | null>(null)
  const attachments = useChatAttachments(agentId, conversationId)
  const { zoneRef, dragState, browserDropHandlers } = useFileDropZone({
    accept: { files: true, folders: false },
    multiple: true,
    disabled: !attachments.takesFiles,
    onDrop: (droppedItems) => attachments.addDropped(droppedItems.map((item) => item.path)),
  })

  // Keep the newest message, its files and the reply being written in view (file cards are tall).
  const messageCount = detail?.messages.length ?? 0
  useEffect(() => {
    const chatElement = zoneRef.current
    if (chatElement) chatElement.scrollTop = chatElement.scrollHeight
  }, [zoneRef, messageCount, replyDraft, isWaitingForBot])

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const customerText = testMessage.trim()
    if ((customerText === '' && attachments.pending.length === 0) || !conversationId || attachments.isAttaching) return
    const sentFiles = attachments.takeForSending()
    setTestMessage('')
    setSendError(null)
    setIsWaitingForBot(true)
    try {
      await sendCustomerMessage(
        conversationId,
        customerText,
        sentFiles.map((card) => card.reference),
      )
    } catch (rawError) {
      setSendError(toErrorMessage(rawError))
      attachments.putBack(sentFiles)
    } finally {
      setIsWaitingForBot(false)
    }
  }

  async function handleCardSubmit(submission: CardSubmission) {
    if (!conversationId || isWaitingForBot) return
    setSendError(null)
    setIsWaitingForBot(true)
    try {
      await sendCustomerCardAnswer(conversationId, { action: submission.action, title: submission.title, values: submission.values })
    } catch (rawError) {
      setSendError(toErrorMessage(rawError))
    } finally {
      setIsWaitingForBot(false)
    }
  }

  // A card can be answered while it is the bot's latest word: once anyone wrote after it, it is history.
  const answerableMessageId = detail?.messages.filter((message) => message.author !== 'system').at(-1)?.id
  const errorMessage = startError ?? sendError
  return (
    <aside aria-labelledby="t-h" className="box-border flex min-w-0 flex-[2_1_340px] flex-col gap-3.5 self-start border-l border-line bg-subtle p-6">
      <div className="flex items-center justify-between">
        <h2 id="t-h" className="m-0 text-[15px] font-semibold">
          {messages().chatbot.tryIt}
        </h2>
        <button
          type="button"
          onClick={startNew}
          className="h-[30px] cursor-pointer rounded-lg border border-line-strong bg-surface px-2.5 text-[12px] font-medium text-ink-2 hover:bg-subtle"
        >
          {messages().chatbot.reset}
        </button>
      </div>
      <div
        ref={zoneRef}
        {...browserDropHandlers}
        lang="id"
        aria-live="polite"
        className={joinClassNames(
          'box-border flex h-[460px] flex-none flex-col gap-2.5 overflow-y-auto rounded-[14px] bg-[#EFEAE2] p-4',
          dragState === 'accepting' && 'outline-2 outline-offset-2 outline-brand',
        )}
      >
        {dragState === 'accepting' && (
          <span lang="en" className="self-center rounded-full bg-surface px-3 py-1.5 text-[12px] font-medium text-ink-2">
            {messages().files.dropToAttach}
          </span>
        )}
        {detail?.messages.length === 0 && (
          <span lang="en" className="self-center text-[12px] text-ink-2">
            {messages().chatbot.writeAsACustomerToTry}
          </span>
        )}
        {detail?.messages.map((message) => (
          <Fragment key={message.id}>
            <TryItBubble
              message={message}
              onCardSubmit={message.author === 'bot' && message.id === answerableMessageId ? (submission) => void handleCardSubmit(submission) : undefined}
              isSubmitting={isWaitingForBot}
            />
            <MessageFiles agentId={agentId} message={message} side={message.author === 'customer' ? 'end' : 'start'} />
          </Fragment>
        ))}
        {replyDraft !== null && (
          <div data-testid="reply-draft" className="flex box-content max-w-[86%] flex-col gap-2 self-start rounded-[12px_12px_12px_4px] bg-surface px-3 py-2.5 leading-[1.45]">
            {replyDraft.split('\n\n').map((paragraph, index) => (
              <span key={index}>{paragraph}</span>
            ))}
          </div>
        )}
        {isWaitingForBot && replyDraft === null && (
          <span lang="en" className="self-start text-[12px] text-ink-2">
            {messages().chatbot.botIsTyping}
          </span>
        )}
      </div>
      {errorMessage && (
        <p role="alert" className="m-0 text-[13px] text-amber-strong">
          {errorMessage}
        </p>
      )}
      <AttachmentTray attachments={attachments} />
      <form onSubmit={(event) => void handleSubmit(event)} className="flex gap-2">
        <button
          type="button"
          onClick={attachments.choose}
          disabled={!conversationId || attachments.isAttaching}
          aria-label={messages().files.attachFiles}
          title={messages().files.attachFiles}
          className="flex size-10 flex-none cursor-pointer items-center justify-center rounded-[10px] border border-line-strong bg-surface text-ink-2 hover:bg-subtle disabled:cursor-default disabled:opacity-50"
        >
          <Icon name="paperclip" size={18} />
        </button>
        <label htmlFor="try" className="sr-only">
          {messages().chatbot.testMessage}
        </label>
        <input
          id="try"
          type="text"
          placeholder={messages().chatbot.writeAsACustomer}
          value={testMessage}
          onChange={(event) => setTestMessage(event.target.value)}
          className="box-border h-10 min-w-0 flex-1 rounded-[10px] border border-line-strong bg-surface px-3 text-[14px] text-ink outline-none focus:border-brand"
        />
        <button
          type="submit"
          disabled={!conversationId || isWaitingForBot || attachments.isAttaching}
          className="h-10 cursor-pointer rounded-[10px] border-0 bg-ink px-3.5 text-[14px] font-medium text-white hover:bg-ink-2 disabled:cursor-default disabled:opacity-50"
        >
          {messages().chatbot.send}
        </button>
      </form>
    </aside>
  )
}
