import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { BackendError } from '@/api/client'
import { resetSamplePlugins, samplePluginsBackend, setSampleBrowserRuntimeStatus } from '@/api/sampleBackend/plugins'
import { routePaths } from '@/routes'
import { ConnectWhatsAppPage } from '../ConnectWhatsAppPage'

/** Lets the plugin and browser runtime loads settle (tests that assert right away). */
async function settleLoads() {
  await act(async () => {})
}

function renderConnectWhatsAppPage() {
  return render(
    <MemoryRouter initialEntries={[routePaths.connectWhatsApp]}>
      <Routes>
        <Route path={routePaths.connectWhatsApp} element={<ConnectWhatsAppPage />} />
        <Route path={routePaths.builder} element={<p>Builder screen</p>} />
      </Routes>
    </MemoryRouter>,
  )
}

async function installAndTrust(pluginName: string) {
  fireEvent.click(await screen.findByRole('button', { name: `Install ${pluginName}` }))
  fireEvent.click(await screen.findByRole('checkbox', { name: `Trust ${pluginName}` }))
  expect(await screen.findByRole('checkbox', { name: `Trust ${pluginName}` })).toBeChecked()
}

async function saveSetting(label: RegExp, value: string, variable: string) {
  fireEvent.change(await screen.findByLabelText(label), { target: { value } })
  fireEvent.click(screen.getByRole('button', { name: `Save ${variable}` }))
  expect(await within(screen.getByRole('form', { name: `whatsapp-api setting ${variable}` })).findByText('Saved')).toBeInTheDocument()
}

describe('ConnectWhatsAppPage', () => {
  beforeEach(() => resetSamplePlugins())
  afterEach(() => vi.restoreAllMocks())

  it('offers the official API and a personal number, and focuses Close', async () => {
    renderConnectWhatsAppPage()
    await settleLoads()
    expect(screen.getByRole('dialog', { name: 'Connect WhatsApp' })).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: /WhatsApp Business \(official API\)/ })).not.toBeChecked()
    expect(screen.getByRole('radio', { name: /Personal WhatsApp \(QR\)/ })).not.toBeChecked()
    expect(screen.queryByRole('img', { name: 'QR code to link WhatsApp' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Close' })).toHaveFocus()
  })

  it('returns to the builder on Close', async () => {
    renderConnectWhatsAppPage()
    await settleLoads()
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    expect(screen.getByText('Builder screen')).toBeInTheDocument()
  })

  it('closes on Escape', async () => {
    renderConnectWhatsAppPage()
    await settleLoads()
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(screen.getByText('Builder screen')).toBeInTheDocument()
  })

  describe('WhatsApp Business (official API)', () => {
    it('installs, trusts, saves the token and phone number ID, then checks the connection', async () => {
      const setConfigSpy = vi.spyOn(samplePluginsBackend, 'setPluginConfig')
      renderConnectWhatsAppPage()
      fireEvent.click(screen.getByRole('radio', { name: /WhatsApp Business/ }))
      const permissions = await screen.findByRole('list', { name: 'What whatsapp-api asks for' })
      expect(permissions).toHaveTextContent('Connects to the internet')
      expect(permissions).toHaveTextContent('WHATSAPP_ACCESS_TOKEN')
      expect(screen.queryByRole('button', { name: 'Check connection' })).not.toBeInTheDocument()

      await installAndTrust('whatsapp-api')
      expect(screen.getByText(/Trusting gives whatsapp-api its settings and secrets in plain text/)).toBeInTheDocument()
      expect(screen.getByLabelText(/Access token/)).toHaveAttribute('type', 'password')
      await saveSetting(/Access token/, '[ACCESS TOKEN]', 'WHATSAPP_ACCESS_TOKEN')
      await saveSetting(/Phone number ID/, '[PHONE NUMBER ID]', 'WHATSAPP_PHONE_NUMBER_ID')
      expect(setConfigSpy).toHaveBeenCalledWith('whatsapp-api', 'WHATSAPP_ACCESS_TOKEN', '[ACCESS TOKEN]')
      expect(screen.getByLabelText(/Access token/)).toHaveValue('')

      fireEvent.click(screen.getByRole('button', { name: 'Check connection' }))
      expect(await screen.findByText('Connected to WhatsApp Business as [BUSINESS NAME]')).toBeInTheDocument()
    })

    it('shows why the connection check failed', async () => {
      vi.spyOn(samplePluginsBackend, 'runPluginAction').mockRejectedValue(new BackendError('workflow', 'Invalid OAuth access token'))
      renderConnectWhatsAppPage()
      fireEvent.click(screen.getByRole('radio', { name: /WhatsApp Business/ }))
      await installAndTrust('whatsapp-api')
      await saveSetting(/Access token/, '[ACCESS TOKEN]', 'WHATSAPP_ACCESS_TOKEN')
      await saveSetting(/Phone number ID/, '[PHONE NUMBER ID]', 'WHATSAPP_PHONE_NUMBER_ID')
      fireEvent.click(screen.getByRole('button', { name: 'Check connection' }))
      expect(await screen.findByRole('alert')).toHaveTextContent('Could not connect: Invalid OAuth access token')
    })

    it('explains a failed install', async () => {
      vi.spyOn(samplePluginsBackend, 'installPlugin').mockRejectedValue(new BackendError('internal', 'Checksum mismatch'))
      renderConnectWhatsAppPage()
      fireEvent.click(screen.getByRole('radio', { name: /WhatsApp Business/ }))
      fireEvent.click(await screen.findByRole('button', { name: 'Install whatsapp-api' }))
      expect(await screen.findByRole('alert')).toHaveTextContent('Could not install whatsapp-api: Checksum mismatch')
    })
  })

  describe('Personal WhatsApp (QR)', () => {
    it('warns about the Terms of Service before anything else', async () => {
      renderConnectWhatsAppPage()
      await settleLoads()
      fireEvent.click(screen.getByRole('radio', { name: /Personal WhatsApp/ }))
      const warning = screen.getByRole('region', { name: 'Read this before linking a personal number' })
      expect(warning).toHaveTextContent("Automating a personal WhatsApp account breaks WhatsApp's Terms of Service")
      expect(warning).toHaveTextContent('can get your number banned')
      expect(warning).toHaveTextContent('Sends are rate limited and never retried')
      expect(warning).toHaveTextContent('use the official Cloud API')
    })

    it('installs, trusts, installs the browser runtime, links with the QR code and refreshes status', async () => {
      const runActionSpy = vi.spyOn(samplePluginsBackend, 'runPluginAction')
      renderConnectWhatsAppPage()
      fireEvent.click(screen.getByRole('radio', { name: /Personal WhatsApp/ }))
      expect(await screen.findByRole('list', { name: 'What whatsapp-web asks for' })).toHaveTextContent('Needs the browser runtime')
      await installAndTrust('whatsapp-web')

      fireEvent.click(await screen.findByRole('button', { name: 'Install browser runtime' }))
      expect(await screen.findByRole('button', { name: 'Refresh status' })).toBeInTheDocument()
      expect(screen.getByText(/A browser window opens with the QR code/)).toBeInTheDocument()

      fireEvent.click(screen.getByRole('button', { name: 'Refresh status' }))
      expect(await screen.findByText(/Not linked yet/)).toBeInTheDocument()

      fireEvent.click(screen.getByRole('button', { name: 'Show QR code' }))
      expect(await screen.findByText(/Linked: WhatsApp is ready/)).toBeInTheDocument()
      expect(runActionSpy).toHaveBeenCalledWith('whatsapp-web', 'whatsapp-web.login', { timeout_seconds: 180 })
    })

    it('skips the browser runtime step when it is installed already, and shows a failed login', async () => {
      setSampleBrowserRuntimeStatus('installed')
      vi.spyOn(samplePluginsBackend, 'runPluginAction').mockRejectedValue(new BackendError('workflow', 'Timed out waiting for the QR scan'))
      renderConnectWhatsAppPage()
      fireEvent.click(screen.getByRole('radio', { name: /Personal WhatsApp/ }))
      await installAndTrust('whatsapp-web')
      expect(screen.queryByRole('button', { name: 'Install browser runtime' })).not.toBeInTheDocument()
      fireEvent.click(await screen.findByRole('button', { name: 'Show QR code' }))
      expect(await screen.findByRole('alert')).toHaveTextContent('Timed out waiting for the QR scan')
    })
  })
})
