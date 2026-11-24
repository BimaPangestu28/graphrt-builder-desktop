import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { resetSampleAgents } from '@/api/sampleBackend/agents'
import { resetSampleAppSettings, sampleAppSettingsBackend } from '@/api/sampleBackend/appSettings'
import { resetSampleCredentials } from '@/api/sampleBackend/credentials'
import { resetSamplePlugins, samplePluginsBackend, setSampleCatalogLabels } from '@/api/sampleBackend/plugins'
import { pluginDetailPath, pluginDetailPattern, routePaths } from '@/routes'
import { PluginDetailPage } from '../PluginDetailPage'
import { PluginsPage } from '../PluginsPage'
import { centerOf, createFakeWindowDragDrop, placeElement } from '@/test/fileDropTestUtils'
import { SettingsPage } from '../SettingsPage'

/**
 * Plugin sources on the Plugins and plugin pages: the Community and Local badges, the
 * community install wording, the repository link, and sideloading behind Developer mode.
 */

function renderAt(initialPath: string) {
  return render(
    <MemoryRouter initialEntries={[initialPath]}>
      <Routes>
        <Route path={routePaths.plugins} element={<PluginsPage />} />
        <Route path={pluginDetailPattern} element={<PluginDetailPage />} />
        <Route path={routePaths.settings} element={<SettingsPage />} />
      </Routes>
    </MemoryRouter>,
  )
}

async function renderLoadedPluginsPage() {
  renderAt(routePaths.plugins)
  await screen.findByRole('list', { name: 'Plugin catalog' })
}

function getCard(displayName: string) {
  return screen.getByRole('article', { name: displayName })
}

const communityLabels = { source: 'community' as const, publisher: 'Acme Bots', repositoryUrl: 'https://github.com/acme/telegram-bot' }

async function turnOnDeveloperMode() {
  const settings = await sampleAppSettingsBackend.getAppSettings()
  await sampleAppSettingsBackend.updateAppSettings({ ...settings, developerMode: true })
}

describe('plugin sources', () => {
  beforeEach(() => {
    resetSampleCredentials()
    resetSampleAgents()
    resetSamplePlugins()
    resetSampleAppSettings()
  })
  afterEach(() => vi.restoreAllMocks())

  it('badges community plugins and leaves official ones unbadged', async () => {
    setSampleCatalogLabels('telegram-bot', communityLabels)
    await renderLoadedPluginsPage()
    expect(within(getCard('Telegram Bot')).getByText('Community')).toBeInTheDocument()
    expect(within(getCard('Stripe')).queryByText('Community')).not.toBeInTheDocument()
    expect(within(getCard('Stripe')).queryByText(/Official|Local/)).not.toBeInTheDocument()
  })

  it('says who maintains a community plugin before it installs', async () => {
    setSampleCatalogLabels('telegram-bot', communityLabels)
    await renderLoadedPluginsPage()
    fireEvent.click(within(getCard('Telegram Bot')).getByRole('button', { name: 'Install Telegram Bot' }))
    const approval = screen.getByRole('group', { name: 'Install Telegram Bot?' })
    expect(approval).toHaveTextContent('Reviewed by the graphrt maintainers, but maintained by Acme Bots.')
    fireEvent.click(within(getCard('Stripe')).getByRole('button', { name: 'Install Stripe' }))
    expect(screen.getByRole('group', { name: 'Install Stripe?' })).not.toHaveTextContent(/maintained by/)
  })

  it('shows the badge, publisher and repository link on a community plugin page', async () => {
    setSampleCatalogLabels('telegram-bot', communityLabels)
    const openSpy = vi.spyOn(window, 'open').mockReturnValue(null)
    renderAt(pluginDetailPath('telegram-bot'))
    await screen.findByRole('heading', { level: 1, name: 'Telegram Bot' })
    const header = screen.getByRole('banner')
    expect(within(header).getByText('Community')).toBeInTheDocument()
    expect(within(header).getByText('by Acme Bots')).toBeInTheDocument()
    expect(within(header).getByText(/Reviewed by the graphrt maintainers, but maintained by Acme Bots\./)).toBeInTheDocument()
    const about = screen.getByRole('region', { name: 'About' })
    expect(within(about).getByText('Community (reviewed by graphrt)')).toBeInTheDocument()
    fireEvent.click(within(about).getByRole('button', { name: /View the source code/ }))
    await waitFor(() => expect(openSpy).toHaveBeenCalledWith('https://github.com/acme/telegram-bot', '_blank', 'noopener,noreferrer'))
  })

  it('hides "Install from folder or archive…" until Developer mode is on', async () => {
    await renderLoadedPluginsPage()
    expect(screen.queryByRole('button', { name: 'Install from folder or archive…' })).not.toBeInTheDocument()
  })

  it('turns Developer mode on in Settings › About', async () => {
    const updateSpy = vi.spyOn(sampleAppSettingsBackend, 'updateAppSettings')
    renderAt(routePaths.settings)
    fireEvent.click(await screen.findByRole('button', { name: 'About' }))
    const toggle = await screen.findByRole('checkbox', { name: /Developer mode/ })
    expect(toggle).not.toBeChecked()
    fireEvent.click(toggle)
    await waitFor(() => expect(updateSpy).toHaveBeenCalledWith(expect.objectContaining({ developerMode: true })))
    expect((await sampleAppSettingsBackend.getAppSettings()).developerMode).toBe(true)
  })

  it('sideloads a folder in Developer mode and labels it Local · not reviewed', async () => {
    await turnOnDeveloperMode()
    await renderLoadedPluginsPage()
    fireEvent.click(await screen.findByRole('button', { name: 'Install from folder or archive…' }))
    const panel = screen.getByRole('region', { name: 'Install a plugin from this computer' })
    expect(panel).toHaveTextContent(/nobody has reviewed the code/)
    fireEvent.click(within(panel).getByRole('button', { name: 'Choose folder…' }))

    expect(await within(panel).findByText(/Installed My Local Plugin v0\.1\.0 from this computer/)).toBeInTheDocument()
    const card = await screen.findByRole('article', { name: 'My Local Plugin' })
    expect(within(card).getByText('Local · not reviewed')).toBeInTheDocument()
    const installed = await samplePluginsBackend.listInstalledPlugins()
    expect(installed.find((plugin) => plugin.name === 'my-local-plugin')).toMatchObject({ source: 'local', trusted: false, localPath: '/Users/you/code/my-local-plugin' })
  })

  it('installs a plugin folder dropped on the drop zone', async () => {
    await turnOnDeveloperMode()
    const fakeWindow = createFakeWindowDragDrop()
    const installSpy = vi.spyOn(samplePluginsBackend, 'installLocalPlugin')
    render(
      <fakeWindow.Provider>
        <MemoryRouter initialEntries={[routePaths.plugins]}>
          <PluginsPage />
        </MemoryRouter>
      </fakeWindow.Provider>,
    )
    fireEvent.click(await screen.findByRole('button', { name: 'Install from folder or archive…' }))
    const dropZone = screen.getByRole('group', { name: 'Drop a plugin folder or .tar.gz archive' })
    const zoneBox = { left: 20, top: 300, width: 600, height: 140 }
    placeElement(dropZone, zoneBox)

    fakeWindow.drop(['/Users/you/Downloads/plugin.zip'], centerOf(zoneBox))
    expect(dropZone).toHaveTextContent('plugin.zip is not a folder or a .tar.gz or .tgz file')
    fakeWindow.drop(['/Users/you/code/my-local-plugin'], { x: 5, y: 5 })
    expect(installSpy).not.toHaveBeenCalled()

    fakeWindow.drop(['/Users/you/code/my-local-plugin'], centerOf(zoneBox))
    expect(await screen.findByText(/Installed My Local Plugin v0\.1\.0 from this computer/)).toBeInTheDocument()
    expect(installSpy).toHaveBeenCalledWith('/Users/you/code/my-local-plugin', false)
  })

  it('installs a .tar.gz archive dropped in the browser preview', async () => {
    await turnOnDeveloperMode()
    const installSpy = vi.spyOn(samplePluginsBackend, 'installLocalPlugin')
    await renderLoadedPluginsPage()
    fireEvent.click(await screen.findByRole('button', { name: 'Install from folder or archive…' }))
    const dropZone = screen.getByRole('group', { name: 'Drop a plugin folder or .tar.gz archive' })
    const archive = new File(['x'], 'my-local-plugin-0.1.0.tar.gz', { type: 'application/gzip' })
    const dataTransfer = { files: [archive], items: [{ kind: 'file', getAsFile: () => archive }], types: ['Files'] }
    fireEvent.drop(dropZone, { dataTransfer })
    await waitFor(() => expect(installSpy).toHaveBeenCalledWith('my-local-plugin-0.1.0.tar.gz', false))
  })

  it('asks before a sideloaded plugin replaces one installed from the catalog', async () => {
    await turnOnDeveloperMode()
    vi.spyOn(samplePluginsBackend, 'pickLocalPluginPath').mockResolvedValue('/Users/you/code/google-maps-scraper')
    await renderLoadedPluginsPage()
    fireEvent.click(await screen.findByRole('button', { name: 'Install from folder or archive…' }))
    fireEvent.click(screen.getByRole('button', { name: 'Choose folder…' }))

    const confirmation = await screen.findByRole('group', { name: 'Replace the catalog plugin?' })
    expect(confirmation).toHaveTextContent(/already installed from the catalog/)
    expect((await samplePluginsBackend.listInstalledPlugins()).find((plugin) => plugin.name === 'google-maps-scraper')?.source).toBe('official')
    fireEvent.click(within(confirmation).getByRole('button', { name: 'Replace' }))

    expect(await screen.findByText(/from this computer\. It starts untrusted/)).toBeInTheDocument()
    await waitFor(() => expect(within(getCard('Google Maps Scraper')).getByText('Local · not reviewed')).toBeInTheDocument())
    expect(within(getCard('Google Maps Scraper')).queryByText('Update available')).not.toBeInTheDocument()
  })

  it('shows where a local plugin came from on its page', async () => {
    await turnOnDeveloperMode()
    await samplePluginsBackend.installLocalPlugin('/Users/you/code/my-local-plugin', false)
    renderAt(pluginDetailPath('my-local-plugin'))
    await screen.findByRole('heading', { level: 1, name: 'My Local Plugin' })
    expect(within(screen.getByRole('banner')).getByText('Local · not reviewed')).toBeInTheDocument()
    const about = screen.getByRole('region', { name: 'About' })
    expect(within(about).getByText('/Users/you/code/my-local-plugin')).toBeInTheDocument()
    expect(within(about).queryByText('Catalog version')).not.toBeInTheDocument()
    expect(within(about).queryByRole('button', { name: /View the source code/ })).not.toBeInTheDocument()
  })
})
