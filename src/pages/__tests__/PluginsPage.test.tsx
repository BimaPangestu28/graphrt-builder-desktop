import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { BackendError } from '@/api/client'
import { resetSampleAgents } from '@/api/sampleBackend/agents'
import { resetSampleCredentials } from '@/api/sampleBackend/credentials'
import { resetSampleAppSettings, sampleAppSettingsBackend } from '@/api/sampleBackend/appSettings'
import { emitSamplePluginEvent, resetSamplePlugins, samplePluginsBackend, setSampleCatalogFetchedAt, setSampleInstalledPlugin } from '@/api/sampleBackend/plugins'
import { pluginDetailPath, pluginDetailPattern, routePaths } from '@/routes'
import { PluginsPage } from '../PluginsPage'

function renderPluginsPage(initialPath: string = routePaths.plugins) {
  return render(
    <MemoryRouter initialEntries={[initialPath]}>
      <Routes>
        <Route path={routePaths.plugins} element={<PluginsPage />} />
        <Route path={pluginDetailPattern} element={<h1>Plugin detail</h1>} />
      </Routes>
    </MemoryRouter>,
  )
}

function getCard(pluginName: string) {
  return screen.getByRole('article', { name: pluginName })
}

function visibleCardNames(): string[] {
  return screen.getAllByRole('article').map((card) => card.getAttribute('aria-label') ?? '')
}

async function renderLoadedPluginsPage(initialPath?: string) {
  renderPluginsPage(initialPath)
  await screen.findByRole('list', { name: 'Plugin catalog' })
}

describe('PluginsPage', () => {
  beforeEach(() => {
    resetSampleCredentials()
    resetSampleAgents()
    resetSamplePlugins()
    resetSampleAppSettings()
  })
  afterEach(() => vi.restoreAllMocks())

  it('explains plugins and shows every plugin as a card, installed ones first', async () => {
    await renderLoadedPluginsPage()
    expect(screen.getByRole('heading', { level: 1, name: 'Plugins' })).toBeInTheDocument()
    expect(screen.getByText(/Nothing installs without your OK/)).toBeInTheDocument()
    expect(visibleCardNames().slice(0, 2)).toEqual(['Google Maps Scraper', 'Website Check'])
    expect(visibleCardNames()).toHaveLength(9)
    const whatsAppApiCard = getCard('WhatsApp Cloud API')
    expect(within(whatsAppApiCard).getByText('Not installed')).toBeInTheDocument()
    expect(within(whatsAppApiCard).getByText(/Messaging · v0\.3\.0 · Beta/)).toBeInTheDocument()
    expect(within(whatsAppApiCard).getByRole('list', { name: 'WhatsApp Cloud API needs' })).toHaveTextContent(/Internet.*Secrets.*4 settings/)
    expect(within(whatsAppApiCard).getByText('Adds 3 steps')).toBeInTheDocument()
  })

  it('gives each card one status: update, needs setup or installed', async () => {
    await samplePluginsBackend.installPlugin('whatsapp-api')
    await renderLoadedPluginsPage()
    expect(within(getCard('Google Maps Scraper')).getByText('Update available')).toBeInTheDocument()
    expect(within(getCard('Google Maps Scraper')).getByRole('button', { name: 'Update Google Maps Scraper' })).toHaveTextContent('Update to v1.1.0')
    expect(within(getCard('Google Maps Scraper')).getByText(/v1\.0\.0 installed/)).toBeInTheDocument()
    // whatsapp-api asks for secrets and is not trusted yet; website-check needs no trust.
    expect(within(getCard('WhatsApp Cloud API')).getByText('Needs setup')).toBeInTheDocument()
    expect(within(getCard('WhatsApp Cloud API')).getByRole('link', { name: 'Set up WhatsApp Cloud API' })).toHaveAttribute('href', pluginDetailPath('whatsapp-api'))
    expect(within(getCard('Website Check')).getByText('Installed v0.4.0')).toBeInTheDocument()
    expect(within(getCard('Website Check')).getByRole('link', { name: 'Open Website Check' })).toHaveAttribute('href', pluginDetailPath('website-check'))
  })

  it('filters by tab with live counts', async () => {
    await samplePluginsBackend.installPlugin('whatsapp-api')
    await renderLoadedPluginsPage()
    const tabs = screen.getByRole('group', { name: 'Show plugins' })
    expect(within(tabs).getByRole('button', { name: 'All 9' })).toHaveAttribute('aria-pressed', 'true')
    fireEvent.click(within(tabs).getByRole('button', { name: 'Installed 3' }))
    expect(visibleCardNames()).toEqual(['WhatsApp Cloud API', 'Google Maps Scraper', 'Website Check'])
    fireEvent.click(within(tabs).getByRole('button', { name: 'Updates 1' }))
    expect(visibleCardNames()).toEqual(['Google Maps Scraper'])
    fireEvent.click(within(tabs).getByRole('button', { name: 'Needs attention 1' }))
    expect(visibleCardNames()).toEqual(['WhatsApp Cloud API'])
  })

  it('says so when a tab is empty', async () => {
    vi.spyOn(samplePluginsBackend, 'listInstalledPlugins').mockResolvedValue([])
    renderPluginsPage(`${routePaths.plugins}?tab=installed`)
    expect(await screen.findByText('No plugins installed yet. Pick one under All')).toBeInTheDocument()
  })

  it('searches names, descriptions and step titles', async () => {
    await renderLoadedPluginsPage()
    const searchBox = screen.getByRole('searchbox', { name: 'Search plugins' })
    fireEvent.change(searchBox, { target: { value: 'WHATSAPP' } })
    expect(visibleCardNames()).toEqual(['WhatsApp Cloud API', 'WhatsApp Web'])
    fireEvent.change(searchBox, { target: { value: 'merge pdfs' } })
    expect(visibleCardNames()).toEqual(['PDF Tools'])
    fireEvent.change(searchBox, { target: { value: 'no such plugin' } })
    expect(screen.getByText('No plugins match “no such plugin”')).toBeInTheDocument()
    fireEvent.change(searchBox, { target: { value: '' } })
    expect(visibleCardNames()).toHaveLength(9)
  })

  it('titles each card with the display name and still finds it by its technical name', async () => {
    await renderLoadedPluginsPage()
    const card = getCard('WhatsApp Cloud API')
    expect(within(card).getByRole('heading', { level: 3 })).toHaveTextContent('WhatsApp Cloud API')
    expect(within(card).getByRole('link', { name: 'WhatsApp Cloud API' })).toHaveAttribute('href', pluginDetailPath('whatsapp-api'))
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search plugins' }), { target: { value: 'whatsapp-api' } })
    expect(visibleCardNames()).toEqual(['WhatsApp Cloud API'])
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search plugins' }), { target: { value: 'cloud api' } })
    expect(visibleCardNames()).toEqual(['WhatsApp Cloud API'])
  })

  it('humanizes the name on a card when the catalog has no display name', async () => {
    const catalog = await samplePluginsBackend.listPluginCatalog(false)
    vi.spyOn(samplePluginsBackend, 'listPluginCatalog').mockResolvedValue({
      ...catalog,
      plugins: catalog.plugins.map((entry) => (entry.name === 'whatsapp-api' ? { ...entry, displayName: '' } : entry)),
    })
    await renderLoadedPluginsPage()
    expect(within(getCard('WhatsApp API')).getByRole('button', { name: 'Install WhatsApp API' })).toBeInTheDocument()
  })

  it('narrows to one category with the chips', async () => {
    await renderLoadedPluginsPage()
    const categories = screen.getByRole('group', { name: 'Category' })
    fireEvent.click(within(categories).getByRole('button', { name: /^Messaging/ }))
    expect(visibleCardNames()).toEqual(['WhatsApp Cloud API', 'WhatsApp Web', 'Telegram Bot'])
    fireEvent.click(within(categories).getByRole('button', { name: 'Any category' }))
    expect(visibleCardNames()).toHaveLength(9)
  })

  it('reads the filters from the URL', async () => {
    await renderLoadedPluginsPage(`${routePaths.plugins}?q=sheets`)
    expect(screen.getByRole('searchbox', { name: 'Search plugins' })).toHaveValue('sheets')
    expect(visibleCardNames()).toEqual(['Google Sheets'])
  })

  it('asks before installing from a card, then installs untrusted with progress', async () => {
    let finishInstall: () => void = () => undefined
    const installPlugin = samplePluginsBackend.installPlugin
    vi.spyOn(samplePluginsBackend, 'installPlugin').mockImplementation(
      (name) =>
        new Promise((resolve) => {
          finishInstall = () => void installPlugin(name).then(resolve)
        }),
    )
    await renderLoadedPluginsPage()
    fireEvent.click(within(getCard('WhatsApp Cloud API')).getByRole('button', { name: 'Install WhatsApp Cloud API' }))
    const approval = within(getCard('WhatsApp Cloud API')).getByRole('group', { name: 'Install WhatsApp Cloud API?' })
    expect(approval).toHaveTextContent('Runs its code on this computer and asks for: Internet, Secrets, 4 settings. It starts untrusted')
    expect(samplePluginsBackend.installPlugin).not.toHaveBeenCalled()

    fireEvent.click(within(approval).getByRole('button', { name: 'Confirm install WhatsApp Cloud API' }))
    act(() => emitSamplePluginEvent({ type: 'install_progress', name: 'whatsapp-api', stage: 'downloading', receivedBytes: 20, totalBytes: 50, message: null }))
    expect(within(getCard('WhatsApp Cloud API')).getByRole('status')).toHaveTextContent('Downloading · 40%')
    expect(within(getCard('WhatsApp Cloud API')).getByRole('button', { name: 'Confirm install WhatsApp Cloud API' })).toBeDisabled()

    act(() => finishInstall())
    await waitFor(() => expect(within(getCard('WhatsApp Cloud API')).getByText('Needs setup')).toBeInTheDocument())
    expect(within(getCard('WhatsApp Cloud API')).getByRole('link', { name: 'Set up WhatsApp Cloud API' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Installed 3' })).toBeInTheDocument()
  })

  it('cancels the install approval without installing', async () => {
    const installSpy = vi.spyOn(samplePluginsBackend, 'installPlugin')
    await renderLoadedPluginsPage()
    fireEvent.click(within(getCard('Stripe')).getByRole('button', { name: 'Install Stripe' }))
    fireEvent.click(within(getCard('Stripe')).getByRole('button', { name: 'Cancel' }))
    expect(within(getCard('Stripe')).queryByRole('group', { name: 'Install Stripe?' })).not.toBeInTheDocument()
    expect(installSpy).not.toHaveBeenCalled()
  })

  it('updates a plugin from its card', async () => {
    await renderLoadedPluginsPage()
    fireEvent.click(within(getCard('Google Maps Scraper')).getByRole('button', { name: 'Update Google Maps Scraper' }))
    expect(await within(getCard('Google Maps Scraper')).findByText('Installed v1.1.0')).toBeInTheDocument()
    expect(within(getCard('Google Maps Scraper')).getByRole('link', { name: 'Open Google Maps Scraper' })).toBeInTheDocument()
  })

  it('shows the error when an action fails', async () => {
    vi.spyOn(samplePluginsBackend, 'updatePlugin').mockRejectedValue(new BackendError('internal', 'The plugin folder is in use'))
    await renderLoadedPluginsPage()
    fireEvent.click(within(getCard('Google Maps Scraper')).getByRole('button', { name: 'Update Google Maps Scraper' }))
    expect(await within(getCard('Google Maps Scraper')).findByRole('alert')).toHaveTextContent('Could not update Google Maps Scraper: The plugin folder is in use')
  })

  it('opens a plugin page from its card', async () => {
    await renderLoadedPluginsPage()
    fireEvent.click(within(getCard('WhatsApp Web')).getByRole('link', { name: 'Details WhatsApp Web' }))
    expect(await screen.findByRole('heading', { name: 'Plugin detail' })).toBeInTheDocument()
  })

  it('shows the browser runtime banner while an installed plugin needs it, and installs it', async () => {
    await renderLoadedPluginsPage()
    const banner = screen.getByRole('region', { name: 'Browser runtime' })
    expect(banner).toHaveTextContent('Chromium for Google Maps Scraper')
    expect(await within(banner).findByText('Not installed')).toBeInTheDocument()
    fireEvent.click(within(banner).getByRole('button', { name: 'Install browser runtime' }))
    expect(await within(banner).findByText('Installed')).toBeInTheDocument()
    expect(within(banner).queryByRole('button', { name: 'Install browser runtime' })).not.toBeInTheDocument()
  })

  it('hides the browser runtime banner when no installed plugin needs it', async () => {
    vi.spyOn(samplePluginsBackend, 'listInstalledPlugins').mockResolvedValue([])
    await renderLoadedPluginsPage()
    expect(screen.queryByRole('region', { name: 'Browser runtime' })).not.toBeInTheDocument()
  })

  it('keeps installed plugins when the catalog cannot be loaded', async () => {
    vi.spyOn(samplePluginsBackend, 'listPluginCatalog').mockRejectedValue(new BackendError('internal', 'You are offline'))
    await renderLoadedPluginsPage()
    expect(screen.getByText(/Could not load the plugin catalog: You are offline/)).toBeInTheDocument()
    expect(visibleCardNames()).toEqual(['Google Maps Scraper', 'Website Check'])
  })

  it('switches automatic updates off next to the tabs', async () => {
    await renderLoadedPluginsPage()
    const toggle = await screen.findByRole('checkbox', { name: 'Update automatically' })
    expect(toggle).toBeChecked()
    fireEvent.click(toggle)
    await waitFor(async () => expect((await sampleAppSettingsBackend.getAppSettings()).autoUpdatePlugins).toBe(false))
    expect(toggle).not.toBeChecked()
  })

  it('sends an update asking for new permissions to the plugin page for review', async () => {
    setSampleInstalledPlugin('google-maps-scraper', '1.0.0', { network: true, secrets: false, env: [] })
    await renderLoadedPluginsPage(`${routePaths.plugins}?tab=updates`)
    const card = getCard('Google Maps Scraper')
    expect(within(card).queryByRole('button', { name: 'Update Google Maps Scraper' })).not.toBeInTheDocument()
    fireEvent.click(within(card).getByRole('link', { name: 'Review update Google Maps Scraper' }))
    expect(await screen.findByRole('heading', { name: 'Plugin detail' })).toBeInTheDocument()
  })

  describe('catalog refresh', () => {
    it('checks for updates on request and says when the catalog was updated', async () => {
      const listCatalog = vi.spyOn(samplePluginsBackend, 'listPluginCatalog')
      await renderLoadedPluginsPage()
      expect(screen.getByText(/Updated just now · catalog published/)).toBeInTheDocument()
      expect(listCatalog).not.toHaveBeenCalledWith(true)

      fireEvent.click(screen.getByRole('button', { name: 'Check for updates' }))

      expect(screen.getByRole('button', { name: 'Check for updates' })).toBeDisabled()
      expect(screen.getByText('Checking for updates…')).toBeInTheDocument()
      await waitFor(() => expect(screen.getByRole('button', { name: 'Check for updates' })).toBeEnabled())
      expect(listCatalog).toHaveBeenCalledWith(true)
      expect(screen.queryByText('Checking for updates…')).not.toBeInTheDocument()
      expect(screen.getByText(/Updated just now/)).toBeInTheDocument()
      expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    })

    it('shows why checking for updates failed and keeps the list', async () => {
      await renderLoadedPluginsPage()
      vi.spyOn(samplePluginsBackend, 'listPluginCatalog').mockRejectedValue(new BackendError('internal', 'You are offline'))

      fireEvent.click(screen.getByRole('button', { name: 'Check for updates' }))

      expect(await screen.findByRole('alert')).toHaveTextContent('Could not check for updates: You are offline')
      expect(visibleCardNames()).toHaveLength(9)
    })

    it('says so when only the saved catalog could be shown', async () => {
      await renderLoadedPluginsPage()
      const savedCopy = { ...(await samplePluginsBackend.listPluginCatalog(false)), fromCache: true, fetchedAt: null }
      vi.spyOn(samplePluginsBackend, 'listPluginCatalog').mockResolvedValue(savedCopy)

      fireEvent.click(screen.getByRole('button', { name: 'Check for updates' }))

      expect(await screen.findByRole('alert')).toHaveTextContent(/last saved copy/)
    })

    it('refetches a catalog older than 10 minutes in the background when the page opens', async () => {
      setSampleCatalogFetchedAt(Date.now() - 11 * 60 * 1000)
      const listCatalog = vi.spyOn(samplePluginsBackend, 'listPluginCatalog')

      await renderLoadedPluginsPage()

      expect(visibleCardNames()).toHaveLength(9)
      await waitFor(() => expect(listCatalog).toHaveBeenCalledWith(true))
      await waitFor(() => expect(screen.getByText(/Updated just now/)).toBeInTheDocument())
      expect(listCatalog.mock.calls.filter(([refresh]) => refresh === true)).toHaveLength(1)
    })

    it('does not refetch a catalog fetched a few minutes ago', async () => {
      setSampleCatalogFetchedAt(Date.now() - 3 * 60 * 1000)
      const listCatalog = vi.spyOn(samplePluginsBackend, 'listPluginCatalog')

      await renderLoadedPluginsPage()

      expect(screen.getByText(/Updated 3 minutes ago/)).toBeInTheDocument()
      await act(async () => {
        await Promise.resolve()
      })
      expect(listCatalog).not.toHaveBeenCalledWith(true)
    })
  })
})
