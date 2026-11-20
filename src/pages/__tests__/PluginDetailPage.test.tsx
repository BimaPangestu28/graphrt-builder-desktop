import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { BackendError } from '@/api/client'
import { resetSampleAgents } from '@/api/sampleBackend/agents'
import { resetSampleCredentials } from '@/api/sampleBackend/credentials'
import { resetSamplePlugins, samplePluginsBackend, setSampleBrowserRuntimeStatus } from '@/api/sampleBackend/plugins'
import { samplePluginSeeds } from '@/api/sampleBackend/samplePluginSeeds'
import { agentPath, pluginDetailPath, pluginDetailPattern, routePaths } from '@/routes'
import { PluginDetailPage } from '../PluginDetailPage'

function renderPluginPage(pluginName: string, listSearch?: string) {
  return render(
    <MemoryRouter initialEntries={[{ pathname: pluginDetailPath(pluginName), state: listSearch ? { listSearch } : null }]}>
      <Routes>
        <Route path={pluginDetailPattern} element={<PluginDetailPage />} />
        <Route path={routePaths.plugins} element={<h1>Plugins list</h1>} />
      </Routes>
    </MemoryRouter>,
  )
}

/** The sample catalog's curated display name of `pluginName`. */
function sampleDisplayName(pluginName: string): string {
  const seed = samplePluginSeeds.find((candidate) => candidate.name === pluginName)
  if (!seed) throw new Error(`no sample plugin ${pluginName}`)
  return seed.displayName
}

async function renderLoadedPluginPage(pluginName: string) {
  renderPluginPage(pluginName)
  await screen.findByRole('heading', { level: 1, name: sampleDisplayName(pluginName) })
}

function getSection(name: string) {
  return screen.getByRole('region', { name })
}

describe('PluginDetailPage', () => {
  beforeEach(() => {
    resetSampleCredentials()
    resetSampleAgents()
    resetSamplePlugins()
  })
  afterEach(() => vi.restoreAllMocks())

  it('shows what a plugin adds and asks for before it is installed, then installs it untrusted', async () => {
    await renderLoadedPluginPage('whatsapp-api')
    expect(screen.getByText('Not installed')).toBeInTheDocument()
    expect(screen.getByText(/It starts untrusted, without settings or secrets/)).toBeInTheDocument()
    const asksFor = within(getSection('What it asks for')).getByRole('list', { name: 'What WhatsApp Cloud API asks for' })
    expect(asksFor).toHaveTextContent('Connects to the internet')
    expect(asksFor).toHaveTextContent('Receives secret values in plain text')
    expect(asksFor).toHaveTextContent('WHATSAPP_ACCESS_TOKEN, WHATSAPP_PHONE_NUMBER_ID')
    const steps = within(getSection('What it adds')).getByRole('list', { name: 'Steps WhatsApp Cloud API adds' })
    expect(steps).toHaveTextContent('Send WhatsApp text')
    expect(steps).toHaveTextContent('Sends a text message to a phone number')
    expect(steps).toHaveTextContent('whatsapp-api.send_text')
    expect(screen.queryByRole('region', { name: 'Set up' })).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Install WhatsApp Cloud API' }))
    expect(await screen.findByText('Needs setup')).toBeInTheDocument()
    expect(within(getSection('Set up')).getByRole('checkbox', { name: 'Trust WhatsApp Cloud API' })).not.toBeChecked()
    expect(screen.getByRole('button', { name: 'Remove WhatsApp Cloud API' })).toBeInTheDocument()
  })

  it('titles the page with the display name and keeps the technical name as small text', async () => {
    await renderLoadedPluginPage('whatsapp-api')
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('WhatsApp Cloud API')
    expect(screen.getByLabelText('Plugin name')).toHaveTextContent('whatsapp-api')
    expect(screen.getByRole('complementary', { name: 'About WhatsApp Cloud API' })).toBeInTheDocument()
  })

  it('falls back to the humanized name for a plugin without a display name', async () => {
    const catalog = await samplePluginsBackend.listPluginCatalog(false)
    vi.spyOn(samplePluginsBackend, 'listPluginCatalog').mockResolvedValue({
      ...catalog,
      plugins: catalog.plugins.map((entry) => (entry.name === 'whatsapp-api' ? { ...entry, displayName: '' } : entry)),
    })
    renderPluginPage('whatsapp-api')
    expect(await screen.findByRole('heading', { level: 1, name: 'WhatsApp API' })).toBeInTheDocument()
  })

  it('shows the README warning in a box before anything else', async () => {
    await renderLoadedPluginPage('whatsapp-web')
    const warning = screen.getByRole('note', { name: 'Warning about WhatsApp Web' })
    expect(warning).toHaveTextContent('High terms-of-service risk')
    expect(warning).toHaveTextContent('against the WhatsApp Terms of Service')
  })

  it('trusts a plugin next to a clear warning', async () => {
    const setTrustedSpy = vi.spyOn(samplePluginsBackend, 'setPluginTrusted')
    await samplePluginsBackend.installPlugin('telegram-bot')
    await renderLoadedPluginPage('telegram-bot')
    const setUp = getSection('Set up')
    expect(within(setUp).getByText(/Plugins run code on this computer: only trust plugins you know/)).toBeInTheDocument()
    fireEvent.click(within(setUp).getByRole('checkbox', { name: 'Trust Telegram Bot' }))
    expect(await within(getSection('Set up')).findByRole('checkbox', { name: 'Trust Telegram Bot' })).toBeChecked()
    expect(setTrustedSpy).toHaveBeenCalledWith('telegram-bot', true)
  })

  it('puts required settings first and folds optional ones away', async () => {
    await samplePluginsBackend.installPlugin('whatsapp-api')
    await renderLoadedPluginPage('whatsapp-api')
    const setUp = getSection('Set up')
    expect(within(setUp).getByLabelText('WHATSAPP_ACCESS_TOKEN')).toBeVisible()
    expect(within(setUp).getByLabelText('WHATSAPP_GRAPH_VERSION')).not.toBeVisible()
    fireEvent.click(within(setUp).getByText('Optional settings (1)'))
    expect(within(setUp).getByLabelText('WHATSAPP_GRAPH_VERSION')).toBeVisible()
  })

  it('saves and clears a setting without ever showing its value', async () => {
    await renderLoadedPluginPage('google-maps-scraper')
    fireEvent.click(within(getSection('Set up')).getByText('Optional settings (1)'))
    const settingForm = within(getSection('Set up')).getByRole('form', { name: 'Google Maps Scraper setting GOOGLE_MAPS_LANGUAGE' })
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

  it('links whatsapp-web by QR code once trusted and the browser runtime is ready', async () => {
    setSampleBrowserRuntimeStatus('installed')
    await samplePluginsBackend.installPlugin('whatsapp-web')
    await renderLoadedPluginPage('whatsapp-web')
    const setUp = getSection('Set up')
    expect(setUp).toHaveTextContent('Trust the plugin, then link WhatsApp by scanning a QR code')
    expect(within(setUp).queryByRole('button', { name: 'Link WhatsApp (scan QR code)' })).not.toBeInTheDocument()

    fireEvent.click(within(setUp).getByRole('checkbox', { name: 'Trust WhatsApp Web' }))
    const linkPanel = await within(getSection('Set up')).findByRole('region', { name: 'Link WhatsApp' })
    expect(await within(linkPanel).findByRole('status')).toHaveTextContent('WhatsApp: Not linked')
    fireEvent.click(within(linkPanel).getByRole('button', { name: 'Link WhatsApp (scan QR code)' }))
    expect(await within(linkPanel).findByText('Linked')).toBeInTheDocument()
  })

  it('installs the browser runtime from the setup of a plugin that needs it', async () => {
    await renderLoadedPluginPage('google-maps-scraper')
    const setUp = getSection('Set up')
    expect(await within(setUp).findByText('Not installed')).toBeInTheDocument()
    fireEvent.click(within(setUp).getByRole('button', { name: 'Install browser runtime' }))
    expect(await within(setUp).findByText('Installed')).toBeInTheDocument()
  })

  it('updates and removes an installed plugin', async () => {
    await renderLoadedPluginPage('google-maps-scraper')
    expect(screen.getByText('Update available')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Update Google Maps Scraper' }))
    expect(await screen.findByText('Installed v1.1.0')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Update Google Maps Scraper' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Remove Google Maps Scraper' }))
    expect(await screen.findByRole('button', { name: 'Install Google Maps Scraper' })).toBeInTheDocument()
    expect(screen.getByText('Not installed')).toBeInTheDocument()
  })

  it('shows the error when an action fails', async () => {
    vi.spyOn(samplePluginsBackend, 'removePlugin').mockRejectedValue(new BackendError('internal', 'The plugin folder is in use'))
    await renderLoadedPluginPage('website-check')
    fireEvent.click(screen.getByRole('button', { name: 'Remove Website Check' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not remove Website Check: The plugin folder is in use')
  })

  it('shows load errors of an installed plugin', async () => {
    const listInstalled = samplePluginsBackend.listInstalledPlugins
    vi.spyOn(samplePluginsBackend, 'listInstalledPlugins').mockImplementation(async () =>
      (await listInstalled()).map((installedPlugin) => (installedPlugin.name === 'website-check' ? { ...installedPlugin, loadError: 'checksum mismatch' } : installedPlugin)),
    )
    await renderLoadedPluginPage('website-check')
    expect(screen.getByText('Failed to load')).toBeInTheDocument()
    expect(screen.getByRole('alert')).toHaveTextContent('Could not load Website Check: checksum mismatch')
  })

  it('lists the agents that use the plugin, linking to their builder', async () => {
    await renderLoadedPluginPage('google-maps-scraper')
    const agents = await within(getSection('Used by agents')).findByRole('list', { name: 'Agents using Google Maps Scraper' })
    const agentLink = within(agents).getByRole('link', { name: 'Maps leads to WhatsApp' })
    expect(agentLink).toHaveAttribute('href', agentPath('builder', 'maps-leads'))
    expect(agents).toHaveTextContent('Search Google Maps')
  })

  it('says when no agent uses the plugin', async () => {
    await renderLoadedPluginPage('stripe')
    expect(await within(getSection('Used by agents')).findByText('No agent uses Stripe yet')).toBeInTheDocument()
  })

  it('opens the README through the backend', async () => {
    const openReadmeSpy = vi.spyOn(samplePluginsBackend, 'openPluginReadme').mockResolvedValue(undefined)
    await renderLoadedPluginPage('stripe')
    fireEvent.click(within(getSection('About')).getByRole('button', { name: 'Read the README' }))
    await waitFor(() => expect(openReadmeSpy).toHaveBeenCalledWith('stripe'))
  })

  it('goes back to the Plugins list with the filters it came from', async () => {
    renderPluginPage('stripe', '?q=pay')
    expect(await screen.findByRole('link', { name: 'All plugins' })).toHaveAttribute('href', `${routePaths.plugins}?q=pay`)
  })

  it('explains a plugin name that does not exist', async () => {
    renderPluginPage('no-such-plugin')
    expect(await screen.findByText(/No plugin named “no-such-plugin”: the catalog does not list it/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('link', { name: 'All plugins' }))
    expect(await screen.findByRole('heading', { name: 'Plugins list' })).toBeInTheDocument()
  })
})
