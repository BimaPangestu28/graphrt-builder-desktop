import { render, screen, within } from '@testing-library/react'
import type { FileCard } from '@/api/agentFileTypes'
import type { ConversationMessage } from '@/api/conversationTypes'
import { sampleMenuChart, sampleOrderCard } from '@/api/sampleBackend/fixtures/sampleChatVisuals'
import { MessageFiles } from '@/components/files'
import { ChatMessageBubble } from '@/pages/inbox/ChatMessageBubble'

/**
 * A bot reply that carries UI blocks and files in the same message, drawn the way the chat detail screen
 * draws a message: the bubble (text and blocks), then the message's files.
 */

const quote: FileCard = { reference: 'workspace:quotes/quote.pdf', name: 'quote.pdf', sizeBytes: 184_320, mimeType: 'application/pdf', kind: 'pdf', preview: 'none' }

function botMessage(metadata: Record<string, unknown>, text: string): ConversationMessage {
  return { id: 'm1', conversationId: 'c1', author: 'bot', text, metadata, createdAt: '2026-11-27T09:00:00Z' }
}

function renderMessage(message: ConversationMessage) {
  return render(
    <>
      <ChatMessageBubble message={message} />
      <MessageFiles agentId="agent-1" message={message} side="end" />
    </>,
  )
}

describe('a reply with blocks and files in one message', () => {
  it('shows the text, the card, the chart and the file card', async () => {
    renderMessage(botMessage({ visuals: [sampleOrderCard, sampleMenuChart], files: [quote] }, 'Ini penawarannya kak'))
    expect(screen.getByText('Ini penawarannya kak')).toBeInTheDocument()
    expect(await screen.findByRole('region', { name: 'Pesanan nasi box' })).toBeInTheDocument()
    expect(await screen.findByRole('region', { name: 'Paket paling sering dipesan' })).toBeInTheDocument()
    const files = screen.getByRole('region', { name: 'Files the agent made' })
    expect(within(files).getByText('quote.pdf')).toBeInTheDocument()
    expect(within(files).getByRole('button', { name: 'Download quote.pdf' })).toBeEnabled()
  })

  it('shows the blocks and the file card, and not the file names again, when the reply has no words', async () => {
    renderMessage(botMessage({ visuals: [sampleMenuChart], files: [quote], filesOnly: true }, 'quote.pdf'))
    expect(await screen.findByRole('region', { name: 'Paket paling sering dipesan' })).toBeInTheDocument()
    const files = screen.getByRole('region', { name: 'Files the agent made' })
    // The name appears once, on its card: the bubble that would repeat it is not drawn.
    expect(screen.getAllByText('quote.pdf')).toHaveLength(1)
    expect(within(files).getByText('quote.pdf')).toBeInTheDocument()
  })

  it('keeps the file card when the blocks are malformed and dropped', () => {
    renderMessage(botMessage({ visuals: [{ $ui: 'hologram', version: 1 }], files: [quote] }, 'Ini penawarannya kak'))
    expect(screen.getByText('Ini penawarannya kak')).toBeInTheDocument()
    expect(screen.getByRole('region', { name: 'Files the agent made' })).toBeInTheDocument()
    expect(screen.getAllByRole('region')).toHaveLength(1)
  })
})
