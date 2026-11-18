import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { BackendError } from '@/api/client'
import { resetSampleAgents } from '@/api/sampleBackend/agents'
import { resetSampleCredentials, sampleCredentialsBackend } from '@/api/sampleBackend/credentials'
import { emitSamplePluginEvent, resetSamplePlugins, samplePluginsBackend } from '@/api/sampleBackend/plugins'
import { connectionsPluginsPath } from '@/routes'
import { ConnectionsPage } from '../ConnectionsPage'

function renderConnectionsPage(initialPath = '/connections') {
  return render(
    <MemoryRouter initialEntries={[initialPath]}>
      <ConnectionsPage />
    </MemoryRouter>,
  )
}

function getModelsSection() {
  return screen.getByRole('region', { name: 'AI models' })
}

describe('ConnectionsPage', () => {
  beforeEach(() => {
    resetSampleCredentials()
    resetSampleAgents()
    resetSamplePlugins()
  })
  afterEach(() => vi.restoreAllMocks())

  it('shows apps, AI models and the Gmail sign-in warning', async () => {
    renderConnectionsPage()
    expect(screen.getByRole('heading', { level: 1, name: 'Connections' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Apps' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'AI models' })).toBeInTheDocument()
    expect(screen.getByRole('alert')).toHaveTextContent('Gmail needs you to sign in again.')
    expect(screen.getByText('Signed out')).toBeInTheDocument()
  })

  it('loads provider statuses for the AI model cards', async () => {
    renderConnectionsPage()
    expect(within(getModelsSection()).getByText('Loading AI models…')).toBeInTheDocument()
    expect(await within(getModelsSection()).findByText('Default')).toBeInTheDocument()
    expect(within(getModelsSection()).getByText('Found on this Mac')).toBeInTheDocument()
    expect(within(getModelsSection()).getByRole('button', { name: 'Add key Anthropic' })).toBeInTheDocument()
    expect(within(getModelsSection()).getByRole('button', { name: 'Add key Google Gemini' })).toBeInTheDocument()
  })

  it('reconnects Gmail from the banner', () => {
    renderConnectionsPage()
    fireEvent.click(screen.getByRole('button', { name: 'Reconnect Gmail' }))
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(screen.queryByText('Signed out')).not.toBeInTheDocument()
  })

  it('adds a provider key with the inline form', async () => {
    const setApiKeySpy = vi.spyOn(sampleCredentialsBackend, 'setApiKey')
    renderConnectionsPage()
    fireEvent.click(await screen.findByRole('button', { name: 'Add key Anthropic' }))
    const keyInput = screen.getByLabelText('Anthropic API key')
    expect(screen.getByRole('button', { name: 'Save key' })).toBeDisabled()
    fireEvent.change(keyInput, { target: { value: ' sk-ant-123 ' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save key' }))
    expect(await screen.findByText('Key in Keychain · not used yet')).toBeInTheDocument()
    expect(setApiKeySpy).toHaveBeenCalledWith('anthropic', 'sk-ant-123')
    expect(screen.queryByRole('button', { name: 'Add key Anthropic' })).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Anthropic API key')).not.toBeInTheDocument()
  })

  it('replaces and removes a stored key', async () => {
    const setApiKeySpy = vi.spyOn(sampleCredentialsBackend, 'setApiKey')
    const deleteApiKeySpy = vi.spyOn(sampleCredentialsBackend, 'deleteApiKey')
    renderConnectionsPage()
    fireEvent.click(await screen.findByRole('button', { name: 'Replace key OpenAI' }))
    fireEvent.change(screen.getByLabelText('OpenAI API key'), { target: { value: 'sk-new' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save key' }))
    expect(await screen.findByRole('button', { name: 'Remove key OpenAI' })).toBeInTheDocument()
    expect(setApiKeySpy).toHaveBeenCalledWith('openai', 'sk-new')

    fireEvent.click(screen.getByRole('button', { name: 'Remove key OpenAI' }))
    expect(await screen.findByRole('button', { name: 'Add key OpenAI' })).toBeInTheDocument()
    expect(deleteApiKeySpy).toHaveBeenCalledWith('openai')
  })

  it('keeps the form open and explains a failed save', async () => {
    vi.spyOn(sampleCredentialsBackend, 'setApiKey').mockRejectedValue(new BackendError('credentials', 'Keychain access was denied'))
    renderConnectionsPage()
    fireEvent.click(await screen.findByRole('button', { name: 'Add key Google Gemini' }))
    fireEvent.change(screen.getByLabelText('Google Gemini API key'), { target: { value: 'g-key' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save key' }))
    expect(await screen.findByText('Could not save the key: Keychain access was denied')).toBeInTheDocument()
    expect(screen.getByLabelText('Google Gemini API key')).toBeInTheDocument()
  })

  it('shows a quiet message when provider statuses cannot be loaded', async () => {
    vi.spyOn(sampleCredentialsBackend, 'listProviderStatuses').mockRejectedValue(new BackendError('credentials', 'Keychain is locked'))
    renderConnectionsPage()
    expect(await screen.findByText('Could not load AI models: Keychain is locked')).toBeInTheDocument()
  })

  it('filters connections by search', async () => {
    renderConnectionsPage()
    await within(getModelsSection()).findByText('Default')
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search connections' }), { target: { value: 'ollama' } })
    expect(screen.getByText('Ollama')).toBeInTheDocument()
    expect(screen.queryByText('WhatsApp')).not.toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Apps' })).not.toBeInTheDocument()
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search connections' }), { target: { value: 'zzz' } })
    expect(screen.getByText(/No connections match/)).toBeInTheDocument()
  })
})

function getPluginCard(pluginName: string) {
  return screen.getByRole('article', { name: pluginName })
}

async function openPluginsPanel() {
  renderConnectionsPage()
  expect(await screen.findByText(/WebAssembly · 2 installed/)).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Manage Plugins' }))
  return screen.findByRole('article', { name: 'whatsapp-api' })
}

describe('ConnectionsPage plugins', () => {
  beforeEach(() => {
    resetSampleCredentials()
    resetSamplePlugins()
  })
  afterEach(() => vi.restoreAllMocks())

  it('shows the installed count and opens the Plugins panel from Manage or the URL', async () => {
    renderConnectionsPage(connectionsPluginsPath)
    expect(await screen.findByRole('region', { name: 'Plugins' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Manage Plugins' })).toHaveAttribute('aria-expanded', 'true')
    fireEvent.click(screen.getByRole('button', { name: 'Manage Plugins' }))
    expect(screen.queryByRole('region', { name: 'Plugins' })).not.toBeInTheDocument()
  })

  it('shows what a plugin asks for before it is installed, then installs it', async () => {
    const whatsAppApiCard = await openPluginsPanel()
    const permissions = within(whatsAppApiCard).getByRole('list', { name: 'What whatsapp-api asks for' })
    expect(permissions).toHaveTextContent('Connects to the internet')
    expect(permissions).toHaveTextContent('Receives secret values in plain text')
    expect(permissions).toHaveTextContent('WHATSAPP_ACCESS_TOKEN, WHATSAPP_PHONE_NUMBER_ID')
    expect(within(whatsAppApiCard).getByText(/Send WhatsApp text/)).toBeInTheDocument()

    fireEvent.click(within(whatsAppApiCard).getByRole('button', { name: 'Install whatsapp-api' }))
    expect(await within(getPluginCard('whatsapp-api')).findByText('Installed v0.3.0')).toBeInTheDocument()
    expect(within(getPluginCard('whatsapp-api')).getByText('Not trusted')).toBeInTheDocument()
    expect(screen.getByText(/WebAssembly · 3 installed/)).toBeInTheDocument()
  })

  it('shows install progress from plugin events', async () => {
    vi.spyOn(samplePluginsBackend, 'installPlugin').mockImplementation(() => new Promise(() => {}))
    const whatsAppApiCard = await openPluginsPanel()
    fireEvent.click(within(whatsAppApiCard).getByRole('button', { name: 'Install whatsapp-api' }))
    act(() => emitSamplePluginEvent({ type: 'install_progress', name: 'whatsapp-api', stage: 'downloading', receivedBytes: 20, totalBytes: 50, message: null }))
    expect(within(whatsAppApiCard).getByRole('status')).toHaveTextContent('Downloading · 40%')
    expect(within(whatsAppApiCard).getByRole('button', { name: 'Install whatsapp-api' })).toBeDisabled()
  })

  it('trusts a plugin next to a clear warning', async () => {
    const setTrustedSpy = vi.spyOn(samplePluginsBackend, 'setPluginTrusted')
    await openPluginsPanel()
    const websiteCheckCard = getPluginCard('website-check')
    expect(within(websiteCheckCard).getByText(/Plugins run code on this computer: only trust plugins you know/)).toBeInTheDocument()
    fireEvent.click(within(websiteCheckCard).getByRole('checkbox', { name: 'Trust website-check' }))
    expect(await within(getPluginCard('website-check')).findByRole('checkbox', { name: 'Trust website-check' })).toBeChecked()
    await waitFor(() => expect(within(getPluginCard('website-check')).queryByText('Not trusted')).not.toBeInTheDocument())
    expect(setTrustedSpy).toHaveBeenCalledWith('website-check', true)
  })

  it('saves and clears a setting without ever showing its value', async () => {
    await openPluginsPanel()
    const settingForm = within(getPluginCard('google-maps-scraper')).getByRole('form', { name: 'google-maps-scraper setting GOOGLE_MAPS_LANGUAGE' })
    expect(within(settingForm).getByText('Not set')).toBeInTheDocument()
    const settingInput = within(settingForm).getByLabelText('GOOGLE_MAPS_LANGUAGE')
    expect(settingInput).toHaveAttribute('type', 'password')
    fireEvent.change(settingInput, { target: { value: '[LANGUAGE]' } })
    fireEvent.click(within(settingForm).getByRole('button', { name: 'Save GOOGLE_MAPS_LANGUAGE' }))
    expect(await within(settingForm).findByText('Saved')).toBeInTheDocument()
    expect(settingInput).toHaveValue('')
    fireEvent.click(within(settingForm).getByRole('button', { name: 'Clear GOOGLE_MAPS_LANGUAGE' }))
    expect(await within(settingForm).findByText('Not set')).toBeInTheDocument()
  })

  it('updates and removes an installed plugin', async () => {
    await openPluginsPanel()
    fireEvent.click(within(getPluginCard('google-maps-scraper')).getByRole('button', { name: 'Update google-maps-scraper' }))
    expect(await within(getPluginCard('google-maps-scraper')).findByText('Installed v1.1.0')).toBeInTheDocument()
    expect(within(getPluginCard('google-maps-scraper')).queryByRole('button', { name: 'Update google-maps-scraper' })).not.toBeInTheDocument()
    fireEvent.click(within(getPluginCard('website-check')).getByRole('button', { name: 'Remove website-check' }))
    expect(await within(getPluginCard('website-check')).findByRole('button', { name: 'Install website-check' })).toBeInTheDocument()
  })

  it('installs the browser runtime when an installed plugin needs it', async () => {
    await openPluginsPanel()
    expect(screen.getByText('Not installed')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Install browser runtime' }))
    expect(await screen.findByText('Installed')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Install browser runtime' })).not.toBeInTheDocument()
  })

  it('shows the error when an action fails', async () => {
    vi.spyOn(samplePluginsBackend, 'removePlugin').mockRejectedValue(new BackendError('internal', 'The plugin folder is in use'))
    await openPluginsPanel()
    fireEvent.click(within(getPluginCard('website-check')).getByRole('button', { name: 'Remove website-check' }))
    expect(await within(getPluginCard('website-check')).findByRole('alert')).toHaveTextContent('Could not remove website-check: The plugin folder is in use')
  })

  it('shows load errors and warnings of installed plugins', async () => {
    const listInstalled = samplePluginsBackend.listInstalledPlugins
    vi.spyOn(samplePluginsBackend, 'listInstalledPlugins').mockImplementation(async () => {
      const installedPlugins = await listInstalled()
      return installedPlugins.map((installedPlugin) => (installedPlugin.name === 'website-check' ? { ...installedPlugin, loadError: 'checksum mismatch' } : installedPlugin))
    })
    renderConnectionsPage(connectionsPluginsPath)
    const websiteCheckCard = await screen.findByRole('article', { name: 'website-check' })
    expect(within(websiteCheckCard).getByRole('alert')).toHaveTextContent('Could not load website-check: checksum mismatch')
  })

  it('keeps installed plugins when the catalog cannot be loaded', async () => {
    vi.spyOn(samplePluginsBackend, 'listPluginCatalog').mockRejectedValue(new BackendError('internal', 'You are offline'))
    renderConnectionsPage(connectionsPluginsPath)
    expect(await screen.findByText(/Could not load the plugin catalog: You are offline/)).toBeInTheDocument()
    expect(screen.getByRole('article', { name: 'website-check' })).toBeInTheDocument()
    expect(screen.queryByRole('article', { name: 'whatsapp-api' })).not.toBeInTheDocument()
  })
})
