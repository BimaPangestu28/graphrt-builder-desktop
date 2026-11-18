import { fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { getTeam } from '@/api/chains'
import { resetSampleAgents } from '@/api/sampleBackend/agents'
import { resetSampleChains } from '@/api/sampleBackend/chains'
import { TeamPage } from '../TeamPage'

function renderTeamPage() {
  return render(
    <MemoryRouter>
      <TeamPage />
    </MemoryRouter>,
  )
}

describe('TeamPage', () => {
  beforeEach(() => {
    resetSampleAgents()
    resetSampleChains()
  })

  it('shows the team, its members and guardrails', async () => {
    renderTeamPage()
    expect(await screen.findByRole('heading', { level: 1, name: 'Catering sales team' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Review 15 messages' })).toHaveAttribute('href', '/agents/outreach/test?runId=sample-run-outreach')
    const members = within(screen.getByRole('region', { name: 'Members' }))
    expect(members.getByText('Working')).toBeInTheDocument()
    expect(members.getByText('Needs you')).toBeInTheDocument()
    expect(members.getByText('Done')).toBeInTheDocument()
    expect(screen.getByText('Coordinator can suggest, I add')).toBeInTheDocument()
  })

  it('sends a message to the coordinator', async () => {
    renderTeamPage()
    await screen.findByRole('heading', { level: 1, name: 'Catering sales team' })
    fireEvent.change(screen.getByLabelText('Message the coordinator'), { target: { value: 'Skip offices this week' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send' }))
    expect(screen.getByText('Skip offices this week')).toBeInTheDocument()
    expect(screen.getByLabelText('Message the coordinator')).toHaveValue('')
  })

  it('pauses and resumes the team through the team agent status', async () => {
    renderTeamPage()
    fireEvent.click(await screen.findByRole('button', { name: 'Pause team' }))
    expect(await screen.findByRole('button', { name: 'Resume team' })).toBeInTheDocument()
    expect(screen.getAllByText('Paused').length).toBeGreaterThan(1)
    expect((await getTeam('sales-team')).status).toBe('paused')
    fireEvent.click(screen.getByRole('button', { name: 'Resume team' }))
    expect(await screen.findByRole('button', { name: 'Pause team' })).toBeInTheDocument()
  })

  it('adds one of your agents as a member', async () => {
    renderTeamPage()
    fireEvent.click(await screen.findByRole('button', { name: 'Add member' }))
    fireEvent.change(screen.getByRole('combobox', { name: 'New member' }), { target: { value: 'translate-bahasa' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add to team' }))
    expect(await within(screen.getByRole('region', { name: 'Members' })).findByText('Translate to Bahasa')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Add to team' })).not.toBeInTheDocument()
    expect((await getTeam('sales-team')).members.map((member) => member.agentId)).toContain('translate-bahasa')
  })
})
