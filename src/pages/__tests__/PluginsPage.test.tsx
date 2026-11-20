import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { BackendError } from '@/api/client'
import { resetSampleAgents } from '@/api/sampleBackend/agents'
import { resetSampleCredentials } from '@/api/sampleBackend/credentials'
import { resetSampleAppSettings, sampleAppSettingsBackend } from '@/api/sampleBackend/appSettings'
import { emitSamplePluginEvent, resetSamplePlugins, samplePluginsBackend, setSampleInstalledPlugin } from '@/api/sampleBackend/plugins'
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
    expect(visibleCardNames().slice(0, 2)).toEqual(['google-maps-scraper', 'website-check'])
    expect(visibleCardNames()).toHaveLength(9)
    const whatsAppApiCard = getCard('whatsapp-api')
    expect(within(whatsAppApiCard).getByText('Not installed')).toBeInTheDocument()
    expect(within(whatsAppApiCard).getByText(/Messaging · v0\.3\.0 · Beta/)).toBeInTheDocument()
    expect(within(whatsAppApiCard).getByRole('list', { name: 'whatsapp-api needs' })).toHaveTextContent(/Internet.*Secrets.*4 settings/)
    expect(within(whatsAppApiCard).getByText('Adds 3 steps')).toBeInTheDocument()
  })

  it('gives each card one status: update, needs setup or installed', async () => {
    await samplePluginsBackend.installPlugin('whatsapp-api')
    await renderLoadedPluginsPage()
    expect(within(getCard('google-maps-scraper')).getByText('Update available')).toBeInTheDocument()
    expect(within(getCard('google-maps-scraper')).getByRole('button', { name: 'Update google-maps-scraper' })).toHaveTextContent('Update to v1.1.0')
    expect(within(getCard('google-maps-scraper')).getByText(/v1\.0\.0 installed/)).toBeInTheDocument()
    // whatsapp-api asks for secrets and is not trusted yet; website-check needs no trust.
    expect(within(getCard('whatsapp-api')).getByText('Needs setup')).toBeInTheDocument()
    expect(within(getCard('whatsapp-api')).getByRole('link', { name: 'Set up whatsapp-api' })).toHaveAttribute('href', pluginDetailPath('whatsapp-api'))
    expect(within(getCard('website-check')).getByText('Installed v0.4.0')).toBeInTheDocument()
    expect(within(getCard('website-check')).getByRole('link', { name: 'Open website-check' })).toHaveAttribute('href', pluginDetailPath('website-check'))
  })

  it('filters by tab with live counts', async () => {
    await samplePluginsBackend.installPlugin('whatsapp-api')
    await renderLoadedPluginsPage()
    const tabs = screen.getByRole('group', { name: 'Show plugins' })
    expect(within(tabs).getByRole('button', { name: 'All 9' })).toHaveAttribute('aria-pressed', 'true')
    fireEvent.click(within(tabs).getByRole('button', { name: 'Installed 3' }))
    expect(visibleCardNames()).toEqual(['whatsapp-api', 'google-maps-scraper', 'website-check'])
    fireEvent.click(within(tabs).getByRole('button', { name: 'Updates 1' }))
    expect(visibleCardNames()).toEqual(['google-maps-scraper'])
    fireEvent.click(within(tabs).getByRole('button', { name: 'Needs attention 1' }))
    expect(visibleCardNames()).toEqual(['whatsapp-api'])
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
    expect(visibleCardNames()).toEqual(['whatsapp-api', 'whatsapp-web'])
    fireEvent.change(searchBox, { target: { value: 'merge pdfs' } })
    expect(visibleCardNames()).toEqual(['pdf-tools'])
    fireEvent.change(searchBox, { target: { value: 'no such plugin' } })
    expect(screen.getByText('No plugins match “no such plugin”')).toBeInTheDocument()
    fireEvent.change(searchBox, { target: { value: '' } })
    expect(visibleCardNames()).toHaveLength(9)
  })

  it('narrows to one category with the chips', async () => {
    await renderLoadedPluginsPage()
    const categories = screen.getByRole('group', { name: 'Category' })
    fireEvent.click(within(categories).getByRole('button', { name: /^Messaging/ }))
    expect(visibleCardNames()).toEqual(['whatsapp-api', 'whatsapp-web', 'telegram-bot'])
    fireEvent.click(within(categories).getByRole('button', { name: 'Any category' }))
    expect(visibleCardNames()).toHaveLength(9)
  })

  it('reads the filters from the URL', async () => {
    await renderLoadedPluginsPage(`${routePaths.plugins}?q=sheets`)
    expect(screen.getByRole('searchbox', { name: 'Search plugins' })).toHaveValue('sheets')
    expect(visibleCardNames()).toEqual(['google-sheets'])
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
    fireEvent.click(within(getCard('whatsapp-api')).getByRole('button', { name: 'Install whatsapp-api' }))
    const approval = within(getCard('whatsapp-api')).getByRole('group', { name: 'Install whatsapp-api?' })
    expect(approval).toHaveTextContent('Runs its code on this computer and asks for: Internet, Secrets, 4 settings. It starts untrusted')
    expect(samplePluginsBackend.installPlugin).not.toHaveBeenCalled()

    fireEvent.click(within(approval).getByRole('button', { name: 'Confirm install whatsapp-api' }))
    act(() => emitSamplePluginEvent({ type: 'install_progress', name: 'whatsapp-api', stage: 'downloading', receivedBytes: 20, totalBytes: 50, message: null }))
    expect(within(getCard('whatsapp-api')).getByRole('status')).toHaveTextContent('Downloading · 40%')
    expect(within(getCard('whatsapp-api')).getByRole('button', { name: 'Confirm install whatsapp-api' })).toBeDisabled()

    act(() => finishInstall())
    await waitFor(() => expect(within(getCard('whatsapp-api')).getByText('Needs setup')).toBeInTheDocument())
    expect(within(getCard('whatsapp-api')).getByRole('link', { name: 'Set up whatsapp-api' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Installed 3' })).toBeInTheDocument()
  })

  it('cancels the install approval without installing', async () => {
    const installSpy = vi.spyOn(samplePluginsBackend, 'installPlugin')
    await renderLoadedPluginsPage()
    fireEvent.click(within(getCard('stripe')).getByRole('button', { name: 'Install stripe' }))
    fireEvent.click(within(getCard('stripe')).getByRole('button', { name: 'Cancel' }))
    expect(within(getCard('stripe')).queryByRole('group', { name: 'Install stripe?' })).not.toBeInTheDocument()
    expect(installSpy).not.toHaveBeenCalled()
  })

  it('updates a plugin from its card', async () => {
    await renderLoadedPluginsPage()
    fireEvent.click(within(getCard('google-maps-scraper')).getByRole('button', { name: 'Update google-maps-scraper' }))
    expect(await within(getCard('google-maps-scraper')).findByText('Installed v1.1.0')).toBeInTheDocument()
    expect(within(getCard('google-maps-scraper')).getByRole('link', { name: 'Open google-maps-scraper' })).toBeInTheDocument()
  })

  it('shows the error when an action fails', async () => {
    vi.spyOn(samplePluginsBackend, 'updatePlugin').mockRejectedValue(new BackendError('internal', 'The plugin folder is in use'))
    await renderLoadedPluginsPage()
    fireEvent.click(within(getCard('google-maps-scraper')).getByRole('button', { name: 'Update google-maps-scraper' }))
    expect(await within(getCard('google-maps-scraper')).findByRole('alert')).toHaveTextContent('Could not update google-maps-scraper: The plugin folder is in use')
  })

  it('opens a plugin page from its card', async () => {
    await renderLoadedPluginsPage()
    fireEvent.click(within(getCard('whatsapp-web')).getByRole('link', { name: 'Details whatsapp-web' }))
    expect(await screen.findByRole('heading', { name: 'Plugin detail' })).toBeInTheDocument()
  })

  it('shows the browser runtime banner while an installed plugin needs it, and installs it', async () => {
    await renderLoadedPluginsPage()
    const banner = screen.getByRole('region', { name: 'Browser runtime' })
    expect(banner).toHaveTextContent('Chromium for google-maps-scraper')
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
    expect(visibleCardNames()).toEqual(['google-maps-scraper', 'website-check'])
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
    const card = getCard('google-maps-scraper')
    expect(within(card).queryByRole('button', { name: 'Update google-maps-scraper' })).not.toBeInTheDocument()
    fireEvent.click(within(card).getByRole('link', { name: 'Review update google-maps-scraper' }))
    expect(await screen.findByRole('heading', { name: 'Plugin detail' })).toBeInTheDocument()
  })
})
