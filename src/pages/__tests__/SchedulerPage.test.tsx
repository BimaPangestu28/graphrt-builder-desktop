import { fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { BackendError } from '@/api/client'
import { resetSampleAppSettings, sampleAppSettingsBackend } from '@/api/sampleBackend/appSettings'
import { resetSampleScheduleRules, sampleScheduleRulesBackend } from '@/api/sampleBackend/scheduleRules'
import { resetSampleTriggers, sampleTriggersBackend } from '@/api/sampleBackend/triggers'
import { SchedulerPage } from '../SchedulerPage'

function renderSchedulerPage() {
  return render(
    <MemoryRouter>
      <SchedulerPage />
    </MemoryRouter>,
  )
}

/** Waits until the backend triggers are on the calendar. */
async function findWeekView() {
  await screen.findByRole('checkbox', { name: 'Morning email digest trigger' })
  return screen.getByRole('region', { name: 'Week view' })
}

describe('SchedulerPage', () => {
  beforeEach(() => {
    resetSampleTriggers()
    resetSampleScheduleRules()
    resetSampleAppSettings()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('shows the current week with past and planned runs', async () => {
    renderSchedulerPage()
    expect(screen.getByRole('heading', { level: 1, name: 'Schedule' })).toBeInTheDocument()
    expect(screen.getByText('16 to 22 Nov · Asia/Jakarta')).toBeInTheDocument()
    const weekView = await findWeekView()
    expect(within(weekView).getByText('Today')).toBeInTheDocument()
    expect(within(weekView).getByText('Needs you')).toBeInTheDocument()
    expect(within(weekView).getByText('Failed')).toBeInTheDocument()
    expect(within(weekView).getAllByText('07:00').length).toBeGreaterThan(1)
  })

  it('lists triggers from the backend with their schedule described', async () => {
    renderSchedulerPage()
    await findWeekView()
    const triggers = screen.getByRole('region', { name: 'Triggers' })
    expect(within(triggers).getByText('Weekdays at 09:00')).toBeInTheDocument()
    expect(within(triggers).getByText('Every day at 07:00')).toBeInTheDocument()
    expect(within(triggers).getByText('Mondays at 10:00')).toBeInTheDocument()
    expect(within(triggers).getByText('Webhook · localhost:7420/hooks/form')).toBeInTheDocument()
  })

  it('moves to the next week with the arrow', () => {
    renderSchedulerPage()
    fireEvent.click(screen.getByRole('button', { name: 'Next week' }))
    expect(screen.getByText('23 to 29 Nov · Asia/Jakarta')).toBeInTheDocument()
  })

  it('turns a trigger off through the backend and pauses its planned runs', async () => {
    const setTriggerEnabledSpy = vi.spyOn(sampleTriggersBackend, 'setTriggerEnabled')
    renderSchedulerPage()
    const weekView = await findWeekView()
    const pausedCountBefore = within(weekView).getAllByText('Paused').length
    fireEvent.click(screen.getByRole('checkbox', { name: 'Morning email digest trigger' }))
    expect(setTriggerEnabledSpy).toHaveBeenCalledWith('morning-digest', false)
    expect(within(weekView).getAllByText('Paused').length).toBe(pausedCountBefore + 4)
    await vi.waitFor(() => expect(screen.getByRole('checkbox', { name: 'Morning email digest trigger' })).not.toBeChecked())
  })

  it('turns the switch back on and shows the error when the backend refuses', async () => {
    vi.spyOn(sampleTriggersBackend, 'setTriggerEnabled').mockRejectedValue(new BackendError('database', 'Could not save'))
    renderSchedulerPage()
    await findWeekView()
    fireEvent.click(screen.getByRole('checkbox', { name: 'Morning email digest trigger' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not save')
    expect(screen.getByRole('checkbox', { name: 'Morning email digest trigger' })).toBeChecked()
  })

  it('shows an error when triggers cannot be loaded', async () => {
    vi.spyOn(sampleTriggersBackend, 'listTriggers').mockRejectedValue(new BackendError('database', 'Database is locked'))
    renderSchedulerPage()
    expect(await screen.findByRole('alert')).toHaveTextContent('Database is locked')
  })

  it('draws past runs from the scheduled-run history and links a failure to its run', async () => {
    const historySpy = vi.spyOn(sampleScheduleRulesBackend, 'listScheduledRuns')
    renderSchedulerPage()
    const weekView = await findWeekView()
    expect(await within(weekView).findByText('14 sent')).toBeInTheDocument()
    expect(within(weekView).getByRole('link', { name: /Failed/ })).toHaveAttribute('href', '/runs/problems?runId=morning-digest-yesterday')
    expect(historySpy).toHaveBeenCalledWith('2026-11-15T00:00:00.000Z', '2026-11-24T00:00:00.000Z')
  })

  it('shows no past runs when the history is empty', async () => {
    vi.spyOn(sampleScheduleRulesBackend, 'listScheduledRuns').mockResolvedValue([])
    renderSchedulerPage()
    const weekView = await findWeekView()
    expect(within(weekView).queryByText('Needs you')).not.toBeInTheDocument()
    expect(within(weekView).queryByText('14 sent')).not.toBeInTheDocument()
  })

  it('stores the concurrency limit as a scheduler rule', async () => {
    const updateRulesSpy = vi.spyOn(sampleScheduleRulesBackend, 'updateScheduleRules')
    renderSchedulerPage()
    const concurrencySelect = screen.getByRole('combobox', { name: 'Agents running at the same time' })
    await vi.waitFor(() => expect(concurrencySelect).toBeEnabled())
    expect(concurrencySelect).toHaveValue('2')
    fireEvent.change(concurrencySelect, { target: { value: '4' } })
    await vi.waitFor(() => expect(updateRulesSpy).toHaveBeenCalledWith({ maxConcurrentRuns: 4 }))
    expect(await sampleScheduleRulesBackend.getScheduleRules()).toEqual({ maxConcurrentRuns: 4 })
  })

  it('stores the missed-run default and keep-awake in the app settings', async () => {
    const updateSettingsSpy = vi.spyOn(sampleAppSettingsBackend, 'updateAppSettings')
    renderSchedulerPage()
    const missedRunSelect = screen.getByRole('combobox', { name: 'If the Mac was asleep' })
    await vi.waitFor(() => expect(missedRunSelect).toBeEnabled())
    fireEvent.change(missedRunSelect, { target: { value: 'Skip the missed run' } })
    await vi.waitFor(() => expect(updateSettingsSpy).toHaveBeenCalledWith(expect.objectContaining({ missedRunDefaultPolicy: 'skip' })))
    fireEvent.click(screen.getByRole('checkbox', { name: 'Keep the Mac awake while an agent runs' }))
    await vi.waitFor(() =>
      expect(updateSettingsSpy).toHaveBeenLastCalledWith(expect.objectContaining({ missedRunDefaultPolicy: 'skip', keepAwakeWhileRunning: false })),
    )
  })

  it('puts a rule back and explains when it cannot be saved', async () => {
    vi.spyOn(sampleScheduleRulesBackend, 'updateScheduleRules').mockRejectedValue(new BackendError('database', 'Disk is full'))
    renderSchedulerPage()
    const concurrencySelect = screen.getByRole('combobox', { name: 'Agents running at the same time' })
    await vi.waitFor(() => expect(concurrencySelect).toBeEnabled())
    fireEvent.change(concurrencySelect, { target: { value: '1' } })
    expect(await screen.findByRole('alert')).toHaveTextContent('Disk is full')
    expect(concurrencySelect).toHaveValue('2')
  })

  it('switches to the list view', () => {
    renderSchedulerPage()
    fireEvent.click(screen.getByRole('button', { name: 'List' }))
    expect(screen.getByRole('region', { name: 'List view' })).toBeInTheDocument()
    expect(screen.queryByRole('region', { name: 'Week view' })).not.toBeInTheDocument()
  })
})
