import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { resetSampleAgents } from '@/api/sampleBackend/agents'
import { resetSampleConversations, sampleConversationsBackend } from '@/api/sampleBackend/conversations'
import { routePaths } from '@/routes'
import { InboxPage } from '../InboxPage'

function renderInbox() {
  return render(
    <MemoryRouter initialEntries={[routePaths.inbox]}>
      <Routes>
        <Route path={routePaths.inbox} element={<InboxPage />} />
        <Route path={routePaths.chatDetail} element={<div>Chat detail screen</div>} />
      </Routes>
    </MemoryRouter>,
  )
}

describe('InboxPage', () => {
  beforeEach(() => {
    resetSampleAgents()
    resetSampleConversations()
  })

  it('shows the inbox heading, counts and every conversation', async () => {
    renderInbox()
    expect(screen.getByRole('heading', { level: 1, name: 'Inbox' })).toBeInTheDocument()
    expect(await screen.findByText('Oke deal 50 box Paket Komplit, Jumat jam 11 ya')).toBeInTheDocument()
    expect(screen.getAllByRole('row')).toHaveLength(7)
    expect(await screen.findByRole('button', { name: 'All 6' })).toBeInTheDocument()
    expect(screen.getByText('Order to confirm')).toBeInTheDocument()
    expect(screen.getByText('Bot: Siap kak, alamatnya sama seperti kemarin ya?')).toBeInTheDocument()
    expect(await screen.findByText('Catering assistant · answering your customers')).toBeInTheDocument()
  })

  it('filters to chats waiting for you', async () => {
    renderInbox()
    fireEvent.click(await screen.findByRole('button', { name: 'Waiting for you 3' }))
    expect(screen.getByRole('button', { name: 'Waiting for you 3' })).toHaveAttribute('aria-pressed', 'true')
    await screen.findByText('Ada menu khusus vegetarian?')
    expect(screen.queryByText('Makasih infonya kak')).not.toBeInTheDocument()
    expect(screen.getAllByRole('row')).toHaveLength(4)
  })

  it('filters to chats from outreach', async () => {
    renderInbox()
    fireEvent.click(await screen.findByRole('button', { name: 'From outreach 3' }))
    await screen.findByText('Bot: Menu lengkapnya saya kirim di sini ya kak')
    expect(screen.queryByText('Bisa ngobrol sama orangnya langsung?')).not.toBeInTheDocument()
  })

  it('pauses the bot with the switch and keeps it paused', async () => {
    renderInbox()
    const botSwitch = await screen.findByRole('checkbox', { name: /bot is answering/i })
    await screen.findByText('Bot is answering')
    await act(async () => {
      fireEvent.click(botSwitch)
    })
    expect(await screen.findByText('Bot is paused')).toBeInTheDocument()
    expect(await sampleConversationsBackend.getBotEnabled('catering-assistant')).toBe(false)
  })

  it('updates live when a customer writes', async () => {
    renderInbox()
    await screen.findByText('Oke deal 50 box Paket Komplit, Jumat jam 11 ya')
    await act(async () => {
      await sampleConversationsBackend.sendCustomerMessage('returning-5520', 'Ada menu vegetarian?')
    })
    const rows = await screen.findAllByRole('row')
    expect(within(rows[1]).getByText('Bot not sure')).toBeInTheDocument()
    expect(await screen.findByRole('button', { name: 'Waiting for you 4' })).toBeInTheDocument()
  })

  it('opens the chat detail when a row is clicked', async () => {
    renderInbox()
    fireEvent.click(await screen.findByText('Ada menu khusus vegetarian?'))
    expect(screen.getByText('Chat detail screen')).toBeInTheDocument()
  })
})
