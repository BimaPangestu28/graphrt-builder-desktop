import { act, renderHook, waitFor } from '@testing-library/react'
import { resetSampleAgentFiles } from '@/api/sampleBackend/agentFiles'
import { useChatAttachments } from '../useChatAttachments'

describe('useChatAttachments', () => {
  beforeEach(() => resetSampleAgentFiles())

  it('keeps files attached while the chat stays the same, and empties the list for another chat', async () => {
    const { result, rerender } = renderHook(({ conversationId }) => useChatAttachments('catering-assistant', conversationId, { asOwner: true }), {
      initialProps: { conversationId: 'cafe-4410' },
    })
    act(() => result.current.choose())
    await waitFor(() => expect(result.current.pending).toHaveLength(1))

    rerender({ conversationId: 'cafe-4410' })
    expect(result.current.pending).toHaveLength(1)

    rerender({ conversationId: 'office-0932' })
    expect(result.current.pending).toHaveLength(0)
  })
})
