import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import * as runSummary from '@/api/runSummary'
import { resetSampleChannels, sampleChannelsBackend } from '@/api/sampleBackend/channels'
import { resetSamplePlugins } from '@/api/sampleBackend/plugins'
import { agentRoutePatterns } from '@/routes'
import { ConnectWhatsAppPage } from '../ConnectWhatsAppPage'

/** The connect step of a chatbot (catering-assistant) or a task agent (maps-leads), with a card chosen. */
function renderConnectStep(agentId: string, channel?: string) {
  const path = `/agents/${agentId}/connect-whatsapp${channel ? `?channel=${channel}` : ''}`
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path={agentRoutePatterns.connectWhatsApp} element={<ConnectWhatsAppPage />} />
        <Route path={agentRoutePatterns.putOnline} element={<p>Put it online screen</p>} />
      </Routes>
    </MemoryRouter>,
  )
}

async function settle() {
  await act(async () => {})
}

describe('Connect a channel', () => {
  beforeEach(() => {
    resetSampleChannels()
    resetSamplePlugins()
  })
  afterEach(() => vi.restoreAllMocks())

  it('shows Telegram next to the two WhatsApp options as wide cards', async () => {
    renderConnectStep('catering-assistant')
    await settle()
    const picker = screen.getByRole('group', { name: 'Where do your customers write to you?' })
    const options = within(picker).getAllByRole('radio')
    expect(options).toHaveLength(5)
    expect(within(picker).getByRole('radio', { name: /^Telegram/ })).toBeInTheDocument()
    expect(picker).toHaveTextContent('A bot from @BotFather. Runs on this computer, no server needed')
    expect(within(picker).getByRole('radio', { name: /WhatsApp Business \(official API\)/ })).toBeInTheDocument()
    expect(within(picker).getByRole('radio', { name: /Personal WhatsApp \(QR\)/ })).toBeInTheDocument()
    expect(within(picker).getByRole('radio', { name: /^Slack/ })).toBeInTheDocument()
    expect(within(picker).getByRole('radio', { name: /^Microsoft Teams/ })).toBeInTheDocument()
  })

  it('tests the two Slack tokens, connects the app and keeps the tokens off the screen', async () => {
    const openLink = vi.spyOn(runSummary, 'openCardLink').mockResolvedValue()
    const connect = vi.spyOn(sampleChannelsBackend, 'connectSlack')
    renderConnectStep('catering-assistant', 'slack')
    expect(await screen.findByRole('radio', { name: /^Slack/ })).toBeChecked()
    fireEvent.click(await screen.findByRole('button', { name: 'Open Slack apps' }))
    expect(openLink).toHaveBeenCalledWith('https://api.slack.com/apps')
    expect(screen.getByText(/app_mentions:read, chat:write, im:history/)).toBeInTheDocument()

    const botToken = screen.getByLabelText('Bot token')
    const appToken = screen.getByLabelText('App token')
    expect(botToken).toHaveAttribute('type', 'password')
    expect(appToken).toHaveAttribute('type', 'password')
    const testButton = screen.getByRole('button', { name: 'Test tokens' })
    expect(testButton).toBeDisabled()
    fireEvent.change(botToken, { target: { value: 'xoxp-user-token' } })
    fireEvent.change(appToken, { target: { value: 'xapp-1-A111-2222' } })
    fireEvent.click(testButton)
    expect(await screen.findByRole('alert')).toHaveTextContent('it starts with xoxb-')

    fireEvent.change(botToken, { target: { value: 'xoxb-1111-2222-abcdef' } })
    fireEvent.click(screen.getByRole('button', { name: 'Test tokens' }))
    expect(await screen.findByText('Found your app in Toko Kue')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Connect app' }))
    expect(await screen.findByText('Connected · answering in Toko Kue')).toBeInTheDocument()
    expect(connect).toHaveBeenCalledWith('catering-assistant', { botToken: 'xoxb-1111-2222-abcdef', appToken: 'xapp-1-A111-2222' })
    expect(screen.queryByDisplayValue('xoxb-1111-2222-abcdef')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Disconnect' }))
    expect(await screen.findByLabelText('Bot token')).toHaveValue('')
  })

  it('says a refused Slack token in plain words', async () => {
    vi.spyOn(sampleChannelsBackend, 'getSlackConnection').mockResolvedValue({
      agentId: 'catering-assistant',
      app: { botUserId: 'U0TOKOKUE', team: 'Toko Kue' },
      state: 'token_wrong',
    })
    renderConnectStep('catering-assistant', 'slack')
    expect(await screen.findByRole('alert')).toHaveTextContent('Slack refused a token, or the app was removed from the workspace.')
  })

  it('saves the Teams bot values after Microsoft checked them and sends the owner to Put it online', async () => {
    const save = vi.spyOn(sampleChannelsBackend, 'saveTeamsBot')
    renderConnectStep('catering-assistant', 'teams')
    expect(await screen.findByRole('heading', { name: 'Let this chatbot answer in Microsoft Teams' })).toBeInTheDocument()
    expect(screen.getByText(/Teams sends messages only to an address on the internet/)).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('Microsoft App ID'), { target: { value: 'my-bot' } })
    fireEvent.change(screen.getByLabelText('Client secret'), { target: { value: 'secret-value' } })
    fireEvent.change(screen.getByLabelText('App Tenant ID'), { target: { value: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee' } })
    fireEvent.click(screen.getByRole('button', { name: 'Check with Microsoft and save' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Copy the Microsoft App ID')

    fireEvent.change(screen.getByLabelText('Microsoft App ID'), { target: { value: '00000000-1111-2222-3333-444444444444' } })
    fireEvent.click(screen.getByRole('button', { name: 'Check with Microsoft and save' }))
    expect(await screen.findByText('Microsoft accepted the values.')).toBeInTheDocument()
    expect(save).toHaveBeenLastCalledWith('catering-assistant', {
      appId: '00000000-1111-2222-3333-444444444444',
      appPassword: 'secret-value',
      tenantId: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
    })
    expect(screen.queryByDisplayValue('secret-value')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('link', { name: 'Open Put it online' }))
    expect(await screen.findByText('Put it online screen')).toBeInTheDocument()
  })

  it('shows the Teams messaging endpoint once the chatbot is online', async () => {
    vi.spyOn(sampleChannelsBackend, 'getTeamsSetup').mockResolvedValue({
      agentId: 'catering-assistant',
      saved: true,
      online: true,
      messagingEndpoint: 'https://toko-kue.fly.dev/v1/channels/teams/webhook',
      toolsReady: true,
    })
    renderConnectStep('catering-assistant', 'teams')
    expect(await screen.findByText('Online with Microsoft Teams')).toBeInTheDocument()
    expect(screen.getByText('https://toko-kue.fly.dev/v1/channels/teams/webhook')).toBeInTheDocument()
  })

  it('tests a Telegram token, connects the bot and shows how it is doing', async () => {
    const openLink = vi.spyOn(runSummary, 'openCardLink').mockResolvedValue()
    const connect = vi.spyOn(sampleChannelsBackend, 'connectTelegram')
    renderConnectStep('catering-assistant', 'telegram')
    expect(await screen.findByRole('radio', { name: /Telegram/ })).toBeChecked()

    fireEvent.click(await screen.findByRole('button', { name: 'Open @BotFather' }))
    expect(openLink).toHaveBeenCalledWith('https://t.me/BotFather')

    const tokenInput = screen.getByLabelText('Bot token')
    expect(tokenInput).toHaveAttribute('type', 'password')
    fireEvent.change(tokenInput, { target: { value: 'hello' } })
    fireEvent.click(screen.getByRole('button', { name: 'Test token' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('This is not a Telegram bot token')

    fireEvent.change(tokenInput, { target: { value: '000000:revoked' } })
    fireEvent.click(screen.getByRole('button', { name: 'Test token' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('It is wrong, or it was revoked in @BotFather')

    fireEvent.change(tokenInput, { target: { value: '123456789:AAEexampleToken' } })
    fireEvent.click(screen.getByRole('button', { name: 'Test token' }))
    expect(await screen.findByText('Found your bot Toko Kue Bot (@toko_kue_bot)')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Connect bot' }))
    expect(await screen.findByText('Connected · answering customers as @toko_kue_bot')).toBeInTheDocument()
    expect(connect).toHaveBeenCalledWith('catering-assistant', '123456789:AAEexampleToken')
    // The token is not on the screen any more.
    expect(screen.queryByLabelText('Bot token')).not.toBeInTheDocument()
    expect(screen.queryByDisplayValue('123456789:AAEexampleToken')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Open in Telegram to try it' }))
    expect(openLink).toHaveBeenCalledWith('https://t.me/toko_kue_bot')

    fireEvent.click(screen.getByRole('button', { name: 'Disconnect' }))
    expect(await screen.findByLabelText('Bot token')).toHaveValue('')
  })

  it('says a wrong Telegram token in plain words when it stops working later', async () => {
    vi.spyOn(sampleChannelsBackend, 'getTelegramConnection').mockResolvedValue({
      agentId: 'catering-assistant',
      bot: { id: '4242', username: 'toko_kue_bot', name: 'Toko Kue Bot' },
      link: 'https://t.me/toko_kue_bot',
      state: 'token_wrong',
    })
    renderConnectStep('catering-assistant', 'telegram')
    expect(await screen.findByRole('alert')).toHaveTextContent('The token is wrong or was revoked in @BotFather. Paste a new token.')
  })

  it('tells a task agent that answering customers is for chatbots', async () => {
    renderConnectStep('maps-leads', 'telegram')
    expect(await screen.findByText(/Answering customers is for chatbots/)).toBeInTheDocument()
    expect(screen.queryByLabelText('Bot token')).not.toBeInTheDocument()
  })

  it('saves the WhatsApp Business values for a chatbot and leads to Put it online', async () => {
    renderConnectStep('catering-assistant', 'whatsapp')
    const section = await screen.findByRole('region', { name: 'Let this chatbot answer customers on WhatsApp Business' })
    expect(section).toHaveTextContent('Nothing on this computer is opened to the internet')
    const form = within(section).getByRole('form', { name: 'Save the values from the Meta app' })
    fireEvent.change(within(form).getByLabelText('Access token'), { target: { value: 'EAAG-token' } })
    fireEvent.change(within(form).getByLabelText('Phone number ID'), { target: { value: '106540352242922' } })
    fireEvent.change(within(form).getByLabelText('App secret'), { target: { value: 'app-secret' } })
    for (const label of ['Access token', 'Phone number ID', 'App secret']) expect(within(form).getByLabelText(label)).toHaveAttribute('type', 'password')
    fireEvent.click(within(form).getByRole('button', { name: 'Check with Meta and save' }))
    expect(await within(section).findByText('Meta confirmed Toko Kue Sari · +62 812-3456-7890')).toBeInTheDocument()
    expect(within(section).queryByDisplayValue('EAAG-token')).not.toBeInTheDocument()

    fireEvent.click(within(section).getByRole('link', { name: 'Open Put it online' }))
    expect(screen.getByText('Put it online screen')).toBeInTheDocument()
  })

  it('shows why Meta refused the WhatsApp Business values', async () => {
    renderConnectStep('catering-assistant', 'whatsapp')
    const section = await screen.findByRole('region', { name: 'Let this chatbot answer customers on WhatsApp Business' })
    fireEvent.change(within(section).getByLabelText('Access token'), { target: { value: 'EAAG-token' } })
    fireEvent.change(within(section).getByLabelText('Phone number ID'), { target: { value: 'my number' } })
    fireEvent.change(within(section).getByLabelText('App secret'), { target: { value: 'app-secret' } })
    fireEvent.click(within(section).getByRole('button', { name: 'Check with Meta and save' }))
    expect(await within(section).findByRole('alert')).toHaveTextContent('the phone number ID is a long number')
  })

  it('shows the callback URL and, on request, the verify token once the chatbot is online', async () => {
    vi.spyOn(sampleChannelsBackend, 'getWhatsAppBusinessSetup').mockResolvedValue({
      agentId: 'catering-assistant',
      saved: true,
      number: { displayPhoneNumber: '+62 812-3456-7890', verifiedName: 'Toko Kue Sari' },
      online: true,
      webhookUrl: 'https://toko-kue.fly.dev/v1/channels/whatsapp/webhook',
      toolsReady: true,
    })
    vi.spyOn(sampleChannelsBackend, 'revealWhatsAppVerifyToken').mockResolvedValue('verify-123')
    renderConnectStep('catering-assistant', 'whatsapp')
    const section = await screen.findByRole('region', { name: 'Let this chatbot answer customers on WhatsApp Business' })
    expect(await within(section).findByText('https://toko-kue.fly.dev/v1/channels/whatsapp/webhook')).toBeInTheDocument()
    expect(within(section).queryByText('verify-123')).not.toBeInTheDocument()
    fireEvent.click(within(section).getByRole('button', { name: 'Show Verify token' }))
    expect(await within(section).findByText('verify-123')).toBeInTheDocument()
  })

  it('says WhatsApp Business online comes with an app update when the tools are too old', async () => {
    vi.spyOn(sampleChannelsBackend, 'getWhatsAppBusinessSetup').mockResolvedValue({
      agentId: 'catering-assistant',
      saved: true,
      number: { displayPhoneNumber: '+62 812-3456-7890', verifiedName: 'Toko Kue Sari' },
      online: false,
      webhookUrl: null,
      toolsReady: false,
    })
    renderConnectStep('catering-assistant', 'whatsapp')
    expect(await screen.findByText(/comes with an app update/)).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Open Put it online' })).not.toBeInTheDocument()
  })

  it('lets the chatbot answer the personal WhatsApp with one switch', async () => {
    renderConnectStep('catering-assistant', 'whatsapp-web')
    const section = await screen.findByRole('region', { name: 'Let this chatbot answer this number' })
    expect(section).toHaveTextContent('marked as read on your phone')
    const toggle = within(section).getByRole('checkbox', { name: 'Answer customers on my personal WhatsApp' })
    await settle()
    fireEvent.click(toggle)
    expect(await within(section).findByText('Answering new chats')).toBeInTheDocument()
    expect(toggle).toBeChecked()
  })
})

describe('plainError', () => {
  it('drops the technical prefix of a backend error', async () => {
    const { plainError } = await import('../connect-whatsapp/plainError')
    expect(plainError(new Error('invalid input: Telegram does not know this token'))).toBe('Telegram does not know this token')
    expect(plainError(new Error('Meta cannot be reached'))).toBe('Meta cannot be reached')
  })
})
