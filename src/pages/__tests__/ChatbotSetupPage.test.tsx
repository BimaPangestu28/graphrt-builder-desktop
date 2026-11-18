import { act, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { resetSampleAgents, sampleAgentsBackend } from '@/api/sampleBackend/agents'
import { resetSampleConversations, sampleConversationsBackend } from '@/api/sampleBackend/conversations'
import { ChatbotSetupPage } from '../ChatbotSetupPage'

function renderChatbotSetup() {
  return render(
    <MemoryRouter>
      <ChatbotSetupPage />
    </MemoryRouter>,
  )
}

async function sendTestMessage(text: string) {
  fireEvent.change(screen.getByLabelText('Test message'), { target: { value: text } })
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: 'Send' }))
  })
}

describe('ChatbotSetupPage', () => {
  beforeEach(() => {
    resetSampleAgents()
    resetSampleConversations()
  })

  it('shows the chatbot name and the setup sections', async () => {
    renderChatbotSetup()
    expect(await screen.findByRole('heading', { level: 1, name: 'Catering assistant' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Persona' })).toBeInTheDocument()
    expect(screen.getByLabelText('Name customers see')).toHaveValue('Admin Catering')
    expect(screen.getByRole('heading', { name: 'Try it' })).toBeInTheDocument()
  })

  it('pauses and goes live through the agent status, and removes a knowledge file', async () => {
    renderChatbotSetup()
    expect(await screen.findByText('Live')).toBeInTheDocument()
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Pause' }))
    })
    expect(await screen.findByText('Paused')).toBeInTheDocument()
    expect((await sampleAgentsBackend.getAgent('catering-assistant')).status).toBe('paused')
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Go live' }))
    })
    expect(await screen.findByText('Live')).toBeInTheDocument()
    expect((await sampleAgentsBackend.getAgent('catering-assistant')).status).toBe('active')

    fireEvent.click(screen.getByRole('button', { name: 'Remove Price list.xlsx' }))
    expect(screen.queryByText('Price list.xlsx')).not.toBeInTheDocument()
  })

  it('answers a test message in a real test conversation', async () => {
    renderChatbotSetup()
    await screen.findByText('Jumat ini jam berapa dikirimnya kak?')
    await sendTestMessage('Ongkir gratis?')
    expect(screen.getByText('Ongkir gratis?')).toBeInTheDocument()
    expect(await screen.findByText('Free delivery inside Bandar Lampung for orders of 30 boxes or more')).toBeInTheDocument()
    const testChats = await sampleConversationsBackend.listConversations({ channel: 'test' })
    expect(testChats).toHaveLength(1)
    expect(testChats[0].lastMessageAuthor).toBe('bot')
  })

  it('shows the hand-off notice when the bot is not sure', async () => {
    renderChatbotSetup()
    await screen.findByText('Jumat ini jam berapa dikirimnya kak?')
    await sendTestMessage('Ada menu vegetarian?')
    expect(await screen.findByText('Bot handed this to you · answer not in the knowledge')).toBeInTheDocument()
  })

  it('starts a new test conversation on Reset', async () => {
    renderChatbotSetup()
    await screen.findByText('Jumat ini jam berapa dikirimnya kak?')
    await sendTestMessage('Ongkir gratis?')
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Reset' }))
    })
    await screen.findByText('Jumat ini jam berapa dikirimnya kak?')
    expect(screen.queryByText('Ongkir gratis?')).not.toBeInTheDocument()
    expect(await sampleConversationsBackend.listConversations({ channel: 'test' })).toHaveLength(2)
  })
})
