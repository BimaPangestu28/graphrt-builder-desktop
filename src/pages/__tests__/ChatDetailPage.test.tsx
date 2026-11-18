import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { routePaths } from '@/routes'
import { ChatDetailPage } from '../ChatDetailPage'

function renderChatDetail(search = '') {
  return render(
    <MemoryRouter initialEntries={[`${routePaths.chatDetail}${search}`]}>
      <ChatDetailPage />
    </MemoryRouter>,
  )
}

describe('ChatDetailPage', () => {
  it('shows the first waiting conversation by default', () => {
    renderChatDetail()
    expect(screen.getByRole('navigation', { name: 'Conversations' })).toBeInTheDocument()
    expect(screen.getByText('Bot paused · you are replying')).toBeInTheDocument()
    expect(screen.getByText('Bot handed this to you · order ready to confirm')).toBeInTheDocument()
  })

  it('opens the conversation named in the query string', () => {
    renderChatDetail('?id=office-7781')
    expect(screen.getByText('WhatsApp · +62 813 •••• 7781')).toBeInTheDocument()
  })

  it('sends a reply using the suggested text', () => {
    renderChatDetail()
    const suggestedReply = 'Siap kak, 50 Paket Komplit Jumat jam 11. Boleh minta alamat lengkapnya?'
    fireEvent.click(screen.getByRole('button', { name: suggestedReply }))
    expect(screen.getByLabelText('Your reply')).toHaveValue(suggestedReply)
    fireEvent.click(screen.getByRole('button', { name: 'Send' }))
    expect(screen.getByLabelText('Your reply')).toHaveValue('')
    expect(screen.getByText(suggestedReply)).toBeInTheDocument()
    expect(screen.getByText(/^You · \d\d:\d\d$/)).toBeInTheDocument()
  })

  it('hands the chat back to the bot and takes it over again', () => {
    renderChatDetail()
    fireEvent.click(screen.getByRole('button', { name: 'Hand back to bot' }))
    expect(screen.getByText('Bot is answering')).toBeInTheDocument()
    expect(screen.getByLabelText('Your reply')).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: 'Take over from bot' }))
    expect(screen.getByText('Bot paused · you are replying')).toBeInTheDocument()
    expect(screen.getByLabelText('Your reply')).toBeEnabled()
  })
})
