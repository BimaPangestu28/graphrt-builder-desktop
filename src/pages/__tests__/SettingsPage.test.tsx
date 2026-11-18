import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { BackendError } from '@/api/client'
import { resetSampleAppSettings, sampleAppSettingsBackend } from '@/api/sampleBackend/appSettings'
import { SettingsPage } from '@/pages/SettingsPage'

function renderSettingsPage() {
  return render(
    <MemoryRouter>
      <SettingsPage />
    </MemoryRouter>,
  )
}

describe('SettingsPage', () => {
  beforeEach(() => resetSampleAppSettings())
  afterEach(() => vi.restoreAllMocks())

  it('shows loading, then the Runner section with the saved preferences', async () => {
    renderSettingsPage()
    expect(screen.getByRole('heading', { level: 1, name: 'Settings' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Runner' })).toHaveAttribute('aria-current', 'page')
    expect(screen.getByRole('status')).toHaveTextContent('Loading settings')
    expect(await screen.findByRole('checkbox', { name: /Start graphrt when I log in/ })).toBeChecked()
    expect(screen.getByRole('heading', { name: 'Privacy and data' })).toBeInTheDocument()
    expect(screen.getByRole('combobox', { name: /If a scheduled run was missed/ })).toHaveValue('Run it once when the Mac wakes')
  })

  it('shows an error with a retry when the preferences cannot load', async () => {
    vi.spyOn(sampleAppSettingsBackend, 'getAppSettings').mockRejectedValueOnce(new BackendError('database', 'disk is full'))
    renderSettingsPage()
    expect(await screen.findByRole('alert')).toHaveTextContent('disk is full')
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(await screen.findByRole('checkbox', { name: /Show in the menu bar/ })).toBeChecked()
  })

  it('saves a toggle to the backend', async () => {
    const updateSpy = vi.spyOn(sampleAppSettingsBackend, 'updateAppSettings')
    renderSettingsPage()
    fireEvent.click(await screen.findByRole('checkbox', { name: /Show in the menu bar/ }))
    expect(screen.getByRole('checkbox', { name: /Show in the menu bar/ })).not.toBeChecked()
    await waitFor(() => expect(updateSpy).toHaveBeenCalledWith(expect.objectContaining({ showInMenuBar: false, openAtLogin: true })))
    expect((await sampleAppSettingsBackend.getAppSettings()).showInMenuBar).toBe(false)
  })

  it('saves the missed-run policy and the notification toggles', async () => {
    renderSettingsPage()
    fireEvent.change(await screen.findByRole('combobox', { name: /If a scheduled run was missed/ }), { target: { value: 'Skip it' } })
    await waitFor(async () => expect((await sampleAppSettingsBackend.getAppSettings()).missedRunDefaultPolicy).toBe('skip'))

    fireEvent.click(screen.getByRole('button', { name: 'Notifications' }))
    fireEvent.click(screen.getByRole('checkbox', { name: /A run fails/ }))
    await waitFor(async () => expect((await sampleAppSettingsBackend.getAppSettings()).notifyOnFailure).toBe(false))
    expect(screen.getByRole('checkbox', { name: /An agent needs my approval/ })).toBeChecked()
  })

  it('puts a toggle back and explains when saving fails', async () => {
    vi.spyOn(sampleAppSettingsBackend, 'updateAppSettings').mockRejectedValueOnce(new BackendError('database', 'disk is full'))
    renderSettingsPage()
    fireEvent.click(await screen.findByRole('checkbox', { name: /Keep the Mac awake/ }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not save the change: disk is full')
    expect(screen.getByRole('checkbox', { name: /Keep the Mac awake/ })).toBeChecked()
  })

  it('keeps local-only values after switching sections', async () => {
    renderSettingsPage()
    const crashReportsToggle = await screen.findByRole('checkbox', { name: /Share anonymous crash reports/ })
    fireEvent.click(crashReportsToggle)
    fireEvent.click(screen.getByRole('button', { name: 'Notifications' }))
    expect(screen.queryByRole('heading', { name: 'Runner' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Privacy and data' }))
    expect(screen.getByRole('checkbox', { name: /Share anonymous crash reports/ })).toBeChecked()
  })

  it('exports every agent to the Downloads folder', async () => {
    const exportSpy = vi.spyOn(sampleAppSettingsBackend, 'exportAgents')
    renderSettingsPage()
    fireEvent.click(await screen.findByRole('button', { name: 'Export all agents' }))
    expect(await screen.findByRole('status')).toHaveTextContent(/Exported 6 agents to ~\/Downloads\/graphrt-agents-.*\.json/)
    expect(exportSpy).toHaveBeenCalledWith(expect.stringMatching(/graphrt-agents-\d{4}-\d{2}-\d{2}\.json$/))
  })

  it('asks before deleting all data, then deletes with the keys', async () => {
    const deleteSpy = vi.spyOn(sampleAppSettingsBackend, 'deleteAllData')
    renderSettingsPage()
    fireEvent.click(await screen.findByRole('button', { name: 'Delete all data' }))
    expect(screen.getByRole('alert')).toHaveTextContent('This cannot be undone')
    expect(deleteSpy).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Delete all data' }))
    expect(screen.getByRole('checkbox', { name: /Also remove saved API keys/ })).toBeChecked()
    fireEvent.click(screen.getByRole('button', { name: 'Delete everything' }))
    expect(await screen.findByRole('status')).toHaveTextContent('Deleted 6 agents, their runs and schedules and the saved keys')
    expect(deleteSpy).toHaveBeenCalledWith(true)
  })

  it('can delete data but keep the keys', async () => {
    const deleteSpy = vi.spyOn(sampleAppSettingsBackend, 'deleteAllData')
    renderSettingsPage()
    fireEvent.click(await screen.findByRole('button', { name: 'Delete all data' }))
    fireEvent.click(screen.getByRole('checkbox', { name: /Also remove saved API keys/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Delete everything' }))
    expect(await screen.findByRole('status')).not.toHaveTextContent('keys')
    expect(deleteSpy).toHaveBeenCalledWith(false)
  })

  it('opens the remote runner section from the promo card', async () => {
    renderSettingsPage()
    fireEvent.click(await screen.findByRole('button', { name: 'Connect a server' }))
    expect(screen.getByRole('heading', { name: 'Remote runner' })).toBeInTheDocument()
  })
})
