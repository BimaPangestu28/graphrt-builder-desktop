import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { toBackendError } from '@/api/client'
import type { NewerAppNeeded, PluginCatalog } from '@/api/pluginTypes'
import { resetSampleAgents } from '@/api/sampleBackend/agents'
import { resetSampleCredentials } from '@/api/sampleBackend/credentials'
import { resetSampleAppSettings } from '@/api/sampleBackend/appSettings'
import { resetSamplePlugins, samplePluginsBackend } from '@/api/sampleBackend/plugins'
import { isInstallableUpdate } from '@/hooks/usePluginUpdates'
import { setLocale } from '@/i18n/locale'
import { pluginDetailPath, pluginDetailPattern, routePaths } from '@/routes'
import { PluginDetailPage } from '../PluginDetailPage'
import { PluginsPage } from '../PluginsPage'
import { AppUpdateContext, type AppUpdateControls, type UpdateStatus } from '../updates/updateContext'

function createUpdateControls(status: UpdateStatus): AppUpdateControls {
  return {
    status,
    restartState: { kind: 'none' },
    currentVersion: '0.2.1',
    checkNow: vi.fn(async () => undefined),
    downloadNow: vi.fn(async () => undefined),
    requestRestart: vi.fn(async () => undefined),
    restartNow: vi.fn(async () => undefined),
    restartWhenIdle: vi.fn(),
    cancelRestart: vi.fn(),
  }
}

const availableUpdate = { version: '0.3.0', currentVersion: '0.2.1', releaseNotes: null, publishedAt: null }

/** The sample catalog with `needsNewerApp` on the plugins named. */
async function catalogNeedingNewerApp(needs: Record<string, NewerAppNeeded>): Promise<PluginCatalog> {
  const catalog = await samplePluginsBackend.listPluginCatalog(false)
  return { ...catalog, plugins: catalog.plugins.map((entry) => ({ ...entry, needsNewerApp: needs[entry.name] ?? null })) }
}

async function serveCatalogNeedingNewerApp(needs: Record<string, NewerAppNeeded>) {
  const catalog = await catalogNeedingNewerApp(needs)
  vi.spyOn(samplePluginsBackend, 'listPluginCatalog').mockResolvedValue(catalog)
}

function renderWithUpdates(initialPath: string, updateControls: AppUpdateControls | null) {
  return render(
    <MemoryRouter initialEntries={[initialPath]}>
      <AppUpdateContext.Provider value={updateControls}>
        <Routes>
          <Route path={routePaths.plugins} element={<PluginsPage />} />
          <Route path={pluginDetailPattern} element={<PluginDetailPage />} />
        </Routes>
      </AppUpdateContext.Provider>
    </MemoryRouter>,
  )
}

async function renderPluginsList(updateControls: AppUpdateControls | null = createUpdateControls({ kind: 'idle' })) {
  renderWithUpdates(routePaths.plugins, updateControls)
  await screen.findByRole('list', { name: 'Plugin catalog' })
}

async function renderPluginPage(pluginName: string, heading: string, updateControls: AppUpdateControls | null = createUpdateControls({ kind: 'idle' })) {
  renderWithUpdates(pluginDetailPath(pluginName), updateControls)
  await screen.findByRole('heading', { level: 1, name: heading })
}

function getCard(pluginName: string) {
  return screen.getByRole('article', { name: pluginName })
}

describe('plugins that need a newer app', () => {
  beforeEach(() => {
    resetSampleCredentials()
    resetSampleAgents()
    resetSamplePlugins()
    resetSampleAppSettings()
    setLocale('en')
  })
  afterEach(() => {
    vi.restoreAllMocks()
    setLocale('en')
  })

  describe('on a plugin card', () => {
    it('says which version is needed and disables Install, leaving other cards alone', async () => {
      await serveCatalogNeedingNewerApp({ 'whatsapp-api': { minVersion: '0.3.0' } })
      await renderPluginsList()

      const card = getCard('WhatsApp Cloud API')
      const notice = within(card).getByRole('note', { name: 'What WhatsApp Cloud API needs' })
      expect(notice).toHaveTextContent('Needs Graphrt Desktop 0.3.0 or newer')
      expect(notice).toHaveTextContent('You have 0.2.1. Update the app to install this plugin.')
      const install = within(card).getByRole('button', { name: 'Install WhatsApp Cloud API' })
      expect(install).toBeDisabled()
      expect(install).toHaveAccessibleDescription(/Needs Graphrt Desktop 0\.3\.0 or newer/)
      expect(within(card).getByRole('link', { name: 'Details WhatsApp Cloud API' })).toHaveAttribute('href', pluginDetailPath('whatsapp-api'))

      const otherCard = getCard('PDF Tools')
      expect(within(otherCard).queryByRole('note', { name: /needs$/ })).not.toBeInTheDocument()
      expect(within(otherCard).getByRole('button', { name: 'Install PDF Tools' })).toBeEnabled()
    })

    it('never opens the install approval or calls install for such a plugin', async () => {
      await serveCatalogNeedingNewerApp({ 'whatsapp-api': { minVersion: '0.3.0' } })
      const install = vi.spyOn(samplePluginsBackend, 'installPlugin')
      await renderPluginsList()

      fireEvent.click(within(getCard('WhatsApp Cloud API')).getByRole('button', { name: 'Install WhatsApp Cloud API' }))

      expect(screen.queryByRole('group', { name: 'Install WhatsApp Cloud API?' })).not.toBeInTheDocument()
      expect(install).not.toHaveBeenCalled()
    })

    it('says only "a newer version" when the catalog gives no version this app can read', async () => {
      await serveCatalogNeedingNewerApp({ 'whatsapp-api': { minVersion: null } })
      await renderPluginsList()

      const notice = within(getCard('WhatsApp Cloud API')).getByRole('note', { name: 'What WhatsApp Cloud API needs' })
      expect(notice).toHaveTextContent('Needs a newer version of Graphrt Desktop')
      expect(within(getCard('WhatsApp Cloud API')).getByRole('button', { name: 'Install WhatsApp Cloud API' })).toBeDisabled()
    })

    it('keeps an installed plugin usable and holds back only its update', async () => {
      // The sample has google-maps-scraper 1.0.0 installed and 1.1.0 in the catalog.
      await serveCatalogNeedingNewerApp({ 'google-maps-scraper': { minVersion: '0.3.0' } })
      await renderPluginsList()

      const card = getCard('Google Maps Scraper')
      expect(within(card).getByRole('note', { name: 'What Google Maps Scraper needs' })).toHaveTextContent(
        'Needs Graphrt Desktop 0.3.0 or newer' + 'You have 0.2.1. The update to v1.1.0 waits for it. The version you have keeps working.',
      )
      expect(within(card).queryByRole('button', { name: 'Update Google Maps Scraper' })).not.toBeInTheDocument()
      expect(within(card).getByRole('link', { name: 'Open Google Maps Scraper' })).toHaveAttribute('href', pluginDetailPath('google-maps-scraper'))
    })

    it('shows nothing about the app for an installed plugin that is up to date', async () => {
      await serveCatalogNeedingNewerApp({ 'website-check': { minVersion: '0.3.0' } })
      await renderPluginsList()

      expect(within(getCard('Website Check')).queryByRole('note', { name: 'What Website Check needs' })).not.toBeInTheDocument()
      expect(within(getCard('Website Check')).getByRole('link', { name: 'Open Website Check' })).toBeInTheDocument()
    })

    it('is said in Bahasa Indonesia too', async () => {
      setLocale('id')
      await serveCatalogNeedingNewerApp({ 'whatsapp-api': { minVersion: '0.3.0' } })
      renderWithUpdates(routePaths.plugins, createUpdateControls({ kind: 'available', update: availableUpdate, downloadError: null }))

      const card = await screen.findByRole('article', { name: 'WhatsApp Cloud API' })
      const notice = within(card).getByRole('note', { name: 'Yang dibutuhkan WhatsApp Cloud API' })
      expect(notice).toHaveTextContent('Butuh Graphrt Desktop 0.3.0 atau lebih baru')
      expect(notice).toHaveTextContent('Versi kamu 0.2.1. Perbarui aplikasi untuk memasang plugin ini.')
      expect(within(notice).getByRole('button', { name: 'Perbarui Graphrt Desktop' })).toBeInTheDocument()
      expect(within(card).getByRole('button', { name: 'Pasang WhatsApp Cloud API' })).toBeDisabled()
    })
  })

  describe('the way to update, from the app updater', () => {
    async function renderNotice(status: UpdateStatus) {
      await serveCatalogNeedingNewerApp({ 'whatsapp-api': { minVersion: '0.3.0' } })
      const updateControls = createUpdateControls(status)
      await renderPluginsList(updateControls)
      const notice = within(getCard('WhatsApp Cloud API')).getByRole('note', { name: 'What WhatsApp Cloud API needs' })
      return { notice, updateControls }
    }

    it('checks for an app update when none was looked for yet', async () => {
      const { notice, updateControls } = await renderNotice({ kind: 'idle' })
      fireEvent.click(within(notice).getByRole('button', { name: 'Check for an app update' }))
      expect(updateControls.checkNow).toHaveBeenCalledTimes(1)
    })

    it('downloads the update that was found', async () => {
      const { notice, updateControls } = await renderNotice({ kind: 'available', update: availableUpdate, downloadError: null })
      fireEvent.click(within(notice).getByRole('button', { name: 'Update Graphrt Desktop' }))
      expect(updateControls.downloadNow).toHaveBeenCalledTimes(1)
    })

    it('shows the download and then offers the restart', async () => {
      const downloading = await renderNotice({ kind: 'downloading', update: availableUpdate, percent: 40 })
      expect(within(downloading.notice).getByRole('status')).toHaveTextContent('Downloading the update… 40%')
    })

    it('restarts into a downloaded update', async () => {
      const { notice, updateControls } = await renderNotice({ kind: 'ready', update: availableUpdate })
      fireEvent.click(within(notice).getByRole('button', { name: 'Restart to update' }))
      expect(updateControls.requestRestart).toHaveBeenCalledTimes(1)
    })

    it('says so when no newer app exists for this computer yet', async () => {
      const { notice } = await renderNotice({ kind: 'upToDate' })
      expect(within(notice).getByRole('status')).toHaveTextContent('There is no newer version for this computer yet. Try again later.')
      expect(within(notice).queryByRole('button')).not.toBeInTheDocument()
    })

    it('says why a check failed and lets it be tried again', async () => {
      const { notice, updateControls } = await renderNotice({ kind: 'checkFailed', message: 'you are offline' })
      expect(within(notice).getByRole('alert')).toHaveTextContent('Could not check for an app update: you are offline')
      fireEvent.click(within(notice).getByRole('button', { name: 'Check for an app update' }))
      expect(updateControls.checkNow).toHaveBeenCalledTimes(1)
    })

    it('still says what is needed where there is no updater (browser preview, a screen on its own)', async () => {
      await serveCatalogNeedingNewerApp({ 'whatsapp-api': { minVersion: '0.3.0' } })
      await renderPluginsList(null)
      const notice = within(getCard('WhatsApp Cloud API')).getByRole('note', { name: 'What WhatsApp Cloud API needs' })
      expect(notice).toHaveTextContent('Needs Graphrt Desktop 0.3.0 or newer' + 'Update the app to install this plugin.')
      expect(within(notice).queryByRole('button')).not.toBeInTheDocument()
    })
  })

  describe('on the plugin page', () => {
    it('disables Install and explains, instead of the usual install notes', async () => {
      await serveCatalogNeedingNewerApp({ 'whatsapp-api': { minVersion: '0.3.0' } })
      const install = vi.spyOn(samplePluginsBackend, 'installPlugin')
      await renderPluginPage('whatsapp-api', 'WhatsApp Cloud API', createUpdateControls({ kind: 'available', update: availableUpdate, downloadError: null }))

      const installButton = screen.getByRole('button', { name: 'Install WhatsApp Cloud API' })
      expect(installButton).toBeDisabled()
      expect(installButton).toHaveAccessibleDescription(/Needs Graphrt Desktop 0\.3\.0 or newer/)
      const notice = screen.getByRole('note', { name: 'What WhatsApp Cloud API needs' })
      expect(notice).toHaveTextContent('You have 0.2.1. Update the app to install this plugin.')
      expect(within(notice).getByRole('button', { name: 'Update Graphrt Desktop' })).toBeInTheDocument()
      expect(screen.queryByText(/It starts untrusted, without settings or secrets/)).not.toBeInTheDocument()
      fireEvent.click(installButton)
      expect(install).not.toHaveBeenCalled()
      // What the plugin adds and asks for is still shown.
      expect(screen.getByRole('region', { name: 'What it asks for' })).toBeInTheDocument()
    })

    it('holds back the update of an installed plugin and keeps Remove', async () => {
      await serveCatalogNeedingNewerApp({ 'google-maps-scraper': { minVersion: '0.3.0' } })
      const update = vi.spyOn(samplePluginsBackend, 'updatePlugin')
      await renderPluginPage('google-maps-scraper', 'Google Maps Scraper')

      const updateButton = screen.getByRole('button', { name: 'Update Google Maps Scraper' })
      expect(updateButton).toBeDisabled()
      expect(screen.getByRole('note', { name: 'What Google Maps Scraper needs' })).toHaveTextContent('The update to v1.1.0 waits for it. The version you have keeps working.')
      expect(screen.getByRole('button', { name: 'Remove Google Maps Scraper' })).toBeEnabled()
      fireEvent.click(updateButton)
      expect(update).not.toHaveBeenCalled()
    })

    it('shows the backend refusal in plain words if an install is tried anyway', async () => {
      // An older saved catalog without the field: the button is enabled and the backend refuses.
      vi.spyOn(samplePluginsBackend, 'installPlugin').mockRejectedValue(
        toBackendError({ code: 'needs_newer_app', message: 'This plugin needs Graphrt Desktop 0.3.0 or newer. You have 0.2.1.', details: { minVersion: '0.3.0', appVersion: '0.2.1', unknownFeature: null } }),
      )
      await renderPluginPage('whatsapp-api', 'WhatsApp Cloud API')

      fireEvent.click(screen.getByRole('button', { name: 'Install WhatsApp Cloud API' }))

      const alert = await screen.findByRole('alert')
      await waitFor(() => expect(alert).toHaveTextContent('This plugin needs Graphrt Desktop 0.3.0 or newer. You have 0.2.1. Update the app, then try again.'))
      expect(alert).not.toHaveTextContent(/unknown field|manifest/)
    })
  })
})

describe('updates the Home notice counts', () => {
  beforeEach(() => resetSamplePlugins())

  it('leave out an update that needs a newer app', async () => {
    const catalog = await catalogNeedingNewerApp({})
    const update = catalog.plugins.find((entry) => entry.updateAvailable)
    if (!update) throw new Error('the sample catalog has no pending update')
    expect(isInstallableUpdate(update)).toBe(true)
    expect(isInstallableUpdate({ ...update, needsNewerApp: { minVersion: '0.3.0' } })).toBe(false)
    expect(isInstallableUpdate({ ...update, updateAvailable: false })).toBe(false)
  })
})

describe('needs_newer_app errors from the backend', () => {
  afterEach(() => setLocale('en'))

  const raw = (details: unknown) => ({ code: 'needs_newer_app', message: 'backend English text', details })

  it('are said in the app language with the versions from the details', () => {
    setLocale('en')
    expect(toBackendError(raw({ minVersion: '0.3.0', appVersion: '0.2.1', unknownFeature: null })).message).toBe(
      'This plugin needs Graphrt Desktop 0.3.0 or newer. You have 0.2.1. Update the app, then try again.',
    )
    setLocale('id')
    expect(toBackendError(raw({ minVersion: '0.3.0', appVersion: '0.2.1', unknownFeature: null })).message).toBe(
      'Plugin ini butuh Graphrt Desktop 0.3.0 atau lebih baru. Versi kamu 0.2.1. Perbarui aplikasi, lalu coba lagi.',
    )
  })

  it('never show the technical reason of a plugin made for a newer app', () => {
    setLocale('en')
    const error = toBackendError(raw({ minVersion: null, appVersion: '0.2.1', unknownFeature: 'triggers' }))
    expect(error.message).toBe('This plugin was made for a newer version of Graphrt Desktop. You have 0.2.1. Update the app, then try again.')
    expect(error.code).toBe('needs_newer_app')
    expect(error.details).toEqual({ minVersion: null, appVersion: '0.2.1' })
    setLocale('id')
    expect(toBackendError(raw({ minVersion: null, appVersion: '0.2.1', unknownFeature: 'triggers' })).message).toBe(
      'Plugin ini dibuat untuk Graphrt Desktop versi yang lebih baru. Versi kamu 0.2.1. Perbarui aplikasi, lalu coba lagi.',
    )
  })

  it('fall back to the backend text when the details are missing', () => {
    expect(toBackendError(raw(undefined)).message).toBe('backend English text')
    expect(toBackendError(raw({ minVersion: 3 })).message).toBe('backend English text')
  })

  it('leave every other error as the backend wrote it', () => {
    expect(toBackendError({ code: 'invalid_input', message: 'invalid input: nope' }).message).toBe('invalid input: nope')
  })
})
