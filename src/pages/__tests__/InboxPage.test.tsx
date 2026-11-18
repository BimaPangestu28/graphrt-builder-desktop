import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
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
  it('shows the inbox heading, stats and every conversation', () => {
    renderInbox()
    expect(screen.getByRole('heading', { level: 1, name: 'Inbox' })).toBeInTheDocument()
    expect(screen.getByText('Chats today')).toBeInTheDocument()
    expect(screen.getAllByRole('row')).toHaveLength(7)
  })

  it('filters to chats waiting for you', () => {
    renderInbox()
    fireEvent.click(screen.getByRole('button', { name: 'Waiting for you 3' }))
    expect(screen.getByRole('button', { name: 'Waiting for you 3' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getAllByRole('row')).toHaveLength(4)
    expect(screen.queryByText('Makasih infonya kak')).not.toBeInTheDocument()
  })

  it('pauses the bot with the switch', () => {
    renderInbox()
    fireEvent.click(screen.getByRole('checkbox', { name: /bot is answering/i }))
    expect(screen.getByText('Bot is paused')).toBeInTheDocument()
  })

  it('opens the chat detail when a row is clicked', () => {
    renderInbox()
    fireEvent.click(screen.getByText('Ada menu khusus vegetarian?'))
    expect(screen.getByText('Chat detail screen')).toBeInTheDocument()
  })
})
