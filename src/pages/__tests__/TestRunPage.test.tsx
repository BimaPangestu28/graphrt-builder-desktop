import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { routePaths } from '@/routes'
import { TestRunPage } from '@/pages/TestRunPage'

function renderTestRunPage() {
  return render(
    <MemoryRouter initialEntries={[routePaths.testRun]}>
      <Routes>
        <Route path={routePaths.testRun} element={<TestRunPage />} />
        <Route path={routePaths.runResult} element={<p>Run result screen</p>} />
      </Routes>
    </MemoryRouter>,
  )
}

describe('TestRunPage', () => {
  it('shows the paused test run with the approval card', () => {
    renderTestRunPage()
    expect(screen.getByRole('heading', { level: 1, name: 'Test run' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Send this message?' })).toBeInTheDocument()
    expect(screen.getByText('Waiting for you')).toBeInTheDocument()
    expect(screen.getAllByRole('listitem')).toHaveLength(5)
  })

  it('disables approval while the message is empty', () => {
    renderTestRunPage()
    fireEvent.change(screen.getByLabelText('Message, edit before sending if needed'), { target: { value: '  ' } })
    expect(screen.getByRole('button', { name: 'Approve and send' })).toBeDisabled()
  })

  it('goes to the run result after approving', () => {
    renderTestRunPage()
    fireEvent.click(screen.getByRole('button', { name: 'Approve and send' }))
    expect(screen.getByText('Run result screen')).toBeInTheDocument()
  })

  it('replaces the approval card when the place is skipped, and can test again', () => {
    renderTestRunPage()
    fireEvent.click(screen.getByRole('button', { name: 'Skip this place' }))
    expect(screen.getByRole('heading', { name: 'Skipped this place' })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Send this message?' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Test again' }))
    expect(screen.getByRole('heading', { name: 'Send this message?' })).toBeInTheDocument()
  })
})
