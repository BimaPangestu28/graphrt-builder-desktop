import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { TeamPage } from '../TeamPage'

function renderTeamPage() {
  return render(
    <MemoryRouter>
      <TeamPage />
    </MemoryRouter>,
  )
}

describe('TeamPage', () => {
  it('shows the team, its members and guardrails', () => {
    renderTeamPage()
    expect(screen.getByRole('heading', { level: 1, name: 'Catering sales team' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Review 15 messages' })).toBeInTheDocument()
    expect(screen.getByText('Coordinator can suggest, I add')).toBeInTheDocument()
  })

  it('sends a message to the coordinator', () => {
    renderTeamPage()
    fireEvent.change(screen.getByLabelText('Message the coordinator'), { target: { value: 'Skip offices this week' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send' }))
    expect(screen.getByText('Skip offices this week')).toBeInTheDocument()
    expect(screen.getByLabelText('Message the coordinator')).toHaveValue('')
  })

  it('pauses and resumes the team', () => {
    renderTeamPage()
    fireEvent.click(screen.getByRole('button', { name: 'Pause team' }))
    expect(screen.getByRole('button', { name: 'Resume team' })).toBeInTheDocument()
    expect(screen.getAllByText('Paused').length).toBeGreaterThan(1)
  })
})
