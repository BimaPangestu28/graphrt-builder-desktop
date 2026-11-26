import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import type { AppSettings } from '@/api/appSettingsTypes'
import { SettingsPage } from '@/pages/SettingsPage'

/**
 * The Settings screen inside the desktop app: every visible control is stored by the
 * backend, and the design's controls without a backend are hidden.
 */

const backendCalls: Array<{ command: string; commandArguments?: Record<string, unknown> }> = []
let storedSettings: AppSettings

function createStoredSettings(): AppSettings {
  return {
    openAtLogin: false,
    showInMenuBar: true,
    notifyOnApproval: true,
    notifyOnFailure: true,
    keepAwakeWhileRunning: true,
    keepAwakeOnlyOnPower: true,
    missedRunDefaultPolicy: 'run_once',
    notifyOnChatHandoff: false,
    notifyDailySummary: false,
    runHistoryRetentionDays: 30,
    autoDownloadUpdates: true,
    autoUpdatePlugins: true,
    runLimits: { stepTimeoutSeconds: 120, runDurationMinutes: 30, maxStepAttempts: 10_000, maxNestingDepth: 8, maxParallelSteps: 64 },
    developerMode: false,
    language: null,
  }
}

function answerBackend(command: string, commandArguments?: Record<string, unknown>): unknown {
  backendCalls.push({ command, commandArguments })
  switch (command) {
    case 'get_app_settings':
      return { ...storedSettings }
    case 'update_app_settings':
      storedSettings = { ...(commandArguments?.settings as AppSettings) }
      return { ...storedSettings }
    case 'get_data_folder_path':
      return '/Users/[USER]/Library/Application Support/dev.graphrt.desktop'
    case 'list_provider_statuses':
      return [
        { provider: 'openai', configured: true, baseUrl: null },
        { provider: 'ollama', configured: true, baseUrl: 'http://localhost:11434' },
      ]
    case 'get_default_model':
      return { provider: 'openai', name: 'gpt-4o-mini' }
    case 'list_crash_reports':
      return []
    case 'get_crash_report_sharing':
      return false
    case 'set_crash_report_sharing':
      return commandArguments?.offersSharing
    default:
      return null
  }
}

vi.mock('@/api/client', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/api/client')>()
  return {
    ...original,
    isDesktopApp: () => true,
    callBackend: async (command: string, commandArguments?: Record<string, unknown>) => answerBackend(command, commandArguments),
  }
})

vi.mock('@tauri-apps/api/app', () => ({ getVersion: async () => '0.1.0' }))

function renderSettingsPage() {
  return render(
    <MemoryRouter>
      <SettingsPage />
    </MemoryRouter>,
  )
}

describe('SettingsPage in the desktop app', () => {
  beforeEach(() => {
    storedSettings = createStoredSettings()
    backendCalls.length = 0
  })

  it('hides the controls that have no backend', async () => {
    renderSettingsPage()
    await screen.findByRole('checkbox', { name: /Start graphrt when I log in/ })
    expect(screen.queryByRole('button', { name: 'General' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Remote runner' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Connect a server' })).not.toBeInTheDocument()
    expect(screen.queryByRole('combobox', { name: /If the main model fails/ })).not.toBeInTheDocument()
  })

  it('shows the crash reports with the sharing opt-in stored by the backend', async () => {
    renderSettingsPage()
    expect(await screen.findByText(/graphrt sends no telemetry/)).toBeInTheDocument()
    const sharingToggle = await screen.findByRole('checkbox', { name: /Help improve graphrt: offer to share crash reports/ })
    expect(sharingToggle).not.toBeChecked()
    fireEvent.click(sharingToggle)
    await waitFor(() =>
      expect(backendCalls).toContainEqual({ command: 'set_crash_report_sharing', commandArguments: { offersSharing: true } }),
    )
    expect(await screen.findByText('No crash reports on this computer')).toBeInTheDocument()
  })

  it('shows the real data folder and version without claiming to be up to date', async () => {
    renderSettingsPage()
    expect(await screen.findByText('/Users/[USER]/Library/Application Support/dev.graphrt.desktop')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Show in Finder' }))
    await waitFor(() => expect(backendCalls.some((call) => call.command === 'reveal_data_folder')).toBe(true))
    fireEvent.click(screen.getByRole('button', { name: 'About' }))
    expect(await screen.findByText('Version 0.1.0')).toBeInTheDocument()
  })

  it('stores the retention and notification settings through update_app_settings', async () => {
    renderSettingsPage()
    fireEvent.change(await screen.findByRole('combobox', { name: /Keep run history for/ }), { target: { value: '90 days' } })
    await waitFor(() => expect(storedSettings.runHistoryRetentionDays).toBe(90))
    fireEvent.click(screen.getByRole('button', { name: 'Notifications' }))
    fireEvent.click(screen.getByRole('checkbox', { name: /Daily summary at 18:00/ }))
    await waitFor(() => expect(storedSettings.notifyDailySummary).toBe(true))
  })

  it('offers only models the app can use as the default', async () => {
    renderSettingsPage()
    const modelSelect = await screen.findByRole('combobox', { name: /Default AI model for new agents/ })
    expect(Array.from((modelSelect as HTMLSelectElement).options, (option) => option.value)).toEqual(['OpenAI gpt-4o-mini'])
  })
})
