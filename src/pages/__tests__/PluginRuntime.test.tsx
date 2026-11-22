import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { BackendError } from '@/api/client'
import { resetSampleAgents } from '@/api/sampleBackend/agents'
import { resetSampleAppSettings } from '@/api/sampleBackend/appSettings'
import { resetSampleCredentials } from '@/api/sampleBackend/credentials'
import { resetSamplePlugins, samplePluginsBackend, setSamplePluginRuntimeStatus } from '@/api/sampleBackend/plugins'
import type { PluginRequirement } from '@/api/pluginRequirementTypes'
import { describeBrowserRuntimeEvent } from '@/hooks/useBrowserRuntime'
import { describePluginRuntimeEvent } from '@/hooks/usePluginRuntime'
import { pluginDetailPath, pluginDetailPattern, routePaths } from '@/routes'
import { describeRequirementState, needsOnlySessionLink, needsPluginRuntimeDownload } from '../agent-builder/pluginRequirementDisplay'
import { PluginDetailPage } from '../PluginDetailPage'
import { PluginsPage } from '../PluginsPage'
import { describeWaitingPlugins, PluginRuntimeNotice } from '../plugins/PluginRuntimeNotice'
import { describePluginRuntimeDetails, PluginRuntimeSection } from '../settings/PluginRuntimeSection'

function renderAt(initialPath: string) {
  return render(
    <MemoryRouter initialEntries={[initialPath]}>
      <PluginRuntimeNotice />
      <Routes>
        <Route path={routePaths.plugins} element={<PluginsPage />} />
        <Route path={pluginDetailPattern} element={<PluginDetailPage />} />
        <Route path={routePaths.settings} element={<PluginRuntimeSection />} />
        <Route path={routePaths.home} element={<h1>Home</h1>} />
      </Routes>
    </MemoryRouter>,
  )
}

function getRuntimeBanner() {
  return screen.getByRole('region', { name: 'Plugin runtime' })
}

describe('plugin runtime (Node.js downloaded on demand)', () => {
  beforeEach(() => {
    resetSampleCredentials()
    resetSampleAgents()
    resetSamplePlugins()
    resetSampleAppSettings()
    window.localStorage.clear()
  })
  afterEach(() => vi.restoreAllMocks())

  describe('progress text', () => {
    it('describes plugin runtime progress and leaves it out of the browser progress', () => {
      const nodeProgress = { type: 'node_install_progress', message: 'Downloading Node.js', percent: 40.4 }
      expect(describePluginRuntimeEvent(nodeProgress)).toBe('Downloading Node.js · 40%')
      expect(describePluginRuntimeEvent({ type: 'node_install_started' })).toBeNull()
      expect(describeBrowserRuntimeEvent(nodeProgress)).toBeNull()
      expect(describeBrowserRuntimeEvent({ type: 'browser_install_progress', line: '|■■■■   | 40% of 150 MiB' })).toBe('|■■■■   | 40% of 150 MiB')
    })

    it('names waiting plugins briefly', () => {
      expect(describeWaitingPlugins(['Google Maps Scraper'])).toBe('Google Maps Scraper')
      expect(describeWaitingPlugins(['A', 'B'])).toBe('A and B')
      expect(describeWaitingPlugins(['A', 'B', 'C'])).toBe('A and 2 more')
    })
  })

  describe('Plugins page', () => {
    it('shows no runtime banner while the runtime is installed', async () => {
      renderAt(routePaths.plugins)
      await screen.findByRole('list', { name: 'Plugin catalog' })
      expect(screen.queryByRole('region', { name: 'Plugin runtime' })).not.toBeInTheDocument()
    })

    it('asks for the runtime when installed plugins need it, and installs it on click', async () => {
      setSamplePluginRuntimeStatus('not_installed')
      const installRuntime = vi.spyOn(samplePluginsBackend, 'installPluginRuntime')
      renderAt(routePaths.plugins)
      await screen.findByRole('list', { name: 'Plugin catalog' })
      const banner = await waitFor(getRuntimeBanner)
      expect(banner).toHaveTextContent('Google Maps Scraper, Website Check need the plugin runtime (Node.js, about 30 MB download)')
      expect(installRuntime).not.toHaveBeenCalled()

      fireEvent.click(within(banner).getByRole('button', { name: 'Install plugin runtime' }))
      await waitFor(() => expect(screen.queryByRole('region', { name: 'Plugin runtime' })).not.toBeInTheDocument())
      expect(installRuntime).toHaveBeenCalledTimes(1)
    })

    it('says clearly when the download fails (offline)', async () => {
      setSamplePluginRuntimeStatus('not_installed')
      vi.spyOn(samplePluginsBackend, 'installPluginRuntime').mockRejectedValue(
        new BackendError('internal', 'could not download the plugin runtime from nodejs.org; check the internet connection and try again'),
      )
      renderAt(routePaths.plugins)
      const banner = await waitFor(getRuntimeBanner)
      fireEvent.click(within(banner).getByRole('button', { name: 'Install plugin runtime' }))
      expect(await within(banner).findByRole('alert')).toHaveTextContent('check the internet connection')
      expect(within(banner).getByRole('button', { name: 'Install plugin runtime' })).toBeEnabled()
    })

    it('adds the runtime to the install approval and downloads it with the same click', async () => {
      setSamplePluginRuntimeStatus('not_installed')
      const installRuntime = vi.spyOn(samplePluginsBackend, 'installPluginRuntime')
      renderAt(routePaths.plugins)
      await screen.findByRole('list', { name: 'Plugin catalog' })
      const card = screen.getByRole('article', { name: 'WhatsApp Cloud API' })
      fireEvent.click(within(card).getByRole('button', { name: 'Install WhatsApp Cloud API' }))
      const approval = within(card).getByRole('group', { name: 'Install WhatsApp Cloud API?' })
      expect(await within(approval).findByText(/Also downloads the plugin runtime \(Node\.js, about 30 MB download/)).toBeInTheDocument()
      expect(installRuntime).not.toHaveBeenCalled()

      fireEvent.click(within(approval).getByRole('button', { name: 'Confirm install WhatsApp Cloud API' }))
      await waitFor(() => expect(installRuntime).toHaveBeenCalledTimes(1))
      await waitFor(() => expect(within(screen.getByRole('article', { name: 'WhatsApp Cloud API' })).getByText('Needs setup')).toBeInTheDocument())
    })

    it('never downloads the runtime for an install while it is already there', async () => {
      const installRuntime = vi.spyOn(samplePluginsBackend, 'installPluginRuntime')
      renderAt(routePaths.plugins)
      await screen.findByRole('list', { name: 'Plugin catalog' })
      const card = screen.getByRole('article', { name: 'WhatsApp Cloud API' })
      fireEvent.click(within(card).getByRole('button', { name: 'Install WhatsApp Cloud API' }))
      const approval = within(card).getByRole('group', { name: 'Install WhatsApp Cloud API?' })
      expect(within(approval).queryByText(/Also downloads the plugin runtime/)).not.toBeInTheDocument()
      fireEvent.click(within(approval).getByRole('button', { name: 'Confirm install WhatsApp Cloud API' }))
      await waitFor(() => expect(within(screen.getByRole('article', { name: 'WhatsApp Cloud API' })).getByText('Needs setup')).toBeInTheDocument())
      expect(installRuntime).not.toHaveBeenCalled()
    })
  })

  it('puts the runtime in the setup steps of an installed plugin while it is missing', async () => {
    setSamplePluginRuntimeStatus('not_installed')
    renderAt(pluginDetailPath('google-maps-scraper'))
    const steps = await screen.findByRole('list', { name: 'Setup steps' })
    const runtimeStep = await within(steps).findByText('Plugin runtime')
    expect(runtimeStep).toBeInTheDocument()
    fireEvent.click(within(steps).getByRole('button', { name: 'Install plugin runtime' }))
    await waitFor(() => expect(within(screen.getByRole('list', { name: 'Setup steps' })).queryByText('Plugin runtime')).not.toBeInTheDocument())
  })

  describe('Settings', () => {
    it('shows the installed runtime and removes it after a confirmation', async () => {
      const removeRuntime = vi.spyOn(samplePluginsBackend, 'removePluginRuntime')
      renderAt(routePaths.settings)
      const section = await screen.findByRole('region', { name: 'Plugin runtime' })
      await within(section).findByText(/Node\.js v22\.23\.5, downloaded from nodejs\.org/)

      fireEvent.click(within(section).getByRole('button', { name: 'Remove' }))
      expect(removeRuntime).not.toHaveBeenCalled()
      fireEvent.click(within(section).getByRole('button', { name: 'Remove plugin runtime' }))
      await waitFor(() => expect(within(section).getByRole('button', { name: 'Install' })).toBeInTheDocument())
      expect(removeRuntime).toHaveBeenCalledTimes(1)

      fireEvent.click(within(section).getByRole('button', { name: 'Install' }))
      await waitFor(() => expect(within(section).getByRole('button', { name: 'Remove' })).toBeInTheDocument())
    })

    it('describes where the runtime came from', () => {
      const info = {
        status: 'installed' as const,
        version: 'v22.23.5',
        pinnedVersion: '22.23.5',
        path: '/data/runtime/node-22.23.5/node',
        source: 'downloaded' as const,
        removable: true,
        downloadable: true,
        browserStatus: 'installed' as const,
        browsersPath: '/cache',
      }
      expect(describePluginRuntimeDetails(info)).toBe('Node.js v22.23.5, downloaded from nodejs.org · /data/runtime/node-22.23.5/node')
      expect(describePluginRuntimeDetails({ ...info, status: 'not_installed', version: null, path: null, source: 'missing' })).toBe(
        'Node.js v22.23.5, which plugins run on · about 30 MB download when a plugin needs it',
      )
    })
  })

  describe('notice after updating from a version that bundled Node.js', () => {
    it('asks once, downloads only on "Download now"', async () => {
      setSamplePluginRuntimeStatus('not_installed')
      const installRuntime = vi.spyOn(samplePluginsBackend, 'installPluginRuntime')
      renderAt(routePaths.home)
      const notice = await screen.findByRole('region', { name: 'Plugin runtime needed' })
      expect(notice).toHaveTextContent('Google Maps Scraper and Website Check need the plugin runtime (Node.js v22.23.5, about 30 MB download from nodejs.org)')
      expect(installRuntime).not.toHaveBeenCalled()

      fireEvent.click(within(notice).getByRole('button', { name: 'Download now' }))
      await waitFor(() => expect(screen.queryByRole('region', { name: 'Plugin runtime needed' })).not.toBeInTheDocument())
      expect(installRuntime).toHaveBeenCalledTimes(1)
    })

    it('remembers "Later" for this runtime version', async () => {
      setSamplePluginRuntimeStatus('not_installed')
      const { unmount } = renderAt(routePaths.home)
      const notice = await screen.findByRole('region', { name: 'Plugin runtime needed' })
      fireEvent.click(within(notice).getByRole('button', { name: 'Later' }))
      expect(screen.queryByRole('region', { name: 'Plugin runtime needed' })).not.toBeInTheDocument()
      unmount()

      renderAt(routePaths.home)
      await screen.findByRole('heading', { name: 'Home' })
      await new Promise((resolve) => setTimeout(resolve, 20))
      expect(screen.queryByRole('region', { name: 'Plugin runtime needed' })).not.toBeInTheDocument()
    })

    it('stays away when nothing needs it', async () => {
      vi.spyOn(samplePluginsBackend, 'listInstalledPlugins').mockResolvedValue([])
      setSamplePluginRuntimeStatus('not_installed')
      renderAt(routePaths.home)
      await screen.findByRole('heading', { name: 'Home' })
      await new Promise((resolve) => setTimeout(resolve, 20))
      expect(screen.queryByRole('region', { name: 'Plugin runtime needed' })).not.toBeInTheDocument()
    })
  })

  describe('builder requirement card text', () => {
    const readyRequirement: PluginRequirement = {
      name: 'whatsapp-web',
      displayName: 'WhatsApp Web',
      description: '',
      usedBySteps: [],
      permissions: { network: true, secrets: false, env: [] },
      needsBrowser: false,
      warning: null,
      installed: true,
      trusted: true,
      trustNotNeeded: true,
      missingConfig: [],
      browserReady: true,
      needsNodeRuntime: true,
      nodeRuntimeReady: true,
      needsSession: true,
      sessionLinked: false,
      ready: false,
    }

    it('asks for the runtime before linking the account', () => {
      const missingRuntime = { ...readyRequirement, nodeRuntimeReady: false }
      expect(needsPluginRuntimeDownload(missingRuntime)).toBe(true)
      expect(describeRequirementState(missingRuntime)).toBe('Needs the plugin runtime')
      expect(needsOnlySessionLink(missingRuntime)).toBe(false)
      expect(needsOnlySessionLink(readyRequirement)).toBe(true)
      expect(needsPluginRuntimeDownload({ ...missingRuntime, needsNodeRuntime: false })).toBe(false)
    })
  })
})
