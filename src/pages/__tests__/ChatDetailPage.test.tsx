import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { resetSampleAgents } from '@/api/sampleBackend/agents'
import { resetSampleConversations, sampleConversationsBackend } from '@/api/sampleBackend/conversations'
import { sampleLearningBackend } from '@/api/sampleBackend/learning'
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

  it('lets a reply of the chatbot be rated, and the comment waits as a note for that chatbot', async () => {
    const record = vi.spyOn(sampleLearningBackend, 'recordReplyFeedback')
    renderChatDetail()
    await screen.findByText('Bot paused · waiting for you')
    const detail = await sampleConversationsBackend.getConversation('cafe-4410')
    const botReplies = detail.messages.filter((message) => message.author === 'bot' && message.metadata.sentBy !== 'outreach')
    // One small button per reply the chatbot wrote: not for the customer, the owner or the outreach agent.
    const rateButtons = screen.getAllByRole('button', { name: 'Rate this reply' })
    expect(rateButtons).toHaveLength(botReplies.length)
    expect(botReplies.length).toBeGreaterThan(0)

    fireEvent.click(rateButtons[0])
    const feedback = screen.getByRole('group', { name: 'Was this what you wanted?' })
    fireEvent.click(within(feedback).getByRole('button', { name: 'No, something was off' }))
    fireEvent.change(within(feedback).getByLabelText('What should it do differently next time?'), { target: { value: 'Ask for the delivery address first' } })
    await act(async () => {
      fireEvent.click(within(feedback).getByRole('button', { name: 'Send' }))
    })
    expect(record).toHaveBeenCalledWith('cafe-4410', botReplies[0].id, { helpful: false, comment: 'Ask for the delivery address first' })
    expect(await screen.findByText('Your note is waiting for your approval.')).toBeInTheDocument()
    const learned = await sampleLearningBackend.getAgentLearning(detail.conversation.agentId)
    expect(learned.lessons.find((lesson) => lesson.text === 'Ask for the delivery address first')).toMatchObject({ status: 'proposed', trust: 'derived' })
    record.mockRestore()
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
