import { act, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { resetSampleAgents, sampleAgentsBackend } from '@/api/sampleBackend/agents'
import { resetSampleChatbotSetups, sampleChatbotSetupBackend } from '@/api/sampleBackend/chatbotSetup'
import { resetSampleConversations, sampleConversationsBackend } from '@/api/sampleBackend/conversations'
import { resetSampleKnowledge } from '@/api/sampleBackend/knowledge'
import { resetSampleTrustedHosts } from '@/api/sampleBackend/trustedHosts'
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
    resetSampleChatbotSetups()
    resetSampleKnowledge()
    resetSampleTrustedHosts()
  })

  it('shows the chatbot name and the setup sections', async () => {
    renderChatbotSetup()
    expect(await screen.findByRole('heading', { level: 1, name: 'Catering assistant' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Persona' })).toBeInTheDocument()
    expect(await screen.findByLabelText('Name customers see')).toHaveValue('Admin Catering')
    expect(screen.getByRole('heading', { name: 'Try it' })).toBeInTheDocument()
  })

  it('shows the sites the chatbot may look things up on, and why it needs them', async () => {
    renderChatbotSetup()
    expect(await screen.findByRole('heading', { name: 'Trusted hosts for lookups' })).toBeInTheDocument()
    expect(screen.getByText(/A chat cannot stop to ask you/)).toBeInTheDocument()
    fireEvent.change(screen.getByRole('textbox', { name: 'Site to trust' }), { target: { value: 'api.open-meteo.com' } })
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Trust' }))
    })
    expect(await screen.findByText('api.open-meteo.com')).toBeInTheDocument()
  })

  it('pauses and goes live through the agent status', async () => {
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
  })

  it('saves the persona, hand-off rules and channels', async () => {
    renderChatbotSetup()
    const nameField = await screen.findByLabelText('Name customers see')
    expect(screen.getByRole('button', { name: 'Save changes' })).toBeDisabled()
    fireEvent.change(nameField, { target: { value: 'Admin Dapur' } })
    fireEvent.change(screen.getByLabelText('Tone'), { target: { value: 'Formal' } })
    fireEvent.click(screen.getByLabelText('The customer sounds upset'))
    fireEvent.click(screen.getByRole('checkbox', { name: /WhatsApp/ }))
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Save changes' }))
    })
    expect(await screen.findByText('Saved · the bot uses it from its next reply')).toBeInTheDocument()
    const saved = await sampleChatbotSetupBackend.getChatbotSetup('catering-assistant')
    expect(saved.settings.persona).toMatchObject({ displayName: 'Admin Dapur', tone: 'Formal' })
    expect(saved.settings.handoffRules.soundsUpset).toBe(true)
    expect(saved.settings.disabledChannels).toEqual(['whatsapp'])
  })

  it('lists the attached knowledge base with its sources, and removes and adds knowledge', async () => {
    renderChatbotSetup()
    expect(await screen.findByText('Menu November.pdf')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Catering menu and prices · Manage' })).toHaveAttribute('href', '/knowledge/menu-and-prices')
    expect(screen.getByRole('link', { name: 'Connect Telegram' })).toHaveAttribute('href', '/plugins')

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Remove Catering menu and prices' }))
    })
    expect(await screen.findByText('The chatbot does not answer from any knowledge yet')).toBeInTheDocument()
    expect((await sampleChatbotSetupBackend.getChatbotSetup('catering-assistant')).settings.knowledgeBaseIds).toEqual([])

    fireEvent.click(screen.getByRole('button', { name: 'Add a knowledge base' }))
    fireEvent.change(screen.getByLabelText('Knowledge base'), { target: { value: 'past-orders' } })
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Use it' }))
    })
    expect(await screen.findByText('Orders.csv')).toBeInTheDocument()
    expect((await sampleChatbotSetupBackend.getChatbotSetup('catering-assistant')).settings.knowledgeBaseIds).toEqual(['past-orders'])
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

  it('draws the card and chart the bot returns, and a card button answers as the customer', async () => {
    renderChatbotSetup()
    await screen.findByText('Jumat ini jam berapa dikirimnya kak?')
    await sendTestMessage('Buat pesanan 50 box')
    expect(await screen.findByRole('region', { name: 'Pesanan nasi box' })).toBeInTheDocument()
    expect(await screen.findByRole('region', { name: 'Paket paling sering dipesan' })).toBeInTheDocument()
    const confirm = await screen.findByRole('button', { name: 'Konfirmasi pesanan' })
    await act(async () => {
      fireEvent.click(confirm)
    })
    expect(await screen.findByText('Terima kasih kak, pesanannya saya teruskan ke admin untuk dikonfirmasi ya.')).toBeInTheDocument()
    // The card is history now: its buttons no longer answer.
    expect(screen.getByRole('button', { name: 'Konfirmasi pesanan' })).toBeDisabled()
    const [testChat] = await sampleConversationsBackend.listConversations({ channel: 'test' })
    const { messages: chatMessages } = await sampleConversationsBackend.getConversation(testChat.id)
    expect(chatMessages.at(-2)).toMatchObject({ author: 'customer', text: 'Konfirmasi pesanan', metadata: { cardAction: { action: 'konfirmasi' } } })
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
