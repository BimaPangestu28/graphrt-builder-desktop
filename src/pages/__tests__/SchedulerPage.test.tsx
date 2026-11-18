import { fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { SchedulerPage } from '../SchedulerPage'

function renderSchedulerPage() {
  return render(
    <MemoryRouter>
      <SchedulerPage />
    </MemoryRouter>,
  )
}

describe('SchedulerPage', () => {
  it('shows the current week with past and planned runs', () => {
    renderSchedulerPage()
    expect(screen.getByRole('heading', { level: 1, name: 'Schedule' })).toBeInTheDocument()
    expect(screen.getByText('16 to 22 Nov · Asia/Jakarta')).toBeInTheDocument()
    const weekView = screen.getByRole('region', { name: 'Week view' })
    expect(within(weekView).getByText('Today')).toBeInTheDocument()
    expect(within(weekView).getByText('Needs you')).toBeInTheDocument()
    expect(within(weekView).getByText('Failed')).toBeInTheDocument()
    expect(within(weekView).getAllByText('07:00').length).toBeGreaterThan(1)
  })

  it('moves to the next week with the arrow', () => {
    renderSchedulerPage()
    fireEvent.click(screen.getByRole('button', { name: 'Next week' }))
    expect(screen.getByText('23 to 29 Nov · Asia/Jakarta')).toBeInTheDocument()
  })

  it('pauses planned runs when a trigger is turned off', () => {
    renderSchedulerPage()
    const weekView = screen.getByRole('region', { name: 'Week view' })
    const pausedCountBefore = within(weekView).getAllByText('Paused').length
    fireEvent.click(screen.getByRole('checkbox', { name: 'Morning email digest trigger' }))
    expect(within(weekView).getAllByText('Paused').length).toBe(pausedCountBefore + 4)
  })

  it('switches to the list view', () => {
    renderSchedulerPage()
    fireEvent.click(screen.getByRole('button', { name: 'List' }))
    expect(screen.getByRole('region', { name: 'List view' })).toBeInTheDocument()
    expect(screen.queryByRole('region', { name: 'Week view' })).not.toBeInTheDocument()
  })
})
