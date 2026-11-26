import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react'
import { sendCustomerMessage, startTestConversation } from '@/api/conversations'
import type { ConversationMessage } from '@/api/conversationTypes'
import { useConversationDetail } from '@/hooks/useConversations'
import { toErrorMessage } from '@/lib/errors'
import { messages } from '@/i18n'

function readCitations(message: ConversationMessage): string[] {
  const citations = message.metadata.citations
  return Array.isArray(citations) ? citations.filter((citation): citation is string => typeof citation === 'string') : []
}

function TryItBubble({ message }: { message: ConversationMessage }) {
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
  return (
    <div className="flex box-content max-w-[86%] flex-col gap-2 self-start rounded-[12px_12px_12px_4px] bg-surface px-3 py-2.5 leading-[1.45]">
      {message.author === 'operator' && (
        <span lang="en" className="text-[11px] text-muted">
          {messages().chatbot.you}
        </span>
      )}
      {message.text.split('\n\n').map((paragraph, index) => (
        <span key={index}>{paragraph}</span>
      ))}
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
 * show as notices. Reset starts a new test conversation, so the bot's memory starts empty again.
 */
export function TryItPanel({ agentId }: { agentId: string }) {
  const { conversationId, startError, startNew } = useTestConversation(agentId)
  const { data: detail } = useConversationDetail(conversationId)
  const [testMessage, setTestMessage] = useState('')
  const [isWaitingForBot, setIsWaitingForBot] = useState(false)
  const [sendError, setSendError] = useState<string | null>(null)

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const customerText = testMessage.trim()
    if (customerText === '' || !conversationId) return
    setTestMessage('')
    setSendError(null)
    setIsWaitingForBot(true)
    try {
      await sendCustomerMessage(conversationId, customerText)
    } catch (rawError) {
      setSendError(toErrorMessage(rawError))
    } finally {
      setIsWaitingForBot(false)
    }
  }

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
      <div lang="id" aria-live="polite" className="box-border flex h-[460px] flex-none flex-col gap-2.5 overflow-y-auto rounded-[14px] bg-[#EFEAE2] p-4">
        {detail?.messages.length === 0 && (
          <span lang="en" className="self-center text-[12px] text-ink-2">
            {messages().chatbot.writeAsACustomerToTry}
          </span>
        )}
        {detail?.messages.map((message) => <TryItBubble key={message.id} message={message} />)}
        {isWaitingForBot && (
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
      <form onSubmit={(event) => void handleSubmit(event)} className="flex gap-2">
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
          disabled={!conversationId || isWaitingForBot}
          className="h-10 cursor-pointer rounded-[10px] border-0 bg-ink px-3.5 text-[14px] font-medium text-white hover:bg-ink-2 disabled:cursor-default disabled:opacity-50"
        >
          {messages().chatbot.send}
        </button>
      </form>
    </aside>
  )
}
