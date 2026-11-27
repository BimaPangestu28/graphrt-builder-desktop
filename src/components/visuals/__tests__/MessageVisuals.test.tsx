import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ConversationMessage } from '@/api/conversationTypes'
import { sampleMenuChart, sampleOrderCard } from '@/api/sampleBackend/fixtures/sampleChatVisuals'
import { applyAppearance } from '@/lib/appearance'
import { ChatMessageBubble } from '@/pages/inbox/ChatMessageBubble'
import { isTextOnlyFallback, MessageVisuals, readMessageVisuals } from '../MessageVisuals'

function botMessage(metadata: Record<string, unknown>, text = 'Ini ringkasannya kak'): ConversationMessage {
  return { id: 'm1', conversationId: 'c1', author: 'bot', text, metadata, createdAt: '2026-11-27T09:00:00Z' }
}

describe('readMessageVisuals', () => {
  it('reads blocks of known kinds and skips everything else', () => {
    const visuals = [sampleOrderCard, { $ui: 'hologram', version: 1 }, 'text', null, sampleMenuChart]
    expect(readMessageVisuals({ visuals }).map((block) => block.$ui)).toEqual(['adaptive_card', 'chart'])
    expect(readMessageVisuals({})).toEqual([])
    expect(readMessageVisuals({ visuals: 'no' })).toEqual([])
  })

  it('knows when the text only repeats the blocks', () => {
    expect(isTextOnlyFallback({ textIsFallback: true, visuals: [sampleMenuChart] })).toBe(true)
    expect(isTextOnlyFallback({ textIsFallback: true })).toBe(false)
    expect(isTextOnlyFallback({ visuals: [sampleMenuChart] })).toBe(false)
  })
})

describe('MessageVisuals', () => {
  it('answers a card with any of its buttons, the title and the typed inputs', async () => {
    const onCardSubmit = vi.fn()
    render(<MessageVisuals blocks={[sampleOrderCard]} onCardSubmit={onCardSubmit} />)
    await userEvent.type(await screen.findByLabelText('Catatan untuk dapur'), 'Sambal dipisah')
    await userEvent.click(screen.getByRole('button', { name: 'Ubah jumlah' }))
    expect(onCardSubmit).toHaveBeenCalledWith({ action: 'ubah', title: 'Ubah jumlah', values: { catatan: 'Sambal dipisah' } })
  })

  it('disables the buttons, with the reason, when nobody can answer here', async () => {
    render(<MessageVisuals blocks={[sampleOrderCard]} />)
    expect(await screen.findByRole('button', { name: 'Konfirmasi pesanan' })).toBeDisabled()
    expect(screen.getAllByText('The customer answers with these buttons').length).toBeGreaterThan(0)
  })
})

describe('ChatMessageBubble with blocks', () => {
  it('draws the card and the chart of a bot reply under its text', async () => {
    render(<ChatMessageBubble message={botMessage({ visuals: [sampleOrderCard, sampleMenuChart] })} />)
    expect(screen.getByText('Ini ringkasannya kak')).toBeInTheDocument()
    expect(await screen.findByRole('region', { name: 'Pesanan nasi box' })).toBeInTheDocument()
    expect(await screen.findByRole('region', { name: 'Paket paling sering dipesan' })).toBeInTheDocument()
    expect(await screen.findByRole('button', { name: 'Konfirmasi pesanan' })).toBeDisabled()
  })

  it('hides the text when it is only the text form of the blocks', async () => {
    render(<ChatMessageBubble message={botMessage({ visuals: [sampleMenuChart], textIsFallback: true }, 'Paket paling sering dipesan\nAyam Bakar: 420')} />)
    expect(await screen.findByRole('region', { name: 'Paket paling sering dipesan' })).toBeInTheDocument()
    expect(screen.queryByText(/Ayam Bakar: 420/)).not.toBeInTheDocument()
  })

  it('keeps a plain reply as it was', () => {
    render(<ChatMessageBubble message={botMessage({})} />)
    expect(screen.getByText('Ini ringkasannya kak')).toBeInTheDocument()
    expect(screen.queryByRole('region')).not.toBeInTheDocument()
  })
})

describe('applyAppearance', () => {
  afterEach(() => applyAppearance('light'))

  it('marks the page dark only when Dark is chosen', () => {
    applyAppearance('dark')
    expect(document.documentElement.dataset.theme).toBe('dark')
    applyAppearance('system')
    expect(document.documentElement.dataset.theme).toBeUndefined()
    applyAppearance('dark')
    applyAppearance('light')
    expect(document.documentElement.dataset.theme).toBeUndefined()
  })

  it('puts every block frame in the theme scope', async () => {
    const { container } = render(<MessageVisuals blocks={[sampleMenuChart]} />)
    await screen.findByRole('region', { name: 'Paket paling sering dipesan' })
    expect(container.querySelector('section.ui-block')).not.toBeNull()
  })
})
