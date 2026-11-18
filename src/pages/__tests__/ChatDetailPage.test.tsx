import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { resetSampleAgents } from '@/api/sampleBackend/agents'
import { resetSampleConversations, sampleConversationsBackend } from '@/api/sampleBackend/conversations'
import { routePaths } from '@/routes'
import { ChatDetailPage } from '../ChatDetailPage'

function renderChatDetail(search = '') {
  return render(
    <MemoryRouter initialEntries={[`${routePaths.chatDetail}${search}`]}>
      <ChatDetailPage />
    </MemoryRouter>,
  )
}

const suggestedReply = 'Siap kak, 50 Paket Komplit Jumat jam 11. Boleh minta alamat lengkapnya?'

describe('ChatDetailPage', () => {
  beforeEach(() => {
    resetSampleAgents()
    resetSampleConversations()
  })

  it('shows the first waiting conversation by default', async () => {
    renderChatDetail()
    expect(screen.getByRole('navigation', { name: 'Conversations' })).toBeInTheDocument()
    expect(await screen.findByText('Bot paused · waiting for you')).toBeInTheDocument()
    expect(screen.getByText('Bot handed this to you · order ready to confirm')).toBeInTheDocument()
    expect(screen.getByText('Outreach agent · 09:12')).toBeInTheDocument()
    // The bot's memory, with what is still missing
    expect(screen.getByText('50 × Paket Komplit')).toBeInTheDocument()
    expect(screen.getByText('Missing')).toBeInTheDocument()
  })

  it('opens the conversation named in the query string', async () => {
    renderChatDetail('?id=office-7781')
    expect(await screen.findByText('WhatsApp · +62 813 •••• 7781')).toBeInTheDocument()
  })

  it('sends a reply using the suggested text, which takes the chat over', async () => {
    renderChatDetail()
    fireEvent.click(await screen.findByRole('button', { name: suggestedReply }))
    expect(screen.getByLabelText('Your reply')).toHaveValue(suggestedReply)
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Send' }))
    })
    expect(screen.getByLabelText('Your reply')).toHaveValue('')
    expect(await screen.findByText(suggestedReply)).toBeInTheDocument()
    expect(screen.getByText(/^You · \d\d:\d\d$/)).toBeInTheDocument()
    expect(screen.getByText('Bot paused · you are replying')).toBeInTheDocument()
    // The suggestion disappears once you replied
    expect(screen.queryByRole('button', { name: suggestedReply })).not.toBeInTheDocument()
    const detail = await sampleConversationsBackend.getConversation('cafe-4410')
    expect(detail.messages.at(-1)).toMatchObject({ author: 'operator', text: suggestedReply })
  })

  it('hands the chat back to the bot and takes it over again', async () => {
    renderChatDetail()
    const handBackButton = await screen.findByRole('button', { name: 'Hand back to bot' })
    await act(async () => {
      fireEvent.click(handBackButton)
    })
    expect(await screen.findByText('Bot is answering')).toBeInTheDocument()
    expect(screen.getByText('You handed this back to the bot')).toBeInTheDocument()
    expect(screen.getByLabelText('Your reply')).toBeDisabled()
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Take over from bot' }))
    })
    expect(await screen.findByText('Bot paused · you are replying')).toBeInTheDocument()
    expect(screen.getByLabelText('Your reply')).toBeEnabled()
  })

  it('closes the chat', async () => {
    renderChatDetail('?id=contact-0932')
    const closeButton = await screen.findByRole('button', { name: 'Close chat' })
    await act(async () => {
      fireEvent.click(closeButton)
    })
    expect(await screen.findByText('Chat closed', { selector: '[role="status"]' })).toBeInTheDocument()
    expect(screen.getByLabelText('Your reply')).toBeDisabled()
    expect(screen.queryByRole('button', { name: 'Hand back to bot' })).not.toBeInTheDocument()
  })

  it('shows new customer messages live', async () => {
    renderChatDetail('?id=contact-0932')
    const chat = await screen.findByRole('region', { name: 'Chat' })
    await within(chat).findByText('Bisa ngobrol sama orangnya langsung?')
    await act(async () => {
      await sampleConversationsBackend.sendCustomerMessage('contact-0932', 'Halo, masih di sana?')
    })
    expect(await within(chat).findByText('Halo, masih di sana?')).toBeInTheDocument()
    // The waiting list shows the new last message too
    expect(within(screen.getByRole('navigation', { name: 'Conversations' })).getByText('Halo, masih di sana?')).toBeInTheDocument()
  })
})
