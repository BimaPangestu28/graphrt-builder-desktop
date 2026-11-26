import { render, screen } from '@testing-library/react'
import type { ConversationMessage } from '@/api/conversationTypes'
import { ChatMessageBubble } from '../ChatMessageBubble'

function botMessage(metadata: Record<string, unknown>): ConversationMessage {
  return { id: 'm1', conversationId: 'c1', author: 'bot', text: 'Ongkir sesuai jarak.', metadata, createdAt: '2026-11-26T10:00:00Z' }
}

describe('ChatMessageBubble', () => {
  it('shows the sources of a bot reply with their pages', () => {
    render(<ChatMessageBubble message={botMessage({ citations: ['menu.pdf · p3, p12', 'faq.md', 7] })} />)
    expect(screen.getByText('menu.pdf · p3, p12')).toBeInTheDocument()
    expect(screen.getByText('faq.md')).toBeInTheDocument()
    expect(screen.queryByText('7')).not.toBeInTheDocument()
  })

  it('shows no sources when the reply has none', () => {
    render(<ChatMessageBubble message={botMessage({})} />)
    expect(screen.queryByLabelText('Sources')).not.toBeInTheDocument()
  })
})
