import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { BackendError } from '@/api/client'
import { resetSampleTriggers, sampleTriggersBackend } from '@/api/sampleBackend/triggers'
import { routePaths } from '@/routes'
import { ScheduleAgentPage } from '@/pages/ScheduleAgentPage'

function renderScheduleAgentPage() {
  return render(
    <MemoryRouter initialEntries={[routePaths.scheduleAgent]}>
      <Routes>
        <Route path={routePaths.scheduleAgent} element={<ScheduleAgentPage />} />
        <Route path={routePaths.home} element={<p>Home screen</p>} />
        <Route path={routePaths.runResult} element={<p>Run result screen</p>} />
      </Routes>
    </MemoryRouter>,
  )
}

describe('ScheduleAgentPage', () => {
  beforeEach(() => {
    resetSampleTriggers()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('opens as a dialog with weekdays at 09:00 preselected', () => {
    renderScheduleAgentPage()
    expect(screen.getByRole('dialog', { name: 'Run it on a schedule' })).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: 'Weekdays' })).toBeChecked()
    expect(screen.getByLabelText('Time')).toHaveValue('09:00')
    expect(screen.getByRole('checkbox', { name: 'Skip places I already messaged' })).toBeChecked()
  })

  it('previews the next runs of the chosen schedule', async () => {
    const previewSpy = vi.spyOn(sampleTriggersBackend, 'previewSchedule')
    renderScheduleAgentPage()
    expect(await screen.findByText(/^Next runs: (Mon|Tue|Wed|Thu|Fri) \d+ \w+ 09:00/)).toBeInTheDocument()
    expect(previewSpy).toHaveBeenCalledWith('0 0 9 * * Mon-Fri', 'Asia/Jakarta', 3)
    fireEvent.click(screen.getByRole('radio', { name: 'Every day' }))
    fireEvent.change(screen.getByLabelText('Time'), { target: { value: '07:30' } })
    expect(previewSpy).toHaveBeenLastCalledWith('0 30 7 * * *', 'Asia/Jakarta', 3)
    expect(await screen.findByText(/07:30 · .* 07:30 · .* 07:30$/)).toBeInTheDocument()
  })

  it('builds a custom schedule from the chosen days', async () => {
    const previewSpy = vi.spyOn(sampleTriggersBackend, 'previewSchedule')
    renderScheduleAgentPage()
    fireEvent.click(screen.getByRole('radio', { name: 'Custom' }))
    fireEvent.click(screen.getByRole('button', { name: 'Wed' }))
    expect(previewSpy).toHaveBeenLastCalledWith('0 0 9 * * Mon,Fri', 'Asia/Jakarta', 3)
    fireEvent.click(screen.getByRole('button', { name: 'Mon' }))
    fireEvent.click(screen.getByRole('button', { name: 'Fri' }))
    expect(await screen.findByText('Pick a time and at least one day')).toBeInTheDocument()
  })

  it('disables the time fields when running by hand', () => {
    renderScheduleAgentPage()
    fireEvent.click(screen.getByRole('radio', { name: 'By hand' }))
    expect(screen.getByRole('radio', { name: 'By hand' })).toBeChecked()
    expect(screen.getByLabelText('Time')).toBeDisabled()
    expect(screen.getByLabelText('Time zone')).toBeDisabled()
    expect(screen.getByText('Runs only when you start it')).toBeInTheDocument()
  })

  it('creates the trigger and goes Home after activating', async () => {
    const createTriggerSpy = vi.spyOn(sampleTriggersBackend, 'createTrigger')
    renderScheduleAgentPage()
    fireEvent.change(screen.getByLabelText('City'), { target: { value: 'Metro' } })
    expect(screen.getByLabelText('City')).toHaveValue('Metro')
    fireEvent.click(screen.getByRole('button', { name: 'Activate agent' }))
    expect(await screen.findByText('Home screen')).toBeInTheDocument()
    expect(createTriggerSpy).toHaveBeenCalledWith({
      agentId: 'maps-leads',
      cronExpression: '0 0 9 * * Mon-Fri',
      timezone: 'Asia/Jakarta',
      missedRunPolicy: 'run_once',
      inputs: { keyword: 'cafe', city: 'Metro', skipAlreadyMessaged: true, approvalMode: 'once-per-run' },
    })
  })

  it('creates no trigger when running by hand', async () => {
    const createTriggerSpy = vi.spyOn(sampleTriggersBackend, 'createTrigger')
    renderScheduleAgentPage()
    fireEvent.click(screen.getByRole('radio', { name: 'By hand' }))
    fireEvent.click(screen.getByRole('button', { name: 'Activate agent' }))
    expect(await screen.findByText('Home screen')).toBeInTheDocument()
    expect(createTriggerSpy).not.toHaveBeenCalled()
  })

  it('stays open with the error when the trigger cannot be created', async () => {
    vi.spyOn(sampleTriggersBackend, 'createTrigger').mockRejectedValue(new BackendError('schedule', 'Bad schedule'))
    renderScheduleAgentPage()
    fireEvent.click(screen.getByRole('button', { name: 'Activate agent' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Bad schedule')
    expect(screen.getByRole('dialog', { name: 'Run it on a schedule' })).toBeInTheDocument()
  })

  it('closes back to the run result on Escape', () => {
    renderScheduleAgentPage()
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(screen.getByText('Run result screen')).toBeInTheDocument()
  })
})
