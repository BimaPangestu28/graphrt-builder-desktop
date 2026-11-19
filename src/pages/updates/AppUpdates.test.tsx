import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { getAppSettings, updateAppSettings } from '@/api/appSettings'
import { resetSampleAppSettings } from '@/api/sampleBackend/appSettings'
import * as updatesApi from '@/api/updates'
import type { AvailableUpdate, DownloadProgress } from '@/api/updates'
import { SettingsPage } from '@/pages/SettingsPage'
import { routePaths } from '@/routes'
import { AppUpdateProvider } from './AppUpdateProvider'
import { calculateDownloadPercent, describeRunningRuns } from './updateContext'

vi.mock('@/api/updates', () => ({
  isUpdaterAvailable: vi.fn(),
  getCurrentVersion: vi.fn(),
  checkForUpdate: vi.fn(),
  downloadUpdate: vi.fn(),
  installUpdateAndRelaunch: vi.fn(),
  countRunningRuns: vi.fn(),
}))

const mockedUpdates = vi.mocked(updatesApi)

const newerVersion: AvailableUpdate = {
  version: '0.2.0',
  currentVersion: '0.1.0',
  releaseNotes: '### Added\n- Auto-update',
  publishedAt: '2026-11-19T00:00:00Z',
}

function renderApp(initialPath: string) {
  return render(
    <MemoryRouter initialEntries={[initialPath]}>
      <AppUpdateProvider idlePollIntervalMs={20}>
        <Routes>
          <Route path={routePaths.home} element={<p>Home screen</p>} />
          <Route path={routePaths.settings} element={<SettingsPage />} />
        </Routes>
      </AppUpdateProvider>
    </MemoryRouter>,
  )
}

async function openUpdatesSettings() {
  renderApp(routePaths.settings)
  fireEvent.click(screen.getByRole('button', { name: 'Updates' }))
  return screen.findByRole('region', { name: 'Updates' })
}

/** A download that reports half its bytes, then waits until the test finishes it. */
function holdDownloadAtHalf(): () => void {
  let finishDownload: () => void = () => {}
  mockedUpdates.downloadUpdate.mockImplementation((onProgress: (progress: DownloadProgress) => void) => {
    onProgress({ downloadedBytes: 50, totalBytes: 100 })
    return new Promise<void>((resolve) => {
      finishDownload = resolve
    })
  })
  return () => finishDownload()
}

beforeEach(() => {
  resetSampleAppSettings()
  vi.clearAllMocks()
  mockedUpdates.isUpdaterAvailable.mockReturnValue(true)
  mockedUpdates.getCurrentVersion.mockResolvedValue('0.1.0')
  mockedUpdates.checkForUpdate.mockResolvedValue(null)
  mockedUpdates.downloadUpdate.mockResolvedValue(undefined)
  mockedUpdates.installUpdateAndRelaunch.mockResolvedValue(undefined)
  mockedUpdates.countRunningRuns.mockResolvedValue(0)
})

describe('Settings > Updates', () => {
  it('shows the version and "Up to date", and checks again on request', async () => {
    const updatesRegion = await openUpdatesSettings()
    expect(await within(updatesRegion).findByText('Version 0.1.0')).toBeInTheDocument()
    expect(await within(updatesRegion).findByText('Up to date')).toBeInTheDocument()
    fireEvent.click(within(updatesRegion).getByRole('button', { name: 'Check for updates' }))
    await waitFor(() => expect(mockedUpdates.checkForUpdate).toHaveBeenCalledTimes(2))
  })

  it('announces a new version with its release notes when automatic download is off', async () => {
    await updateAppSettings({ ...(await getAppSettings()), autoDownloadUpdates: false })
    mockedUpdates.checkForUpdate.mockResolvedValue(newerVersion)
    const updatesRegion = await openUpdatesSettings()
    expect(await within(updatesRegion).findByText('Version 0.2.0 is available')).toBeInTheDocument()
    expect(within(updatesRegion).getByText("What's new in 0.2.0")).toBeInTheDocument()
    expect(within(updatesRegion).getByText(/Auto-update/)).toBeInTheDocument()
    expect(mockedUpdates.downloadUpdate).not.toHaveBeenCalled()
    fireEvent.click(within(updatesRegion).getByRole('button', { name: 'Download version 0.2.0' }))
    expect(await within(updatesRegion).findByRole('button', { name: 'Restart to update' })).toBeInTheDocument()
  })

  it('shows download progress, then "Restart to update" once downloaded', async () => {
    mockedUpdates.checkForUpdate.mockResolvedValue(newerVersion)
    const finishDownload = holdDownloadAtHalf()
    const updatesRegion = await openUpdatesSettings()
    expect(await within(updatesRegion).findByText('Downloading version 0.2.0… 50%')).toBeInTheDocument()
    expect(within(updatesRegion).getByRole('button', { name: 'Check for updates' })).toBeDisabled()
    finishDownload()
    expect(await within(updatesRegion).findByText(/Version 0\.2\.0 is ready/)).toBeInTheDocument()
    fireEvent.click(within(updatesRegion).getByRole('button', { name: 'Restart to update' }))
    await waitFor(() => expect(mockedUpdates.installUpdateAndRelaunch).toHaveBeenCalledTimes(1))
  })

  it('says why a check failed', async () => {
    mockedUpdates.checkForUpdate.mockRejectedValue(new Error('offline'))
    const updatesRegion = await openUpdatesSettings()
    expect(await within(updatesRegion).findByRole('alert')).toHaveTextContent('Could not check for updates: offline')
  })

  it('saves "Automatically download updates" with the other settings', async () => {
    const updatesRegion = await openUpdatesSettings()
    const autoDownloadToggle = await within(updatesRegion).findByRole('checkbox', { name: /Automatically download updates/ })
    expect(autoDownloadToggle).toBeChecked()
    fireEvent.click(autoDownloadToggle)
    await waitFor(async () => expect((await getAppSettings()).autoDownloadUpdates).toBe(false))
  })

  it('points to the desktop app in the browser preview', async () => {
    mockedUpdates.isUpdaterAvailable.mockReturnValue(false)
    const updatesRegion = await openUpdatesSettings()
    expect(within(updatesRegion).getByText('Updates are available in the desktop app')).toBeInTheDocument()
    expect(within(updatesRegion).queryByRole('button', { name: 'Check for updates' })).not.toBeInTheDocument()
    expect(mockedUpdates.checkForUpdate).not.toHaveBeenCalled()
  })
})

describe('Update ready banner', () => {
  beforeEach(() => {
    mockedUpdates.checkForUpdate.mockResolvedValue(newerVersion)
  })

  it('appears once the update is downloaded and restarts when no agent runs', async () => {
    renderApp(routePaths.home)
    const banner = await screen.findByRole('region', { name: 'Update ready' })
    expect(banner).toHaveTextContent('graphrt 0.2.0 is ready')
    fireEvent.click(within(banner).getByRole('button', { name: 'Restart to update' }))
    await waitFor(() => expect(mockedUpdates.installUpdateAndRelaunch).toHaveBeenCalledTimes(1))
  })

  it('hides on "Later"', async () => {
    renderApp(routePaths.home)
    const banner = await screen.findByRole('region', { name: 'Update ready' })
    fireEvent.click(within(banner).getByRole('button', { name: 'Later' }))
    expect(screen.queryByRole('region', { name: 'Update ready' })).not.toBeInTheDocument()
  })

  it('warns while agents run and restarts by itself once they finish', async () => {
    mockedUpdates.countRunningRuns.mockResolvedValue(2)
    renderApp(routePaths.home)
    const banner = await screen.findByRole('region', { name: 'Update ready' })
    fireEvent.click(within(banner).getByRole('button', { name: 'Restart to update' }))
    expect(await within(banner).findByRole('alert')).toHaveTextContent('2 agent runs are in progress. Restarting now stops them.')
    fireEvent.click(within(banner).getByRole('button', { name: 'Restart when idle' }))
    expect(await within(banner).findByText('graphrt restarts when no agent is running')).toBeInTheDocument()
    await new Promise((resolve) => setTimeout(resolve, 60))
    expect(mockedUpdates.installUpdateAndRelaunch).not.toHaveBeenCalled()
    mockedUpdates.countRunningRuns.mockResolvedValue(0)
    await waitFor(() => expect(mockedUpdates.installUpdateAndRelaunch).toHaveBeenCalledTimes(1))
  })

  it('can restart now even while agents run', async () => {
    mockedUpdates.countRunningRuns.mockResolvedValue(1)
    renderApp(routePaths.home)
    const banner = await screen.findByRole('region', { name: 'Update ready' })
    fireEvent.click(within(banner).getByRole('button', { name: 'Restart to update' }))
    expect(await within(banner).findByRole('alert')).toHaveTextContent('1 agent run is in progress. Restarting now stops it.')
    fireEvent.click(within(banner).getByRole('button', { name: 'Restart now' }))
    await waitFor(() => expect(mockedUpdates.installUpdateAndRelaunch).toHaveBeenCalledTimes(1))
  })

  it('shows an install failure and offers the restart again', async () => {
    mockedUpdates.installUpdateAndRelaunch.mockRejectedValue(new Error('disk full'))
    renderApp(routePaths.home)
    const banner = await screen.findByRole('region', { name: 'Update ready' })
    fireEvent.click(within(banner).getByRole('button', { name: 'Restart to update' }))
    expect(await within(banner).findByRole('alert')).toHaveTextContent('Could not install the update: disk full')
    expect(within(banner).getByRole('button', { name: 'Restart to update' })).toBeInTheDocument()
  })

  it('stays hidden on Settings, which has its own Updates section', async () => {
    renderApp(routePaths.settings)
    await waitFor(() => expect(mockedUpdates.downloadUpdate).toHaveBeenCalled())
    expect(screen.queryByRole('region', { name: 'Update ready' })).not.toBeInTheDocument()
  })
})

describe('update helpers', () => {
  it('computes whole download percents and unknown sizes', () => {
    expect(calculateDownloadPercent(50, 200)).toBe(25)
    expect(calculateDownloadPercent(10, null)).toBeNull()
    expect(calculateDownloadPercent(300, 200)).toBe(100)
  })

  it('describes running runs', () => {
    expect(describeRunningRuns(1)).toBe('1 agent run is in progress')
    expect(describeRunningRuns(3)).toBe('3 agent runs are in progress')
    expect(describeRunningRuns(null)).toBe('Agent runs may be in progress')
  })
})
