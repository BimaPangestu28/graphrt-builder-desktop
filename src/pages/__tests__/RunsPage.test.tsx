import { fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { RunsPage } from '../RunsPage'

function renderRunsPage() {
  return render(
    <MemoryRouter>
      <RunsPage />
    </MemoryRouter>,
  )
}

describe('RunsPage', () => {
  it('lists runs and opens the scheduled Maps leads run by default', () => {
    renderRunsPage()
    expect(screen.getByRole('heading', { level: 1, name: 'Runs' })).toBeInTheDocument()
    expect(screen.getAllByRole('row')).toHaveLength(7)
    expect(screen.getByRole('heading', { level: 2, name: 'Maps leads to WhatsApp' })).toBeInTheDocument()
    expect(screen.getByText('You approved 11 of 12')).toBeInTheDocument()
  })

  it('filters by status', () => {
    renderRunsPage()
    fireEvent.click(screen.getByRole('button', { name: 'Failed 1' }))
    const table = screen.getByRole('table')
    expect(within(table).getAllByRole('row')).toHaveLength(2)
    expect(within(table).getByText('Gmail sign-in expired')).toBeInTheDocument()
  })

  it('filters by agent', () => {
    renderRunsPage()
    fireEvent.change(screen.getByRole('combobox', { name: 'Agent' }), { target: { value: 'Morning email digest' } })
    expect(within(screen.getByRole('table')).getAllByRole('row')).toHaveLength(3)
    expect(screen.getByRole('button', { name: 'Running 0' })).toBeInTheDocument()
  })

  it('switches and closes the detail panel', () => {
    renderRunsPage()
    fireEvent.click(screen.getByRole('button', { name: 'Show run: Catering assistant, 08:52' }))
    expect(screen.getByRole('heading', { level: 2, name: 'Catering assistant' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Open in Inbox' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Show raw log' }))
    expect(screen.getByLabelText('Raw log')).toHaveTextContent('approval requested')
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    expect(screen.queryByRole('heading', { level: 2 })).not.toBeInTheDocument()
  })
})
