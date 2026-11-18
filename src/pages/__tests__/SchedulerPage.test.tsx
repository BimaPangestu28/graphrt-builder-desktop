import { fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { BackendError } from '@/api/client'
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

  it('switches to the list view', () => {
    renderSchedulerPage()
    fireEvent.click(screen.getByRole('button', { name: 'List' }))
    expect(screen.getByRole('region', { name: 'List view' })).toBeInTheDocument()
    expect(screen.queryByRole('region', { name: 'Week view' })).not.toBeInTheDocument()
  })
})
