import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import type { PluginCatalogEntry } from '@/api/pluginTypes'
import { listInstalledPlugins } from '@/api/plugins'
import { emitSamplePluginEvent, resetSamplePlugins, setSampleAutoUpdates, setSampleInstalledPlugin } from '@/api/sampleBackend/plugins'
import { AppUpdateContext, type AppUpdateControls, type UpdateStatus } from '@/pages/updates/updateContext'
import { UpdatesNotice } from './UpdatesNotice'
import { buildUpdatesNoticeLines, hasUndismissedLine, recentAutoUpdateWindowMs, updatesNoticeDismissedKey } from './updatesNoticeLines'

const now = new Date('2026-11-20T12:00:00Z')

function createUpdateControls(status: UpdateStatus): AppUpdateControls {
  return {
    status,
    restartState: { kind: 'none' },
    currentVersion: '0.1.0',
    checkNow: vi.fn(async () => undefined),
    downloadNow: vi.fn(async () => undefined),
    requestRestart: vi.fn(async () => undefined),
    restartNow: vi.fn(async () => undefined),
    restartWhenIdle: vi.fn(),
    cancelRestart: vi.fn(),
  }
}

function renderNotice(updateControls: AppUpdateControls | null = null) {
  return render(
    <MemoryRouter>
      <AppUpdateContext.Provider value={updateControls}>
        <UpdatesNotice />
      </AppUpdateContext.Provider>
    </MemoryRouter>,
  )
}

function catalogEntry(name: string, overrides: Partial<PluginCatalogEntry> = {}): PluginCatalogEntry {
  return {
    name,
    version: '1.1.0',
    description: '',
    permissions: { network: false, secrets: false, env: [] },
    needsBrowser: false,
    nodes: [],
    tools: [],
    readmeUrl: null,
    iconUrl: null,
    warning: null,
    status: null,
    tosRisk: null,
    sizeBytes: 1,
    installedVersion: '1.0.0',
    updateAvailable: true,
    updateNeedsApproval: false,
    ...overrides,
  }
}

const lineInputs = { appStatus: null, pendingUpdates: [], autoUpdates: [], now, updatesListPath: '/plugins?tab=updates', pluginPath: (name: string) => `/plugins/${name}` }

describe('buildUpdatesNoticeLines', () => {
  it('says nothing when there is no news', () => {
    expect(buildUpdatesNoticeLines(lineInputs)).toEqual([])
    expect(buildUpdatesNoticeLines({ ...lineInputs, appStatus: { kind: 'upToDate' } })).toEqual([])
  })

  it('puts the app update first, then ready plugin updates, approvals and automatic updates', () => {
    const lines = buildUpdatesNoticeLines({
      ...lineInputs,
      appStatus: { kind: 'ready', update: { version: '0.2.0', currentVersion: '0.1.0', releaseNotes: null, publishedAt: null } },
      pendingUpdates: [catalogEntry('a'), catalogEntry('b'), catalogEntry('c', { updateNeedsApproval: true })],
      autoUpdates: [{ name: 'maps', fromVersion: '0.2.0', toVersion: '0.2.1', updatedAt: '2026-11-20T08:00:00Z' }],
    })
    expect(lines.map((line) => line.text)).toEqual([
      'graphrt 0.2.0 is ready',
      '2 plugin updates available',
      'c 1.1.0 asks for new permissions and needs your approval',
      'Updated automatically: maps 0.2.0 → 0.2.1',
    ])
    expect(lines[2]).toMatchObject({ needsApproval: true, action: { kind: 'review', path: '/plugins/c' } })
    expect(lines[1].action).toEqual({ kind: 'updateAll', reviewPath: '/plugins?tab=updates' })
  })

  it('shows downloads with their percent and drops automatic updates after 24 hours', () => {
    const lines = buildUpdatesNoticeLines({
      ...lineInputs,
      appStatus: { kind: 'downloading', update: { version: '0.2.0', currentVersion: '0.1.0', releaseNotes: null, publishedAt: null }, percent: 40 },
      autoUpdates: [{ name: 'maps', fromVersion: '0.2.0', toVersion: '0.2.1', updatedAt: new Date(now.getTime() - recentAutoUpdateWindowMs - 1).toISOString() }],
    })
    expect(lines.map((line) => line.text)).toEqual(['Downloading graphrt 0.2.0… 40%'])
  })

  it('counts a line as new once its versions change', () => {
    const before = buildUpdatesNoticeLines({ ...lineInputs, pendingUpdates: [catalogEntry('a')] })
    const after = buildUpdatesNoticeLines({ ...lineInputs, pendingUpdates: [catalogEntry('a', { version: '1.2.0' })] })
    const dismissed = new Set(before.map((line) => line.key))
    expect(hasUndismissedLine(before, dismissed)).toBe(false)
    expect(hasUndismissedLine(after, dismissed)).toBe(true)
  })
})

describe('UpdatesNotice', () => {
  beforeEach(() => {
    resetSamplePlugins()
    window.localStorage.removeItem(updatesNoticeDismissedKey)
  })
  afterEach(() => vi.restoreAllMocks())

  it('offers to restart into a downloaded app update', async () => {
    const updateControls = createUpdateControls({ kind: 'ready', update: { version: '0.2.0', currentVersion: '0.1.0', releaseNotes: null, publishedAt: null } })
    renderNotice(updateControls)
    const notice = await screen.findByRole('region', { name: 'Updates' })
    expect(within(notice).getByText('graphrt 0.2.0 is ready')).toBeInTheDocument()
    fireEvent.click(within(notice).getByRole('button', { name: 'Restart to update' }))
    expect(updateControls.requestRestart).toHaveBeenCalled()
  })

  it('lists plugin updates and installs them with Update all', async () => {
    renderNotice()
    const notice = await screen.findByRole('region', { name: 'Updates' })
    expect(within(notice).getByText('google-maps-scraper 1.1.0 is available')).toBeInTheDocument()
    expect(within(notice).getByRole('link', { name: 'Review plugin updates' })).toHaveAttribute('href', '/plugins?tab=updates')
    fireEvent.click(within(notice).getByRole('button', { name: 'Update all' }))
    expect(await within(notice).findByText('Updated google-maps-scraper')).toBeInTheDocument()
    const installed = await listInstalledPlugins()
    expect(installed.find((plugin) => plugin.name === 'google-maps-scraper')?.version).toBe('1.1.0')
    expect(within(notice).queryByText('google-maps-scraper 1.1.0 is available')).not.toBeInTheDocument()
  })

  it('leaves updates asking for new permissions to the user', async () => {
    setSampleInstalledPlugin('google-maps-scraper', '1.0.0', { network: true, secrets: false, env: [] })
    renderNotice()
    const notice = await screen.findByRole('region', { name: 'Updates' })
    expect(within(notice).getByText('google-maps-scraper 1.1.0 asks for new permissions and needs your approval')).toBeInTheDocument()
    expect(within(notice).getByRole('link', { name: 'Review updates needing approval' })).toHaveAttribute('href', '/plugins/google-maps-scraper')
    expect(within(notice).queryByRole('button', { name: 'Update all' })).not.toBeInTheDocument()
  })

  it('says which plugins were updated automatically', async () => {
    setSampleInstalledPlugin('google-maps-scraper', '1.1.0')
    setSampleAutoUpdates([{ name: 'google-maps-scraper', fromVersion: '1.0.0', toVersion: '1.1.0', updatedAt: new Date().toISOString() }])
    renderNotice()
    expect(await screen.findByText('Updated automatically: google-maps-scraper 1.0.0 → 1.1.0')).toBeInTheDocument()
  })

  it('stays dismissed until something new appears', async () => {
    const { unmount } = renderNotice()
    const notice = await screen.findByRole('region', { name: 'Updates' })
    fireEvent.click(within(notice).getByRole('button', { name: 'Dismiss updates' }))
    expect(screen.queryByRole('region', { name: 'Updates' })).not.toBeInTheDocument()
    unmount()

    renderNotice()
    await waitFor(() => expect(screen.queryByText('Loading')).not.toBeInTheDocument())
    expect(screen.queryByRole('region', { name: 'Updates' })).not.toBeInTheDocument()

    setSampleAutoUpdates([{ name: 'website-check', fromVersion: '0.3.0', toVersion: '0.4.0', updatedAt: new Date().toISOString() }])
    emitSamplePluginEvent({ type: 'plugins_changed' })
    expect(await screen.findByText('Updated automatically: website-check 0.3.0 → 0.4.0')).toBeInTheDocument()
  })

  it('renders nothing when there is no news', async () => {
    setSampleInstalledPlugin('google-maps-scraper', '1.1.0')
    const { container } = renderNotice(createUpdateControls({ kind: 'upToDate' }))
    await waitFor(() => expect(container).toBeEmptyDOMElement())
  })
})
