import { act, renderHook, waitFor } from '@testing-library/react'
import type { ConversationEventPayload } from '@/api/conversationTypes'
import { useReplyDraft } from '../useConversations'

const listeners: Array<(payload: ConversationEventPayload) => void> = []

vi.mock('@/api/conversations', () => ({
  subscribeToConversationEvents: (listener: (payload: ConversationEventPayload) => void) => {
    listeners.push(listener)
    return Promise.resolve(() => listeners.splice(listeners.indexOf(listener), 1))
  },
}))

function send(payload: Partial<ConversationEventPayload>) {
  act(() => {
    listeners.forEach((listener) =>
      listener({ kind: 'reply_draft', conversationId: 'c1', agentId: 'a1', status: 'bot_answering', message: null, ...payload }),
    )
  })
}

describe('useReplyDraft', () => {
  it('shows the growing reply and clears it once the finished message is stored', async () => {
    const { result } = renderHook(() => useReplyDraft('c1'))
    await waitFor(() => expect(listeners).toHaveLength(1))

    send({ draft: 'Ada ' })
    expect(result.current).toBe('Ada ')
    send({ draft: 'Ada kak' })
    expect(result.current).toBe('Ada kak')
    send({ conversationId: 'c2', draft: 'other chat' })
    expect(result.current).toBe('Ada kak')

    send({ kind: 'message_added', draft: undefined })
    expect(result.current).toBeNull()
  })

  it('is null for another conversation', async () => {
    const { result } = renderHook(() => useReplyDraft('c2'))
    await waitFor(() => expect(listeners.length).toBeGreaterThan(0))
    send({ draft: 'for c1' })
    expect(result.current).toBeNull()
  })
})
