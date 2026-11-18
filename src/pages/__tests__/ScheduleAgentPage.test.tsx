import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
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
  it('opens as a dialog with weekdays at 09:00 preselected', () => {
    renderScheduleAgentPage()
    expect(screen.getByRole('dialog', { name: 'Run it on a schedule' })).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: 'Weekdays' })).toBeChecked()
    expect(screen.getByLabelText('Time')).toHaveValue('09:00')
    expect(screen.getByRole('checkbox', { name: 'Skip places I already messaged' })).toBeChecked()
  })

  it('disables the time fields when running by hand', () => {
    renderScheduleAgentPage()
    fireEvent.click(screen.getByRole('radio', { name: 'By hand' }))
    expect(screen.getByRole('radio', { name: 'By hand' })).toBeChecked()
    expect(screen.getByLabelText('Time')).toBeDisabled()
    expect(screen.getByLabelText('Time zone')).toBeDisabled()
  })

  it('goes Home after activating', () => {
    renderScheduleAgentPage()
    fireEvent.change(screen.getByLabelText('City'), { target: { value: 'Metro' } })
    expect(screen.getByLabelText('City')).toHaveValue('Metro')
    fireEvent.click(screen.getByRole('button', { name: 'Activate agent' }))
    expect(screen.getByText('Home screen')).toBeInTheDocument()
  })

  it('closes back to the run result on Escape', () => {
    renderScheduleAgentPage()
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(screen.getByText('Run result screen')).toBeInTheDocument()
  })
})
