import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { routePaths } from '@/routes'
import { RunResultPage } from '@/pages/RunResultPage'

function renderRunResultPage() {
  return render(
    <MemoryRouter initialEntries={[routePaths.runResult]}>
      <Routes>
        <Route path={routePaths.runResult} element={<RunResultPage />} />
        <Route path={routePaths.scheduleAgent} element={<p>Schedule screen</p>} />
      </Routes>
    </MemoryRouter>,
  )
}

describe('RunResultPage', () => {
  it('shows the succeeded test with stats and places', () => {
    renderRunResultPage()
    expect(screen.getByRole('heading', { level: 1, name: 'Test run' })).toBeInTheDocument()
    expect(screen.getByText('Succeeded')).toBeInTheDocument()
    expect(screen.getByText('$0.004')).toBeInTheDocument()
    expect(screen.getByRole('cell', { name: '[PLACE NAME 1]' })).toBeInTheDocument()
    expect(screen.getByText('15 more places')).toBeInTheDocument()
  })

  it('offers the places as a CSV download', () => {
    renderRunResultPage()
    const exportLink = screen.getByRole('link', { name: 'Export CSV' })
    expect(exportLink).toHaveAttribute('download', 'maps-leads-test-run.csv')
    expect(decodeURIComponent(exportLink.getAttribute('href') ?? '')).toContain('"[PLACE NAME 1]","[PHONE]","Sent"')
  })

  it('opens the schedule dialog from "What next?"', () => {
    renderRunResultPage()
    fireEvent.click(screen.getByRole('button', { name: 'Run it every weekday on new places' }))
    expect(screen.getByText('Schedule screen')).toBeInTheDocument()
  })
})
