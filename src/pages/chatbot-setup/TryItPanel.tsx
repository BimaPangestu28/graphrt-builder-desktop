import { useState, type FormEvent } from 'react'
import { initialTryItMessages, type TryItMessage } from '@/data/chatbotSetup'
import { searchKnowledgePassages } from '@/data/knowledge'

/**
 * Builds the bot's demo answer from the mock knowledge search, or hands over when nothing matches.
 *
 * @param customerText - What the tester wrote as a customer
 * @param sequenceNumber - Keeps message ids unique
 * @returns The bot message to append
 */
export function buildDemoBotReply(customerText: string, sequenceNumber: number): TryItMessage {
  const bestPassage = searchKnowledgePassages(customerText)[0]
  if (!bestPassage || bestPassage.score < 0.55) {
    return { id: `bot-${sequenceNumber}`, sender: 'bot', paragraphs: ['Sebentar ya kak, saya sambungkan ke admin kami'], citations: ['Passed to you'] }
  }
  const sourceName = bestPassage.citation.split(' · ').slice(0, -1).join(' · ')
  return { id: `bot-${sequenceNumber}`, sender: 'bot', paragraphs: [bestPassage.text], citations: [sourceName] }
}

function TryItBubble({ message }: { message: TryItMessage }) {
  if (message.sender === 'customer') {
    return <div className="box-content max-w-[80%] self-end rounded-[12px_12px_4px_12px] bg-[#D9FDD3] px-3 py-2.5 leading-[1.45]">{message.paragraphs.join(' ')}</div>
  }
  return (
    <div className="flex box-content max-w-[86%] flex-col gap-2 self-start rounded-[12px_12px_12px_4px] bg-surface px-3 py-2.5 leading-[1.45]">
      {message.paragraphs.map((paragraph) => (
        <span key={paragraph}>{paragraph}</span>
      ))}
      {message.citations && (
        <span lang="en" className="flex flex-wrap gap-1.5">
          {message.citations.map((citation) => (
            <span key={citation} className="rounded-md bg-canvas px-2 py-0.5 text-[11px] text-ink-2">
              {citation}
            </span>
          ))}
        </span>
      )}
    </div>
  )
}

/**
 * "Try it" panel on the chatbot setup: a WhatsApp-styled preview where you write as a customer
 * and get a demo answer with its sources. Reset restores the sample conversation.
 */
export function TryItPanel() {
  const [messages, setMessages] = useState<TryItMessage[]>(initialTryItMessages)
  const [testMessage, setTestMessage] = useState('')

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const customerText = testMessage.trim()
    if (customerText === '') return
    setMessages((previousMessages) => [
      ...previousMessages,
      { id: `customer-${previousMessages.length}`, sender: 'customer', paragraphs: [customerText] },
      buildDemoBotReply(customerText, previousMessages.length + 1),
    ])
    setTestMessage('')
  }

  return (
    <aside aria-labelledby="t-h" className="box-border flex min-w-0 flex-[2_1_340px] flex-col gap-3.5 self-start border-l border-line bg-subtle p-6">
      <div className="flex items-center justify-between">
        <h2 id="t-h" className="m-0 text-[15px] font-semibold">
          Try it
        </h2>
        <button
          type="button"
          onClick={() => setMessages(initialTryItMessages)}
          className="h-[30px] cursor-pointer rounded-lg border border-line-strong bg-surface px-2.5 text-[12px] font-medium text-ink-2 hover:bg-subtle"
        >
          Reset
        </button>
      </div>
      <div lang="id" aria-live="polite" className="box-border flex h-[460px] flex-none flex-col gap-2.5 overflow-y-auto rounded-[14px] bg-[#EFEAE2] p-4">
        {messages.map((message) => (
          <TryItBubble key={message.id} message={message} />
        ))}
      </div>
      <form onSubmit={handleSubmit} className="flex gap-2">
        <label htmlFor="try" className="sr-only">
          Test message
        </label>
        <input
          id="try"
          type="text"
          placeholder="Write as a customer"
          value={testMessage}
          onChange={(event) => setTestMessage(event.target.value)}
          className="box-border h-10 min-w-0 flex-1 rounded-[10px] border border-line-strong bg-surface px-3 text-[14px] text-ink outline-none focus:border-brand"
        />
        <button type="submit" className="h-10 cursor-pointer rounded-[10px] border-0 bg-ink px-3.5 text-[14px] font-medium text-white hover:bg-ink-2">
          Send
        </button>
      </form>
    </aside>
  )
}
