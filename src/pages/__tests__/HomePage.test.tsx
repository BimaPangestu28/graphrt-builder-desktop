import { fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { routePaths } from '@/routes'
import { HomePage } from '@/pages/HomePage'
import { getGreetingForHour } from '@/pages/home-dashboard/greeting'

function renderHomePage() {
  return render(
    <MemoryRouter initialEntries={[routePaths.home]}>
      <Routes>
        <Route path={routePaths.home} element={<HomePage />} />
        <Route path={routePaths.batchApproval} element={<p>Batch approval screen</p>} />
      </Routes>
    </MemoryRouter>,
  )
}

describe('HomePage', () => {
  it('greets the user and lists what needs them', () => {
    renderHomePage()
    expect(screen.getByRole('heading', { level: 1, name: /^Good (morning|afternoon|evening)$/ })).toBeInTheDocument()
    expect(screen.getByText('3 things need you · next run tomorrow 07:00')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Home' })).toHaveAttribute('aria-current', 'page')
  })

  it('shows agents, recent runs and monthly usage', () => {
    renderHomePage()
    expect(screen.getByRole('link', { name: /Invoice reminders/ })).toHaveTextContent('Paused')
    const recentRunsTable = screen.getByRole('table')
    expect(within(recentRunsTable).getByText('Failed')).toBeInTheDocument()
    expect(screen.getByText('$0.38')).toBeInTheDocument()
  })

  it('opens the batch review from "Review messages"', () => {
    renderHomePage()
    fireEvent.click(screen.getByRole('link', { name: 'Review messages' }))
    expect(screen.getByText('Batch approval screen')).toBeInTheDocument()
  })

  it('picks a greeting for the time of day', () => {
    expect(getGreetingForHour(8)).toBe('Good morning')
    expect(getGreetingForHour(14)).toBe('Good afternoon')
    expect(getGreetingForHour(21)).toBe('Good evening')
  })
})
