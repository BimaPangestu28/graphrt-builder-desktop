import { act, render } from '@testing-library/react'
import { useState } from 'react'
import { describe, expect, it } from 'vitest'
import { useFollowNewContent } from '../useFollowNewContent'

function ChatThread({ messages }: { messages: string[] }) {
  const chatBodyRef = useFollowNewContent()
  return (
    <div ref={chatBodyRef} data-testid="chat-body">
      {messages.map((message) => (
        <p key={message}>{message}</p>
      ))}
    </div>
  )
}

/** jsdom has no layout, so give the scroll container fixed sizes. */
function fakeScrollSizes(element: HTMLElement, sizes: { scrollHeight: number; clientHeight: number }) {
  Object.defineProperty(element, 'scrollHeight', { configurable: true, get: () => sizes.scrollHeight })
  Object.defineProperty(element, 'clientHeight', { configurable: true, get: () => sizes.clientHeight })
}

let addMessage: (message: string) => void = () => undefined
function GrowingChat() {
  const [messages, setMessages] = useState(['first'])
  addMessage = (message) => setMessages((previous) => [...previous, message])
  return <ChatThread messages={messages} />
}

const flushObservers = () => act(() => new Promise((resolve) => setTimeout(resolve, 0)))

describe('useFollowNewContent', () => {
  it('scrolls to the newest message while the reader is at the bottom', async () => {
    const { getByTestId } = render(<GrowingChat />)
    const chatBody = getByTestId('chat-body')
    fakeScrollSizes(chatBody, { scrollHeight: 900, clientHeight: 300 })
    act(() => addMessage('second'))
    await flushObservers()
    expect(chatBody.scrollTop).toBe(900)
  })

  it('stops following after the reader scrolls up to older messages', async () => {
    const { getByTestId } = render(<GrowingChat />)
    const chatBody = getByTestId('chat-body')
    fakeScrollSizes(chatBody, { scrollHeight: 900, clientHeight: 300 })
    chatBody.scrollTop = 100
    chatBody.dispatchEvent(new Event('scroll'))
    act(() => addMessage('second'))
    await flushObservers()
    expect(chatBody.scrollTop).toBe(100)
  })
})
