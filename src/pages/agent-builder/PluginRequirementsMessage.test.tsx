import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { resetSampleAgents } from '@/api/sampleBackend/agents'
import {
  emitSampleBrowserRuntimeEvent,
  emitSamplePluginEvent,
  resetSamplePlugins,
  samplePluginsBackend,
  setSampleAgentPluginNeeds,
  setSampleBrowserRuntimeStatus,
} from '@/api/sampleBackend/plugins'
import { AgentPluginSetupMessage } from './PluginRequirementsMessage'

/** What the whatsapp-api card shows (its catalog entry), so what "Install & trust" approves. */
const whatsAppApiPermissions = {
  network: true,
  secrets: true,
  env: ['WHATSAPP_ACCESS_TOKEN', 'WHATSAPP_PHONE_NUMBER_ID', 'WHATSAPP_BUSINESS_ACCOUNT_ID', 'WHATSAPP_GRAPH_VERSION'],
}

function renderSetupMessage() {
  return render(<AgentPluginSetupMessage agentId="maps-leads" />)
}

async function findCard(pluginLabel: string) {
  return screen.findByRole('article', { name: pluginLabel })
}

describe('plugin setup message in the build chat', () => {
  beforeEach(() => {
    resetSampleAgents()
    resetSamplePlugins()
  })
  afterEach(() => vi.restoreAllMocks())

  it('shows each plugin with its steps, permissions in plain words, warning and state', async () => {
    setSampleAgentPluginNeeds('maps-leads', [
      { pluginName: 'whatsapp-api', stepId: 'send_whatsapp' },
      { pluginName: 'whatsapp-web', stepId: 'send_whatsapp' },
    ])
    renderSetupMessage()
    const whatsAppApiCard = await findCard('WhatsApp Cloud API')
    expect(screen.getByRole('group', { name: 'This agent needs 2 plugins · 0 ready' })).toBeInTheDocument()
    expect(whatsAppApiCard).toHaveTextContent('Used by: Send WhatsApp')
    expect(whatsAppApiCard).toHaveTextContent('Not installed')
    const permissions = within(whatsAppApiCard).getByRole('list', { name: 'What WhatsApp Cloud API asks for' })
    expect(permissions).toHaveTextContent('Uses the internet')
    expect(permissions).toHaveTextContent('Asks for secrets or tokens: WHATSAPP_ACCESS_TOKEN, WHATSAPP_PHONE_NUMBER_ID')
    expect(within(whatsAppApiCard).queryByRole('note')).not.toBeInTheDocument()

    const whatsAppWebCard = screen.getByRole('article', { name: 'WhatsApp Web' })
    expect(within(whatsAppWebCard).getByRole('note', { name: 'Warning about WhatsApp Web' })).toHaveTextContent(/against the WhatsApp Terms of Service/)
    expect(within(whatsAppWebCard).getByRole('list', { name: 'What WhatsApp Web asks for' })).toHaveTextContent('Opens web pages in a browser (Chromium)')
    expect(within(whatsAppWebCard).getByRole('button', { name: 'Install & trust WhatsApp Web' })).toBeInTheDocument()
    expect(within(whatsAppWebCard).getByRole('button', { name: 'Download browser' })).toBeInTheDocument()
    expect(whatsAppWebCard).toHaveTextContent('about 150 MB download')
  })

  it('installs then trusts on one click, shows the download progress, then asks for the missing settings', async () => {
    setSampleAgentPluginNeeds('maps-leads', [{ pluginName: 'whatsapp-api', stepId: 'send_whatsapp' }])
    const installPlugin = samplePluginsBackend.installPlugin
    let finishInstall: () => void = () => {}
    const installSpy = vi
      .spyOn(samplePluginsBackend, 'installPlugin')
      .mockImplementation((name, approvedPermissions) => new Promise<void>((resolve) => (finishInstall = resolve)).then(() => installPlugin(name, approvedPermissions)))
    const trustSpy = vi.spyOn(samplePluginsBackend, 'setPluginTrusted')
    const configSpy = vi.spyOn(samplePluginsBackend, 'setPluginConfig')
    renderSetupMessage()
    const card = await findCard('WhatsApp Cloud API')

    fireEvent.click(within(card).getByRole('button', { name: 'Install & trust WhatsApp Cloud API' }))
    act(() => emitSamplePluginEvent({ type: 'install_progress', name: 'whatsapp-api', stage: 'downloading', receivedBytes: 12_000, totalBytes: 48_000, message: null }))
    expect(within(card).getByRole('status')).toHaveTextContent('Downloading · 25%')
    act(() => emitSamplePluginEvent({ type: 'install_progress', name: 'whatsapp-api', stage: 'verifying', receivedBytes: 48_000, totalBytes: 48_000, message: null }))
    expect(within(card).getByRole('status')).toHaveTextContent('Checking the download…')

    await act(async () => finishInstall())
    expect(await within(card).findByLabelText('WHATSAPP_ACCESS_TOKEN')).toHaveAttribute('type', 'password')
    expect(installSpy).toHaveBeenCalledWith('whatsapp-api', whatsAppApiPermissions)
    expect(trustSpy).toHaveBeenCalledWith('whatsapp-api', true, whatsAppApiPermissions)
    expect(installSpy.mock.invocationCallOrder[0]).toBeLessThan(trustSpy.mock.invocationCallOrder[0])
    expect(card).toHaveTextContent('Needs 2 settings')

    fireEvent.change(within(card).getByLabelText('WHATSAPP_ACCESS_TOKEN'), { target: { value: 'token-123' } })
    fireEvent.click(within(card).getByRole('button', { name: 'Save WHATSAPP_ACCESS_TOKEN' }))
    expect(await within(card).findByText('Needs 1 setting')).toBeInTheDocument()
    expect(configSpy).toHaveBeenCalledWith('whatsapp-api', 'WHATSAPP_ACCESS_TOKEN', 'token-123')
    expect(within(card).queryByLabelText('WHATSAPP_ACCESS_TOKEN')).not.toBeInTheDocument()

    fireEvent.change(within(card).getByLabelText('WHATSAPP_PHONE_NUMBER_ID'), { target: { value: '1234' } })
    fireEvent.click(within(card).getByRole('button', { name: 'Save WHATSAPP_PHONE_NUMBER_ID' }))
    expect(await within(card).findByText('Ready', { selector: 'span.font-medium' })).toBeInTheDocument()
    expect(screen.getByRole('group', { name: 'This agent needs 1 plugin · 1 ready' })).toBeInTheDocument()
  })

  it('downloads the browser with progress from the runtime events', async () => {
    let finishDownload: () => void = () => {}
    vi.spyOn(samplePluginsBackend, 'installBrowserRuntime').mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          finishDownload = () => {
            setSampleBrowserRuntimeStatus('installed')
            resolve()
          }
        }),
    )
    renderSetupMessage()
    const card = await findCard('Google Maps Scraper')
    expect(card).toHaveTextContent('Needs the browser')

    fireEvent.click(within(card).getByRole('button', { name: 'Download browser' }))
    expect(within(card).getByRole('button', { name: 'Downloading…' })).toBeDisabled()
    act(() => emitSampleBrowserRuntimeEvent({ message: 'Downloading Chromium', percent: 40 }))
    expect(within(card).getAllByRole('status').some((status) => status.textContent === 'Downloading Chromium · 40%')).toBe(true)

    await act(async () => finishDownload())
    expect(await within(card).findByText('Ready', { selector: 'span.font-medium' })).toBeInTheDocument()
    expect(within(card).queryByRole('button', { name: 'Download browser' })).not.toBeInTheDocument()
  })

  it('approves every pending plugin with "Install all & trust", trusting only those that ask for secrets', async () => {
    setSampleBrowserRuntimeStatus('installed')
    await samplePluginsBackend.removePlugin('website-check')
    setSampleAgentPluginNeeds('maps-leads', [
      { pluginName: 'whatsapp-api', stepId: 'send_whatsapp' },
      { pluginName: 'website-check', stepId: 'send_whatsapp' },
    ])
    const installSpy = vi.spyOn(samplePluginsBackend, 'installPlugin')
    const trustSpy = vi.spyOn(samplePluginsBackend, 'setPluginTrusted')
    renderSetupMessage()
    await findCard('WhatsApp Cloud API')

    fireEvent.click(screen.getByRole('button', { name: 'Install all & trust' }))
    expect(await screen.findByRole('group', { name: 'This agent needs 2 plugins · 1 ready' })).toBeInTheDocument()
    expect(installSpy.mock.calls).toEqual([
      ['whatsapp-api', whatsAppApiPermissions],
      ['website-check', { network: true, secrets: false, env: [] }],
    ])
    expect(trustSpy.mock.calls).toEqual([['whatsapp-api', true, whatsAppApiPermissions]])
    expect(screen.queryByRole('button', { name: 'Install all & trust' })).not.toBeInTheDocument()
    expect(within(screen.getByRole('article', { name: 'Website Check' })).getByText('Ready', { selector: 'span.font-medium' })).toBeInTheDocument()
  })

  it('links personal WhatsApp by QR code from the card once whatsapp-web is installed and trusted', async () => {
    setSampleBrowserRuntimeStatus('installed')
    setSampleAgentPluginNeeds('maps-leads', [{ pluginName: 'whatsapp-web', stepId: 'send_whatsapp' }])
    const runActionSpy = vi.spyOn(samplePluginsBackend, 'runPluginAction')
    renderSetupMessage()
    const card = await findCard('WhatsApp Web')
    expect(within(card).queryByRole('button', { name: 'Link WhatsApp (scan QR code)' })).not.toBeInTheDocument()

    fireEvent.click(within(card).getByRole('button', { name: 'Install & trust WhatsApp Web' }))
    const linkPanel = await within(card).findByRole('region', { name: 'Link WhatsApp' })
    expect(await within(linkPanel).findByRole('status')).toHaveTextContent('WhatsApp: Not linked')
    expect(linkPanel).toHaveTextContent('On your phone: WhatsApp → Settings → Linked devices → Link a device')

    fireEvent.click(within(linkPanel).getByRole('button', { name: 'Link WhatsApp (scan QR code)' }))
    expect(await within(linkPanel).findByText('Linked')).toBeInTheDocument()
    expect(runActionSpy).toHaveBeenCalledWith('whatsapp-web', 'whatsapp-web.login', { timeout_seconds: 180 })
  })

  it('shows why an approval failed on the card', async () => {
    setSampleAgentPluginNeeds('maps-leads', [{ pluginName: 'whatsapp-api', stepId: 'send_whatsapp' }])
    vi.spyOn(samplePluginsBackend, 'installPlugin').mockRejectedValue(new Error('Checksum mismatch'))
    renderSetupMessage()
    const card = await findCard('WhatsApp Cloud API')
    fireEvent.click(within(card).getByRole('button', { name: 'Install & trust WhatsApp Cloud API' }))
    expect(await within(card).findByRole('alert')).toHaveTextContent('Could not set up WhatsApp Cloud API: Checksum mismatch')
  })

  it('never trusts a plugin whose install was refused for asking more than the card showed', async () => {
    setSampleAgentPluginNeeds('maps-leads', [{ pluginName: 'whatsapp-api', stepId: 'send_whatsapp' }])
    const installSpy = vi
      .spyOn(samplePluginsBackend, 'installPlugin')
      .mockRejectedValue(new Error('plugin whatsapp-api 0.3.0 asks for more than you approved (the setting EXTRA); nothing was installed'))
    const trustSpy = vi.spyOn(samplePluginsBackend, 'setPluginTrusted')
    renderSetupMessage()
    const card = await findCard('WhatsApp Cloud API')
    fireEvent.click(within(card).getByRole('button', { name: 'Install & trust WhatsApp Cloud API' }))
    expect(await within(card).findByRole('alert')).toHaveTextContent('asks for more than you approved')
    expect(installSpy).toHaveBeenCalledWith('whatsapp-api', whatsAppApiPermissions)
    expect(trustSpy).not.toHaveBeenCalled()
  })

  it('renders nothing for an agent without plugins', async () => {
    setSampleAgentPluginNeeds('maps-leads', [])
    const listSpy = vi.spyOn(samplePluginsBackend, 'listAgentPluginRequirements')
    const { container } = renderSetupMessage()
    await act(async () => {})
    expect(listSpy).toHaveBeenCalledWith('maps-leads')
    expect(container).toBeEmptyDOMElement()
  })
})
