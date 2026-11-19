import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { BackendError } from '@/api/client'
import { sampleAppInfoBackend } from '@/api/sampleBackend/appInfo'
import { resetSampleAppSettings, sampleAppSettingsBackend } from '@/api/sampleBackend/appSettings'
import { resetSampleCredentials, sampleCredentialsBackend } from '@/api/sampleBackend/credentials'
import { SettingsPage } from '@/pages/SettingsPage'

function renderSettingsPage() {
  return render(
    <MemoryRouter>
      <SettingsPage />
    </MemoryRouter>,
  )
}

describe('SettingsPage', () => {
  beforeEach(() => {
    resetSampleAppSettings()
    resetSampleCredentials()
  })
  afterEach(() => vi.restoreAllMocks())

  it('shows loading, then the Runner section with the saved preferences', async () => {
    renderSettingsPage()
    expect(screen.getByRole('heading', { level: 1, name: 'Settings' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Runner' })).toHaveAttribute('aria-current', 'page')
    expect(screen.getByRole('status')).toHaveTextContent('Loading settings')
    expect(await screen.findByRole('checkbox', { name: /Start graphrt when I log in/ })).toBeChecked()
    expect(screen.getByRole('heading', { name: 'Privacy and data' })).toBeInTheDocument()
    expect(screen.getByRole('combobox', { name: /If a scheduled run was missed/ })).toHaveValue('Run it once when the computer wakes')
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
    fireEvent.click(await screen.findByRole('checkbox', { name: /Keep the computer awake/ }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not save the change: disk is full')
    expect(screen.getByRole('checkbox', { name: /Keep the computer awake/ })).toBeChecked()
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

  it('saves the chat hand-off and daily summary notifications', async () => {
    renderSettingsPage()
    await screen.findByRole('checkbox', { name: /Start graphrt when I log in/ })
    fireEvent.click(screen.getByRole('button', { name: 'Notifications' }))
    fireEvent.click(screen.getByRole('checkbox', { name: /A chatbot conversation needs me/ }))
    fireEvent.click(screen.getByRole('checkbox', { name: /Daily summary at 18:00/ }))
    await waitFor(async () => {
      const savedSettings = await sampleAppSettingsBackend.getAppSettings()
      expect(savedSettings.notifyOnChatHandoff).toBe(true)
      expect(savedSettings.notifyDailySummary).toBe(true)
    })
  })

  it('saves how long run history is kept, including forever', async () => {
    renderSettingsPage()
    const retentionSelect = await screen.findByRole('combobox', { name: /Keep run history for/ })
    expect(retentionSelect).toHaveValue('30 days')
    fireEvent.change(retentionSelect, { target: { value: 'Forever' } })
    await waitFor(async () => expect((await sampleAppSettingsBackend.getAppSettings()).runHistoryRetentionDays).toBeNull())
    fireEvent.change(screen.getByRole('combobox', { name: /Keep run history for/ }), { target: { value: '90 days' } })
    await waitFor(async () => expect((await sampleAppSettingsBackend.getAppSettings()).runHistoryRetentionDays).toBe(90))
  })

  it('changes the default model among the providers that have a key', async () => {
    const setDefaultSpy = vi.spyOn(sampleCredentialsBackend, 'setDefaultModel')
    await sampleCredentialsBackend.setApiKey('anthropic', 'sk-ant')
    renderSettingsPage()
    const modelSelect = await screen.findByRole('combobox', { name: /Default AI model for new agents/ })
    expect(modelSelect).toHaveValue('OpenAI gpt-4o-mini')
    // Every model each connected provider reports, the default's provider first.
    await waitFor(() => expect(Array.from((modelSelect as HTMLSelectElement).options, (option) => option.value)).toContain('Anthropic claude-opus-5-5'))
    const optionValues = Array.from((modelSelect as HTMLSelectElement).options, (option) => option.value)
    expect(optionValues.slice(0, 2)).toEqual(['OpenAI gpt-4.1', 'OpenAI gpt-4.1-mini'])
    expect(optionValues).toContain('OpenAI gpt-4o-mini')
    fireEvent.change(modelSelect, { target: { value: 'Anthropic claude-opus-5-5' } })
    await waitFor(() => expect(setDefaultSpy).toHaveBeenCalledWith({ provider: 'anthropic', name: 'claude-opus-5-5' }))
    await waitFor(() => expect(screen.getByRole('combobox', { name: /Default AI model for new agents/ })).toHaveValue('Anthropic claude-opus-5-5'))
  })

  it('opens the data folder and explains when it cannot', async () => {
    const revealSpy = vi.spyOn(sampleAppInfoBackend, 'revealDataFolder')
    renderSettingsPage()
    expect(await screen.findByText('~/Library/Application Support/graphrt')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Show in Finder' }))
    expect(await screen.findByText('Opened the data folder in Finder')).toBeInTheDocument()
    expect(revealSpy).toHaveBeenCalled()

    revealSpy.mockRejectedValueOnce(new BackendError('not_found', 'the folder does not exist'))
    fireEvent.click(screen.getByRole('button', { name: 'Show in Finder' }))
    expect(await screen.findByText(/Could not open the data folder: the folder does not exist/)).toBeInTheDocument()
  })

  it('names the system tray and File Explorer on Windows', async () => {
    const userAgentSpy = vi.spyOn(window.navigator, 'userAgent', 'get').mockReturnValue('Mozilla/5.0 (Windows NT 10.0; Win64; x64)')
    renderSettingsPage()
    expect(await screen.findByRole('checkbox', { name: /Show in the system tray/ })).toBeChecked()
    fireEvent.click(screen.getByRole('button', { name: 'Show in File Explorer' }))
    expect(await screen.findByText('Opened the data folder in File Explorer')).toBeInTheDocument()
    userAgentSpy.mockRestore()
  })

  it('shows the app version in About', async () => {
    renderSettingsPage()
    fireEvent.click(screen.getByRole('button', { name: 'About' }))
    expect(await screen.findByText('Version 0.9.0 · up to date')).toBeInTheDocument()
  })

  it('opens the remote runner section from the promo card', async () => {
    renderSettingsPage()
    fireEvent.click(await screen.findByRole('button', { name: 'Connect a server' }))
    expect(screen.getByRole('heading', { name: 'Remote runner' })).toBeInTheDocument()
  })
})
